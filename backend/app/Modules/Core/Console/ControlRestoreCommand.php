<?php

namespace App\Modules\Core\Console;

use App\Control\Services\ControlBackupService;
use Illuminate\Console\Command;

class ControlRestoreCommand extends Command
{
    protected $signature = 'erp:control-restore {file} {--to= : New, empty staging directory}';

    protected $description = 'Decrypt and verify an issuer recovery set into a new protected staging directory';

    public function handle(ControlBackupService $service): int
    {
        if (! $this->option('to')) {
            $this->error('Specify a new staging directory with --to. Live issuer files are never replaced.');

            return self::FAILURE;
        }
        $manifest = $service->unpack($this->argument('file'), (string) config('licensing.backup_password'), $this->option('to'));
        $this->line(json_encode(['verified' => true, 'driver' => $manifest['driver'], 'created_at' => $manifest['created_at'], 'staged_at' => $this->option('to')], JSON_PRETTY_PRINT));

        return self::SUCCESS;
    }
}
