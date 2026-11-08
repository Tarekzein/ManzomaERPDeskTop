<?php

namespace App\Control\Http;

use App\Control\Services\DeviceProof;
use App\Control\Services\LicenseSigner;
use App\Control\Services\OfflinePeerProof;
use Closure;
use Illuminate\Http\Request;

class EnforceLicense
{
    public function handle(Request $request, Closure $next)
    {
        if (! config('licensing.enforce') || $request->is('api/licensing/*') || $request->is('api/system/ping') || $request->is('api/system/companies')) {
            return $next($request);
        }
        if ($path = config('licensing.offline_certificate')) {
            abort_unless(is_file($path), 403, 'Import a valid offline license.');
            try {
                $claims = app(LicenseSigner::class)->verify(json_decode(file_get_contents($path), true, 32, JSON_THROW_ON_ERROR));
            } catch (\Throwable) {
                abort(403, 'The offline license is invalid or expired.');
            }
            abort_unless(in_array($claims['mode'], ['offline', 'hybrid'], true) && hash_equals($claims['device_id'], (string) config('licensing.device_id')) && hash_equals($claims['machine_hash'], (string) config('licensing.machine_hash')) && in_array(config('licensing.company_id'), array_column($claims['offline_companies'], 'id'), true), 403, 'This device or company is not licensed.');
            if ($request->header('X-Manzoma-LAN') === '1') {
                app(OfflinePeerProof::class)->verify($request, $claims);
            }
        } else {
            app(DeviceProof::class)->verify($request);
        }

        return $next($request);
    }
}
