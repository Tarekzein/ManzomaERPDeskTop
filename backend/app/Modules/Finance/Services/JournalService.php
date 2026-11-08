<?php

namespace App\Modules\Finance\Services;

use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\NumberingService;
use App\Modules\Core\Services\PeriodGuard;
use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Models\JournalEntry;
use App\Modules\Finance\Models\JournalLine;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * The single door into the general ledger. Every document posts through here,
 * so balance, period and account rules are enforced in one place.
 *
 * Line shape: ['account' => id|system key, 'debit' => x, 'credit' => y,
 *              'party_id' => ?, 'cost_center_id' => ?, 'description' => ?]
 */
class JournalService
{
    public function __construct(
        private readonly AccountResolver $accounts,
        private readonly PeriodGuard $period,
        private readonly NumberingService $numbers,
        private readonly AuditService $audit,
    ) {}

    /**
     * Create and post a system entry in one step.
     */
    public function post(array $header, array $lines): ?JournalEntry
    {
        $lines = $this->normalise($lines);
        if ($lines === []) {
            return null;
        }

        return DB::transaction(function () use ($header, $lines) {
            $entry = $this->write($header + ['type' => 'system'], $lines, 'posted');
            $this->audit->record('posted', $entry, $entry->number.' '.$entry->description);

            return $entry;
        });
    }

    /**
     * Manual entries start as drafts so a second person can review them.
     */
    public function saveDraft(array $header, array $lines, ?JournalEntry $entry = null): JournalEntry
    {
        $lines = $this->normalise($lines, false, true);
        if ($entry && $entry->status !== 'draft') {
            throw BusinessException::make(__('erp.only_draft_editable'), 'not_draft');
        }

        return DB::transaction(function () use ($header, $lines, $entry) {
            if ($entry) {
                $entry->lines()->delete();
                $entry->update([
                    'date' => $header['date'],
                    'description' => $header['description'],
                    'reference' => $header['reference'] ?? null,
                    'branch_id' => $header['branch_id'] ?? $entry->branch_id,
                    'total' => collect($lines)->sum('debit'),
                ]);
                $this->writeLines($entry, $lines);

                return $entry->load('lines.account', 'lines.party', 'lines.costCenter');
            }

            return $this->write($header + ['type' => $header['type'] ?? 'manual'], $lines, 'draft');
        });
    }

    public function postDraft(JournalEntry $entry): JournalEntry
    {
        if ($entry->status !== 'draft') {
            throw BusinessException::make(__('erp.only_draft_postable'), 'not_draft');
        }
        $lines = $entry->lines->map(fn (JournalLine $l) => [
            'account' => $l->account_id, 'debit' => $l->debit, 'credit' => $l->credit,
            'party_id' => $l->party_id, 'cost_center_id' => $l->cost_center_id, 'description' => $l->description,
        ])->all();
        $this->normalise($lines, true, true);
        $this->period->assertOpen($entry->date->toDateString());

        $entry->update(['status' => 'posted', 'posted_by' => auth()->id(), 'posted_at' => now()]);
        $this->audit->record('posted', $entry);

        return $entry->refresh()->load('lines.account', 'lines.party', 'lines.costCenter');
    }

    /**
     * Reverse a posted entry with a mirror entry; the original stays visible.
     */
    public function reverse(JournalEntry $entry, ?string $date = null, ?string $reason = null): JournalEntry
    {
        if ($entry->status !== 'posted') {
            throw BusinessException::make(__('erp.only_posted_reversible'), 'not_posted');
        }
        $date ??= $entry->date->toDateString();

        return DB::transaction(function () use ($entry, $date, $reason) {
            $lines = $entry->lines->map(fn (JournalLine $l) => [
                'account' => $l->account_id, 'debit' => $l->credit, 'credit' => $l->debit,
                'party_id' => $l->party_id, 'cost_center_id' => $l->cost_center_id, 'description' => $l->description,
            ])->all();

            $reversal = $this->write([
                'date' => $date,
                'type' => 'reversal',
                'description' => trim(__('erp.reversal_of', ['number' => $entry->number]).' '.($reason ?? '')),
                'reference' => $entry->reference,
                'source_type' => $entry->source_type,
                'source_id' => $entry->source_id,
                'branch_id' => $entry->branch_id,
                'reversal_of_id' => $entry->id,
            ], $this->normalise($lines), 'posted');

            $entry->update(['status' => 'reversed', 'reversed_by_id' => $reversal->id]);
            $this->audit->record('reversed', $entry, $reason);

            return $reversal;
        });
    }

    /**
     * Debit minus credit for an account (and optionally a party) up to a date.
     */
    public function balance(int|array $accountIds, ?string $to = null, ?int $partyId = null, ?string $from = null): float
    {
        $query = JournalLine::query()
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->where('journal_entries.status', '!=', 'draft')
            ->whereIn('journal_lines.account_id', (array) $accountIds);
        if ($to) {
            $query->whereDate('journal_entries.date', '<=', $to);
        }
        if ($from) {
            $query->whereDate('journal_entries.date', '>=', $from);
        }
        if ($partyId) {
            $query->where('journal_lines.party_id', $partyId);
        }

        return Money::round((float) $query->sum(DB::raw('journal_lines.debit - journal_lines.credit')));
    }

    /**
     * Receivable minus payable for a party (positive = they owe us).
     */
    public function partyBalance(int $partyId, ?string $to = null): float
    {
        return $this->balance([$this->accounts->id('ar'), $this->accounts->id('ap')], $to, $partyId);
    }

    private function write(array $header, array $lines, string $status): JournalEntry
    {
        $this->period->assertOpen($header['date']);

        $entry = JournalEntry::query()->create([
            'number' => $this->numbers->next('journal', $header['date']),
            'date' => $header['date'],
            'type' => $header['type'] ?? 'system',
            'description' => mb_substr((string) ($header['description'] ?? ''), 0, 250),
            'reference' => $header['reference'] ?? null,
            'status' => $status,
            'source_type' => $header['source_type'] ?? null,
            'source_id' => $header['source_id'] ?? null,
            'branch_id' => $header['branch_id'] ?? auth()->user()?->branch_id,
            'reversal_of_id' => $header['reversal_of_id'] ?? null,
            'total' => collect($lines)->sum('debit'),
            'created_by' => auth()->id(),
            'posted_by' => $status === 'posted' ? auth()->id() : null,
            'posted_at' => $status === 'posted' ? now() : null,
        ]);
        $this->writeLines($entry, $lines);

        return $entry->load('lines.account');
    }

    private function writeLines(JournalEntry $entry, array $lines): void
    {
        foreach (array_values($lines) as $i => $line) {
            $entry->lines()->create([
                'line_no' => $i + 1,
                'account_id' => $line['account_id'],
                'party_id' => $line['party_id'] ?? null,
                'cost_center_id' => $line['cost_center_id'] ?? null,
                'description' => isset($line['description']) ? mb_substr((string) $line['description'], 0, 250) : null,
                'debit' => $line['debit'],
                'credit' => $line['credit'],
                'currency' => $line['currency'] ?? null,
                'fx_rate' => $line['fx_rate'] ?? 1,
                'fx_amount' => $line['fx_amount'] ?? null,
            ]);
        }
    }

    /**
     * Resolve keys, round, drop zero lines, merge duplicates and validate.
     */
    private function normalise(array $lines, bool $validate = true, bool $manual = false): array
    {
        $merged = [];
        foreach ($lines as $line) {
            $accountId = is_numeric($line['account'] ?? null) ? (int) $line['account'] : $this->accounts->id((string) $line['account']);
            $debit = Money::round($line['debit'] ?? 0);
            $credit = Money::round($line['credit'] ?? 0);
            if ($debit < 0) {
                [$debit, $credit] = [0.0, $credit - $debit];
            }
            if ($credit < 0) {
                [$debit, $credit] = [$debit - $credit, 0.0];
            }
            if (Money::isZero($debit) && Money::isZero($credit)) {
                continue;
            }
            // Manual entries keep each line as typed; system entries merge.
            $key = $manual ? count($merged) : implode(':', [$accountId, $line['party_id'] ?? 0, $line['cost_center_id'] ?? 0, $debit > 0 ? 'd' : 'c']);
            if (isset($merged[$key])) {
                $merged[$key]['debit'] = Money::round($merged[$key]['debit'] + $debit);
                $merged[$key]['credit'] = Money::round($merged[$key]['credit'] + $credit);
            } else {
                $merged[$key] = [
                    'account_id' => $accountId,
                    'debit' => $debit,
                    'credit' => $credit,
                    'party_id' => $line['party_id'] ?? null,
                    'cost_center_id' => $line['cost_center_id'] ?? null,
                    'description' => $line['description'] ?? null,
                    'currency' => $line['currency'] ?? null,
                    'fx_rate' => $line['fx_rate'] ?? 1,
                    'fx_amount' => $line['fx_amount'] ?? null,
                ];
            }
        }
        $lines = array_values($merged);
        if (! $validate || $lines === []) {
            return $lines;
        }

        $debits = Money::round(collect($lines)->sum('debit'));
        $credits = Money::round(collect($lines)->sum('credit'));
        if (! Money::equals($debits, $credits)) {
            throw BusinessException::make(__('erp.journal_unbalanced', ['debit' => $debits, 'credit' => $credits]), 'journal_unbalanced');
        }
        foreach ($lines as $line) {
            if ($line['debit'] > 0 && $line['credit'] > 0) {
                throw BusinessException::make(__('erp.journal_line_both_sides'), 'journal_line_invalid');
            }
        }

        $accounts = Account::query()->whereIn('id', collect($lines)->pluck('account_id')->unique())->get()->keyBy('id');
        foreach ($lines as $line) {
            $account = $accounts[$line['account_id']] ?? null;
            if (! $account || ! $account->is_active) {
                throw BusinessException::make(__('erp.account_inactive'), 'account_invalid');
            }
            if ($account->is_group) {
                throw BusinessException::make(__('erp.account_is_group', ['account' => $account->code.' '.$account->name]), 'account_group');
            }
            if ($manual && ! $account->allow_manual) {
                throw BusinessException::make(__('erp.account_no_manual', ['account' => $account->code.' '.$account->name]), 'account_no_manual');
            }
            // Receivable and payable are sub-ledgers: every line names its party,
            // otherwise statements stop agreeing with the books.
            if (in_array($account->system_key, ['ar', 'ap'], true) && empty($line['party_id'])) {
                throw BusinessException::make(__('erp.party_required_for_account', ['account' => $account->code.' '.$account->name]), 'party_required');
            }
        }

        return $lines;
    }
}
