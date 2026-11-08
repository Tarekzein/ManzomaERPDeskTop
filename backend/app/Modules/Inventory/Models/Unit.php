<?php

namespace App\Modules\Inventory\Models;

use App\Support\Model;

class Unit extends Model
{
    protected $casts = ['allow_fraction' => 'boolean'];
}
