<?php

namespace App\Modules\Trading\Models;

use App\Modules\Finance\Models\Voucher;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Allocation extends Model
{
    protected $casts = ['amount' => 'decimal:2', 'date' => 'date:Y-m-d'];

    public function document(): BelongsTo
    {
        return $this->belongsTo(TradeDocument::class, 'document_id');
    }

    public function voucher(): BelongsTo
    {
        return $this->belongsTo(Voucher::class);
    }

    public function returnDocument(): BelongsTo
    {
        return $this->belongsTo(TradeDocument::class, 'return_id');
    }
}
