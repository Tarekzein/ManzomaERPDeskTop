<?php

namespace App\Modules\Parties\Models;

use App\Models\User;
use App\Modules\Inventory\Models\PriceList;
use App\Support\Concerns\Auditable;
use App\Support\Concerns\HasTags;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Party extends Model
{
    use Auditable, HasTags, SoftDeletes;

    protected $casts = [
        'is_customer' => 'boolean',
        'is_supplier' => 'boolean',
        'subject_to_wht' => 'boolean',
        'is_active' => 'boolean',
        'credit_limit' => 'decimal:2',
        'wht_rate' => 'decimal:2',
    ];

    public function contacts(): HasMany
    {
        return $this->hasMany(PartyContact::class);
    }

    public function priceList(): BelongsTo
    {
        return $this->belongsTo(PriceList::class);
    }

    public function salesperson(): BelongsTo
    {
        return $this->belongsTo(User::class, 'salesperson_id');
    }
}
