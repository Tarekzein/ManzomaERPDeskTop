<?php

namespace App\Modules\Finance\Services;

use App\Models\User;
use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\SettingsService;
use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Models\FiscalYear;
use App\Modules\Finance\Models\JournalEntry;
use App\Modules\Finance\Models\JournalLine;
use App\Modules\Parties\Models\Party;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Lock date, fiscal year closing and opening balances.
 */
class FiscalService
{
    public function __construct(
        private readonly JournalService $journal,
        private readonly AccountResolver $accounts,
        private readonly SettingsService $settings,
        private readonly AuditService $audit,
    ) {}

    public function setLockDate(?string $date): void
    {
        $this->settings->set('accounting.lock_date', $date ?: null);
        $this->audit->record('lock_date', null, $date ?: 'cleared');
    }

    /**
     * Close revenue and expense accounts into retained earnings.
     */
    public function closeYear(FiscalYear $year, User $user): FiscalYear
    {
        if ($year->status === 'closed') {
            throw BusinessException::make(__('erp.fiscal_year_closed', ['year' => $year->name]), 'fiscal_year_closed');
        }
        if (JournalEntry::query()->where('status', 'draft')->whereBetween('date', [$year->start_date->toDateString(), $year->end_date->toDateString()])->exists()) {
            throw BusinessException::make(__('erp.draft_entries_in_year'), 'draft_entries');
        }

        return DB::transaction(function () use ($year, $user) {
            $rows = JournalLine::query()
                ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
                ->join('accounts', 'accounts.id', '=', 'journal_lines.account_id')
                ->where('journal_entries.status', '!=', 'draft')
                ->whereIn('accounts.type', ['revenue', 'expense'])
                ->whereBetween('journal_entries.date', [$year->start_date->toDateString(), $year->end_date->toDateString()])
                ->groupBy('journal_lines.account_id')
                ->selectRaw('journal_lines.account_id, SUM(journal_lines.debit - journal_lines.credit) AS balance')
                ->get();

            $lines = [];
            $net = 0.0;
            foreach ($rows as $row) {
                $balance = Money::round($row->balance);
                if (Money::isZero($balance)) {
                    continue;
                }
                $lines[] = ['account' => (int) $row->account_id, 'debit' => $balance < 0 ? -$balance : 0, 'credit' => $balance > 0 ? $balance : 0];
                $net += $balance;
            }
            $net = Money::round($net); // positive = loss
            $lines[] = ['account' => 'retained_earnings', 'debit' => $net > 0 ? $net : 0, 'credit' => $net < 0 ? -$net : 0];

            $entry = count($lines) > 1 ? $this->journal->post([
                'date' => $year->end_date->toDateString(),
                'type' => 'closing',
                'description' => __('erp.je_year_closing', ['year' => $year->name]),
                'source_type' => 'fiscal_year',
                'source_id' => $year->id,
            ], $lines) : null;
            if ($entry) {
                $entry->update(['type' => 'closing']);
            }

            $year->update(['status' => 'closed', 'closed_at' => now(), 'closed_by' => $user->id, 'closing_entry_id' => $entry?->id]);
            $lock = $this->settings->get('accounting.lock_date');
            if (! $lock || $lock < $year->end_date->toDateString()) {
                $this->settings->set('accounting.lock_date', $year->end_date->toDateString());
            }
            $this->audit->record('closed', $year, $year->name);

            return $year->refresh();
        });
    }

    /**
     * Opening balance of a customer or supplier at go-live.
     * Positive amount: the party owes us (debit); negative: we owe them.
     */
    public function partyOpening(Party $party, float $amount, string $date, ?string $account = null): ?JournalEntry
    {
        $amount = Money::round($amount);
        if (Money::isZero($amount)) {
            return null;
        }
        $control = $account ?? ($party->is_customer ? 'ar' : 'ap');

        $entry = $this->journal->post([
            'date' => $date,
            'description' => __('erp.je_party_opening', ['party' => $party->name]),
            'reference' => $party->code,
            'source_type' => 'party_opening',
            'source_id' => $party->id,
        ], [
            ['account' => $control, 'debit' => $amount > 0 ? $amount : 0, 'credit' => $amount < 0 ? -$amount : 0, 'party_id' => $party->id],
            ['account' => 'opening_equity', 'debit' => $amount < 0 ? -$amount : 0, 'credit' => $amount > 0 ? $amount : 0],
        ]);
        $entry?->update(['type' => 'opening']);

        return $entry;
    }

    /**
     * Opening balances for balance-sheet accounts, offset to opening equity.
     *
     * @param  array  $rows  [{account_id, debit, credit}]
     */
    public function accountsOpening(array $rows, string $date): ?JournalEntry
    {
        $lines = [];
        $net = 0.0;
        foreach ($rows as $row) {
            $account = Account::query()->findOrFail($row['account_id']);
            if (in_array($account->system_key, ['ar', 'ap', 'inventory', 'notes_receivable', 'notes_payable'], true)) {
                throw BusinessException::make(__('erp.opening_use_dedicated', ['account' => $account->name]), 'opening_dedicated');
            }
            $debit = Money::round($row['debit'] ?? 0);
            $credit = Money::round($row['credit'] ?? 0);
            $lines[] = ['account' => $account->id, 'debit' => $debit, 'credit' => $credit];
            $net += $debit - $credit;
        }
        $net = Money::round($net);
        $lines[] = ['account' => 'opening_equity', 'debit' => $net < 0 ? -$net : 0, 'credit' => $net > 0 ? $net : 0];

        $entry = $this->journal->post(['date' => $date, 'description' => __('erp.je_accounts_opening'), 'source_type' => 'accounts_opening'], $lines);
        $entry?->update(['type' => 'opening']);

        return $entry;
    }
}
