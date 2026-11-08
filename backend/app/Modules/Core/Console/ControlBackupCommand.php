<?php

namespace App\Modules\Core\Console;

use App\Control\Services\ControlBackupService;
use Illuminate\Console\Command;

class ControlBackupCommand extends Command
{
    protected $signature = 'erp:control-backup {--to=} {--keep=14}';

    protected $description = 'Create an encrypted issuer recovery set; password from ERP_CONTROL_BACKUP_PASSWORD';

    public function handle(ControlBackupService $service): int
    {
        abort_unless(config('licensing.control_enabled'), 403);
        $directory = $this->option('to') ?: config('licensing.backup_path');
        $file = $service->create($directory, (string) config('licensing.backup_password'));
        $this->line($file);
        $files = glob(rtrim($directory, '/').'/issuer-*.mzb') ?: [];
        rsort($files);
        foreach (array_slice($files, max(1, (int) $this->option('keep'))) as $old) {
            unlink($old);
        }

        return self::SUCCESS;
    }
}
