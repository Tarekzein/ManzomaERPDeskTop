<?php

namespace App\Modules\Finance\Http\Controllers;

use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Models\CashAccount;
use App\Modules\Finance\Models\Cheque;
use App\Modules\Finance\Models\JournalLine;
use App\Modules\Finance\Models\Voucher;
use App\Modules\Finance\Services\ChequeService;
use App\Modules\Finance\Services\JournalService;
use App\Modules\Finance\Services\VoucherService;
use App\Support\ApiController;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TreasuryController extends ApiController
{
    public function __construct(
        private readonly VoucherService $vouchers,
        private readonly JournalService $journal,
    ) {}

    // ─────────────── Cash boxes and banks ───────────────

    public function cashAccounts(Request $request)
    {
        $this->allow('treasury.view', 'vouchers.manage');
        $user = $this->user();
        $query = CashAccount::query()->with('account:id,code,name,name_en', 'branch:id,name,name_en', 'custodian:id,name')->orderBy('type')->orderBy('code');
        if (! $user->can('treasury.all_accounts') && ! $user->isAdmin()) {
            $query->where(fn ($q) => $q->whereNull('custodian_id')->orWhere('custodian_id', $user->id)->orWhere('id', $user->default_cash_account_id));
        }
        $rows = $query->get();
        $balances = DB::table('journal_lines')->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->where('journal_entries.status', '!=', 'draft')->whereIn('journal_lines.account_id', $rows->pluck('account_id'))
            ->groupBy('journal_lines.account_id')->selectRaw('journal_lines.account_id, SUM(debit - credit) b')->pluck('b', 'account_id');

        return response()->json(['data' => $rows->map(fn ($r) => $r->toArray() + ['balance' => Money::round($balances[$r->account_id] ?? 0)])]);
    }

    public function storeCashAccount(Request $request)
    {
        $this->allow('accounts.manage');
        $data = $this->validatedCash($request);

        return DB::transaction(function () use ($data) {
            // Each box or bank gets its own GL account under cash or banks.
            $group = Account::query()->where('system_key', $data['type'] === 'bank' ? 'bank_group' : 'cash_group')->firstOrFail();
            $last = Account::query()->where('parent_id', $group->id)->max('code');
            $code = $last ? (string) ((int) $last + 1) : $group->code.'01';
            $gl = Account::query()->create(['parent_id' => $group->id, 'code' => $code, 'name' => $data['name'], 'name_en' => $data['name_en'] ?? null, 'type' => 'asset', 'currency' => $data['currency'] ?? null]);
            $cash = CashAccount::query()->create($data + ['account_id' => $gl->id]);

            return response()->json(['data' => $cash->load('account')], 201);
        });
    }

    public function updateCashAccount(Request $request, CashAccount $cashAccount)
    {
        $this->allow('accounts.manage');
        $data = $this->validatedCash($request, $cashAccount);
        unset($data['type']);
        $cashAccount->update($data);
        $cashAccount->account->update(['name' => $data['name'], 'name_en' => $data['name_en'] ?? $cashAccount->account->name_en]);

        return response()->json(['data' => $cashAccount->refresh()->load('account')]);
    }

    /**
     * Cash box / bank statement with running balance.
     */
    public function cashStatement(Request $request, CashAccount $cashAccount)
    {
        $this->allow('treasury.view');
        abort_unless($this->can('treasury.all_accounts') || ! $cashAccount->custodian_id || $cashAccount->custodian_id === $this->user()->id || $cashAccount->id === $this->user()->default_cash_account_id, 403);
        $from = $request->query('from', now()->toDateString());
        $to = $request->query('to', now()->toDateString());
        $opening = $this->journal->balance((int) $cashAccount->account_id, date('Y-m-d', strtotime($from.' -1 day')));
        $rows = JournalLine::query()->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->where('journal_entries.status', '!=', 'draft')->where('journal_lines.account_id', $cashAccount->account_id)
            ->whereDate('journal_entries.date', '>=', $from)->whereDate('journal_entries.date', '<=', $to)
            ->orderBy('journal_entries.date')->orderBy('journal_entries.id')
            ->get(['journal_entries.id as entry_id', 'journal_entries.number', 'journal_entries.date', 'journal_entries.description', 'journal_entries.reference', 'journal_entries.source_type', 'journal_entries.source_id', 'journal_lines.debit', 'journal_lines.credit']);
        $running = $opening;
        $lines = $rows->map(function ($r) use (&$running) {
            $running = Money::round($running + (float) $r->debit - (float) $r->credit);
            $r->date = substr((string) $r->date, 0, 10);
            $r->debit = (float) $r->debit;
            $r->credit = (float) $r->credit;
            $r->balance = $running;

            return $r;
        });

        return response()->json(['cash_account' => $cashAccount, 'from' => $from, 'to' => $to, 'opening_balance' => $opening, 'lines' => $lines,
            'total_in' => Money::round($lines->sum('debit')), 'total_out' => Money::round($lines->sum('credit')), 'closing_balance' => $running]);
    }

    // ─────────────── Vouchers ───────────────

    public function vouchers(Request $request)
    {
        $this->allow('treasury.view', 'vouchers.manage', 'expenses.manage');
        $query = Voucher::query()->with('cashAccount:id,code,name,name_en,type', 'toCashAccount:id,code,name,name_en', 'party:id,code,name,name_en', 'account:id,code,name,name_en', 'creator:id,name');
        if ($request->filled('type')) {
            $query->where('type', $request->string('type'));
        }
        if ($request->boolean('expenses')) {
            $query->where('type', 'payment')->whereNull('party_id');
        }
        if ($request->boolean('with_party')) {
            $query->whereNotNull('party_id');
        }
        foreach (['status', 'method', 'party_id', 'cash_account_id', 'account_id', 'cost_center_id'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->query($filter));
            }
        }
        $this->dateRange($query, $request);
        $term = trim((string) $request->query('search'));
        if ($term !== '') {
            $query->where(fn ($q) => $q->where('number', 'like', "%{$term}%")->orWhere('description', 'like', "%{$term}%")->orWhere('reference', 'like', "%{$term}%")->orWhere('payee', 'like', "%{$term}%")
                ->orWhereHas('party', fn ($p) => $p->where('name', 'like', "%{$term}%")));
        }
        $totals = (clone $query)->where('status', 'posted')->toBase()->reorder()->selectRaw('COUNT(*) count, COALESCE(SUM(amount),0) amount')->first();
        $result = $this->paginate($query, $request, ['id', 'number', 'date', 'amount'], '-id');

        return response()->json((is_array($result) ? $result : $result->toArray()) + ['totals' => $totals]);
    }

    public function showVoucher(Voucher $voucher)
    {
        $this->allow('treasury.view', 'vouchers.manage', 'expenses.manage');

        return response()->json(['data' => $voucher->load($this->vouchers->relations())]);
    }

    public function storeVoucher(Request $request)
    {
        $data = $this->validatedVoucher($request);
        $this->allowVoucher($data);
        if ($request->boolean('post')) {
            $this->allow('vouchers.post');
            $voucher = $this->vouchers->createAndPost($data);
        } else {
            $voucher = $this->vouchers->save($data);
        }

        return response()->json(['data' => $voucher->load($this->vouchers->relations())], 201);
    }

    public function updateVoucher(Request $request, Voucher $voucher)
    {
        $data = $this->validatedVoucher($request) + ['type' => $voucher->type];
        $this->allowVoucher($data);
        $voucher = DB::transaction(function () use ($voucher, $data, $request) {
            $voucher = $this->vouchers->save($data, $voucher);
            if ($request->boolean('post')) {
                $this->allow('vouchers.post');
                $voucher = $this->vouchers->post($voucher, $data);
            }

            return $voucher;
        });

        return response()->json(['data' => $voucher->load($this->vouchers->relations())]);
    }

    public function postVoucher(Request $request, Voucher $voucher)
    {
        $this->allow('vouchers.post');

        return response()->json(['data' => $this->vouchers->post($voucher, $request->only(['cheque', 'allocations', 'auto_allocate']))]);
    }

    public function voidVoucher(Request $request, Voucher $voucher)
    {
        $this->allow('vouchers.void');
        $data = $request->validate(['reason' => 'required|string|max:250']);

        return response()->json(['data' => $this->vouchers->void($voucher, $data['reason'])]);
    }

    public function destroyVoucher(Voucher $voucher)
    {
        $this->allow('vouchers.manage', 'expenses.manage');
        if ($voucher->status !== 'draft') {
            throw BusinessException::make(__('erp.only_draft_deletable'), 'not_draft');
        }
        $voucher->delete();

        return response()->json(['ok' => true]);
    }

    // ─────────────── Cheques ───────────────

    public function cheques(Request $request)
    {
        $this->allow('cheques.manage', 'treasury.view');
        $query = Cheque::query()->with('party:id,code,name,name_en', 'cashAccount:id,code,name,name_en', 'voucher:id,number,type');
        foreach (['direction', 'party_id'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->query($filter));
            }
        }
        if ($request->filled('status')) {
            $query->whereIn('status', explode(',', (string) $request->query('status')));
        }
        if ($request->filled('due_from')) {
            $query->whereDate('due_date', '>=', $request->query('due_from'));
        }
        if ($request->filled('due_to')) {
            $query->whereDate('due_date', '<=', $request->query('due_to'));
        }
        $this->search($query, $request->query('search'), ['number', 'bank_name', 'drawer_name']);
        $totals = (clone $query)->toBase()->reorder()->selectRaw('COUNT(*) count, COALESCE(SUM(amount),0) amount')->first();
        $result = $this->paginate($query, $request, ['id', 'due_date', 'amount', 'number'], 'due_date');

        return response()->json((is_array($result) ? $result : $result->toArray()) + ['totals' => $totals]);
    }

    public function showCheque(Cheque $cheque)
    {
        $this->allow('cheques.manage', 'treasury.view');

        return response()->json(['data' => $cheque->load('party:id,code,name', 'cashAccount:id,name,code', 'events.user:id,name', 'events.cashAccount:id,name', 'voucher:id,number,type,date')]);
    }

    public function chequeAction(Request $request, Cheque $cheque, string $action, ChequeService $cheques)
    {
        $this->allow('cheques.manage');
        $data = $request->validate([
            'date' => ['nullable', 'date'],
            'cash_account_id' => ['nullable', 'exists:cash_accounts,id'],
            'party_id' => ['nullable', 'exists:parties,id'],
            'note' => ['nullable', 'string', 'max:250'],
        ]);

        return response()->json(['data' => $cheques->act($cheque, $action, $data)]);
    }

    private function allowVoucher(array $data): void
    {
        if (($data['type'] ?? null) === 'payment' && empty($data['party_id'])) {
            $this->allow('expenses.manage', 'vouchers.manage');

            return;
        }
        $this->allow('vouchers.manage');
    }

    private function validatedVoucher(Request $request): array
    {
        return $request->validate([
            'type' => ['sometimes', 'in:receipt,payment,transfer'],
            'date' => ['required', 'date'],
            'branch_id' => ['nullable', 'exists:branches,id'],
            'cash_account_id' => ['nullable', 'exists:cash_accounts,id'],
            'to_cash_account_id' => ['nullable', 'exists:cash_accounts,id'],
            'party_id' => ['nullable', 'exists:parties,id'],
            'party_account' => ['nullable', 'in:ar,ap'],
            'account_id' => ['nullable', 'exists:accounts,id'],
            'cost_center_id' => ['nullable', 'exists:cost_centers,id'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'tax_rate_id' => ['nullable', 'exists:tax_rates,id'],
            'method' => ['nullable', 'in:cash,cheque,bank_transfer,card,wallet'],
            'payee' => ['nullable', 'string', 'max:190'],
            'reference' => ['nullable', 'string', 'max:80'],
            'description' => ['nullable', 'string', 'max:250'],
            'cheque' => ['nullable', 'array'],
            'cheque.number' => ['required_with:cheque', 'string', 'max:40'],
            'cheque.bank_name' => ['nullable', 'string', 'max:120'],
            'cheque.due_date' => ['required_with:cheque', 'date'],
            'cheque.issue_date' => ['nullable', 'date'],
            'cheque.drawer_name' => ['nullable', 'string', 'max:190'],
            'cheque.cash_account_id' => ['nullable', 'exists:cash_accounts,id'],
            'allocations' => ['nullable', 'array'],
            'allocations.*.document_id' => ['required', 'exists:trade_documents,id'],
            'allocations.*.amount' => ['required', 'numeric', 'min:0'],
            'auto_allocate' => ['nullable', 'boolean'],
        ]);
    }

    private function validatedCash(Request $request, ?CashAccount $cash = null): array
    {
        return $request->validate([
            'type' => [$cash ? 'sometimes' : 'required', 'in:cash,bank'],
            'code' => ['required', 'string', 'max:20', Rule::unique('cash_accounts', 'code')->ignore($cash?->id)],
            'name' => ['required', 'string', 'max:190'],
            'name_en' => ['nullable', 'string', 'max:190'],
            'branch_id' => ['nullable', 'exists:branches,id'],
            'currency' => ['nullable', 'string', 'size:3'],
            'bank_name' => ['nullable', 'string', 'max:120'],
            'account_number' => ['nullable', 'string', 'max:60'],
            'iban' => ['nullable', 'string', 'max:60'],
            'custodian_id' => ['nullable', 'exists:users,id'],
            'allow_negative' => ['boolean'],
            'is_active' => ['boolean'],
        ]);
    }
}
