<?php

namespace App\Modules\Reports\Http\Controllers;

use App\Modules\Reports\Services\BusinessReports;
use App\Modules\Reports\Services\FinancialReports;
use App\Support\ApiController;
use Illuminate\Http\Request;

class ReportController extends ApiController
{
    public function __construct(
        private readonly FinancialReports $finance,
        private readonly BusinessReports $business,
    ) {}

    public function dashboard()
    {
        return response()->json($this->business->dashboard($this->user()));
    }

    public function finance(Request $request, string $report)
    {
        $this->allow('finance.reports');
        [$from, $to] = $this->range($request);

        return response()->json(match ($report) {
            'trial-balance' => $this->finance->trialBalance($from, $to, ! $request->boolean('show_zero'), $request->integer('level') ?: null),
            'income-statement' => $this->finance->incomeStatement($from, $to),
            'balance-sheet' => $this->finance->balanceSheet($request->query('as_of', $to)),
            'cash-flow' => $this->finance->cashFlow($from, $to),
            'vat' => $this->finance->vat($from, $to),
            default => abort(404),
        });
    }

    public function aging(Request $request, string $kind)
    {
        abort_unless(in_array($kind, ['receivable', 'payable'], true), 404);
        $this->allow('finance.reports', $kind === 'receivable' ? 'customers.view' : 'suppliers.view');

        return response()->json($this->finance->aging($kind, $request->query('as_of', now()->toDateString())));
    }

    public function analysis(Request $request, string $side)
    {
        abort_unless(in_array($side, ['sales', 'purchases'], true), 404);
        $this->allow($side === 'sales' ? 'sales.reports' : 'purchases.reports');
        [$from, $to] = $this->range($request);
        $dimension = $request->query('by', 'month');
        abort_unless(in_array($dimension, BusinessReports::DIMENSIONS, true), 422);
        $withCost = $this->can('sales.view_cost') || $this->can('inventory.view_cost');

        return response()->json($this->business->analysis($side, $dimension, $from, $to, $request->only(['party_id', 'product_id', 'category_id', 'salesperson_id', 'warehouse_id', 'branch_id']), $withCost));
    }

    public function salespeople(Request $request)
    {
        $this->allow('sales.reports');
        [$from, $to] = $this->range($request);

        return response()->json($this->business->salespeople($from, $to));
    }

    public function crm(Request $request)
    {
        $this->allow('crm.view');
        [$from, $to] = $this->range($request);
        $owner = $this->can('crm.view_all') ? ($request->integer('owner_id') ?: null) : $this->user()->id;

        return response()->json($this->business->crm($from, $to, $owner));
    }

    private function range(Request $request): array
    {
        return [
            $request->query('from', now()->startOfMonth()->toDateString()),
            $request->query('to', now()->toDateString()),
        ];
    }
}
