<?php

namespace App\Modules\Core\Console;

use App\Modules\Core\Services\RestoreService;
use App\Modules\Core\Services\TenantContext;
use Illuminate\Console\Command;

class RestoreCommand extends Command
{
    protected $signature = 'erp:restore {file : ZIP bundle path} {--company=} {--confirm : Confirm services are stopped and replace this company} {--json}';

    protected $description = 'Verify and restore a company database plus private attachments; requires downtime';

    public function handle(TenantContext $tenants, RestoreService $restore): int
    {
        if (! $this->option('confirm')) {
            $this->error('Stop HTTP, workers and scheduler; then pass --confirm to replace the selected company.');

            return self::FAILURE;
        }
        $tenants->select($this->option('company'));
        $result = $restore->restore($this->argument('file'));
        $this->option('json') ? $this->line(json_encode($result)) : $this->info('Restored; safety backup: '.$result['safety_backup']);

        return self::SUCCESS;
    }
}
