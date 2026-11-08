<?php

namespace App\Modules\Finance\Http\Controllers;

use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Models\JournalLine;
use App\Modules\Finance\Services\JournalService;
use App\Support\ApiController;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AccountController extends ApiController
{
    /**
     * Flat list ordered by code with balances; the desktop builds the tree.
     */
    public function index(Request $request)
    {
        $this->allow('accounts.manage', 'finance.reports', 'journals.manage', 'vouchers.manage', 'expenses.manage');
        $to = $request->query('to');
        $balances = DB::table('journal_lines')
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->where('journal_entries.status', '!=', 'draft')
            ->when($to, fn ($q) => $q->whereDate('journal_entries.date', '<=', $to))
            ->groupBy('journal_lines.account_id')
            ->selectRaw('journal_lines.account_id, SUM(journal_lines.debit) d, SUM(journal_lines.credit) c')
            ->get()->keyBy('account_id');

        $accounts = Account::query()->orderBy('code')->get();
        $children = $accounts->groupBy('parent_id');
        $totals = [];
        $sum = function (Account $a) use (&$sum, &$totals, $children, $balances) {
            $d = (float) ($balances[$a->id]->d ?? 0);
            $c = (float) ($balances[$a->id]->c ?? 0);
            foreach ($children[$a->id] ?? [] as $child) {
                [$cd, $cc] = $sum($child);
                $d += $cd;
                $c += $cc;
            }
            $totals[$a->id] = [$d, $c];

            return [$d, $c];
        };
        foreach ($children[''] ?? $children[null] ?? [] as $root) {
            $sum($root);
        }

        return response()->json(['data' => $accounts->map(fn (Account $a) => $a->toArray() + [
            'debit' => Money::round($totals[$a->id][0] ?? 0),
            'credit' => Money::round($totals[$a->id][1] ?? 0),
            'balance' => Money::round(($totals[$a->id][0] ?? 0) - ($totals[$a->id][1] ?? 0)),
        ])]);
    }

    public function store(Request $request)
    {
        $this->allow('accounts.manage');

        return DB::transaction(function () use ($request) {
            Account::query()->orderBy('id')->lockForUpdate()->get(['id']);
            $data = $this->validated($request);
            $parent = $data['parent_id'] ? Account::query()->findOrFail($data['parent_id']) : null;
            if ($parent && ! $parent->is_group) {
                throw BusinessException::make(__('erp.parent_must_be_group'), 'parent_not_group');
            }
            $data['type'] = $parent?->type ?? $data['type'];
            $data['code'] ??= $this->nextCode($parent);

            return response()->json(['data' => Account::query()->create($data)], 201);
        });
    }

    public function update(Request $request, Account $account)
    {
        $this->allow('accounts.manage');
        DB::transaction(function () use ($request, $account) {
            // Serialize tree edits as well as posting; a valid tree must not gain cycles concurrently.
            Account::query()->orderBy('id')->lockForUpdate()->get(['id']);
            $account->refresh();
            $data = $this->validated($request, $account);
            $hasLines = JournalLine::query()->where('account_id', $account->id)->exists();
            if ($account->system_key) {
                abort_if((int) ($data['parent_id'] ?? 0) !== (int) ($account->parent_id ?? 0), 422, 'System account parents are fixed.');
                unset($data['type'], $data['is_group']);
            }
            $parent = ! empty($data['parent_id']) ? Account::query()->findOrFail($data['parent_id']) : null;
            abort_if($parent && ! $parent->is_group, 422, 'Parent must be a group account.');
            $visited = [$account->id];
            $ancestor = $parent;
            while ($ancestor) {
                abort_if(in_array($ancestor->id, $visited, true), 422, 'Account hierarchy cannot contain cycles.');
                $visited[] = $ancestor->id;
                $ancestor = $ancestor->parent_id ? Account::query()->findOrFail($ancestor->parent_id) : null;
            }
            if ($parent) {
                $data['type'] = $parent->type;
            }
            if ($hasLines && (($data['is_group'] ?? false) && ! $account->is_group || ($data['type'] ?? $account->type) !== $account->type)) {
                throw BusinessException::make(__('erp.account_has_entries'), 'account_has_entries');
            }
            if (array_key_exists('is_group', $data) && ! $data['is_group']) {
                abort_if($account->children()->exists(), 422, 'An account with children must remain a group.');
            }
            unset($data['code']);
            $account->update($data);
        });

        return response()->json(['data' => $account->refresh()]);
    }

    public function destroy(Account $account)
    {
        $this->allow('accounts.manage');
        if ($account->system_key || JournalLine::query()->where('account_id', $account->id)->exists() || $account->children()->exists()
            || DB::table('cash_accounts')->where('account_id', $account->id)->exists()) {
            throw BusinessException::make(__('erp.account_in_use'), 'account_in_use');
        }
        $account->delete();

        return response()->json(['ok' => true]);
    }

    /**
     * General ledger for one account (account statement) with running balance.
     */
    public function ledger(Request $request, Account $account, JournalService $journal)
    {
        $this->allow('finance.reports', 'accounts.manage');
        $from = $request->query('from', now()->startOfYear()->toDateString());
        $to = $request->query('to', now()->toDateString());
        $ids = $this->descendants($account);
        $partyId = $request->integer('party_id') ?: null;
        $costCenterId = $request->integer('cost_center_id') ?: null;

        $opening = $journal->balance($ids, date('Y-m-d', strtotime($from.' -1 day')), $partyId);
        $rows = JournalLine::query()
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->leftJoin('parties', 'parties.id', '=', 'journal_lines.party_id')
            ->leftJoin('accounts', 'accounts.id', '=', 'journal_lines.account_id')
            ->where('journal_entries.status', '!=', 'draft')
            ->whereIn('journal_lines.account_id', $ids)
            ->when($partyId, fn ($q) => $q->where('journal_lines.party_id', $partyId))
            ->when($costCenterId, fn ($q) => $q->where('journal_lines.cost_center_id', $costCenterId))
            ->whereDate('journal_entries.date', '>=', $from)->whereDate('journal_entries.date', '<=', $to)
            ->orderBy('journal_entries.date')->orderBy('journal_entries.id')->orderBy('journal_lines.id')
            ->get(['journal_entries.id as entry_id', 'journal_entries.number', 'journal_entries.date', 'journal_entries.description', 'journal_entries.reference',
                'journal_entries.source_type', 'journal_entries.source_id', 'journal_lines.description as line_description', 'journal_lines.debit', 'journal_lines.credit',
                'parties.name as party', 'accounts.code as account_code', 'accounts.name as account_name']);
        $running = $opening;
        $lines = $rows->map(function ($r) use (&$running) {
            $running = Money::round($running + (float) $r->debit - (float) $r->credit);
            $r->date = substr((string) $r->date, 0, 10);
            $r->debit = (float) $r->debit;
            $r->credit = (float) $r->credit;
            $r->balance = $running;

            return $r;
        });

        return response()->json([
            'account' => $account,
            'from' => $from,
            'to' => $to,
            'opening_balance' => $opening,
            'lines' => $lines,
            'total_debit' => Money::round($lines->sum('debit')),
            'total_credit' => Money::round($lines->sum('credit')),
            'closing_balance' => $running,
        ]);
    }

    private function descendants(Account $account): array
    {
        $ids = [$account->id];
        $frontier = [$account->id];
        while ($frontier) {
            $frontier = Account::query()->whereIn('parent_id', $frontier)->pluck('id')->all();
            $ids = array_merge($ids, $frontier);
        }

        return $ids;
    }

    private function nextCode(?Account $parent): string
    {
        if (! $parent) {
            return (string) ((int) Account::query()->whereNull('parent_id')->max('code') + 1);
        }
        $siblings = Account::query()->where('parent_id', $parent->id)->pluck('code')->map(fn ($c) => (int) $c);
        $width = strlen($parent->code) >= 3 ? 2 : (strlen($parent->code) === 1 ? 1 : 2);
        $next = $siblings->isEmpty() ? (int) ($parent->code.str_pad('1', $width, '0', STR_PAD_LEFT)) : $siblings->max() + 1;

        return (string) $next;
    }

    private function validated(Request $request, ?Account $account = null): array
    {
        return $request->validate([
            'parent_id' => ['nullable', 'exists:accounts,id'],
            'code' => ['nullable', 'string', 'max:30', 'regex:/^[0-9]+$/', Rule::unique('accounts', 'code')->ignore($account?->id)],
            'name' => ['required', 'string', 'max:190'],
            'name_en' => ['nullable', 'string', 'max:190'],
            'type' => [$account ? 'sometimes' : 'required_without:parent_id', 'in:asset,liability,equity,revenue,expense'],
            'is_group' => ['boolean'],
            'allow_manual' => ['boolean'],
            'is_active' => ['boolean'],
            'description' => ['nullable', 'string', 'max:250'],
        ]) + ['parent_id' => null];
    }
}
