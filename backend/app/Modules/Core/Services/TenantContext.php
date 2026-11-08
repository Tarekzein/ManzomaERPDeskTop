<?php

namespace App\Modules\Core\Services;

use App\Modules\Core\Http\Middleware\SelectCompany;
use App\Modules\Finance\Services\AccountResolver;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;

class TenantContext
{
    /** Enter before reading tenant jobs, deserializing models or resolving services. */
    public function select(?string $slug): void
    {
        if (! config('erp.multi_company')) {
            abort_if($slug, 400, 'Company selection is only available in server mode.');

            return;
        }
        abort_unless($slug && in_array($slug, SelectCompany::registered(), true), 400, 'Unknown registered company.');
        $connection = config('database.default');
        config(["database.connections.$connection.database" => config('erp.company_db_prefix').$slug, 'cache.prefix' => 'erp_'.$slug.'_']);
        DB::purge($connection);
        DB::reconnect($connection);
        app(SettingsService::class)->flush();
        app(AccountResolver::class)->flush();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
