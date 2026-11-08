<?php

namespace App\Modules\Parties\Http\Controllers;

use App\Modules\Core\Services\NumberingService;
use App\Modules\CRM\Models\Activity;
use App\Modules\CRM\Models\Opportunity;
use App\Modules\CRM\Models\Task;
use App\Modules\Finance\Models\Cheque;
use App\Modules\Finance\Models\JournalLine;
use App\Modules\Finance\Services\AccountResolver;
use App\Modules\Finance\Services\FiscalService;
use App\Modules\Finance\Services\JournalService;
use App\Modules\Parties\Models\Party;
use App\Modules\Parties\Services\CustomerIntakeService;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\ServiceRequest;
use App\Modules\Trading\Models\TradeDocument;
use App\Support\ApiController;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class PartyController extends ApiController
{
    public function __construct(
        private readonly AccountResolver $accounts,
        private readonly JournalService $journal,
    ) {}

    public function index(Request $request)
    {
        $role = $request->query('role');
        $this->allowRole($role, 'view');

        $query = Party::query()->with('tags:id,name,color', 'salesperson:id,name');
        $this->withBalance($query);
        if ($role === 'customer') {
            $query->where('is_customer', true);
        } elseif ($role === 'supplier') {
            $query->where('is_supplier', true);
        }
        if ($request->filled('active')) {
            $query->where('is_active', $request->boolean('active'));
        }
        if ($request->filled('tag_id')) {
            $query->whereHas('tags', fn ($q) => $q->where('tags.id', $request->integer('tag_id')));
        }
        if ($request->filled('salesperson_id')) {
            $query->where('salesperson_id', $request->integer('salesperson_id'));
        }
        if ($request->filled('city')) {
            $query->where('city', $request->string('city'));
        }
        if ($request->boolean('with_balance_only')) {
            $query->whereRaw('ABS(COALESCE(('.$this->balanceSql().'), 0)) > 0.004');
        }
        $this->search($query, $request->query('search'), ['code', 'name', 'name_en', 'phone', 'mobile', 'tax_number', 'email']);

        return $this->paginate($query, $request, ['id', 'code', 'name', 'balance', 'created_at'], 'name');
    }

    public function show(Party $party)
    {
        $this->allowParty($party, 'view');
        $party->load('contacts', 'tags:id,name,color', 'salesperson:id,name', 'priceList:id,name,name_en');
        $balance = $this->journal->partyBalance($party->id);

        $overdue = TradeDocument::query()->where('party_id', $party->id)->whereIn('type', ['sales_invoice', 'purchase_invoice'])
            ->where('status', 'posted')->whereColumn('paid_amount', '<', 'balance_due')->whereDate('due_date', '<', now()->toDateString())
            ->selectRaw('COUNT(*) c, COALESCE(SUM(balance_due - paid_amount), 0) amount')->first();

        return response()->json(['data' => $party, 'summary' => [
            'balance' => $balance,
            'credit_available' => $party->credit_limit !== null ? Money::round((float) $party->credit_limit - $balance) : null,
            'overdue_count' => (int) $overdue->c,
            'overdue_amount' => Money::round($overdue->amount),
            'cheques_in_portfolio' => Money::round(Cheque::query()->where('party_id', $party->id)->whereIn('status', ['in_portfolio', 'deposited'])->sum('amount')),
            'sales_this_year' => Money::round(TradeDocument::query()->where('party_id', $party->id)->where('type', 'sales_invoice')->where('status', 'posted')->whereYear('date', now()->year)->sum('net_total')
                - TradeDocument::query()->where('party_id', $party->id)->where('type', 'sales_return')->where('status', 'posted')->whereYear('date', now()->year)->sum('net_total')),
            'purchases_this_year' => Money::round(TradeDocument::query()->where('party_id', $party->id)->where('type', 'purchase_invoice')->where('status', 'posted')->whereYear('date', now()->year)->sum('net_total')),
            'last_invoice' => TradeDocument::query()->where('party_id', $party->id)->whereIn('type', ['sales_invoice', 'purchase_invoice'])->where('status', 'posted')->latest('date')->first(['id', 'type', 'number', 'date', 'total']),
        ]]);
    }

    public function store(Request $request, NumberingService $numbers, FiscalService $fiscal)
    {
        $data = $this->validated($request);
        $this->allowRole($data['is_customer'] ? 'customer' : 'supplier', 'manage');

        $entry = $request->validate(['product_entry' => 'sometimes|nullable|array'])['product_entry'] ?? null;

        return DB::transaction(function () use ($data, $numbers, $fiscal, $entry) {
            $kind = $data['is_customer'] && $data['is_supplier'] ? 'party' : ($data['is_customer'] ? 'customer' : 'supplier');
            $party = Party::query()->create(collect($data)->except(['contacts', 'tags', 'opening_balance', 'opening_date'])->all() + [
                'code' => $data['code'] ?? $numbers->code($kind),
            ]);
            $this->syncRelations($party, $data);
            if (! empty($data['opening_balance'])) {
                $fiscal->partyOpening($party, (float) $data['opening_balance'], $data['opening_date'] ?? now()->toDateString());
            }

            $result = $entry !== null ? app(CustomerIntakeService::class)->record($party, $entry) : null;

            return response()->json(['data' => $party->load('contacts', 'tags:id,name,color'), 'product_entry_result' => $result], 201);
        });
    }

    public function update(Request $request, Party $party)
    {
        $this->allowParty($party, 'manage');
        $request->validate(['product_entry' => 'prohibited']);
        $data = $this->validated($request, $party);
        DB::transaction(function () use ($party, $data) {
            $party->update(collect($data)->except(['contacts', 'tags', 'opening_balance', 'opening_date', 'code'])->all() + (isset($data['code']) ? ['code' => $data['code']] : []));
            $this->syncRelations($party, $data);
        });

        return response()->json(['data' => $party->refresh()->load('contacts', 'tags:id,name,color')]);
    }

    public function destroy(Party $party)
    {
        $this->allowParty($party, 'manage');
        $used = CustomerUnit::query()->where('party_id', $party->id)->exists()
            || ServiceRequest::query()->where('party_id', $party->id)->exists()
            || TradeDocument::query()->where('party_id', $party->id)->exists() || JournalLine::query()->where('party_id', $party->id)->exists();
        if ($used) {
            // Keep history intact: deactivate instead of deleting.
            if (! Money::isZero($this->journal->partyBalance($party->id))) {
                throw BusinessException::make(__('erp.party_has_balance'), 'has_balance');
            }
            $party->update(['is_active' => false]);

            return response()->json(['ok' => true, 'deactivated' => true]);
        }
        $party->delete();

        return response()->json(['ok' => true]);
    }

    public function opening(Request $request, Party $party, FiscalService $fiscal)
    {
        $this->allow('journals.manage', 'fiscal.manage');
        $data = $request->validate(['amount' => 'required|numeric', 'date' => 'required|date', 'account' => 'nullable|in:ar,ap']);
        $entry = $fiscal->partyOpening($party, (float) $data['amount'], $data['date'], $data['account'] ?? null);

        return response()->json(['data' => $entry]);
    }

    /**
     * Statement of account (كشف حساب) with running balance.
     */
    public function statement(Request $request, Party $party)
    {
        $this->allowParty($party, 'view');
        $from = $request->query('from', now()->startOfYear()->toDateString());
        $to = $request->query('to', now()->toDateString());
        $accounts = [$this->accounts->id('ar'), $this->accounts->id('ap')];

        $opening = $this->journal->balance($accounts, date('Y-m-d', strtotime($from.' -1 day')), $party->id);
        $rows = JournalLine::query()
            ->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->where('journal_entries.status', '!=', 'draft')
            ->where('journal_lines.party_id', $party->id)
            ->whereIn('journal_lines.account_id', $accounts)
            ->whereDate('journal_entries.date', '>=', $from)
            ->whereDate('journal_entries.date', '<=', $to)
            ->orderBy('journal_entries.date')->orderBy('journal_entries.id')->orderBy('journal_lines.id')
            ->get(['journal_entries.id as entry_id', 'journal_entries.number as entry_number', 'journal_entries.date', 'journal_entries.description',
                'journal_entries.reference', 'journal_entries.source_type', 'journal_entries.source_id', 'journal_lines.debit', 'journal_lines.credit']);

        $running = $opening;
        $lines = $rows->map(function ($row) use (&$running) {
            $running = Money::round($running + (float) $row->debit - (float) $row->credit);

            return [
                'date' => substr((string) $row->date, 0, 10),
                'entry_id' => $row->entry_id,
                'entry_number' => $row->entry_number,
                'reference' => $row->reference,
                'description' => $row->description,
                'source_type' => $row->source_type,
                'source_id' => $row->source_id,
                'debit' => (float) $row->debit,
                'credit' => (float) $row->credit,
                'balance' => $running,
            ];
        });

        return response()->json([
            'party' => $party->only(['id', 'code', 'name', 'name_en', 'phone', 'mobile', 'address', 'tax_number']),
            'from' => $from,
            'to' => $to,
            'opening_balance' => $opening,
            'lines' => $lines,
            'total_debit' => Money::round($lines->sum('debit')),
            'total_credit' => Money::round($lines->sum('credit')),
            'closing_balance' => $running,
        ]);
    }

    /**
     * Posted invoices still open, for allocating a receipt or payment.
     */
    public function openInvoices(Request $request, Party $party)
    {
        $this->allowParty($party, 'view');
        $type = $request->query('type', $party->is_customer ? 'sales_invoice' : 'purchase_invoice');

        return response()->json(['data' => TradeDocument::query()
            ->where('party_id', $party->id)->where('type', $type)->where('status', 'posted')
            ->whereColumn('paid_amount', '<', 'balance_due')
            ->orderBy('due_date')->orderBy('date')
            ->get(['id', 'type', 'number', 'date', 'due_date', 'total', 'balance_due', 'paid_amount'])]);
    }

    /**
     * Customer 360: everything about one customer on one screen.
     */
    public function overview(Party $party)
    {
        $this->allowParty($party, 'view');
        $docs = TradeDocument::query()->where('party_id', $party->id)->latest('date')->latest('id')->limit(15)
            ->get(['id', 'type', 'number', 'date', 'status', 'total', 'balance_due', 'paid_amount']);

        $topProducts = DB::table('trade_document_lines')
            ->join('trade_documents', 'trade_documents.id', '=', 'trade_document_lines.trade_document_id')
            ->join('products', 'products.id', '=', 'trade_document_lines.product_id')
            ->where('trade_documents.party_id', $party->id)
            ->where('trade_documents.type', $party->is_customer ? 'sales_invoice' : 'purchase_invoice')
            ->where('trade_documents.status', 'posted')
            ->groupBy('products.id', 'products.code', 'products.name', 'products.name_en')
            ->selectRaw('products.id, products.code, products.name, products.name_en, SUM(trade_document_lines.base_quantity) quantity, SUM(trade_document_lines.net_amount) amount')
            ->orderByDesc('amount')->limit(8)->get();

        $monthly = TradeDocument::query()->where('party_id', $party->id)->where('type', 'sales_invoice')->where('status', 'posted')
            ->whereDate('date', '>=', now()->subMonths(11)->startOfMonth()->toDateString())
            ->selectRaw('SUBSTR(date, 1, 7) month, SUM(net_total) amount')->groupBy('month')->orderBy('month')->get();

        return response()->json([
            'documents' => $docs,
            'top_products' => $topProducts,
            'monthly_sales' => $monthly,
            'activities' => Activity::query()->with('user:id,name')->where('party_id', $party->id)->latest('occurred_at')->limit(15)->get(),
            'tasks' => Task::query()->with('assignee:id,name')->where('party_id', $party->id)->where('status', 'open')->orderBy('due_at')->get(),
            'opportunities' => Opportunity::query()->with('stage', 'owner:id,name')->where('party_id', $party->id)->latest()->limit(10)->get(),
            'cheques' => Cheque::query()->where('party_id', $party->id)->whereIn('status', ['in_portfolio', 'deposited', 'issued', 'bounced'])->orderBy('due_date')->get(),
        ]);
    }

    private function withBalance(Builder $query): void
    {
        $query->select('parties.*')->selectRaw('COALESCE(('.$this->balanceSql().'), 0) AS balance');
    }

    private function balanceSql(): string
    {
        $ar = $this->accounts->id('ar');
        $ap = $this->accounts->id('ap');

        return "SELECT SUM(jl.debit - jl.credit) FROM journal_lines jl INNER JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE jl.party_id = parties.id AND je.status <> 'draft' AND jl.account_id IN ({$ar}, {$ap})";
    }

    private function syncRelations(Party $party, array $data): void
    {
        if (array_key_exists('tags', $data)) {
            $party->syncTags($data['tags'] ?? []);
        }
        if (array_key_exists('contacts', $data)) {
            $party->contacts()->delete();
            foreach ($data['contacts'] ?? [] as $contact) {
                if (! empty($contact['name'])) {
                    $party->contacts()->create(collect($contact)->only(['name', 'position', 'phone', 'email'])->all());
                }
            }
        }
    }

    private function validated(Request $request, ?Party $party = null): array
    {
        $data = $request->validate([
            'code' => ['nullable', 'string', 'max:30', Rule::unique('parties', 'code')->ignore($party?->id)],
            'is_customer' => ['boolean'],
            'is_supplier' => ['boolean'],
            'kind' => ['nullable', 'in:company,individual'],
            'name' => ['required', 'string', 'max:190'],
            'name_en' => ['nullable', 'string', 'max:190'],
            'tax_number' => ['nullable', 'string', 'max:40'],
            'commercial_register' => ['nullable', 'string', 'max:40'],
            'national_id' => ['nullable', 'string', 'max:20'],
            'phone' => ['nullable', 'string', 'max:40'],
            'mobile' => ['nullable', 'string', 'max:40'],
            'email' => ['nullable', 'email', 'max:190'],
            'city' => ['nullable', 'string', 'max:100'],
            'address' => ['nullable', 'string', 'max:250'],
            'payment_terms_days' => ['nullable', 'integer', 'min:0', 'max:365'],
            'credit_limit' => ['nullable', 'numeric', 'min:0'],
            'price_list_id' => ['nullable', 'exists:price_lists,id'],
            'salesperson_id' => ['nullable', 'exists:users,id'],
            'branch_id' => ['nullable', 'exists:branches,id'],
            'subject_to_wht' => ['boolean'],
            'wht_rate' => ['nullable', 'numeric', 'between:0,20'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'is_active' => ['boolean'],
            'tags' => ['nullable', 'array'],
            'contacts' => ['nullable', 'array'],
            'contacts.*.name' => ['nullable', 'string', 'max:120'],
            'contacts.*.position' => ['nullable', 'string', 'max:120'],
            'contacts.*.phone' => ['nullable', 'string', 'max:40'],
            'contacts.*.email' => ['nullable', 'email', 'max:190'],
            'opening_balance' => ['nullable', 'numeric'],
            'opening_date' => ['nullable', 'date'],
        ]);
        $data['is_customer'] = (bool) ($data['is_customer'] ?? $party?->is_customer ?? false);
        $data['is_supplier'] = (bool) ($data['is_supplier'] ?? $party?->is_supplier ?? false);
        if (! $data['is_customer'] && ! $data['is_supplier']) {
            throw BusinessException::make(__('erp.party_role_required'), 'party_role_required');
        }
        $data['payment_terms_days'] = (int) ($data['payment_terms_days'] ?? 0);
        $data['wht_rate'] = (float) ($data['wht_rate'] ?? 1);
        $data['kind'] = $data['kind'] ?? $party?->kind ?? ($data['is_customer'] && ! $data['is_supplier'] ? 'individual' : 'company');
        if (array_key_exists('code', $data) && $data['code'] === null) {
            unset($data['code']);
        }

        return $data;
    }

    private function allowRole(?string $role, string $level): void
    {
        $permissions = match ($role) {
            'customer' => ["customers.{$level}"],
            'supplier' => ["suppliers.{$level}"],
            default => ["customers.{$level}", "suppliers.{$level}"],
        };
        $this->allow(...$permissions);
    }

    private function allowParty(Party $party, string $level): void
    {
        $permissions = [];
        if ($party->is_customer) {
            $permissions[] = "customers.{$level}";
        }
        if ($party->is_supplier) {
            $permissions[] = "suppliers.{$level}";
        }
        $this->allow(...$permissions);
    }
}
