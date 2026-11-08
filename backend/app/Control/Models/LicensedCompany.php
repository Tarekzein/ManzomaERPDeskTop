<?php

namespace App\Control\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;

class LicensedCompany extends ControlModel
{
    use HasUuids;

    protected function casts(): array
    {
        return ['reserved_until' => 'immutable_datetime', 'registered_at' => 'immutable_datetime'];
    }

    public function license()
    {
        return $this->belongsTo(License::class);
    }

    public function device()
    {
        return $this->belongsTo(LicensedDevice::class, 'device_id');
    }

    public function registration()
    {
        return $this->hasOne(CompanyRegistration::class, 'slug', 'company_key');
    }
}
