<?php

namespace App\Modules\CRM\Models;

use App\Models\User;
use App\Modules\Parties\Models\Party;
use App\Support\Concerns\Auditable;
use App\Support\Concerns\HasTags;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Lead extends Model
{
    use Auditable, HasTags, SoftDeletes;

    protected $table = 'crm_leads';

    protected $casts = ['expected_value' => 'decimal:2', 'converted_at' => 'datetime'];

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function source(): BelongsTo
    {
        return $this->belongsTo(Source::class);
    }

    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class);
    }

    public function opportunities(): HasMany
    {
        return $this->hasMany(Opportunity::class);
    }
}
