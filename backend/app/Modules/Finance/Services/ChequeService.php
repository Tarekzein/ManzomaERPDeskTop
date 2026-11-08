<?php

namespace App\Modules\Finance\Services;

use App\Modules\Core\Services\AuditService;
use App\Modules\Finance\Models\CashAccount;
use App\Modules\Finance\Models\Cheque;
use App\Modules\Finance\Models\ChequeEvent;
use App\Modules\Parties\Models\Party;
use App\Modules\Trading\Services\AllocationService;
use App\Support\BusinessException;
use Illuminate\Support\Facades\DB;

/**
 * Cheque lifecycle (أوراق القبض والدفع).
 *
 * Received: in_portfolio → deposited → collected | bounced → returned
 *           in_portfolio → endorsed (passed to a supplier) | returned
 * Issued:   issued → cleared | cancelled
 */
class ChequeService
{
    public function __construct(
        private readonly JournalService $journal,
        private readonly AllocationService $allocations,
        private readonly AuditService $audit,
    ) {}

    public function act(Cheque $cheque, string $action, array $data): Cheque
    {
        return DB::transaction(function () use ($cheque, $action, $data) {
            $cheque = Cheque::query()->whereKey($cheque->id)->lockForUpdate()->firstOrFail();
            $date = $data['date'] ?? now()->toDateString();
            $note = $data['note'] ?? null;
            $entry = null;
            $cashAccountId = null;

            switch ($action) {
                case 'deposit':
                    $this->expect($cheque, 'received', ['in_portfolio', 'bounced']);
                    $bank = $this->bank($data['cash_account_id'] ?? null);
                    $cashAccountId = $bank->id;
                    if ($cheque->status === 'bounced') {
                        // Re-presenting a bounced cheque puts it back in the portfolio account.
                        $entry = $this->post($cheque, $date, 'erp.je_cheque_redeposit', [
                            ['account' => 'notes_receivable', 'debit' => $cheque->amount],
                            ['account' => 'ar', 'credit' => $cheque->amount, 'party_id' => $cheque->party_id],
                        ]);
                    }
                    $cheque->update(['status' => 'deposited', 'cash_account_id' => $bank->id]);
                    break;

                case 'collect':
                    $this->expect($cheque, 'received', ['in_portfolio', 'deposited']);
                    $bank = $this->bank($data['cash_account_id'] ?? $cheque->cash_account_id);
                    $cashAccountId = $bank->id;
                    $entry = $this->post($cheque, $date, 'erp.je_cheque_collected', [
                        ['account' => $bank->account_id, 'debit' => $cheque->amount],
                        ['account' => 'notes_receivable', 'credit' => $cheque->amount],
                    ]);
                    $cheque->update(['status' => 'collected', 'cash_account_id' => $bank->id]);
                    break;

                case 'bounce':
                    $this->expect($cheque, 'received', ['in_portfolio', 'deposited']);
                    // The customer owes the money again, and the invoices it paid reopen.
                    $entry = $this->post($cheque, $date, 'erp.je_cheque_bounced', [
                        ['account' => 'ar', 'debit' => $cheque->amount, 'party_id' => $cheque->party_id],
                        ['account' => 'notes_receivable', 'credit' => $cheque->amount],
                    ]);
                    if ($cheque->voucher_id) {
                        $this->allocations->removeForVoucher($cheque->voucher_id);
                    }
                    $cheque->update(['status' => 'bounced']);
                    break;

                case 'return':
                    $this->expect($cheque, 'received', ['in_portfolio', 'bounced']);
                    if ($cheque->status === 'in_portfolio') {
                        $entry = $this->post($cheque, $date, 'erp.je_cheque_returned', [
                            ['account' => 'ar', 'debit' => $cheque->amount, 'party_id' => $cheque->party_id],
                            ['account' => 'notes_receivable', 'credit' => $cheque->amount],
                        ]);
                        if ($cheque->voucher_id) {
                            $this->allocations->removeForVoucher($cheque->voucher_id);
                        }
                    }
                    $cheque->update(['status' => 'returned']);
                    break;

                case 'endorse':
                    $this->expect($cheque, 'received', ['in_portfolio']);
                    $supplier = Party::query()->findOrFail($data['party_id'] ?? 0);
                    if (! $supplier->is_supplier) {
                        throw BusinessException::make(__('erp.party_not_supplier', ['party' => $supplier->name]), 'party_role');
                    }
                    $entry = $this->post($cheque, $date, 'erp.je_cheque_endorsed', [
                        ['account' => 'ap', 'debit' => $cheque->amount, 'party_id' => $supplier->id],
                        ['account' => 'notes_receivable', 'credit' => $cheque->amount],
                    ], $supplier->name);
                    $cheque->update(['status' => 'endorsed', 'notes' => trim(($cheque->notes ?? '').' → '.$supplier->name)]);
                    break;

                case 'clear':
                    $this->expect($cheque, 'issued', ['issued']);
                    $bank = $this->bank($cheque->cash_account_id);
                    $cashAccountId = $bank->id;
                    $entry = $this->post($cheque, $date, 'erp.je_cheque_cleared', [
                        ['account' => 'notes_payable', 'debit' => $cheque->amount],
                        ['account' => $bank->account_id, 'credit' => $cheque->amount],
                    ]);
                    $cheque->update(['status' => 'cleared']);
                    break;

                case 'cancel':
                    $this->expect($cheque, 'issued', ['issued']);
                    $entry = $this->post($cheque, $date, 'erp.je_cheque_cancelled', [
                        ['account' => 'notes_payable', 'debit' => $cheque->amount],
                        ['account' => 'ap', 'credit' => $cheque->amount, 'party_id' => $cheque->party_id],
                    ]);
                    if ($cheque->voucher_id) {
                        $this->allocations->removeForVoucher($cheque->voucher_id);
                    }
                    $cheque->update(['status' => 'cancelled']);
                    break;

                default:
                    throw BusinessException::make(__('erp.transition_not_allowed'), 'transition_not_allowed');
            }

            ChequeEvent::query()->create([
                'cheque_id' => $cheque->id,
                'event' => $action,
                'date' => $date,
                'cash_account_id' => $cashAccountId,
                'journal_entry_id' => $entry?->id,
                'note' => $note,
                'user_id' => auth()->id(),
            ]);
            $this->audit->record($action, $cheque, $cheque->number);

            return $cheque->refresh()->load('party:id,code,name', 'cashAccount:id,name,code', 'events.user:id,name', 'voucher:id,number,type');
        });
    }

    private function expect(Cheque $cheque, string $direction, array $statuses): void
    {
        if ($cheque->direction !== $direction || ! in_array($cheque->status, $statuses, true)) {
            throw BusinessException::make(__('erp.cheque_action_invalid', ['status' => $cheque->status]), 'cheque_action_invalid');
        }
    }

    private function bank(?int $cashAccountId): CashAccount
    {
        $bank = $cashAccountId ? CashAccount::query()->find($cashAccountId) : null;
        if (! $bank || $bank->type !== 'bank') {
            throw BusinessException::make(__('erp.cheque_bank_required'), 'cheque_bank_required');
        }

        return $bank;
    }

    private function post(Cheque $cheque, string $date, string $key, array $lines, ?string $extra = null)
    {
        return $this->journal->post([
            'date' => $date,
            'description' => __($key, ['number' => $cheque->number, 'party' => $extra ?? $cheque->party?->name ?? $cheque->drawer_name]),
            'reference' => $cheque->number,
            'source_type' => 'cheque',
            'source_id' => $cheque->id,
        ], $lines);
    }
}
