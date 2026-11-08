<?php

namespace App\Modules\Core\Console;

use App\Modules\Core\Services\TenantContext;
use Illuminate\Console\Command;

class TenantQueueCommand extends Command
{
    protected $signature = 'erp:queue-work {--company=} {--once}';

    protected $description = 'Run a queue worker pinned to one registered company database';

    public function handle(TenantContext $tenants): int
    {
        $tenants->select($this->option('company'));

        return $this->call('queue:work', ['connection' => 'database', '--sleep' => 3, '--tries' => 3, '--max-time' => 3600, '--once' => (bool) $this->option('once')]);
    }
}
