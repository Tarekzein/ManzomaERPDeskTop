<?php

namespace App\Modules\Finance\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Account extends Model
{
    use Auditable;

    protected $casts = ['is_group' => 'boolean', 'allow_manual' => 'boolean', 'is_active' => 'boolean'];

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('code');
    }

    /** Debit-natured accounts: assets and expenses (plus contra-revenue). */
    public function isDebitNature(): bool
    {
        return in_array($this->type, ['asset', 'expense'], true);
    }
}
