<?php

namespace App\Modules\Core\Console;

use App\Modules\Core\Services\DemoDataService;
use App\Modules\Core\Services\InstallService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;

/**
 * Creates a company file: migrations, chart of accounts, roles, defaults and
 * the first administrator. The desktop shell runs this on first launch.
 */
class InstallCommand extends Command
{
    protected $signature = 'erp:install
        {--company= : Company name (Arabic)}
        {--company-en= : Company name (English)}
        {--currency=EGP : Base currency}
        {--vat=14 : Default VAT rate}
        {--tax-number= : Tax registration number}
        {--admin-name= : Administrator full name}
        {--admin-username=admin : Administrator user name}
        {--admin-password= : Administrator password}
        {--locale=ar : Interface language (ar|en)}
        {--demo : Load demonstration data}
        {--json : Print the result as JSON}';

    protected $description = 'Install a new ManzomaERP company database';

    public function handle(InstallService $installer, DemoDataService $demo): int
    {
        Artisan::call('migrate', ['--force' => true]);

        if ($installer->isInstalled()) {
            $installer->syncPermissions();

            return $this->finish(['ok' => true, 'already_installed' => true]);
        }
        // The desktop passes the password in the environment, not on the command line.
        $password = (string) ($this->option('admin-password') ?: getenv('ERP_ADMIN_PASSWORD'));
        if (strlen($password) < 6) {
            return $this->finish(['ok' => false, 'error' => 'The administrator password must be at least 6 characters.'], self::FAILURE);
        }

        $admin = $installer->install([
            'company_name' => $this->option('company') ?: 'شركتي',
            'company_name_en' => $this->option('company-en') ?: ($this->option('company') ?: 'My Company'),
            'currency' => $this->option('currency'),
            'vat_rate' => (float) $this->option('vat'),
            'tax_number' => $this->option('tax-number'),
            'admin_name' => $this->option('admin-name') ?: 'مدير النظام',
            'admin_username' => $this->option('admin-username'),
            'admin_password' => $password,
            'locale' => $this->option('locale'),
        ]);

        if ($this->option('demo')) {
            Auth::setUser($admin);
            $demo->seed();
        }

        return $this->finish(['ok' => true, 'admin' => $admin->username, 'demo' => (bool) $this->option('demo')]);
    }

    private function finish(array $result, int $code = self::SUCCESS): int
    {
        if ($this->option('json')) {
            $this->line(json_encode($result, JSON_UNESCAPED_UNICODE));
        } else {
            $result['ok'] ? $this->info('ManzomaERP is ready.') : $this->error($result['error'] ?? 'Install failed');
        }

        return $code;
    }
}
