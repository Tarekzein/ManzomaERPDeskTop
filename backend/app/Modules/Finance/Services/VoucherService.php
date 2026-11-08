<?php

namespace App\Modules\Finance\Services;

use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\NumberingService;
use App\Modules\Core\Services\PeriodGuard;
use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Models\CashAccount;
use App\Modules\Finance\Models\Cheque;
use App\Modules\Finance\Models\ChequeEvent;
use App\Modules\Finance\Models\JournalEntry;
use App\Modules\Finance\Models\TaxRate;
use App\Modules\Finance\Models\Voucher;
use App\Modules\Parties\Models\Party;
use App\Modules\Trading\Models\TradeDocument;
use App\Modules\Trading\Services\AllocationService;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Receipt vouchers (سند قبض), payment vouchers (سند صرف) including expenses,
 * and transfers between cash boxes and banks.
 *
 * A voucher's account_id is always the counter account: the party's
 * receivable/payable control account, or an expense/other account.
 */
class VoucherService
{
    public function __construct(
        private readonly JournalService $journal,
        private readonly AccountResolver $accounts,
        private readonly NumberingService $numbers,
        private readonly PeriodGuard $period,
        private readonly AllocationService $allocations,
        private readonly AuditService $audit,
    ) {}

    /**
     * Create or update a draft.
     *
     * @param  array  $data  type, date, cash_account_id, to_cash_account_id, party_id, account_id, amount,
     *                       tax_rate_id, cost_center_id, method, reference, description, payee,
     *                       cheque: {number, bank_name, due_date, issue_date, drawer_name},
     *                       allocations: [{document_id, amount}], auto_allocate: bool
     */
    public function save(array $data, ?Voucher $voucher = null): Voucher
    {
        if ($voucher && $voucher->status !== 'draft') {
            throw BusinessException::make(__('erp.only_draft_editable'), 'not_draft');
        }
        $type = $data['type'] ?? $voucher?->type;
        if (! in_array($type, ['receipt', 'payment', 'transfer'], true)) {
            throw BusinessException::make(__('erp.unknown_document_type'), 'invalid_type');
        }
        $amount = Money::round($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw BusinessException::make(__('erp.amount_positive'), 'invalid_amount');
        }
        $method = $data['method'] ?? 'cash';

        $attributes = [
            'type' => $type,
            'date' => $data['date'] ?? now()->toDateString(),
            'branch_id' => $data['branch_id'] ?? auth()->user()?->branch_id,
            'cash_account_id' => $data['cash_account_id'] ?? null,
            'to_cash_account_id' => $type === 'transfer' ? ($data['to_cash_account_id'] ?? null) : null,
            'party_id' => $type === 'transfer' ? null : ($data['party_id'] ?? null),
            'cost_center_id' => $data['cost_center_id'] ?? null,
            'amount' => $amount,
            'tax_rate_id' => null,
            'tax_amount' => 0,
            'method' => $type === 'transfer' ? 'bank_transfer' : $method,
            'payee' => $data['payee'] ?? null,
            'reference' => $data['reference'] ?? null,
            'description' => $data['description'] ?? null,
            'source_document_id' => $data['source_document_id'] ?? $voucher?->source_document_id,
        ];

        if ($type === 'transfer') {
            if (! $attributes['cash_account_id'] || ! $attributes['to_cash_account_id'] || $attributes['cash_account_id'] == $attributes['to_cash_account_id']) {
                throw BusinessException::make(__('erp.transfer_accounts_required'), 'transfer_invalid');
            }
            $attributes['account_id'] = CashAccount::query()->findOrFail($attributes['to_cash_account_id'])->account_id;
        } else {
            if ($method !== 'cheque' && ! $attributes['cash_account_id']) {
                throw BusinessException::make(__('erp.cash_account_required'), 'cash_account_required');
            }
            if ($attributes['party_id']) {
                $party = Party::query()->findOrFail($attributes['party_id']);
                $attributes['account_id'] = $this->controlAccountFor($party, $type, $data['party_account'] ?? null);
            } else {
                $accountId = $data['account_id'] ?? null;
                $account = $accountId ? Account::query()->find($accountId) : null;
                if (! $account || $account->is_group || ! $account->is_active) {
                    throw BusinessException::make(__('erp.counter_account_required'), 'account_required');
                }
                if (in_array($account->system_key, ['ar', 'ap'], true)) {
                    throw BusinessException::make(__('erp.party_required_for_account', ['account' => $account->name]), 'party_required');
                }
                $attributes['account_id'] = $account->id;
            }
            // Expense VAT (payments without a party only).
            if ($type === 'payment' && ! $attributes['party_id'] && ! empty($data['tax_rate_id'])) {
                $rate = TaxRate::query()->findOrFail($data['tax_rate_id']);
                $attributes['tax_rate_id'] = $rate->id;
                // The amount entered is what leaves the box, VAT included.
                $attributes['tax_amount'] = Money::round($amount - $amount / (1 + (float) $rate->rate / 100));
            }
        }

        return DB::transaction(function () use ($attributes, $voucher, $data) {
            if ($voucher) {
                $voucher->update($attributes);
            } else {
                $voucher = Voucher::query()->create($attributes + [
                    'number' => 'D-'.uniqid(),
                    'status' => 'draft',
                    'created_by' => auth()->id(),
                ]);
                $voucher->update(['number' => 'D-'.$voucher->id]);
            }
            return $voucher;
        });
    }

    public function post(Voucher $voucher, array $data = []): Voucher
    {
        // Cheque details and allocations are supplied when posting.
        $cheque = $data['cheque'] ?? null;
        $allocations = $data['allocations'] ?? [];
        $auto = (bool) ($data['auto_allocate'] ?? false);

        return DB::transaction(function () use ($voucher, $cheque, $allocations, $auto) {
            $voucher = Voucher::query()->whereKey($voucher->id)->lockForUpdate()->firstOrFail();
            if ($voucher->status !== 'draft') {
                throw BusinessException::make(__('erp.only_draft_postable'), 'not_draft');
            }
            $date = $voucher->date->toDateString();
            $this->period->assertOpen($date);
            $voucher->update(['number' => $this->numbers->next($voucher->type, $date)]);

            $cashGl = $voucher->cash_account_id ? CashAccount::query()->findOrFail($voucher->cash_account_id) : null;
            $amount = (float) $voucher->amount;
            $partyId = $voucher->party_id;
            $label = $voucher->description ?: ($voucher->party?->name ?? $voucher->payee ?? '');

            if ($voucher->method === 'cheque' && $voucher->type !== 'transfer') {
                $voucher->update(['cheque_id' => $this->createCheque($voucher, (array) $cheque)->id]);
            }

            $lines = match ($voucher->type) {
                'receipt' => [
                    ['account' => $voucher->method === 'cheque' ? 'notes_receivable' : $cashGl->account_id, 'debit' => $amount],
                    ['account' => $voucher->account_id, 'credit' => $amount, 'party_id' => $partyId, 'cost_center_id' => $voucher->cost_center_id],
                ],
                'payment' => [
                    ['account' => $voucher->account_id, 'debit' => Money::round($amount - (float) $voucher->tax_amount), 'party_id' => $partyId, 'cost_center_id' => $voucher->cost_center_id],
                    ['account' => 'vat_input', 'debit' => (float) $voucher->tax_amount],
                    ['account' => $voucher->method === 'cheque' ? 'notes_payable' : $cashGl->account_id, 'credit' => $amount],
                ],
                'transfer' => [
                    ['account' => $voucher->account_id, 'debit' => $amount],
                    ['account' => $cashGl->account_id, 'credit' => $amount],
                ],
            };

            // Cash boxes cannot pay out money they do not hold.
            if (in_array($voucher->type, ['payment', 'transfer'], true) && $voucher->method !== 'cheque' && $cashGl) {
                $this->assertFunds($cashGl, $amount, $date);
            }

            $descriptionKey = ['receipt' => 'erp.je_receipt', 'payment' => 'erp.je_payment', 'transfer' => 'erp.je_transfer'][$voucher->type];
            $entry = $this->journal->post([
                'date' => $date,
                'description' => __($descriptionKey, ['number' => $voucher->number, 'party' => $label]),
                'reference' => $voucher->number,
                'source_type' => 'voucher',
                'source_id' => $voucher->id,
                'branch_id' => $voucher->branch_id,
            ], $lines);

            $voucher->update(['status' => 'posted', 'journal_entry_id' => $entry?->id, 'posted_by' => auth()->id(), 'posted_at' => now()]);

            if ($partyId) {
                $this->applyAllocations($voucher, $allocations, $auto);
            }
            $this->audit->record('posted', $voucher, $voucher->number);

            return $voucher->refresh()->load($this->relations());
        });
    }

    public function createAndPost(array $data): Voucher
    {
        return DB::transaction(fn () => $this->post($this->save($data), $data));
    }

    public function void(Voucher $voucher, string $reason): Voucher
    {
        return DB::transaction(function () use ($voucher, $reason) {
            $voucher = Voucher::query()->whereKey($voucher->id)->lockForUpdate()->firstOrFail();
            if ($voucher->status !== 'posted') {
                throw BusinessException::make(__('erp.only_posted_voidable'), 'not_posted');
            }
            $this->period->assertOpen($voucher->date->toDateString());
            if ($voucher->cheque_id) {
                $cheque = Cheque::query()->lockForUpdate()->findOrFail($voucher->cheque_id);
                if (! in_array($cheque->status, ['in_portfolio', 'issued'], true)) {
                    throw BusinessException::make(__('erp.void_cheque_moved', ['status' => $cheque->status]), 'cheque_moved');
                }
                $cheque->update(['status' => 'cancelled']);
                ChequeEvent::query()->create(['cheque_id' => $cheque->id, 'event' => 'cancelled', 'date' => now()->toDateString(), 'note' => $reason, 'user_id' => auth()->id()]);
            }
            $this->allocations->removeForVoucher($voucher->id);
            if ($voucher->journal_entry_id) {
                $this->journal->reverse(JournalEntry::query()->findOrFail($voucher->journal_entry_id), null, $reason);
            }
            $voucher->update(['status' => 'void', 'voided_by' => auth()->id(), 'voided_at' => now(), 'void_reason' => $reason]);
            $this->audit->record('voided', $voucher, $reason);

            return $voucher->refresh()->load($this->relations());
        });
    }

    /**
     * Payment taken at the counter when an invoice is posted.
     */
    public function settleInvoice(TradeDocument $invoice, array $payment): Voucher
    {
        $amount = min(Money::round($payment['amount']), $invoice->outstanding);
        $isSales = $invoice->type === 'sales_invoice';

        return $this->createAndPost([
            'type' => $isSales ? 'receipt' : 'payment',
            'date' => $invoice->date->toDateString(),
            'branch_id' => $invoice->branch_id,
            'cash_account_id' => $payment['cash_account_id'] ?? null,
            'party_id' => $invoice->party_id,
            'party_account' => $isSales ? 'ar' : 'ap',
            'amount' => $amount,
            'method' => $payment['method'] ?? 'cash',
            'reference' => $payment['reference'] ?? $invoice->number,
            'description' => __($isSales ? 'erp.payment_for_invoice' : 'erp.payment_for_bill', ['number' => $invoice->number]),
            'cheque' => $payment['cheque'] ?? null,
            'source_document_id' => $invoice->id,
            'allocations' => [['document_id' => $invoice->id, 'amount' => $amount]],
        ]);
    }

    /**
     * Cash given back to a customer for a return (or received back from a
     * supplier for a purchase return).
     */
    public function refundForReturn(TradeDocument $return, array $refund): Voucher
    {
        $isSales = $return->type === 'sales_return';
        $voucher = $this->createAndPost([
            'type' => $isSales ? 'payment' : 'receipt',
            'date' => $return->date->toDateString(),
            'branch_id' => $return->branch_id,
            'cash_account_id' => $refund['cash_account_id'] ?? null,
            'party_id' => $return->party_id,
            'party_account' => $isSales ? 'ar' : 'ap',
            'amount' => Money::round($refund['amount']),
            'method' => $refund['method'] ?? 'cash',
            'description' => __('erp.refund_for_return', ['number' => $return->number]),
            'source_document_id' => $return->id,
        ]);
        $return->update(['paid_amount' => Money::round((float) $return->paid_amount + (float) $voucher->amount)]);

        return $voucher;
    }

    public function relations(): array
    {
        return ['cashAccount:id,code,name,name_en,type', 'toCashAccount:id,code,name,name_en,type', 'party:id,code,name,name_en', 'account:id,code,name,name_en', 'costCenter:id,code,name', 'cheque', 'allocations.document:id,type,number,date,total,balance_due,paid_amount', 'creator:id,name'];
    }

    public function cashBalance(CashAccount $cash, ?string $to = null): float
    {
        return $this->journal->balance((int) $cash->account_id, $to);
    }

    private function assertFunds(CashAccount $cash, float $amount, string $date): void
    {
        if ($cash->type !== 'cash' || $cash->allow_negative) {
            return;
        }
        $balance = $this->cashBalance($cash);
        if ($amount - $balance > 0.005) {
            throw BusinessException::make(__('erp.insufficient_cash', ['account' => $cash->name, 'balance' => $balance]), 'insufficient_cash', ['balance' => $balance]);
        }
    }

    private function controlAccountFor(Party $party, string $type, ?string $preferred): int
    {
        if (in_array($preferred, ['ar', 'ap'], true)) {
            return $this->accounts->id($preferred);
        }
        if ($type === 'receipt') {
            return $this->accounts->id($party->is_customer ? 'ar' : 'ap');
        }

        return $this->accounts->id($party->is_supplier ? 'ap' : 'ar');
    }

    private function applyAllocations(Voucher $voucher, array $allocations, bool $auto): void
    {
        $remaining = (float) $voucher->amount;
        $invoiceType = $this->invoiceTypeFor($voucher);
        foreach ($allocations as $row) {
            $amount = Money::round($row['amount'] ?? 0);
            if ($amount <= 0) {
                continue;
            }
            if ($amount - $remaining > 0.005) {
                throw BusinessException::make(__('erp.allocations_exceed_voucher'), 'allocation_exceeds');
            }
            $doc = TradeDocument::query()->findOrFail($row['document_id']);
            if ((int) $doc->party_id !== (int) $voucher->party_id || $doc->type !== $invoiceType) {
                throw BusinessException::make(__('erp.allocation_invoice_invalid', ['number' => $doc->number]), 'allocation_invalid');
            }
            $this->allocations->allocate($doc, $amount, $voucher->date->toDateString(), $voucher->id);
            $remaining = Money::round($remaining - $amount);
        }
        if ($auto && $remaining > 0) {
            $this->allocations->autoAllocate((int) $voucher->party_id, $invoiceType, $remaining, $voucher->date->toDateString(), $voucher->id);
        }
    }

    private function invoiceTypeFor(Voucher $voucher): string
    {
        $ar = $this->accounts->id('ar');

        return (int) $voucher->account_id === $ar ? 'sales_invoice' : 'purchase_invoice';
    }

    private function createCheque(Voucher $voucher, array $cheque): Cheque
    {
        if (empty($cheque['number']) || empty($cheque['due_date'])) {
            throw BusinessException::make(__('erp.cheque_details_required'), 'cheque_details_required');
        }
        $received = $voucher->type === 'receipt';
        $model = Cheque::query()->create([
            'direction' => $received ? 'received' : 'issued',
            'number' => $cheque['number'],
            'bank_name' => $cheque['bank_name'] ?? null,
            'issue_date' => $cheque['issue_date'] ?? $voucher->date->toDateString(),
            'due_date' => $cheque['due_date'],
            'amount' => $voucher->amount,
            'party_id' => $voucher->party_id,
            'drawer_name' => $cheque['drawer_name'] ?? $voucher->party?->name,
            'status' => $received ? 'in_portfolio' : 'issued',
            // Issued cheques are drawn on one of our banks.
            'cash_account_id' => $received ? null : ($cheque['cash_account_id'] ?? $voucher->cash_account_id),
            'voucher_id' => $voucher->id,
        ]);
        if (! $received && ! $model->cash_account_id) {
            throw BusinessException::make(__('erp.cheque_bank_required'), 'cheque_bank_required');
        }
        ChequeEvent::query()->create(['cheque_id' => $model->id, 'event' => $received ? 'received' : 'issued', 'date' => $voucher->date->toDateString(), 'user_id' => auth()->id()]);

        return $model;
    }
}
