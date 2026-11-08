<?php

namespace App\Providers;

use App\Models\User;
use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Core\Services\SettingsService;
use App\Modules\Finance\Services\AccountResolver;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Request-scoped caches: reset per request in long-running servers.
        $this->app->scoped(SettingsService::class);
        $this->app->scoped(DynamicFormService::class);
        $this->app->scoped(AccountResolver::class);
        $this->app->scoped(AuditService::class);
    }

    public function boot(): void
    {
        Model::preventLazyLoading(false);

        // Administrators hold every permission.
        Gate::before(fn (Authenticatable $user) => $user instanceof User && $user->hasRole('admin') ? true : null);

        // SQLite company files: write-ahead log for concurrent readers,
        // wait instead of failing when another request is writing.
        if (DB::connection()->getDriverName() === 'sqlite' && config('database.connections.sqlite.database') !== ':memory:') {
            try {
                DB::statement('PRAGMA journal_mode = WAL');
                DB::statement('PRAGMA busy_timeout = 10000');
                DB::statement('PRAGMA synchronous = NORMAL');
            } catch (\Throwable) {
                // The database may not exist yet (first run before install).
            }
        }
    }
}
