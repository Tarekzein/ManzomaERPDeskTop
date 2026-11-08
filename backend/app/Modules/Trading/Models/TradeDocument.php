<?php

namespace App\Modules\Trading\Models;

use App\Models\User;
use App\Modules\Core\Models\Branch;
use App\Modules\Inventory\Models\PriceList;
use App\Modules\Inventory\Models\Warehouse;
use App\Modules\Parties\Models\Party;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TradeDocument extends Model
{
    use Auditable;

    public const SALES = ['sales_quotation', 'sales_order', 'sales_invoice', 'sales_return'];

    public const PURCHASES = ['purchase_order', 'purchase_receipt', 'purchase_invoice', 'purchase_return'];

    protected $casts = [
        'date' => 'date:Y-m-d',
        'due_date' => 'date:Y-m-d',
        'valid_until' => 'date:Y-m-d',
        'price_includes_tax' => 'boolean',
        'exchange_rate' => 'decimal:8',
        'invoice_discount_percent' => 'decimal:4',
        'invoice_discount_amount' => 'decimal:2',
        'gross_total' => 'decimal:2',
        'discount_total' => 'decimal:2',
        'net_total' => 'decimal:2',
        'tax_total' => 'decimal:2',
        'total' => 'decimal:2',
        'wht_rate' => 'decimal:2',
        'wht_amount' => 'decimal:2',
        'balance_due' => 'decimal:2',
        'paid_amount' => 'decimal:2',
        'cost_total' => 'decimal:2',
        'posted_at' => 'datetime',
        'voided_at' => 'datetime',
    ];

    protected $appends = ['outstanding', 'payment_status'];

    public function lines(): HasMany
    {
        return $this->hasMany(TradeDocumentLine::class)->orderBy('line_no');
    }

    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class)->withTrashed();
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function salesperson(): BelongsTo
    {
        return $this->belongsTo(User::class, 'salesperson_id');
    }

    public function priceList(): BelongsTo
    {
        return $this->belongsTo(PriceList::class);
    }

    public function source(): BelongsTo
    {
        return $this->belongsTo(self::class, 'source_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'source_id');
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(Allocation::class, 'document_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isSales(): bool
    {
        return str_starts_with($this->type, 'sales_');
    }

    public function isInvoice(): bool
    {
        return in_array($this->type, ['sales_invoice', 'purchase_invoice'], true);
    }

    public function getOutstandingAttribute(): float
    {
        if (! $this->isInvoice() || $this->status !== 'posted') {
            return 0.0;
        }

        return round((float) $this->balance_due - (float) $this->paid_amount, 2);
    }

    public function getPaymentStatusAttribute(): ?string
    {
        if (! $this->isInvoice() || $this->status !== 'posted') {
            return null;
        }
        $outstanding = $this->outstanding;
        if ($outstanding <= 0.004) {
            return 'paid';
        }

        return (float) $this->paid_amount > 0 ? 'partial' : 'unpaid';
    }
}
