<?php

namespace App\Modules\Service\Models;

use App\Modules\Parties\Models\Party;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ServiceRequest extends Model
{
    use Auditable;

    protected $table = 'service_requests';

    protected $casts = [];

    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class, 'party_id');
    }

    public function unit(): BelongsTo
    {
        return $this->belongsTo(CustomerUnit::class, 'unit_id');
    }

    public function address(): BelongsTo
    {
        return $this->belongsTo(PartyAddress::class, 'address_id');
    }

    public function visits(): HasMany
    {
        return $this->hasMany(ServiceVisit::class, 'request_id');
    }
}
