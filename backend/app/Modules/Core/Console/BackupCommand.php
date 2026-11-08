<?php

namespace App\Modules\Core\Console;

use App\Modules\Core\Services\BackupService;
use App\Modules\Core\Services\TenantContext;
use Illuminate\Console\Command;

class BackupCommand extends Command
{
    protected $signature = 'erp:backup {--keep=30 : Number of backups to keep} {--json} {--bundle : Include private attachments and checksum manifest} {--company=}';

    protected $description = 'Back up the company database';

    public function handle(BackupService $backups): int
    {
        app(TenantContext::class)->select($this->option('company'));
        $file = $this->option('bundle') ? $backups->bundle() : $backups->create();
        $all = $backups->list();
        foreach (array_slice($all, max(1, (int) $this->option('keep'))) as $old) {
            @unlink($old['path']);
        }
        $this->option('json') ? $this->line(json_encode($file)) : $this->info('Backup written: '.$file['file']);

        return self::SUCCESS;
    }
}
