<?php

namespace App\Modules\Core\Http\Middleware;

use App\Modules\Core\Services\SettingsService;
use App\Modules\Finance\Services\AccountResolver;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;
use Symfony\Component\HttpFoundation\Response;

/**
 * Server mode hosts several company databases on one backend. The desktop
 * sends X-Company with the company's slug; each slug maps to its own
 * database (erp_<slug>). In local mode the shell starts one backend per
 * company file and this middleware does nothing.
 */
class SelectCompany
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('erp.multi_company')) {
            return $next($request);
        }

        // Listing companies for the login screen needs no company.
        if ($request->is('api/licensing/*') || $request->is('api/system/companies') || $request->is('api/system/ping')) {
            return $next($request);
        }

        $slug = strtolower((string) $request->header('X-Company', ''));
        if (! preg_match('/^[a-z0-9_]{2,40}$/', $slug) || ! in_array($slug, self::registered(), true)) {
            return response()->json(['message' => __('erp.company_unknown'), 'code' => 'company_unknown'], 400);
        }

        $connection = config('database.default');
        config(["database.connections.{$connection}.database" => config('erp.company_db_prefix').$slug]);
        config(['cache.prefix' => 'erp_'.$slug.'_']);
        DB::purge($connection);
        DB::reconnect($connection);

        app(PermissionRegistrar::class)->forgetCachedPermissions();
        app(SettingsService::class)->flush();
        app(AccountResolver::class)->flush();

        return $next($request);
    }

    /**
     * @return array<int, string>
     */
    public static function registered(): array
    {
        return array_column(self::companies(), 'slug');
    }

    /**
     * @return array<int, array{slug: string, name: string}>
     */
    public static function companies(): array
    {
        $path = config('erp.companies_registry');
        if (! is_file($path)) {
            return [];
        }
        $data = json_decode((string) file_get_contents($path), true);

        return is_array($data) ? array_values($data) : [];
    }
}
