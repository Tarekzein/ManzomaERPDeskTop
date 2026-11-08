<?php

namespace App\Control\Services;

use App\Control\Models\License;
use App\Control\Models\LicensedCompany;
use App\Control\Models\LicensedDevice;
use App\Control\Models\LicenseEvent;
use App\Modules\Core\Http\Middleware\SelectCompany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class LicenseService
{
    public function audit(?string $license, string $event, array $details = []): void
    {
        LicenseEvent::create(['license_id' => $license, 'actor_id' => auth('control')->id(), 'event' => $event, 'details' => $details, 'created_at' => now()]);
    }

    public function available(License $license, ?string $mode = null): void
    {
        if ($license->status !== 'active' || $license->expires_at->isPast()) {
            $this->fail('License is expired, suspended or revoked.');
        }
        if ($mode && ! in_array($license->mode, [$mode, 'hybrid'], true)) {
            $this->fail('This license does not allow '.$mode.' use.');
        }
    }

    public function fail(string $message): never
    {
        throw ValidationException::withMessages(['license' => __($message)]);
    }

    public function save(array $data, ?License $record = null): License
    {
        $data = Validator::make($data, ['customer_name' => 'required|string|max:150', 'email' => 'nullable|email|max:255', 'mode' => 'required|in:online,offline,hybrid', 'status' => 'required|in:active,suspended,revoked', 'max_companies' => 'required|integer|min:1|max:10000', 'max_devices' => 'required|integer|min:1|max:10000', 'expires_at' => 'required|date', 'notes' => 'nullable|string|max:5000', 'offline_company_slots' => 'sometimes|integer|min:0|max:1|lte:max_companies'])->validate();
        $data['offline_company_slots'] = $data['mode'] === 'online' ? 0 : ($data['offline_company_slots'] ?? ($record && $record->mode === $data['mode'] ? min(1, $record->offline_company_slots) : 1));
        if ($data['offline_company_slots'] > $data['max_companies']) {
            $this->fail('Offline slots per device cannot exceed the shared company limit.');
        }
        if ($data['mode'] === 'offline' && $data['offline_company_slots'] < 1) {
            $this->fail('Offline licenses need at least one offline company slot per device.');
        }
        if (! $record && Carbon::parse($data['expires_at'])->isPast()) {
            $this->fail('A new license must have a future expiry.');
        }

        return DB::connection('control')->transaction(function () use ($data, $record) {
            if ($record) {
                $record = License::whereKey($record->id)->lockForUpdate()->firstOrFail();
                if ($record->companies()->count() > $data['max_companies'] || $this->occupiedDevices($record) > $data['max_devices']) {
                    $this->fail('Limits cannot be lower than allocated companies/devices.');
                }
                if ($data['mode'] !== 'hybrid' && $record->companies()->where('mode', '!=', $data['mode'])->exists()) {
                    $this->fail('Existing allocations need the selected license mode.');
                }
                $record->fill($data);
                $record->revision++;
                $record->save();
            } else {
                $secret = bin2hex(random_bytes(32));
                $record = License::create($data + ['activation_secret' => $secret, 'activation_hash' => hash('sha256', $secret)]);
            }
            $this->audit($record->id, 'license.saved', ['status' => $record->status, 'max_companies' => $record->max_companies, 'max_devices' => $record->max_devices]);

            return $record;
        });
    }

    private function occupiedDevices(License $license): int
    {
        return $license->devices()->where(fn ($q) => $q->where('status', 'active')->orWhere('offline_reserved_until', '>', now()))->count();
    }

    public function request(array $data): array
    {
        $data = Validator::make($data, ['device_id' => 'required|string|size:64|regex:/^[a-f0-9]+$/', 'public_key' => 'required|string|max:4000', 'machine_hash' => 'required|string|size:64|regex:/^[a-f0-9]+$/', 'name' => 'required|string|max:120', 'platform' => 'nullable|string|max:40', 'app_version' => 'nullable|string|max:40', 'existing_companies' => 'sometimes|array|max:1000', 'existing_companies.*.id' => 'required|uuid', 'existing_companies.*.name' => 'required|string|max:120', 'proof' => 'required|string|max:1024'])->validate();
        $key = openssl_pkey_get_public($data['public_key']);
        $details = $key ? openssl_pkey_get_details($key) : false;
        if (! $details || $details['type'] !== OPENSSL_KEYTYPE_RSA || $details['bits'] < 2048 || hash('sha256', $details['key']) !== $data['device_id']) {
            $this->fail('Invalid device public key.');
        }
        $data['public_key'] = $details['key'];
        $proof = implode("\n", ['manzoma-device-v1', $data['device_id'], $data['machine_hash']]);
        if (openssl_verify($proof, LicenseSigner::decode($data['proof']), $key, OPENSSL_ALGO_SHA256) !== 1) {
            $this->fail('The device request proof is invalid.');
        }

        return $data;
    }

    /** Shareable paste key: the authority address travels with the secret, never its signing key. */
    public function activationKey(License $license): string
    {
        return 'MZ1.'.LicenseSigner::encode(json_encode(['server' => rtrim(config('licensing.issuer'), '/'), 'key' => $license->id.'.'.$license->activation_secret], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    }

    public function activate(string $key, array $request, string $ip): array
    {
        [$id,$secret] = array_pad(explode('.', $key, 2), 2, '');
        $license = License::find($id);
        if (! $license || ! hash_equals($license->activation_hash, hash('sha256', $secret))) {
            $this->fail('Invalid activation key.');
        }

        // Re-read mode, settings and allocations under the same lock used by all capacity changes.
        return DB::connection('control')->transaction(function () use ($license, $request, $ip) {
            $license = License::whereKey($license->id)->lockForUpdate()->firstOrFail();

            return $this->allocate($license, $request, 0, $license->mode !== 'online', $ip, true);
        }, 3);
    }

    public function allocate(License $license, array $request, int $extraSlots, bool $offline, ?string $ip = null, bool $activation = false): array
    {
        $data = $this->request($request);

        return DB::connection('control')->transaction(function () use ($license, $data, $extraSlots, $offline, $ip, $activation) {
            $license = License::whereKey($license->id)->lockForUpdate()->firstOrFail();
            $this->available($license, $offline ? 'offline' : 'online');
            $device = LicensedDevice::find($data['device_id']);
            if ($device && ($device->license_id !== $license->id || $device->machine_hash !== $data['machine_hash'] || $device->status !== 'active')) {
                $this->fail('This device is revoked or belongs to another license.');
            }
            if (! $device && $this->occupiedDevices($license) >= $license->max_devices) {
                $this->fail('The device limit has been reached.');
            }
            $device ??= new LicensedDevice(['id' => $data['device_id'], 'license_id' => $license->id, 'public_key' => $data['public_key'], 'machine_hash' => $data['machine_hash']]);
            $device->fill(collect($data)->only(['name', 'platform', 'app_version'])->all());
            if ($ip) {
                $device->fill(['last_ip' => $ip, 'last_seen_at' => now()]);
            }
            $device->save();
            if ($offline) {
                if ($extraSlots < 0 || $extraSlots > 1000) {
                    $this->fail('Invalid offline slot count.');
                }
                foreach ($data['existing_companies'] ?? [] as $company) {
                    $this->addOffline($license, $device, $company['id'], $company['name'], true);
                }
                // Activation registers a device only. Creating/joining its single company is separate.
                if ($activation) { $extraSlots = 0; }
                for ($i = 0; $i < $extraSlots; $i++) {
                    $this->addOffline($license, $device, (string) Str::uuid(), 'Offline company slot');
                }

            }
            $this->audit($license->id, $activation ? 'device.activated' : ($offline ? 'offline.issued' : 'device.activated'), ['device_id' => $device->id, 'new_slots' => $extraSlots]);

            return $this->certificate($license, $device);
        }, 3);
    }

    private function addOffline(License $license, LicensedDevice $device, string $id, string $name, bool $registered = false): void
    {
        $this->assertCompanyChoice($device, 'offline', $id);
        $existing = LicensedCompany::where('mode', 'offline')->where('company_key', $id)->first();
        if ($existing) {
            if ($existing->license_id !== $license->id || $existing->device_id !== $device->id) {
                $this->fail('An offline company is already allocated elsewhere.');
            }

            if ($registered) {
                $existing->update(['name' => $name, 'registered_at' => $existing->registered_at ?? now()]);
            }

            $device->update(['company_id' => $existing->id]);

            return;
        }
        if ($license->companies()->count() >= $license->max_companies) {
            $this->fail('The company limit has been reached.');
        }
        $license->increment('revision');
        $company = $license->companies()->create(['device_id' => $device->id, 'mode' => 'offline', 'company_key' => $id, 'name' => $name, 'reserved_until' => $license->expires_at, 'registered_at' => $registered ? now() : null]);
        $device->update(['company_id' => $company->id]);
    }

    public function assertCompanyChoice(LicensedDevice $device, string $mode, string $key): void
    {
        $assigned = $device->fresh()->assignedCompany;
        abort_if($assigned && ($assigned->mode !== $mode || $assigned->company_key !== $key), 409, 'Each device can use only one company. Use another licensed device for a different company.');
        abort_if(! $assigned && $device->companies()->count() > 1, 409, 'This device has legacy multiple-company allocations. Contact the license administrator.');
    }

    /** Reuses the company allocation; joining another device never creates another company. */
    public function assignCompany(LicensedDevice $device, string $mode, string $key): array
    {
        return DB::connection('control')->transaction(function () use ($device, $mode, $key) {
            $license = License::whereKey($device->license_id)->lockForUpdate()->firstOrFail();
            $this->available($license, $mode);
            abort_unless($device->fresh()->status === 'active', 403, 'Device has been revoked.');
            $this->assertCompanyChoice($device, $mode, $key);
            $company = $license->companies()->where('mode', $mode)->where('company_key', $key)->first();
            abort_unless($company, 403, 'This company is not assigned to the license.');
            if ($mode === 'offline') {
                abort_unless($company->device_id && LicensedDevice::whereKey($company->device_id)->where('status', 'active')->exists(), 403, 'The main computer is not licensed.');
            }
            $device->update(['company_id' => $company->id]);
            $this->audit($license->id, 'device.company_assigned', ['device_id' => $device->id, 'company_key' => $key, 'mode' => $mode]);

            return $this->certificate($license, $device);
        }, 3);
    }

    public function reserveOffline(LicensedDevice $device, string $id): array
    {
        return DB::connection('control')->transaction(function () use ($device, $id) {
            $license = License::whereKey($device->license_id)->lockForUpdate()->firstOrFail();
            $this->available($license, 'offline');
            abort_unless($device->fresh()->status === 'active', 403, 'Device has been revoked.');
            $this->addOffline($license, $device, $id, 'Offline company slot');
            $this->audit($license->id, 'offline.slot_reserved', ['device_id' => $device->id, 'company_key' => $id]);

            return $this->certificate($license, $device);
        }, 3);
    }

    public function confirmOffline(LicensedDevice $device, array $companies): array
    {
        return DB::connection('control')->transaction(function () use ($device, $companies) {
            $license = License::whereKey($device->license_id)->lockForUpdate()->firstOrFail();
            $this->available($license, 'offline');
            abort_unless($device->fresh()->status === 'active', 403, 'Device has been revoked.');
            foreach ($companies as $company) {
                $row = $license->companies()->where('mode', 'offline')->where('device_id', $device->id)->where('company_key', $company['id'])->first();
                abort_unless($row, 403, 'This offline company is not assigned to this device.');
                if (! $row->registered_at) {
                    $this->audit($license->id, 'offline.company_registered', ['device_id' => $device->id, 'company_key' => $company['id']]);
                }
                $row->update(['name' => $company['name'], 'registered_at' => $row->registered_at ?? now()]);
            }

            return $this->certificate($license, $device);
        }, 3);
    }

    public function bindOnline(License $license, string $slug, ?string $provisioningName = null): void
    {
        DB::connection('control')->transaction(function () use ($license, $slug, $provisioningName) {
            $license = License::whereKey($license->id)->lockForUpdate()->firstOrFail();
            $this->available($license, 'online');
            $companies = config('erp.multi_company') ? SelectCompany::companies() : [['slug' => 'default', 'name' => config('app.name')]];
            $company = collect($companies)->firstWhere('slug', $slug);
            if ($company && $provisioningName !== null) {
                $company['name'] = $provisioningName;
            }
            if (! $company && $provisioningName !== null && preg_match('/^[a-z0-9_]{2,40}$/', $slug)) {
                $company = ['slug' => $slug, 'name' => $provisioningName];
            }
            if (! $company) {
                $this->fail('Select a registered server company.');
            }
            $existing = LicensedCompany::where('mode', 'online')->where('company_key', $slug)->first();
            if ($existing?->license_id === $license->id) {
                return;
            }
            if ($existing || $license->companies()->count() >= $license->max_companies) {
                $this->fail('Company already assigned or license company limit reached.');
            }
            $license->increment('revision');
            $license->companies()->create(['mode' => 'online', 'company_key' => $slug, 'name' => $company['name'], 'registered_at' => $provisioningName === null ? now() : null]);
            $this->audit($license->id, 'company.bound', ['slug' => $slug]);
        }, 3);
    }

    public function revokeDevice(LicensedDevice $device): void
    {
        DB::connection('control')->transaction(function () use ($device) {
            $license = License::whereKey($device->license_id)->lockForUpdate()->firstOrFail();
            $license->increment('revision');
            $device->update(['status' => 'revoked']);
            $this->audit($device->license_id, 'device.revoked', ['device_id' => $device->id]);
        });
    }

    public function releaseCompany(LicensedCompany $company): void
    {
        DB::connection('control')->transaction(function () use ($company) {
            License::whereKey($company->license_id)->lockForUpdate()->firstOrFail();
            $company = LicensedCompany::whereKey($company->id)->lockForUpdate()->firstOrFail();
            if ($company->mode === 'offline' && $company->reserved_until?->isFuture()) {
                $this->fail('Offline slots cannot be released before their last signed expiry.');
            }
            $this->audit($company->license_id, 'company.released', ['mode' => $company->mode, 'company_key' => $company->company_key, 'name' => $company->name]);
            $company->delete();
        });
    }

    public function restoreDevice(LicensedDevice $device): void
    {
        DB::connection('control')->transaction(function () use ($device) {
            $license = License::whereKey($device->license_id)->lockForUpdate()->firstOrFail();
            $this->available($license);
            $device = LicensedDevice::whereKey($device->id)->lockForUpdate()->firstOrFail();
            if ($device->status !== 'active' && ! $device->offline_reserved_until?->isFuture() && $this->occupiedDevices($license) >= $license->max_devices) {
                $this->fail('The device limit has been reached.');
            }
            $license->increment('revision');
            $device->update(['status' => 'active']);
            $this->audit($license->id, 'device.restored', ['device_id' => $device->id]);
        });
    }

    /** Every signed file extends its offline reservation in the same locked transaction. */
    public function certificate(License $license, LicensedDevice $device, bool $includeInactive = false): array
    {
        return DB::connection('control')->transaction(function () use ($license, $device, $includeInactive) {
            $license = License::whereKey($license->id)->lockForUpdate()->firstOrFail();
            $device = LicensedDevice::whereKey($device->id)->lockForUpdate()->firstOrFail();
            if ($device->license_id !== $license->id) {
                $this->fail('Device license assignment changed.');
            }
            if (! $includeInactive) {
                $this->available($license);
            }
            $status = $device->status !== 'active' ? 'revoked' : ($license->expires_at->isPast() ? 'expired' : $license->status);
            $assigned = $device->assignedCompany;
            if ($status === 'active' && $assigned?->mode === 'offline') {
                if (! $device->offline_reserved_until || $device->offline_reserved_until->lt($license->expires_at)) {
                    $device->update(['offline_reserved_until' => $license->expires_at]);
                }
                $license->companies()->where('device_id', $device->id)->where('mode', 'offline')->where(fn ($query) => $query->whereNull('reserved_until')->orWhere('reserved_until', '<', $license->expires_at))->update(['reserved_until' => $license->expires_at]);
            }

            return app(LicenseSigner::class)->sign([
                'v' => 1, 'issuer' => rtrim(config('licensing.issuer'), '/'), 'license_id' => $license->id, 'revision' => $license->revision,
                'status' => $status, 'customer_name' => $license->customer_name, 'device_id' => $device->id, 'machine_hash' => $device->machine_hash, 'mode' => $license->mode,
                'device_public_key' => $device->public_key,
                'company_assignment' => $assigned ? ['id' => $assigned->company_key, 'name' => $assigned->name, 'mode' => $assigned->mode, 'host_device_id' => $assigned->device_id] : null,
                'issued_at' => now()->timestamp, 'expires_at' => $license->expires_at->timestamp,
                'offline_companies' => $license->companies()->whereKey($device->company_id)->where('device_id', $device->id)->where('mode', 'offline')->get(['company_key', 'name', 'registered_at'])->map(fn ($company) => ['id' => $company->company_key, 'name' => $company->name, 'registered' => $company->registered_at !== null])->all(),
                'online_companies' => $license->companies()->whereKey($device->company_id)->where('mode', 'online')->pluck('company_key')->all(),
                'max_devices' => $license->max_devices, 'max_companies' => $license->max_companies,
            ]);
        }, 3);
    }
}
