<?php

namespace App\Control\Models;

use Illuminate\Database\Eloquent\Model;

abstract class ControlModel extends Model
{
    protected $connection = 'control';

    protected $guarded = [];
}
