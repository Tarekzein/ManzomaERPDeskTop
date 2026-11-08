<?php

namespace App\Modules\Trading\Services;

use App\Modules\Trading\Models\Allocation;
use App\Modules\Trading\Models\TradeDocument;
use App\Support\BusinessException;
use App\Support\Money;

/**
 * Settles invoices with vouchers, cheques and returns. An invoice's paid
 * amount is always the sum of its allocations.
 */
class AllocationService
{
    public function allocate(TradeDocument $invoice, float $amount, string $date, ?int $voucherId = null, ?int $returnId = null): ?Allocation
    {
        $amount = Money::round($amount);
        if ($amount <= 0) {
            return null;
        }
        $invoice = TradeDocument::query()->whereKey($invoice->id)->lockForUpdate()->firstOrFail();
        if (! $invoice->isInvoice() || $invoice->status !== 'posted') {
            throw BusinessException::make(__('erp.allocation_invoice_invalid', ['number' => $invoice->number]), 'allocation_invalid');
        }
        if ($amount - $invoice->outstanding > 0.005) {
            throw BusinessException::make(__('erp.allocation_exceeds', ['number' => $invoice->number, 'outstanding' => $invoice->outstanding]), 'allocation_exceeds');
        }

        $allocation = Allocation::query()->create([
            'document_id' => $invoice->id,
            'voucher_id' => $voucherId,
            'return_id' => $returnId,
            'amount' => $amount,
            'date' => $date,
        ]);
        $this->recompute($invoice);

        return $allocation;
    }

    /**
     * Spread an amount over the party's open invoices, oldest due first.
     *
     * @return float amount left unallocated (sits on account as a credit)
     */
    public function autoAllocate(int $partyId, string $invoiceType, float $amount, string $date, int $voucherId): float
    {
        $remaining = Money::round($amount);
        $invoices = TradeDocument::query()
            ->where('party_id', $partyId)
            ->where('type', $invoiceType)
            ->where('status', 'posted')
            ->whereColumn('paid_amount', '<', 'balance_due')
            ->orderBy('due_date')->orderBy('date')->orderBy('id')
            ->get();
        foreach ($invoices as $invoice) {
            if ($remaining <= 0) {
                break;
            }
            $take = min($remaining, $invoice->outstanding);
            if ($take > 0) {
                $this->allocate($invoice, $take, $date, $voucherId);
                $remaining = Money::round($remaining - $take);
            }
        }

        return $remaining;
    }

    public function removeForVoucher(int $voucherId): void
    {
        $documentIds = Allocation::query()->where('voucher_id', $voucherId)->pluck('document_id')->unique();
        Allocation::query()->where('voucher_id', $voucherId)->delete();
        foreach (TradeDocument::query()->whereIn('id', $documentIds)->get() as $doc) {
            $this->recompute($doc);
        }
    }

    public function removeForReturn(int $returnId): void
    {
        $documentIds = Allocation::query()->where('return_id', $returnId)->pluck('document_id')->unique();
        Allocation::query()->where('return_id', $returnId)->delete();
        foreach (TradeDocument::query()->whereIn('id', $documentIds)->get() as $doc) {
            $this->recompute($doc);
        }
    }

    public function recompute(TradeDocument $doc): void
    {
        $paid = Money::round(Allocation::query()->where('document_id', $doc->id)->sum('amount'));
        $doc->forceFill(['paid_amount' => $paid])->save();
    }
}
