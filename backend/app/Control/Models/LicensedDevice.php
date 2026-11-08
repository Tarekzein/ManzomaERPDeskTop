<?php

namespace App\Control\Models;

class LicensedDevice extends ControlModel
{
    protected $attributes = ['status' => 'active'];

    public $incrementing = false;

    protected $keyType = 'string';

    protected function casts(): array
    {
        return ['last_seen_at' => 'immutable_datetime', 'offline_reserved_until' => 'immutable_datetime'];
    }

    public function license()
    {
        return $this->belongsTo(License::class);
    }

    public function companies()
    {
        return $this->hasMany(LicensedCompany::class, 'device_id');
    }

    public function assignedCompany()
    {
        return $this->belongsTo(LicensedCompany::class, 'company_id');
    }
}
