<?php

namespace App\Modules\Core\Console;

use App\Control\Models\ControlAdmin;
use App\Control\Services\SigningKeys;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;

class ControlInstallCommand extends Command
{
    protected $signature = 'erp:control-install {--email=} {--name=License administrator}';

    protected $description = 'Install the separate license-control database, signing keys and operator account';

    public function handle(): int
    {
        if (! config('licensing.control_enabled')) {
            $this->error('Set ERP_CONTROL_ENABLED=true on the control server first.');

            return self::FAILURE;
        }
        $email = $this->option('email') ?: ($this->input->isInteractive() ? $this->ask('Operator email') : null);
        $password = getenv('ERP_CONTROL_PASSWORD') ?: ($this->input->isInteractive() ? $this->secret('Operator password (at least 12 characters)') : '');
        if (! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 12) {
            $this->error('A valid email and ERP_CONTROL_PASSWORD of at least 12 characters are required.');

            return self::FAILURE;
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
        if ($code !== 0) {
            return $code;
        }
        app(SigningKeys::class)->ensure();
        $public = config('licensing.public_key');
        ControlAdmin::updateOrCreate(['email' => $email], ['name' => $this->option('name'), 'password' => $password, 'active' => true]);
        Artisan::call('filament:assets', [], $this->output);
        Artisan::call('vendor:publish', ['--tag' => 'manzoma-control-assets', '--force' => true], $this->output);
        $this->info('Control database ready. Sign in at /control. Public key: '.$public);
        $this->warn('Preserve the private key and APP_KEY. Distribute only the public key with desktop builds.');

        return self::SUCCESS;
    }
}
