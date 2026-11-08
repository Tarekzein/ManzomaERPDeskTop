<?php

namespace App\Modules\Trading\Http\Controllers;

use App\Modules\Trading\Models\TradeDocument;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use App\Support\ApiController;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/**
 * One controller for every sales and purchase document type; the URL picks
 * the type: /api/documents/sales_invoice, /api/documents/purchase_order …
 */
class TradeDocumentController extends ApiController
{
    /** [view/edit permission, post permission, void permission] */
    private const PERMISSIONS = [
        'sales_quotation' => ['sales.quotations', 'sales.quotations', null],
        'sales_order' => ['sales.orders', 'sales.orders', null],
        'sales_invoice' => ['sales.invoices', 'sales.invoices.post', 'sales.invoices.void'],
        'sales_return' => ['sales.returns', 'sales.returns', 'sales.invoices.void'],
        'purchase_order' => ['purchases.orders', 'purchases.orders', null],
        'purchase_receipt' => ['purchases.receipts', 'purchases.receipts', 'purchases.invoices.void'],
        'purchase_invoice' => ['purchases.invoices', 'purchases.invoices.post', 'purchases.invoices.void'],
        'purchase_return' => ['purchases.returns', 'purchases.returns', 'purchases.invoices.void'],
    ];

    public function __construct(
        private readonly TradingService $trading,
        private readonly TradingPoster $poster,
    ) {}

    public function index(Request $request, string $type)
    {
        $this->allowType($type, 0, true);
        $query = TradeDocument::query()
            ->with('party:id,code,name,name_en', 'warehouse:id,code,name,name_en', 'salesperson:id,name', 'creator:id,name')
            ->where('type', $type);
        if ($request->filled('status')) {
            $statuses = explode(',', (string) $request->query('status'));
            $query->whereIn('status', $statuses);
        }
        if ($request->filled('party_id')) {
            $query->where('party_id', $request->integer('party_id'));
        }
        if ($request->filled('warehouse_id')) {
            $query->where('warehouse_id', $request->integer('warehouse_id'));
        }
        if ($request->filled('salesperson_id')) {
            $query->where('salesperson_id', $request->integer('salesperson_id'));
        }
        if ($request->filled('branch_id')) {
            $query->where('branch_id', $request->integer('branch_id'));
        }
        if ($request->filled('payment_status')) {
            match ($request->query('payment_status')) {
                'paid' => $query->where('status', 'posted')->whereColumn('paid_amount', '>=', 'balance_due'),
                'unpaid' => $query->where('status', 'posted')->where('paid_amount', 0)->where('balance_due', '>', 0),
                'partial' => $query->where('status', 'posted')->where('paid_amount', '>', 0)->whereColumn('paid_amount', '<', 'balance_due'),
                'open' => $query->where('status', 'posted')->whereColumn('paid_amount', '<', 'balance_due'),
                'overdue' => $query->where('status', 'posted')->whereColumn('paid_amount', '<', 'balance_due')->whereDate('due_date', '<', now()->toDateString()),
                default => null,
            };
        }
        if (! $this->can('crm.view_all') && $type === 'sales_quotation' && ! $this->user()->isAdmin() && $request->boolean('mine')) {
            $query->where('salesperson_id', $this->user()->id);
        }
        $this->dateRange($query, $request);
        $term = trim((string) $request->query('search'));
        if ($term !== '') {
            $query->where(function ($q) use ($term) {
                $q->where('number', 'like', "%{$term}%")->orWhere('reference', 'like', "%{$term}%")
                    ->orWhereHas('party', fn ($p) => $p->where('name', 'like', "%{$term}%")->orWhere('code', 'like', "%{$term}%"));
                $this->searchCustom($q, $term);
            });
        }

        $totals = (clone $query)->whereNotIn('status', ['void', 'cancelled'])->toBase()->reorder()
            ->selectRaw('COUNT(*) as count, COALESCE(SUM(total),0) as total, COALESCE(SUM(net_total),0) as net_total, COALESCE(SUM(tax_total),0) as tax_total, COALESCE(SUM(balance_due - paid_amount),0) as outstanding')
            ->first();

        $result = $this->paginate($query, $request, ['id', 'number', 'date', 'due_date', 'total', 'status'], '-id');
        if (! $this->canSeeCost($type)) {
            $this->hide($result);
        }

        return response()->json((is_array($result) ? $result : $result->toArray()) + ['totals' => $totals]);
    }

    public function show(string $type, TradeDocument $document)
    {
        $this->assertType($type, $document);
        $this->allowType($type, 0, true);
        $document->load($this->trading->relations());
        if (! $this->canSeeCost($type)) {
            $document->makeHidden('cost_total');
            $document->lines->each->makeHidden(['unit_cost', 'cost_amount']);
        }

        if ($this->can('service.view')) {
            $visit = \App\Modules\Service\Models\ServiceVisit::query()->where('invoice_id', $document->id)
                ->when(! $this->can('service.view_all'), fn ($q) => $q->where('technician_id', $this->user()->id))->value('id');
            if ($visit) {
                $document->setAttribute('service_visit_id', $visit);
            }
        }

        return response()->json(['data' => $document]);
    }

    public function store(Request $request, string $type)
    {
        $this->allowType($type);
        $data = $this->validated($request);
        if ($request->boolean('post')) {
            $this->allowType($type, 1);
            $options = $this->postOptions($request);
            // Save and post together: a refused post leaves nothing behind.
            $doc = DB::transaction(fn () => $this->poster->post($this->trading->save($type, $data), $options));
        } else {
            $doc = $this->trading->save($type, $data);
        }

        return response()->json(['data' => $doc], 201);
    }

    public function update(Request $request, string $type, TradeDocument $document)
    {
        $this->assertType($type, $document);
        $this->allowType($type);
        $data = $this->validated($request);
        if ($request->boolean('post')) {
            $this->allowType($type, 1);
            $options = $this->postOptions($request);
            $doc = DB::transaction(fn () => $this->poster->post($this->trading->save($type, $data, $document), $options));
        } else {
            $doc = $this->trading->save($type, $data, $document);
        }

        return response()->json(['data' => $doc]);
    }

    public function destroy(string $type, TradeDocument $document)
    {
        $this->assertType($type, $document);
        $this->allowType($type);
        $this->trading->delete($document);

        return response()->json(['ok' => true]);
    }

    public function post(Request $request, string $type, TradeDocument $document)
    {
        $this->assertType($type, $document);
        $this->allowType($type, 1);

        return response()->json(['data' => $this->poster->post($document, $this->postOptions($request))]);
    }

    public function void(Request $request, string $type, TradeDocument $document)
    {
        $this->assertType($type, $document);
        $this->allowType($type, 2);
        $data = $request->validate(['reason' => 'required|string|max:250']);

        return response()->json(['data' => $this->poster->void($document, $data['reason'])]);
    }

    public function convert(Request $request, string $type, TradeDocument $document)
    {
        $this->assertType($type, $document);
        $data = $request->validate(['target' => 'required|string']);
        $this->allowType($data['target']);

        return response()->json(['data' => $this->trading->convert($document, $data['target'], $request->except('target'))], 201);
    }

    public function transition(string $type, TradeDocument $document, string $action)
    {
        $this->assertType($type, $document);
        $this->allowType($type);

        return response()->json(['data' => $this->trading->transition($document, $action)]);
    }

    private function postOptions(Request $request): array
    {
        $request->validate([
            'payment' => ['nullable', 'array'],
            'payment.amount' => ['nullable', 'numeric', 'min:0'],
            'payment.cash_account_id' => ['nullable', 'exists:cash_accounts,id'],
            'payment.method' => ['nullable', 'in:cash,cheque,bank_transfer,card,wallet'],
            'payment.cheque' => ['nullable', 'array'],
            'refund' => ['nullable', 'array'],
            'refund.amount' => ['nullable', 'numeric', 'min:0'],
            'refund.cash_account_id' => ['nullable', 'exists:cash_accounts,id'],
            'override_credit' => ['nullable', 'boolean'],
        ]);
        if ($request->filled('payment.amount') && (float) $request->input('payment.amount') > 0) {
            $this->allow('vouchers.manage', 'sales.invoices.post', 'purchases.invoices.post');
        }

        return $request->only(['payment', 'refund', 'override_credit']);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'party_id' => ['required', 'exists:parties,id'],
            'date' => ['required', 'date'],
            'due_date' => ['nullable', 'date'],
            'valid_until' => ['nullable', 'date'],
            'branch_id' => ['nullable', 'exists:branches,id'],
            'warehouse_id' => ['nullable', 'exists:warehouses,id'],
            'salesperson_id' => ['nullable', 'exists:users,id'],
            'price_list_id' => ['nullable', 'exists:price_lists,id'],
            'source_id' => ['nullable', 'exists:trade_documents,id'],
            'opportunity_id' => ['nullable', 'integer'],
            'reference' => ['nullable', 'string', 'max:80'],
            'currency' => ['nullable', 'string', 'size:3'],
            'exchange_rate' => ['nullable', 'numeric', 'gt:0'],
            'price_includes_tax' => ['nullable', 'boolean'],
            'invoice_discount_percent' => ['nullable', 'numeric', 'between:0,100'],
            'invoice_discount_amount' => ['nullable', 'numeric', 'min:0'],
            'wht_rate' => ['nullable', 'numeric', 'between:0,20'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'terms' => ['nullable', 'string', 'max:4000'],
            'lines' => ['required', 'array', 'min:1'],
            'lines.*.id' => ['nullable', 'integer'],
            'lines.*.serial_numbers' => ['nullable', 'array'],
            'lines.*.serial_numbers.*' => ['string', 'max:100', 'distinct'],
            'lines.*.product_id' => ['required', 'exists:products,id'],
            'lines.*.product_unit_id' => ['nullable', 'exists:product_units,id'],
            'lines.*.description' => ['nullable', 'string', 'max:250'],
            'lines.*.quantity' => ['required', 'numeric', 'gt:0'],
            'lines.*.unit_price' => ['nullable', 'numeric', 'min:0'],
            'lines.*.discount_percent' => ['nullable', 'numeric', 'between:0,100'],
            'lines.*.discount_amount' => ['nullable', 'numeric', 'min:0'],
            'lines.*.tax_rate_id' => ['nullable', 'exists:tax_rates,id'],
            'lines.*.batch_id' => ['nullable', 'integer'],
            'lines.*.batch_no' => ['nullable', 'string', 'max:60'],
            'lines.*.expiry_date' => ['nullable', 'date'],
            'lines.*.source_line_id' => ['nullable', 'integer'],
        ]);
    }

    private function allowType(string $type, int $level = 0, bool $view = false): void
    {
        abort_unless(isset(self::PERMISSIONS[$type]), 404);
        $permission = self::PERMISSIONS[$type][$level] ?? null;
        abort_unless($permission, 403, __('erp.forbidden'));
        if ($view) {
            $reports = str_starts_with($type, 'sales_') ? 'sales.reports' : 'purchases.reports';
            $this->allow($permission, $reports);

            return;
        }
        $this->allow($permission);
    }

    private function assertType(string $type, TradeDocument $document): void
    {
        abort_unless($document->type === $type, 404);
    }

    private function canSeeCost(string $type): bool
    {
        return str_starts_with($type, 'purchase_') || $this->can('sales.view_cost') || $this->can('inventory.view_cost');
    }

    private function hide(mixed $result): void
    {
        $items = $result instanceof LengthAwarePaginator ? $result->getCollection() : collect($result['data'] ?? []);
        $items->each(fn ($d) => $d->makeHidden('cost_total'));
    }
}
