<?php

namespace App\Modules\Inventory\Models;

use App\Support\Model;

class CostLayer extends Model
{
    protected $casts = ['date' => 'date:Y-m-d', 'original_quantity' => 'decimal:4', 'remaining_quantity' => 'decimal:4', 'unit_cost' => 'decimal:4'];
}
