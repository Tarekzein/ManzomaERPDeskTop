<?php

namespace App\Modules\Core\Console;

use App\Control\Models\License;
use App\Control\Services\LicenseService;
use App\Modules\Core\Http\Middleware\SelectCompany;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/**
 * Server mode: create a company database (erp_<slug>), install it and
 * register it so desktops can choose it at sign-in.
 */
class CreateCompanyCommand extends Command
{
    protected $signature = 'erp:company {slug : Short id, a-z 0-9 _} {name : Display name}
        {--license= : License UUID that will own this company} {--admin-password= : First administrator password} {--admin-username=admin} {--demo}';

    protected $description = 'Create and register a company database (server mode)';

    public function handle(): int
    {
        $slug = strtolower((string) $this->argument('slug'));
        if (! preg_match('/^[a-z0-9_]{2,40}$/', $slug)) {
            $this->error('Slug must be 2-40 characters: a-z, 0-9, _');

            return self::FAILURE;
        }
        $connection = config('database.default');
        if (! in_array(DB::connection()->getDriverName(), ['mysql', 'mariadb'], true)) {
            $this->error('Server mode needs MySQL or MariaDB.');

            return self::FAILURE;
        }
        if (config('licensing.enforce')) {
            $license = License::find($this->option('license'));
            if (! $license) {
                $this->error('Provide --license with an active online/hybrid license UUID.');

                return self::FAILURE;
            }
            app(LicenseService::class)->bindOnline($license, $slug, (string) $this->argument('name'));
        }
        $database = config('erp.company_db_prefix').$slug;
        DB::statement("CREATE DATABASE IF NOT EXISTS `{$database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        config(["database.connections.{$connection}.database" => $database]);
        DB::purge($connection);

        $code = Artisan::call('erp:install', [
            '--company' => $this->argument('name'),
            '--admin-username' => $this->option('admin-username'),
            '--admin-password' => $this->option('admin-password'),
            '--demo' => $this->option('demo'),
        ], $this->output);
        if ($code !== self::SUCCESS) {
            return $code;
        }

        $registry = config('erp.companies_registry');
        $companies = collect(SelectCompany::companies())->reject(fn ($c) => $c['slug'] === $slug)->push(['slug' => $slug, 'name' => $this->argument('name')])->values()->all();
        @mkdir(dirname($registry), 0775, true);
        file_put_contents($registry, json_encode($companies, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        $this->info("Company {$slug} is ready on database {$database}.");

        return self::SUCCESS;
    }
}
