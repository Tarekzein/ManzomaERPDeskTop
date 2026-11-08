<?php

namespace App\Modules\Finance\Models;

use App\Modules\Parties\Models\Party;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Cheque extends Model
{
    use Auditable;

    protected $casts = ['issue_date' => 'date:Y-m-d', 'due_date' => 'date:Y-m-d', 'amount' => 'decimal:2'];

    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class);
    }

    public function cashAccount(): BelongsTo
    {
        return $this->belongsTo(CashAccount::class);
    }

    public function voucher(): BelongsTo
    {
        return $this->belongsTo(Voucher::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(ChequeEvent::class)->orderBy('id');
    }
}
