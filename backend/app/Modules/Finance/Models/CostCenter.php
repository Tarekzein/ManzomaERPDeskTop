<?php

namespace App\Modules\Finance\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;

class CostCenter extends Model
{
    use Auditable;

    protected $casts = ['is_active' => 'boolean'];
}
