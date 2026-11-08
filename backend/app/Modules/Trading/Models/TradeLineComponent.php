<?php

namespace App\Modules\Trading\Models;

use App\Support\Model;

class TradeLineComponent extends Model
{
    public $timestamps = false;

    protected $casts = [
        'quantity_per_unit' => 'decimal:4', 'quantity' => 'decimal:4',
        'unit_cost' => 'decimal:4', 'cost_amount' => 'decimal:2',
    ];
}
