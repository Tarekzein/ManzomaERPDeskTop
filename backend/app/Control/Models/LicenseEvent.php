<?php

namespace App\Control\Models;

class LicenseEvent extends ControlModel
{
    public $timestamps = false;

    protected function casts(): array
    {
        return ['details' => 'array', 'created_at' => 'immutable_datetime'];
    }
}
