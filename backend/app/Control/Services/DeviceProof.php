<?php

namespace App\Control\Services;

use App\Control\Models\LicensedDevice;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DeviceProof
{
    public function verify(Request $request, bool $companyRequired = true, bool $licenseStatusRefresh = false, bool $allowOffline = false): LicensedDevice
    {
        $id = (string) $request->header('X-Device-Id');
        $time = (string) $request->header('X-Device-Time');
        $nonce = (string) $request->header('X-Device-Nonce');
        abort_unless(ctype_digit($time) && abs(now()->timestamp - (int) $time) <= 300 && preg_match('/^[a-f0-9]{32,64}$/', $nonce), 403, 'Invalid or expired device proof.');
        $device = LicensedDevice::find($id);
        abort_unless($device && ($licenseStatusRefresh || $device->status === 'active'), 403, 'Device is not activated or has been revoked.');
        $license = $device->license;
        if (! $licenseStatusRefresh) {
            app(LicenseService::class)->available($license, $allowOffline ? null : 'online');
        }
        $company = config('erp.multi_company') ? (string) $request->header('X-Company') : 'default';
        $message = implode("\n", ['manzoma-api-v1', $id, $time, $nonce, strtoupper($request->method()), $request->getPathInfo(), (string) $request->header('X-Company', '')]);
        $sig = (string) $request->header('X-Device-Signature');
        abort_unless($sig && openssl_verify($message, LicenseSigner::decode($sig), $device->public_key, OPENSSL_ALGO_SHA256) === 1, 403, 'Invalid device signature.');
        if ($companyRequired) {
            $assigned = $device->assignedCompany;
            abort_unless($assigned && $assigned->license_id === $license->id && $assigned->mode === 'online' && $assigned->company_key === $company, 403, 'This company is not assigned to this device.');
        }
        $fresh = DB::connection('control')->table('device_nonces')->insertOrIgnore(['device_id' => $id, 'nonce' => $nonce, 'expires_at' => now()->addMinutes(10)]);
        abort_unless($fresh === 1, 403, 'This device request was already used.');
        if (! $device->last_seen_at || $device->last_seen_at->lt(now()->subMinute())) {
            $device->update(['last_seen_at' => now(), 'last_ip' => $request->ip(), 'app_version' => substr((string) $request->header('X-App-Version', $device->app_version), 0, 40)]);
        }

        return $device;
    }
}
