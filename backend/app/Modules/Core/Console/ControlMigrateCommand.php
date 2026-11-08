<?php

namespace App\Modules\Core\Console;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;

class ControlMigrateCommand extends Command
{
    protected $signature = 'erp:control-migrate';

    protected $description = 'Upgrade only the isolated license-control database';

    public function handle(): int
    {
        if (! config('licensing.control_enabled')) {
            return self::SUCCESS;
        }
        if (config('database.connections.control.driver') === 'sqlite') {
            $db = config('database.connections.control.database');
            if (! is_dir(dirname($db))) {
                mkdir(dirname($db), 0700, true);
            } if (! is_file($db)) {
                touch($db);
                chmod($db, 0600);
            }
        }

        $code = Artisan::call('migrate', ['--database' => 'control', '--path' => 'database/control', '--force' => true], $this->output);
        if ($code !== self::SUCCESS) {
            return $code;
        }
        Artisan::call('filament:assets', [], $this->output);

        return Artisan::call('vendor:publish', ['--tag' => 'manzoma-control-assets', '--force' => true], $this->output);
    }
}
