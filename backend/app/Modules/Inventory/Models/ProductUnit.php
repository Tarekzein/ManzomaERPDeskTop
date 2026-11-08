<?php

namespace App\Modules\Inventory\Models;

use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductUnit extends Model
{
    protected $casts = [
        'factor' => 'decimal:4',
        'sale_price' => 'decimal:4',
        'purchase_price' => 'decimal:4',
        'is_default_sale' => 'boolean',
        'is_default_purchase' => 'boolean',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function unit(): BelongsTo
    {
        return $this->belongsTo(Unit::class);
    }

    /** Sale price of this unit: explicit, or the base price times the factor. */
    public function effectiveSalePrice(): float
    {
        return $this->sale_price !== null ? (float) $this->sale_price : round((float) $this->product->sale_price * (float) $this->factor, 4);
    }

    public function effectivePurchasePrice(): float
    {
        return $this->purchase_price !== null ? (float) $this->purchase_price : round((float) $this->product->purchase_price * (float) $this->factor, 4);
    }
}
