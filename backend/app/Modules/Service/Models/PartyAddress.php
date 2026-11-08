<?php

namespace App\Modules\Service\Models;

use App\Modules\Parties\Models\Party;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PartyAddress extends Model
{
    use Auditable;

    protected $table = 'party_addresses';

    protected $casts = ['is_default' => 'boolean', 'latitude' => 'decimal:7', 'longitude' => 'decimal:7'];

    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class, 'party_id');
    }
}
