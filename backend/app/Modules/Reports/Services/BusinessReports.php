<?php

namespace App\Modules\Reports\Services;

use App\Models\User;
use App\Modules\CRM\Models\Activity;
use App\Modules\CRM\Models\Lead;
use App\Modules\CRM\Models\Opportunity;
use App\Modules\CRM\Models\Task;
use App\Modules\Finance\Models\Cheque;
use App\Modules\Finance\Services\AccountResolver;
use App\Modules\Finance\Services\JournalService;
use App\Modules\Trading\Models\TradeDocument;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

class BusinessReports
{
    public const DIMENSIONS = ['day', 'month', 'party', 'product', 'category', 'brand', 'salesperson', 'warehouse', 'branch', 'document'];

    public function __construct(
        private readonly JournalService $journal,
        private readonly AccountResolver $accounts,
    ) {}

    /**
     * Sales or purchase analysis by a dimension. Returns net of returns.
     */
    public function analysis(string $side, string $dimension, string $from, string $to, array $filters = [], bool $withCost = true): array
    {
        $types = $side === 'purchases' ? ['purchase_invoice', 'purchase_return'] : ['sales_invoice', 'sales_return'];
        $return = $types[1];
        $sign = "CASE WHEN d.type = '{$return}' THEN -1 ELSE 1 END";

        $query = DB::table('trade_document_lines as l')
            ->join('trade_documents as d', 'd.id', '=', 'l.trade_document_id')
            ->join('products as p', 'p.id', '=', 'l.product_id')
            ->join('parties as pt', 'pt.id', '=', 'd.party_id')
            ->leftJoin('categories as c', 'c.id', '=', 'p.category_id')
            ->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')
            ->leftJoin('users as u', 'u.id', '=', 'd.salesperson_id')
            ->leftJoin('warehouses as w', 'w.id', '=', 'd.warehouse_id')
            ->leftJoin('branches as br', 'br.id', '=', 'd.branch_id')
            ->whereIn('d.type', $types)->where('d.status', 'posted')
            ->whereDate('d.date', '>=', $from)->whereDate('d.date', '<=', $to);
        foreach (['party_id' => 'd.party_id', 'product_id' => 'l.product_id', 'category_id' => 'p.category_id', 'salesperson_id' => 'd.salesperson_id', 'warehouse_id' => 'd.warehouse_id', 'branch_id' => 'd.branch_id'] as $key => $column) {
            if (! empty($filters[$key])) {
                $query->where($column, $filters[$key]);
            }
        }

        [$keyExpr, $labelExpr, $labelEnExpr, $codeExpr] = match ($dimension) {
            'day' => ['d.date', 'd.date', 'd.date', "''"],
            'month' => ['SUBSTR(d.date, 1, 7)', 'SUBSTR(d.date, 1, 7)', 'SUBSTR(d.date, 1, 7)', "''"],
            'party' => ['pt.id', 'pt.name', 'COALESCE(pt.name_en, pt.name)', 'pt.code'],
            'product' => ['p.id', 'p.name', 'COALESCE(p.name_en, p.name)', 'p.code'],
            'category' => ['COALESCE(c.id, 0)', "COALESCE(c.name, '—')", "COALESCE(c.name_en, c.name, '—')", "COALESCE(c.code, '')"],
            'brand' => ['COALESCE(b.id, 0)', "COALESCE(b.name, '—')", "COALESCE(b.name, '—')", "''"],
            'salesperson' => ['COALESCE(u.id, 0)', "COALESCE(u.name, '—')", "COALESCE(u.name, '—')", "''"],
            'warehouse' => ['COALESCE(w.id, 0)', "COALESCE(w.name, '—')", "COALESCE(w.name_en, w.name, '—')", "COALESCE(w.code, '')"],
            'branch' => ['COALESCE(br.id, 0)', "COALESCE(br.name, '—')", "COALESCE(br.name_en, br.name, '—')", "COALESCE(br.code, '')"],
            'document' => ['d.id', 'd.number', 'd.number', 'd.type'],
        };

        $documentCount = (clone $query)->distinct()->count('d.id');
        $rows = $query->groupByRaw("{$keyExpr}, {$labelExpr}, {$labelEnExpr}, {$codeExpr}")
            ->selectRaw("{$keyExpr} as key_id, {$labelExpr} as label, {$labelEnExpr} as label_en, {$codeExpr} as code,
                COUNT(DISTINCT d.id) as documents,
                SUM({$sign} * l.base_quantity) as quantity,
                SUM({$sign} * l.gross_amount) as gross,
                SUM({$sign} * l.total_discount) as discount,
                SUM({$sign} * l.net_amount) as net,
                SUM({$sign} * l.tax_amount) as tax,
                SUM({$sign} * l.line_total) as total,
                SUM({$sign} * l.cost_amount) as cost,
                SUM(CASE WHEN d.type = '{$return}' THEN l.net_amount ELSE 0 END) as returns")
            ->orderByRaw(in_array($dimension, ['day', 'month'], true) ? 'key_id' : 'net DESC')
            ->get()
            ->map(function ($r) use ($withCost, $side) {
                foreach (['quantity'] as $q) {
                    $r->{$q} = Money::qty($r->{$q});
                }
                foreach (['gross', 'discount', 'net', 'tax', 'total', 'cost', 'returns'] as $m) {
                    $r->{$m} = Money::round($r->{$m});
                }
                if ($side === 'sales' && $withCost) {
                    $r->profit = Money::round($r->net - $r->cost);
                    $r->margin = $r->net > 0 ? round($r->profit / $r->net * 100, 1) : null;
                } else {
                    unset($r->cost);
                }

                return $r;
            });

        $totals = ['documents' => 0];
        foreach (['quantity', 'gross', 'discount', 'net', 'tax', 'total', 'returns'] as $m) {
            $totals[$m] = Money::round($rows->sum($m));
        }
        if ($side === 'sales' && $withCost) {
            $totals['cost'] = Money::round($rows->sum('cost'));
            $totals['profit'] = Money::round($totals['net'] - $totals['cost']);
            $totals['margin'] = $totals['net'] > 0 ? round($totals['profit'] / $totals['net'] * 100, 1) : null;
        }
        $totals['documents'] = (int) $documentCount;

        return ['side' => $side, 'dimension' => $dimension, 'from' => $from, 'to' => $to, 'rows' => $rows->values(), 'totals' => $totals];
    }

    /**
     * Salesperson performance with commission at each person's rate.
     */
    public function salespeople(string $from, string $to): array
    {
        $data = $this->analysis('sales', 'salesperson', $from, $to);
        $rates = User::query()->pluck('commission_rate', 'id');
        $collections = DB::table('vouchers as v')->join('trade_documents as d', 'd.id', '=', 'v.source_document_id')
            ->where('v.type', 'receipt')->where('v.status', 'posted')->whereDate('v.date', '>=', $from)->whereDate('v.date', '<=', $to)
            ->groupBy('d.salesperson_id')->selectRaw('d.salesperson_id, SUM(v.amount) amount')->pluck('amount', 'salesperson_id');
        $data['rows'] = collect($data['rows'])->map(function ($r) use ($rates, $collections) {
            $rate = (float) ($rates[$r->key_id] ?? 0);
            $r->commission_rate = $rate;
            $r->commission = Money::round($r->net * $rate / 100);
            $r->collected_at_sale = Money::round($collections[$r->key_id] ?? 0);

            return $r;
        })->values();

        return $data;
    }

    public function crm(string $from, string $to, ?int $ownerId = null): array
    {
        $opps = Opportunity::query()->when($ownerId, fn ($q) => $q->where('crm_opportunities.owner_id', $ownerId));
        $leads = Lead::query()->when($ownerId, fn ($q) => $q->where('crm_leads.owner_id', $ownerId))->whereDate('crm_leads.created_at', '>=', $from)->whereDate('crm_leads.created_at', '<=', $to);

        $byStage = (clone $opps)->where('crm_opportunities.status', 'open')->join('crm_stages', 'crm_stages.id', '=', 'crm_opportunities.stage_id')
            ->groupBy('crm_stages.id', 'crm_stages.name', 'crm_stages.name_en', 'crm_stages.sort_order', 'crm_stages.color')
            ->orderBy('crm_stages.sort_order')
            ->selectRaw('crm_stages.id, crm_stages.name, crm_stages.name_en, crm_stages.color, COUNT(*) count, SUM(crm_opportunities.value) value, SUM(crm_opportunities.value * crm_opportunities.probability / 100.0) weighted')->get();

        $closed = (clone $opps)->whereIn('crm_opportunities.status', ['won', 'lost'])
            ->where(fn ($q) => $q->whereBetween('crm_opportunities.won_at', [$from.' 00:00:00', $to.' 23:59:59'])->orWhereBetween('crm_opportunities.lost_at', [$from.' 00:00:00', $to.' 23:59:59']));
        $won = (clone $closed)->where('crm_opportunities.status', 'won');
        $wonCount = $won->count();
        $closedCount = $closed->count();

        $lostReasons = (clone $closed)->where('crm_opportunities.status', 'lost')->leftJoin('crm_lost_reasons', 'crm_lost_reasons.id', '=', 'crm_opportunities.lost_reason_id')
            ->groupBy('crm_lost_reasons.id', 'crm_lost_reasons.name', 'crm_lost_reasons.name_en')
            ->selectRaw('crm_lost_reasons.id, crm_lost_reasons.name, crm_lost_reasons.name_en, COUNT(*) count, SUM(crm_opportunities.value) value')->orderByDesc('count')->get();

        $sources = (clone $leads)->leftJoin('crm_sources', 'crm_sources.id', '=', 'crm_leads.source_id')
            ->groupBy('crm_sources.id', 'crm_sources.name', 'crm_sources.name_en')
            ->selectRaw("crm_sources.id, crm_sources.name, crm_sources.name_en, COUNT(*) leads, SUM(CASE WHEN crm_leads.status = 'converted' THEN 1 ELSE 0 END) converted")->get();

        $reps = User::query()->where('is_active', true)->when($ownerId, fn ($q) => $q->where('id', $ownerId))->get(['id', 'name'])->map(function ($u) use ($from, $to) {
            $range = [$from.' 00:00:00', $to.' 23:59:59'];

            return [
                'id' => $u->id, 'name' => $u->name,
                'leads' => Lead::query()->where('owner_id', $u->id)->whereBetween('created_at', $range)->count(),
                'activities' => Activity::query()->where('user_id', $u->id)->whereBetween('occurred_at', $range)->count(),
                'won_count' => Opportunity::query()->where('owner_id', $u->id)->where('status', 'won')->whereBetween('won_at', $range)->count(),
                'won_value' => Money::round(Opportunity::query()->where('owner_id', $u->id)->where('status', 'won')->whereBetween('won_at', $range)->sum('value')),
                'lost_count' => Opportunity::query()->where('owner_id', $u->id)->where('status', 'lost')->whereBetween('lost_at', $range)->count(),
                'open_value' => Money::round(Opportunity::query()->where('owner_id', $u->id)->where('status', 'open')->sum('value')),
                'overdue_tasks' => Task::query()->where('assigned_to', $u->id)->where('status', 'open')->where('due_at', '<', now())->count(),
            ];
        })->filter(fn ($r) => $r['leads'] + $r['activities'] + $r['won_count'] + $r['lost_count'] + $r['open_value'] > 0)->values();

        $leadCount = (clone $leads)->count();
        $converted = (clone $leads)->where('crm_leads.status', 'converted')->count();

        return [
            'from' => $from, 'to' => $to,
            'pipeline' => $byStage,
            'leads' => $leadCount,
            'converted_leads' => $converted,
            'lead_conversion' => $leadCount > 0 ? round($converted / $leadCount * 100, 1) : null,
            'won_count' => $wonCount,
            'won_value' => Money::round((clone $won)->sum('value')),
            'win_rate' => $closedCount > 0 ? round($wonCount / $closedCount * 100, 1) : null,
            'lost_reasons' => $lostReasons,
            'sources' => $sources,
            'reps' => $reps,
        ];
    }

    /**
     * Home dashboard, filtered by what the user may see.
     */
    public function dashboard(User $user): array
    {
        $today = now()->toDateString();
        $monthStart = now()->startOfMonth()->toDateString();
        $lastMonthStart = now()->subMonthNoOverflow()->startOfMonth()->toDateString();
        $lastMonthSameDay = now()->subMonthNoOverflow()->toDateString();
        $out = [];

        $salesNet = function (string $from, string $to) {
            $q = fn ($type) => (float) TradeDocument::query()->where('type', $type)->where('status', 'posted')->whereDate('date', '>=', $from)->whereDate('date', '<=', $to)->sum('net_total');

            return Money::round($q('sales_invoice') - $q('sales_return'));
        };
        $cost = function (string $from, string $to) {
            $q = fn ($type) => (float) TradeDocument::query()->where('type', $type)->where('status', 'posted')->whereDate('date', '>=', $from)->whereDate('date', '<=', $to)->sum('cost_total');

            return Money::round($q('sales_invoice') - $q('sales_return'));
        };

        if ($user->can('sales.reports') || $user->can('sales.invoices') || $user->isAdmin()) {
            $out['sales'] = [
                'today' => $salesNet($today, $today),
                'today_count' => TradeDocument::query()->where('type', 'sales_invoice')->where('status', 'posted')->whereDate('date', $today)->count(),
                'month' => $salesNet($monthStart, $today),
                'last_month_to_date' => $salesNet($lastMonthStart, $lastMonthSameDay),
                'trend' => TradeDocument::query()->whereIn('type', ['sales_invoice', 'sales_return'])->where('status', 'posted')
                    ->whereDate('date', '>=', now()->subDays(29)->toDateString())
                    ->selectRaw("date, SUM(CASE WHEN type = 'sales_return' THEN -net_total ELSE net_total END) amount")
                    ->groupBy('date')->orderBy('date')->get()->map(fn ($r) => ['date' => substr((string) $r->date, 0, 10), 'amount' => Money::round($r->amount)]),
                'monthly' => TradeDocument::query()->whereIn('type', ['sales_invoice', 'sales_return'])->where('status', 'posted')
                    ->whereDate('date', '>=', now()->subMonths(11)->startOfMonth()->toDateString())
                    ->selectRaw("SUBSTR(date, 1, 7) month, SUM(CASE WHEN type = 'sales_return' THEN -net_total ELSE net_total END) amount")
                    ->groupBy('month')->orderBy('month')->get(),
                'top_products' => collect($this->analysis('sales', 'product', $monthStart, $today, [], false)['rows'])->take(5)->values(),
                'top_customers' => collect($this->analysis('sales', 'party', $monthStart, $today, [], false)['rows'])->take(5)->values(),
            ];
            if ($user->can('sales.view_cost') || $user->isAdmin()) {
                $out['sales']['gross_profit_month'] = Money::round($out['sales']['month'] - $cost($monthStart, $today));
            }
        }

        if ($user->can('finance.reports') || $user->can('treasury.view') || $user->isAdmin()) {
            $cash = DB::table('cash_accounts')->where('is_active', true)->get(['id', 'type', 'account_id', 'name', 'name_en']);
            $balances = DB::table('journal_lines')->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
                ->where('journal_entries.status', '!=', 'draft')->whereIn('account_id', $cash->pluck('account_id'))
                ->groupBy('account_id')->selectRaw('account_id, SUM(debit - credit) b')->pluck('b', 'account_id');
            $out['treasury'] = [
                'cash' => Money::round($cash->where('type', 'cash')->sum(fn ($c) => $balances[$c->account_id] ?? 0)),
                'bank' => Money::round($cash->where('type', 'bank')->sum(fn ($c) => $balances[$c->account_id] ?? 0)),
                'accounts' => $cash->map(fn ($c) => ['id' => $c->id, 'type' => $c->type, 'name' => $c->name, 'name_en' => $c->name_en, 'balance' => Money::round($balances[$c->account_id] ?? 0)])->values(),
                'cheques_in_due_7' => Money::round(Cheque::query()->where('direction', 'received')->whereIn('status', ['in_portfolio', 'deposited'])->whereDate('due_date', '<=', now()->addDays(7)->toDateString())->sum('amount')),
                'cheques_out_due_7' => Money::round(Cheque::query()->where('direction', 'issued')->where('status', 'issued')->whereDate('due_date', '<=', now()->addDays(7)->toDateString())->sum('amount')),
                'cheques_in_portfolio' => Money::round(Cheque::query()->where('direction', 'received')->whereIn('status', ['in_portfolio', 'deposited'])->sum('amount')),
            ];
        }

        if ($user->can('customers.view') || $user->can('finance.reports') || $user->isAdmin()) {
            $out['receivables'] = [
                'total' => $this->journal->balance($this->accounts->id('ar')),
                'overdue' => Money::round(TradeDocument::query()->where('type', 'sales_invoice')->where('status', 'posted')->whereColumn('paid_amount', '<', 'balance_due')->whereDate('due_date', '<', $today)->sum(DB::raw('balance_due - paid_amount'))),
            ];
        }
        if ($user->can('suppliers.view') || $user->can('finance.reports') || $user->isAdmin()) {
            $out['payables'] = [
                'total' => -$this->journal->balance($this->accounts->id('ap')),
                'due_7' => Money::round(TradeDocument::query()->where('type', 'purchase_invoice')->where('status', 'posted')->whereColumn('paid_amount', '<', 'balance_due')->whereDate('due_date', '<=', now()->addDays(7)->toDateString())->sum(DB::raw('balance_due - paid_amount'))),
            ];
        }

        if ($user->can('stock.view') || $user->isAdmin()) {
            $out['inventory'] = [
                'low_stock' => DB::table('products')->where('type', 'stock')->where('is_active', true)->whereNull('deleted_at')->where('reorder_level', '>', 0)
                    ->whereRaw('(SELECT COALESCE(SUM(quantity),0) FROM stock_balances sb WHERE sb.product_id = products.id) <= products.reorder_level')->count(),
                'expiring' => DB::table('stock_balances as sb')->join('batches as b', 'b.id', '=', 'sb.batch_id')->where('sb.quantity', '>', 0)
                    ->whereNotNull('b.expiry_date')->whereDate('b.expiry_date', '<=', now()->addDays(60)->toDateString())->count(),
                'transfers_in_transit' => DB::table('stock_documents')->where('type', 'transfer')->where('status', 'in_transit')->count(),
            ];
            if ($user->can('inventory.view_cost') || $user->isAdmin()) {
                $out['inventory']['value'] = Money::round(DB::table('stock_moves')->sum('total_cost'));
            }
        }

        if ($user->can('crm.view') || $user->isAdmin()) {
            $mine = fn ($q) => $user->can('crm.view_all') ? $q : $q->where('owner_id', $user->id);
            $open = $mine(Opportunity::query()->where('status', 'open'))->get(['value', 'probability']);
            $out['crm'] = [
                'open_deals' => $open->count(),
                'pipeline_value' => Money::round($open->sum('value')),
                'weighted_value' => Money::round($open->sum(fn ($o) => (float) $o->value * $o->probability / 100)),
                'new_leads_month' => $mine(Lead::query())->whereDate('created_at', '>=', $monthStart)->count(),
                'tasks_today' => Task::query()->where('assigned_to', $user->id)->where('status', 'open')->whereDate('due_at', $today)->count(),
                'tasks_overdue' => Task::query()->where('assigned_to', $user->id)->where('status', 'open')->where('due_at', '<', now()->startOfDay())->count(),
            ];
        }

        $out['recent'] = TradeDocument::query()->with('party:id,name,name_en')
            ->when(! $user->isAdmin(), fn ($q) => $q->where('created_by', $user->id))
            ->latest('id')->limit(8)->get(['id', 'type', 'number', 'date', 'status', 'party_id', 'total']);

        return $out;
    }
}
