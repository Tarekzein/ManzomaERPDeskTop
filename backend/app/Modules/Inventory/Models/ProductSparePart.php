<?php

namespace App\Modules\Inventory\Models;

use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductSparePart extends Model
{
    public $timestamps = false;

    protected $casts = ['quantity_per_unit' => 'decimal:4'];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'spare_part_id')->withTrashed();
    }
}
