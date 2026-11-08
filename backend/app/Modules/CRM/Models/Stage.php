<?php

namespace App\Modules\CRM\Models;

use App\Support\Model;

class Stage extends Model
{
    protected $table = 'crm_stages';

    protected $casts = ['is_won' => 'boolean', 'is_lost' => 'boolean'];
}
