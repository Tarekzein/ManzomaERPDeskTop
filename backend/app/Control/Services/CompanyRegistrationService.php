<?php

namespace App\Control\Services;

use App\Control\Models\License;
use App\Control\Models\LicensedDevice;
use App\Modules\Core\Http\Middleware\SelectCompany;
use App\Modules\Core\Services\InstallService;
use App\Modules\Core\Services\SettingsService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;

/** License-first server onboarding. Reservations survive failures so retries cannot duplicate companies. */
class CompanyRegistrationService
{
    public function register(LicensedDevice $device, array $data): array
    {
        $control = DB::connection('control');
        $hash = hash_hmac('sha256', json_encode($data, JSON_THROW_ON_ERROR), config('app.key'));
        $registration = $control->transaction(function () use ($control, $device, $data, $hash) {
            $license = License::whereKey($device->license_id)->lockForUpdate()->firstOrFail();
            $slug = config('erp.multi_company') ? 'company_'.str_replace('-', '', $data['registration_id']) : 'default';
            app(LicenseService::class)->assertCompanyChoice($device, 'online', $slug);
            app(LicenseService::class)->available($license, 'online');
            abort_unless($device->fresh()->status === 'active', 403, 'Device has been revoked.');
            $existing = $control->table('company_registrations')->where('id', $data['registration_id'])->first();
            if ($existing) {
                abort_unless($existing->license_id === $license->id && $existing->device_id === $device->id && hash_equals($existing->input_hash, $hash), 409, 'This registration belongs to another request. Retry with the original company details and password.');
                app(LicenseService::class)->bindOnline($license, $existing->slug, $existing->name);
                app(LicenseService::class)->assignCompany($device, 'online', $existing->slug);
                if ($existing->status === 'ready') {
                    return $existing;
                }
                abort_if($existing->status === 'installing' && $existing->lease_until > now()->toDateTimeString(), 409, 'Company registration is still running. Please wait and retry.');
                $control->table('company_registrations')->where('id', $existing->id)->update(['status' => 'installing', 'lease_until' => now()->addMinutes(10), 'updated_at' => now()]);

                return $control->table('company_registrations')->find($existing->id);
            }

            $slug = config('erp.multi_company') ? 'company_'.str_replace('-', '', $data['registration_id']) : 'default';
            if (config('erp.multi_company')) {
                $database = $this->database($slug);
                abort_unless(in_array(DB::connection()->getDriverName(), ['mysql', 'mariadb'], true), 422, 'Multi-company server registration needs MySQL or MariaDB.');
                abort_if(DB::selectOne('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [$database]), 409, 'A database already exists for this company. Contact the server administrator.');
            } else {
                abort_if(app(InstallService::class)->isInstalled(), 409, 'This server already has a company. Ask the administrator to assign it to your license.');
            }
            abort_if($control->table('company_registrations')->where('slug', $slug)->exists(), 409, 'This server company is already reserved.');
            app(LicenseService::class)->bindOnline($license, $slug, $data['name']);
            app(LicenseService::class)->assignCompany($device, 'online', $slug);
            $control->table('company_registrations')->insert([
                'id' => $data['registration_id'], 'license_id' => $license->id, 'device_id' => $device->id,
                'slug' => $slug, 'name' => $data['name'], 'input_hash' => $hash, 'status' => 'installing',
                'lease_until' => now()->addMinutes(10), 'created_at' => now(), 'updated_at' => now(),
            ]);

            return $control->table('company_registrations')->find($data['registration_id']);
        }, 3);

        if ($registration->status !== 'ready') {
            try {
                $this->install($registration->slug, $data);
                $this->publish($registration->slug, $registration->name);
                $control->table('company_registrations')->where('id', $registration->id)->update(['status' => 'ready', 'lease_until' => null, 'updated_at' => now()]);
                app(LicenseService::class)->audit($device->license_id, 'company.registered', ['registration_id' => $registration->id, 'slug' => $registration->slug]);
            } catch (\Throwable $error) {
                $control->table('company_registrations')->where('id', $registration->id)->update(['status' => 'failed', 'lease_until' => null, 'updated_at' => now()]);
                report($error);
                abort(503, 'Company setup could not finish. Retry with the same details. Its license slot is reserved; existing data has not been removed.');
            }
        }

        $device->license->companies()->where('mode', 'online')->where('company_key', $registration->slug)->update(['registered_at' => now(), 'name' => $registration->name]);

        return ['company' => ['slug' => $registration->slug, 'name' => $registration->name], 'certificate' => app(LicenseService::class)->certificate($device->license, $device)];
    }

    private function database(string $slug): string
    {
        $database = config('erp.company_db_prefix').$slug;
        abort_unless(preg_match('/^[a-zA-Z0-9_]{1,64}$/', $database), 422, 'Invalid company database prefix.');

        return $database;
    }

    protected function install(string $slug, array $data): void
    {
        $previous = DB::getDefaultConnection();
        $prefix = config('cache.prefix');
        $connection = config('database.connections.'.$previous);
        if (config('erp.multi_company')) {
            $database = $this->database($slug);
            config(['database.connections.provisioning_admin' => $connection]);
            try {
                DB::connection('provisioning_admin')->statement("CREATE DATABASE IF NOT EXISTS `{$database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
            } finally {
                DB::purge('provisioning_admin');
            }
            $connection['database'] = $database;
            $connection['url'] = null;
        }
        config(['database.connections.provisioning' => $connection, 'cache.prefix' => 'erp_'.$slug.'_']);
        DB::setDefaultConnection('provisioning');
        try {
            app(SettingsService::class)->flush();
            app(PermissionRegistrar::class)->forgetCachedPermissions();
            if (Artisan::call('migrate', ['--database' => 'provisioning', '--force' => true]) !== 0) {
                throw new \RuntimeException('Company migrations failed.');
            }
            $installer = app(InstallService::class);
            if (! $installer->isInstalled()) {
                $installer->install([
                    'company_name' => $data['name'], 'company_name_en' => $data['nameEn'] ?? $data['name'],
                    'currency' => $data['currency'], 'vat_rate' => $data['vatRate'], 'tax_number' => $data['taxNumber'] ?? null,
                    'admin_name' => $data['adminName'], 'admin_username' => $data['adminUsername'],
                    'admin_password' => $data['adminPassword'], 'locale' => $data['locale'],
                ]);
            }
        } finally {
            DB::setDefaultConnection($previous);
            DB::purge('provisioning');
            config(['cache.prefix' => $prefix]);
            app(SettingsService::class)->flush();
            app(PermissionRegistrar::class)->forgetCachedPermissions();
        }
    }

    private function publish(string $slug, string $name): void
    {
        $path = config('erp.companies_registry');
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0750, true);
        }
        $lock = fopen($path.'.lock', 'c');
        if (! $lock || ! flock($lock, LOCK_EX)) {
            throw new \RuntimeException('Cannot lock the company registry.');
        }
        try {
            if (is_file($path) && ! is_array(json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR))) {
                throw new \RuntimeException('The company registry is invalid. Restore it before registration.');
            }
            $companies = SelectCompany::companies();
            if (! collect($companies)->contains('slug', $slug)) {
                $companies[] = ['slug' => $slug, 'name' => $name];
            }
            $temporary = tempnam(dirname($path), '.company-registry-');
            if ($temporary === false || file_put_contents($temporary, json_encode($companies, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)) === false || ! rename($temporary, $path)) {
                throw new \RuntimeException('Cannot publish the company registry.');
            }
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}
