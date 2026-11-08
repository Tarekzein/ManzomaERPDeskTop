<?php

namespace App\Modules\Core\Console;

use App\Control\Services\CompanyReconciliation;
use Illuminate\Console\Command;

class ControlReconcileCommand extends Command
{
    protected $signature = 'erp:control-reconcile {--apply : Apply proven display/count corrections; never releases grants}';

    protected $description = 'Report license allocation metadata mismatches; dry-run by default';

    public function handle(CompanyReconciliation $service): int
    {
        abort_unless(config('licensing.control_enabled'), 403);
        $this->line(json_encode($service->run((bool) $this->option('apply')), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}
