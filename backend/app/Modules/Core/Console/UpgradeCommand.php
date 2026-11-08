<?php

namespace App\Modules\Core\Console;

use App\Modules\Core\Http\Middleware\SelectCompany;
use App\Modules\Core\Services\InstallService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/**
 * Runs on every start of a company file: applies new migrations and adds
 * any permissions introduced by an app update. On a server, `--all` does the
 * same for every registered company database.
 */
class UpgradeCommand extends Command
{
    protected $signature = 'erp:upgrade {--json} {--all : Every company in the server registry}';

    protected $description = 'Bring a company database up to date';

    public function handle(InstallService $installer): int
    {
        if (! $this->option('all')) {
            $result = $this->upgrade($installer);
            $this->option('json') ? $this->line(json_encode($result)) : $this->info($result['installed'] ? 'Up to date.' : 'Database is empty: run erp:install.');

            return self::SUCCESS;
        }

        $connection = config('database.default');
        $results = [];
        foreach (SelectCompany::companies() as $company) {
            config(["database.connections.{$connection}.database" => config('erp.company_db_prefix').$company['slug']]);
            DB::purge($connection);
            try {
                $results[$company['slug']] = $this->upgrade($installer);
                $this->option('json') || $this->info("{$company['slug']}: up to date");
            } catch (\Throwable $e) {
                $results[$company['slug']] = ['ok' => false, 'error' => $e->getMessage()];
                $this->error("{$company['slug']}: {$e->getMessage()}");
            }
        }
        if ($this->option('json')) {
            $this->line(json_encode($results));
        }

        return collect($results)->every(fn ($r) => $r['ok']) ? self::SUCCESS : self::FAILURE;
    }

    private function upgrade(InstallService $installer): array
    {
        if (Artisan::call('migrate', ['--force' => true]) !== 0) {
            throw new \RuntimeException('Company migration failed: '.Artisan::output());
        }
        $installed = $installer->isInstalled();
        if ($installed) {
            $installer->syncPermissions();
        }

        return ['ok' => true, 'installed' => $installed];
    }
}
