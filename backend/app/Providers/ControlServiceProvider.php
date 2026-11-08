<?php

namespace App\Providers;

use App\Control\Models\ControlAdmin;
use Illuminate\Support\ServiceProvider;

class ControlServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        if (config('licensing.control_enabled')) {
            $sessions = storage_path('framework/control-sessions');
            if (! is_dir($sessions)) {
                mkdir($sessions, 0700, true);
            }
            config(['session.driver' => 'file', 'session.files' => $sessions, 'session.cookie' => 'manzoma_control_session']);
        }
        config(['auth.guards.control' => ['driver' => 'session', 'provider' => 'control_admins'],
            'auth.providers.control_admins' => ['driver' => 'eloquent', 'model' => ControlAdmin::class]]);
    }

    public function boot(): void
    {
        $this->publishes([resource_path('control-assets') => public_path()], 'manzoma-control-assets');
    }
}
