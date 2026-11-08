<?php

namespace App\Modules\Inventory\Models;

use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Batch extends Model
{
    protected $casts = ['mfg_date' => 'date:Y-m-d', 'expiry_date' => 'date:Y-m-d'];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
