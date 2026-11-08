<?php

namespace App\Modules\Finance\Models;

use App\Modules\Parties\Models\Party;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class JournalLine extends Model
{
    protected $casts = ['debit' => 'decimal:2', 'credit' => 'decimal:2', 'fx_rate' => 'decimal:8', 'fx_amount' => 'decimal:2'];

    public function entry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class);
    }

    public function costCenter(): BelongsTo
    {
        return $this->belongsTo(CostCenter::class);
    }
}
