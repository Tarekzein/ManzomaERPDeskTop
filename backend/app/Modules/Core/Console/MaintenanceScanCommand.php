<?php

namespace App\Modules\Core\Console;

use App\Modules\Core\Http\Middleware\SelectCompany;
use App\Modules\Core\Services\TenantContext;
use App\Modules\Inventory\Services\StockAlertService;
use App\Modules\Service\Services\MaintenanceService;
use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

class MaintenanceScanCommand extends Command
{
    protected $signature = 'erp:maintenance-scan {--company=} {--all}';

    protected $description = 'Generate deduplicated maintenance follow-ups in each company';

    public function handle(TenantContext $tenants): int
    {
        if ($this->option('all') && config('erp.multi_company')) {
            $failed = false;
            foreach (SelectCompany::companies() as $company) {
                // A fresh process isolates model boot state, permissions and scoped caches.
                $process = new Process([PHP_BINARY, base_path('artisan'), 'erp:maintenance-scan', '--company='.$company['slug']], base_path());
                $process->setTimeout(600);
                $process->run();
                $this->line($company['slug'].': '.trim($process->getOutput()));
                if (! $process->isSuccessful()) {
                    $failed = true;
                    $this->error($process->getErrorOutput());
                }
            }

            return $failed ? self::FAILURE : self::SUCCESS;
        }
        $tenants->select($this->option('company'));
        $result = app(MaintenanceService::class)->scan();
        $result['stock_alerts_created'] = app(StockAlertService::class)->scan();
        $this->line(json_encode($result));

        return self::SUCCESS;
    }
}
