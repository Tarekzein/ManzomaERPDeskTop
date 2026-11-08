<?php

namespace App\Modules\Finance\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;

class TaxRate extends Model
{
    use Auditable;

    protected $casts = ['rate' => 'decimal:4', 'is_default' => 'boolean', 'is_active' => 'boolean'];
}
