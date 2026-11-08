<?php

namespace App\Modules\Inventory\Models;

use App\Modules\Finance\Models\TaxRate;
use App\Modules\Inventory\Services\SparePartsService;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Product extends Model
{
    use Auditable, SoftDeletes;

    protected $casts = [
        'uses_spare_parts' => 'boolean',
        'track_batches' => 'boolean',
        'track_serials' => 'boolean',
        'is_active' => 'boolean',
        'sale_price' => 'decimal:4',
        'min_sale_price' => 'decimal:4',
        'purchase_price' => 'decimal:4',
        'avg_cost' => 'decimal:4',
        'reorder_level' => 'decimal:4',
        'reorder_qty' => 'decimal:4',
    ];

    protected static function booted(): void
    {
        static::saving(fn (Product $product) => app(SparePartsService::class)->guardChange($product));
        static::deleting(fn (Product $product) => app(SparePartsService::class)->guardChange($product, true));
    }

    public function spareParts(): HasMany
    {
        return $this->hasMany(ProductSparePart::class)->orderBy('id');
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    public function baseUnit(): BelongsTo
    {
        return $this->belongsTo(Unit::class, 'base_unit_id');
    }

    public function taxRate(): BelongsTo
    {
        return $this->belongsTo(TaxRate::class);
    }

    public function units(): HasMany
    {
        return $this->hasMany(ProductUnit::class)->orderBy('factor');
    }

    public function balances(): HasMany
    {
        return $this->hasMany(StockBalance::class);
    }

    public function batches(): HasMany
    {
        return $this->hasMany(Batch::class);
    }

    public function isStock(): bool
    {
        return $this->type === 'stock';
    }
}
