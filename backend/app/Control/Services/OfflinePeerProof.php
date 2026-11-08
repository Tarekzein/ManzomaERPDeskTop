<?php

namespace App\Control\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/** LAN peers prove their own issuer-signed device grant; no authority connection is needed. */
class OfflinePeerProof
{
    public function verify(Request $request, array $host): void
    {
        try {
            $raw = (string) $request->header('X-Offline-Certificate');
            abort_if(strlen($raw) > 24000, 403);
            $peer = app(LicenseSigner::class)->verify(json_decode(LicenseSigner::decode($raw), true, 32, JSON_THROW_ON_ERROR));
            $binding = $peer['company_assignment'] ?? [];
            $company = (string) config('licensing.company_id');
            abort_unless(($binding['mode'] ?? null) === 'offline' && ($binding['id'] ?? null) === $company && ($binding['host_device_id'] ?? null) === $host['device_id'] && $peer['license_id'] === $host['license_id'] && $peer['issuer'] === $host['issuer'] && in_array($peer['mode'], ['offline', 'hybrid'], true), 403);
            $public = $peer['device_public_key'] ?? '';
            abort_unless(hash_equals(hash('sha256', $public), (string) ($peer['device_id'] ?? '')) && hash_equals($peer['device_id'], (string) $request->header('X-Device-Id')), 403);
            $time = (string) $request->header('X-Device-Time');
            $nonce = (string) $request->header('X-Device-Nonce');
            abort_unless(ctype_digit($time) && abs(now()->timestamp - (int) $time) <= 300 && preg_match('/^[a-f0-9]{32,64}$/', $nonce), 403);
            $message = implode("\n", ['manzoma-api-v1', $peer['device_id'], $time, $nonce, strtoupper($request->method()), $request->getPathInfo(), (string) $request->header('X-Company', '')]);
            abort_unless(openssl_verify($message, LicenseSigner::decode((string) $request->header('X-Device-Signature')), $public, OPENSSL_ALGO_SHA256) === 1, 403);
            abort_unless(Cache::add('offline-peer-'.hash('sha256', $peer['device_id'].$nonce), true, now()->addMinutes(10)), 403);
        } catch (\Throwable) {
            abort(403, 'This computer is not authorized for the shared company. Connect to the internet and pair it again.');
        }
    }
}
