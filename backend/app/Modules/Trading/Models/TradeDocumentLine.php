<?php

namespace App\Modules\Trading\Models;

use App\Modules\Finance\Models\TaxRate;
use App\Modules\Inventory\Models\Batch;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\ProductUnit;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TradeDocumentLine extends Model
{
    protected $casts = [
        'component_cost_amount' => 'decimal:2',
        'serial_numbers' => 'array',
        'factor' => 'decimal:4',
        'quantity' => 'decimal:4',
        'base_quantity' => 'decimal:4',
        'unit_price' => 'decimal:4',
        'discount_percent' => 'decimal:4',
        'discount_amount' => 'decimal:2',
        'tax_rate' => 'decimal:4',
        'gross_amount' => 'decimal:2',
        'total_discount' => 'decimal:2',
        'net_amount' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'line_total' => 'decimal:2',
        'unit_cost' => 'decimal:4',
        'cost_amount' => 'decimal:2',
        'processed_quantity' => 'decimal:4',
        'expiry_date' => 'date:Y-m-d',
    ];

    public function components(): HasMany
    {
        return $this->hasMany(TradeLineComponent::class)->orderBy('id');
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(TradeDocument::class, 'trade_document_id');
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    public function productUnit(): BelongsTo
    {
        return $this->belongsTo(ProductUnit::class);
    }

    public function taxRate(): BelongsTo
    {
        return $this->belongsTo(TaxRate::class);
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(Batch::class);
    }

    public function sourceLine(): BelongsTo
    {
        return $this->belongsTo(self::class, 'source_line_id');
    }

    public function remainingQuantity(): float
    {
        return round((float) $this->quantity - (float) $this->processed_quantity, 4);
    }
}
