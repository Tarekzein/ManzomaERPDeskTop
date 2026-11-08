<?php

namespace App\Control\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;

class License extends ControlModel
{
    use HasUuids;

    protected $hidden = ['activation_secret', 'activation_hash'];

    protected function casts(): array
    {
        return ['expires_at' => 'immutable_datetime', 'activation_secret' => 'encrypted', 'max_companies' => 'integer', 'max_devices' => 'integer', 'offline_company_slots' => 'integer', 'revision' => 'integer'];
    }

    public function devices()
    {
        return $this->hasMany(LicensedDevice::class);
    }

    public function registeredCompanies()
    {
        return $this->companies()->whereNotNull('registered_at');
    }

    public function reservedCompanies()
    {
        return $this->companies()->whereNull('registered_at');
    }

    public function companies()
    {
        return $this->hasMany(LicensedCompany::class);
    }
}
