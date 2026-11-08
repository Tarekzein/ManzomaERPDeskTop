<?php

namespace App\Modules\CRM\Models;

use App\Models\User;
use App\Modules\Parties\Models\Party;
use App\Modules\Trading\Models\TradeDocument;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Opportunity extends Model
{
    use Auditable, SoftDeletes;

    protected $table = 'crm_opportunities';

    protected $casts = ['value' => 'decimal:2', 'expected_close_date' => 'date:Y-m-d', 'won_at' => 'datetime', 'lost_at' => 'datetime'];

    public function lead(): BelongsTo
    {
        return $this->belongsTo(Lead::class);
    }

    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class);
    }

    public function stage(): BelongsTo
    {
        return $this->belongsTo(Stage::class);
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function source(): BelongsTo
    {
        return $this->belongsTo(Source::class);
    }

    public function lostReason(): BelongsTo
    {
        return $this->belongsTo(LostReason::class);
    }

    public function quotation(): BelongsTo
    {
        return $this->belongsTo(TradeDocument::class, 'quotation_id');
    }
}
