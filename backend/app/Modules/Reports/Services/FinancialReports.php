<?php

namespace App\Modules\Reports\Services;

use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Services\AccountResolver;
use App\Modules\Finance\Services\JournalService;
use App\Modules\Trading\Models\TradeDocument;
use App\Support\Money;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class FinancialReports
{
    public function __construct(
        private readonly AccountResolver $accounts,
        private readonly JournalService $journal,
    ) {}

    /**
     * Trial balance: opening, period movement and closing per account,
     * with group accounts rolled up.
     */
    public function trialBalance(string $from, string $to, bool $hideZero = true, ?int $level = null): array
    {
        $opening = $this->sums(null, date('Y-m-d', strtotime($from.' -1 day')));
        $period = $this->sums($from, $to);
        $accounts = Account::query()->orderBy('code')->get();
        $children = $accounts->groupBy(fn ($a) => (string) $a->parent_id);
        $rows = [];

        $walk = function (Account $a, int $depth) use (&$walk, &$rows, $children, $opening, $period) {
            $own = [
                'od' => (float) ($opening[$a->id]->d ?? 0), 'oc' => (float) ($opening[$a->id]->c ?? 0),
                'pd' => (float) ($period[$a->id]->d ?? 0), 'pc' => (float) ($period[$a->id]->c ?? 0),
            ];
            $index = count($rows);
            $rows[] = null;
            foreach ($children[(string) $a->id] ?? [] as $child) {
                $sub = $walk($child, $depth + 1);
                foreach ($own as $k => $v) {
                    $own[$k] = $v + $sub[$k];
                }
            }
            $openingBalance = $own['od'] - $own['oc'];
            $closing = $openingBalance + $own['pd'] - $own['pc'];
            $rows[$index] = [
                'id' => $a->id, 'code' => $a->code, 'name' => $a->name, 'name_en' => $a->name_en, 'type' => $a->type,
                'is_group' => $a->is_group, 'level' => $depth, 'parent_id' => $a->parent_id,
                'opening_debit' => Money::round(max($openingBalance, 0)), 'opening_credit' => Money::round(max(-$openingBalance, 0)),
                'period_debit' => Money::round($own['pd']), 'period_credit' => Money::round($own['pc']),
                'closing_debit' => Money::round(max($closing, 0)), 'closing_credit' => Money::round(max(-$closing, 0)),
            ];

            return $own;
        };
        foreach ($children[''] ?? [] as $root) {
            $walk($root, 1);
        }

        $rows = collect($rows)->filter();
        if ($hideZero) {
            $rows = $rows->filter(fn ($r) => $r['opening_debit'] + $r['opening_credit'] + $r['period_debit'] + $r['period_credit'] + $r['closing_debit'] + $r['closing_credit'] > 0);
        }
        if ($level) {
            $rows = $rows->filter(fn ($r) => $r['level'] <= $level);
        }
        $leaf = $rows->where('is_group', false);
        $sum = fn ($k) => Money::round($leaf->sum($k));

        return [
            'from' => $from, 'to' => $to,
            'rows' => $rows->values(),
            'totals' => [
                'opening_debit' => $sum('opening_debit'), 'opening_credit' => $sum('opening_credit'),
                'period_debit' => $sum('period_debit'), 'period_credit' => $sum('period_credit'),
                'closing_debit' => $sum('closing_debit'), 'closing_credit' => $sum('closing_credit'),
            ],
        ];
    }

    /**
     * Income statement in the Egyptian layout: net sales, cost of sales,
     * gross profit, operating expenses, other income, net profit.
     */
    public function incomeStatement(string $from, string $to): array
    {
        $period = $this->sums($from, $to);
        $accounts = Account::query()->whereIn('type', ['revenue', 'expense'])->where('is_group', false)->orderBy('code')->get();
        $salesGroup = $this->accounts->key('sales')->parent_id;
        $cogsGroup = $this->accounts->key('cogs')->parent_id;
        $groups = Account::query()->where('is_group', true)->get()->keyBy('id');

        $line = function (Account $a) use ($period) {
            $d = (float) ($period[$a->id]->d ?? 0);
            $c = (float) ($period[$a->id]->c ?? 0);
            $amount = $a->type === 'revenue' ? $c - $d : $d - $c;

            return ['id' => $a->id, 'code' => $a->code, 'name' => $a->name, 'name_en' => $a->name_en, 'amount' => Money::round($amount), 'parent_id' => $a->parent_id];
        };
        $lines = $accounts->map($line)->filter(fn ($l) => ! Money::isZero($l['amount']));

        $section = fn (Collection $items) => ['lines' => $items->values(), 'total' => Money::round($items->sum('amount'))];
        $revenueLines = $lines->filter(fn ($l) => $accounts->firstWhere('id', $l['id'])->type === 'revenue');
        $expenseLines = $lines->filter(fn ($l) => $accounts->firstWhere('id', $l['id'])->type === 'expense');

        $sales = $section($revenueLines->where('parent_id', $salesGroup));
        $cost = $section($expenseLines->where('parent_id', $cogsGroup));
        $otherIncome = $section($revenueLines->where('parent_id', '!=', $salesGroup));
        $operating = $expenseLines->where('parent_id', '!=', $cogsGroup)->groupBy('parent_id')->map(fn ($items, $parent) => [
            'group' => $groups[$parent]?->only(['id', 'code', 'name', 'name_en']),
            'lines' => $items->values(),
            'total' => Money::round($items->sum('amount')),
        ])->values();
        $operatingTotal = Money::round($operating->sum('total'));
        $gross = Money::round($sales['total'] - $cost['total']);
        $net = Money::round($gross - $operatingTotal + $otherIncome['total']);

        return [
            'from' => $from, 'to' => $to,
            'net_sales' => $sales,
            'cost_of_sales' => $cost,
            'gross_profit' => $gross,
            'gross_margin' => $sales['total'] > 0 ? round($gross / $sales['total'] * 100, 1) : null,
            'operating_expenses' => ['groups' => $operating, 'total' => $operatingTotal],
            'other_income' => $otherIncome,
            'net_profit' => $net,
            'net_margin' => $sales['total'] > 0 ? round($net / $sales['total'] * 100, 1) : null,
        ];
    }

    /**
     * Balance sheet as of a date. Unclosed profit is shown in equity.
     */
    public function balanceSheet(string $asOf): array
    {
        $tb = $this->trialBalance('1900-01-01', $asOf, true);
        $rows = collect($tb['rows']);
        $balance = fn ($r) => $r['closing_debit'] - $r['closing_credit'];

        $build = function (string $type, int $sign) use ($rows, $balance) {
            $items = $rows->where('type', $type)->map(fn ($r) => $r + ['amount' => Money::round($balance($r) * $sign)])->values();

            return ['rows' => $items, 'total' => Money::round($items->where('is_group', false)->sum('amount'))];
        };
        $assets = $build('asset', 1);
        $liabilities = $build('liability', -1);
        $equity = $build('equity', -1);
        $profit = Money::round($rows->where('is_group', false)->whereIn('type', ['revenue', 'expense'])->sum(fn ($r) => -$balance($r)));

        return [
            'as_of' => $asOf,
            'assets' => $assets,
            'liabilities' => $liabilities,
            'equity' => $equity,
            'unclosed_profit' => $profit,
            'total_liabilities_equity' => Money::round($liabilities['total'] + $equity['total'] + $profit),
            'balanced' => Money::equals($assets['total'], $liabilities['total'] + $equity['total'] + $profit),
        ];
    }

    /**
     * Cash movement (direct method) for cash boxes and banks.
     */
    public function cashFlow(string $from, string $to): array
    {
        $cashIds = DB::table('cash_accounts')->pluck('account_id')->all();
        $opening = $this->journal->balance($cashIds ?: [0], date('Y-m-d', strtotime($from.' -1 day')));
        $keys = Account::query()->whereNotNull('system_key')->pluck('system_key', 'id');
        $types = Account::query()->pluck('type', 'id');

        $entries = DB::table('journal_lines as jl')->join('journal_entries as je', 'je.id', '=', 'jl.journal_entry_id')
            ->where('je.status', '!=', 'draft')->whereDate('je.date', '>=', $from)->whereDate('je.date', '<=', $to)
            ->whereIn('jl.journal_entry_id', fn ($q) => $q->from('journal_lines')->select('journal_entry_id')->whereIn('account_id', $cashIds ?: [0]))
            ->get(['jl.journal_entry_id', 'jl.account_id', 'jl.debit', 'jl.credit'])->groupBy('journal_entry_id');

        $categories = [];
        foreach ($entries as $lines) {
            $cash = $lines->whereIn('account_id', $cashIds);
            $others = $lines->whereNotIn('account_id', $cashIds);
            $net = $cash->sum(fn ($l) => (float) $l->debit - (float) $l->credit);
            if ($others->isEmpty() || Money::isZero($net)) {
                continue; // transfers between our own boxes and banks
            }
            $main = $others->sortByDesc(fn ($l) => (float) $l->debit + (float) $l->credit)->first();
            $key = $keys[$main->account_id] ?? null;
            $category = match (true) {
                $key === 'ar' || $key === 'notes_receivable' => 'customers',
                $key === 'ap' || $key === 'notes_payable' => 'suppliers',
                in_array($key, ['vat_input', 'vat_output', 'wht_payable', 'wht_receivable'], true) => 'taxes',
                ($types[$main->account_id] ?? null) === 'expense' => 'expenses',
                ($types[$main->account_id] ?? null) === 'equity' => 'owners',
                ($types[$main->account_id] ?? null) === 'revenue' => 'other_income',
                ($types[$main->account_id] ?? null) === 'liability' => 'financing',
                default => 'other',
            };
            $categories[$category]['in'] = ($categories[$category]['in'] ?? 0) + max($net, 0);
            $categories[$category]['out'] = ($categories[$category]['out'] ?? 0) + max(-$net, 0);
        }
        $rows = collect($categories)->map(fn ($v, $k) => ['category' => $k, 'in' => Money::round($v['in'] ?? 0), 'out' => Money::round($v['out'] ?? 0), 'net' => Money::round(($v['in'] ?? 0) - ($v['out'] ?? 0))])->values();
        $net = Money::round($rows->sum('net'));

        return ['from' => $from, 'to' => $to, 'opening' => $opening, 'rows' => $rows, 'total_in' => Money::round($rows->sum('in')), 'total_out' => Money::round($rows->sum('out')), 'net' => $net, 'closing' => Money::round($opening + $net)];
    }

    /**
     * VAT return: output tax on sales less input tax on purchases and expenses.
     */
    public function vat(string $from, string $to): array
    {
        $docs = TradeDocument::query()->with('party:id,name,tax_number')
            ->whereIn('type', ['sales_invoice', 'sales_return', 'purchase_invoice', 'purchase_return'])
            ->where('status', 'posted')->whereDate('date', '>=', $from)->whereDate('date', '<=', $to)
            ->orderBy('date')->get(['id', 'type', 'number', 'date', 'party_id', 'net_total', 'tax_total', 'total']);
        $sum = fn ($type, $field) => Money::round($docs->where('type', $type)->sum($field));
        $expenseTax = Money::round(DB::table('vouchers')->where('type', 'payment')->where('status', 'posted')->whereNull('party_id')
            ->whereDate('date', '>=', $from)->whereDate('date', '<=', $to)->sum('tax_amount'));
        $expenseBase = Money::round(DB::table('vouchers')->where('type', 'payment')->where('status', 'posted')->whereNull('party_id')->where('tax_amount', '>', 0)
            ->whereDate('date', '>=', $from)->whereDate('date', '<=', $to)->sum(DB::raw('amount - tax_amount')));

        $output = Money::round($sum('sales_invoice', 'tax_total') - $sum('sales_return', 'tax_total'));
        $input = Money::round($sum('purchase_invoice', 'tax_total') - $sum('purchase_return', 'tax_total') + $expenseTax);

        return [
            'from' => $from, 'to' => $to,
            'sales' => ['base' => $sum('sales_invoice', 'net_total'), 'tax' => $sum('sales_invoice', 'tax_total')],
            'sales_returns' => ['base' => $sum('sales_return', 'net_total'), 'tax' => $sum('sales_return', 'tax_total')],
            'purchases' => ['base' => $sum('purchase_invoice', 'net_total'), 'tax' => $sum('purchase_invoice', 'tax_total')],
            'purchase_returns' => ['base' => $sum('purchase_return', 'net_total'), 'tax' => $sum('purchase_return', 'tax_total')],
            'expenses' => ['base' => $expenseBase, 'tax' => $expenseTax],
            'output_tax' => $output,
            'input_tax' => $input,
            'net_payable' => Money::round($output - $input),
            'documents' => $docs,
        ];
    }

    /**
     * Receivable or payable aging by party, from open invoices.
     */
    public function aging(string $kind, string $asOf): array
    {
        $type = $kind === 'payable' ? 'purchase_invoice' : 'sales_invoice';
        $invoices = TradeDocument::query()->where('type', $type)->where('status', 'posted')->whereDate('date', '<=', $asOf)
            ->whereColumn('paid_amount', '<', 'balance_due')->get(['id', 'party_id', 'number', 'date', 'due_date', 'balance_due', 'paid_amount']);
        $parties = DB::table('parties')->whereIn('id', $invoices->pluck('party_id')->unique())->get(['id', 'code', 'name', 'name_en', 'phone', 'mobile', 'credit_limit'])->keyBy('id');
        $control = [$this->accounts->id($kind === 'payable' ? 'ap' : 'ar')];
        $sign = $kind === 'payable' ? -1 : 1;

        $rows = $invoices->groupBy('party_id')->map(function ($items, $partyId) use ($parties, $asOf, $control, $sign) {
            $buckets = ['current' => 0, 'd1_30' => 0, 'd31_60' => 0, 'd61_90' => 0, 'd90_plus' => 0];
            foreach ($items as $inv) {
                $open = (float) $inv->balance_due - (float) $inv->paid_amount;
                $days = (int) floor((strtotime($asOf) - strtotime($inv->due_date?->toDateString() ?? $inv->date->toDateString())) / 86400);
                $bucket = match (true) {
                    $days <= 0 => 'current', $days <= 30 => 'd1_30', $days <= 60 => 'd31_60', $days <= 90 => 'd61_90', default => 'd90_plus',
                };
                $buckets[$bucket] += $open;
            }
            $outstanding = array_sum($buckets);
            $balance = $sign * $this->journal->balance($control, $asOf, (int) $partyId);

            return ['party' => $parties[$partyId] ?? null] + array_map(fn ($v) => Money::round($v), $buckets) + [
                'outstanding' => Money::round($outstanding),
                'balance' => Money::round($balance),
                // Opening balances, unallocated receipts, bounced cheques…
                'unallocated' => Money::round($balance - $outstanding),
                'invoices' => $items->count(),
            ];
        })->sortByDesc('outstanding')->values();

        $totals = [];
        foreach (['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus', 'outstanding'] as $k) {
            $totals[$k] = Money::round($rows->sum($k));
        }

        return ['kind' => $kind, 'as_of' => $asOf, 'rows' => $rows, 'totals' => $totals];
    }

    /**
     * @return Collection<int, object{d: float, c: float}>
     */
    private function sums(?string $from, string $to): Collection
    {
        return DB::table('journal_lines')->join('journal_entries', 'journal_entries.id', '=', 'journal_lines.journal_entry_id')
            ->where('journal_entries.status', '!=', 'draft')
            ->when($from, fn ($q) => $q->whereDate('journal_entries.date', '>=', $from))
            ->whereDate('journal_entries.date', '<=', $to)
            ->groupBy('journal_lines.account_id')
            ->selectRaw('journal_lines.account_id, SUM(journal_lines.debit) d, SUM(journal_lines.credit) c')
            ->get()->keyBy('account_id');
    }
}
