<?php

namespace App\Modules\Inventory\Models;

use App\Models\User;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StockDocument extends Model
{
    use Auditable;

    protected $casts = ['date' => 'date:Y-m-d', 'total_cost' => 'decimal:2', 'posted_at' => 'datetime', 'received_at' => 'datetime'];

    public function lines(): HasMany
    {
        return $this->hasMany(StockDocumentLine::class)->orderBy('id');
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function toWarehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class, 'to_warehouse_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
