<?php

namespace App\Modules\Finance\Models;

use App\Models\User;
use App\Modules\Parties\Models\Party;
use App\Modules\Trading\Models\Allocation;
use App\Modules\Trading\Models\TradeDocument;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Voucher extends Model
{
    use Auditable;

    protected $casts = ['date' => 'date:Y-m-d', 'amount' => 'decimal:2', 'tax_amount' => 'decimal:2', 'posted_at' => 'datetime', 'voided_at' => 'datetime'];

    public function cashAccount(): BelongsTo
    {
        return $this->belongsTo(CashAccount::class);
    }

    public function toCashAccount(): BelongsTo
    {
        return $this->belongsTo(CashAccount::class, 'to_cash_account_id');
    }

    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class);
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function costCenter(): BelongsTo
    {
        return $this->belongsTo(CostCenter::class);
    }

    public function cheque(): BelongsTo
    {
        return $this->belongsTo(Cheque::class);
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(Allocation::class);
    }

    public function sourceDocument(): BelongsTo
    {
        return $this->belongsTo(TradeDocument::class, 'source_document_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
