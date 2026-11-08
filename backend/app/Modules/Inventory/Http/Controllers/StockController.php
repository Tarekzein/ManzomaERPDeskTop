<?php

namespace App\Modules\Inventory\Http\Controllers;

use App\Modules\Core\Services\SettingsService;
use App\Modules\Inventory\Models\Batch;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\StockMove;
use App\Support\ApiController;
use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StockController extends ApiController
{
    /**
     * Stock on hand by product and warehouse, with value.
     */
    public function onHand(Request $request)
    {
        $this->allow('stock.view');
        $showCost = $this->can('inventory.view_cost');
        $query = DB::table('stock_balances as sb')
            ->join('products as p', 'p.id', '=', 'sb.product_id')
            ->join('warehouses as w', 'w.id', '=', 'sb.warehouse_id')
            ->leftJoin('units as u', 'u.id', '=', 'p.base_unit_id')
            ->leftJoin('categories as c', 'c.id', '=', 'p.category_id')
            ->leftJoin('batches as b', 'b.id', '=', 'sb.batch_id')
            ->whereNull('p.deleted_at')
            ->where('sb.quantity', '!=', 0);
        if ($request->filled('warehouse_id')) {
            $query->where('sb.warehouse_id', $request->integer('warehouse_id'));
        }
        if ($request->filled('category_id')) {
            $query->where('p.category_id', $request->integer('category_id'));
        }
        if ($request->filled('product_id')) {
            $query->where('sb.product_id', $request->integer('product_id'));
        }
        $term = trim((string) $request->query('search'));
        if ($term !== '') {
            $query->where(fn ($q) => $q->where('p.code', 'like', "%{$term}%")->orWhere('p.name', 'like', "%{$term}%")->orWhere('p.name_en', 'like', "%{$term}%"));
        }
        $byBatch = $request->boolean('by_batch');
        $group = ['p.id', 'p.code', 'p.name', 'p.name_en', 'p.avg_cost', 'p.reorder_level', 'u.name', 'u.name_en', 'c.name', 'c.name_en', 'w.id', 'w.code', 'w.name', 'w.name_en'];
        if ($byBatch) {
            $group = array_merge($group, ['b.id', 'b.batch_no', 'b.expiry_date']);
        }
        $rows = $query->groupBy($group)->orderBy('p.code')->orderBy('w.code')->get(array_merge([
            'p.id as product_id', 'p.code', 'p.name', 'p.name_en', 'p.avg_cost', 'p.reorder_level',
            'u.name as unit', 'u.name_en as unit_en', 'c.name as category', 'c.name_en as category_en',
            'w.id as warehouse_id', 'w.code as warehouse_code', 'w.name as warehouse', 'w.name_en as warehouse_en',
            DB::raw('SUM(sb.quantity) as quantity'),
        ], $byBatch ? ['b.id as batch_id', 'b.batch_no', 'b.expiry_date'] : []));

        $rows = $rows->map(function ($r) use ($showCost) {
            $r->quantity = Money::qty($r->quantity);
            if ($showCost) {
                $r->value = Money::round($r->quantity * (float) $r->avg_cost);
            } else {
                unset($r->avg_cost);
            }

            return $r;
        });

        return response()->json([
            'data' => $rows,
            'totals' => ['quantity' => Money::qty($rows->sum('quantity')), 'value' => $showCost ? Money::round($rows->sum('value')) : null],
        ]);
    }

    /**
     * Item card (كارت صنف): every move of one product with running balance.
     */
    public function itemCard(Request $request, Product $product)
    {
        $this->allow('stock.view');
        $from = $request->query('from', now()->startOfYear()->toDateString());
        $to = $request->query('to', now()->toDateString());
        $warehouseId = $request->integer('warehouse_id') ?: null;
        $showCost = $this->can('inventory.view_cost');

        $base = StockMove::query()->where('product_id', $product->id)
            ->when($warehouseId, fn ($q) => $q->where('warehouse_id', $warehouseId), fn ($q) => $q->whereNotIn('warehouse_id', fn ($w) => $w->from('warehouses')->select('id')->where('is_transit', true)));
        $openingQty = Money::qty((clone $base)->whereDate('date', '<', $from)->sum('quantity'));
        $openingValue = Money::round((clone $base)->whereDate('date', '<', $from)->sum('total_cost'));

        $moves = (clone $base)->with('warehouse:id,code,name,name_en', 'batch:id,batch_no,expiry_date')
            ->whereDate('date', '>=', $from)->whereDate('date', '<=', $to)
            ->orderBy('date')->orderBy('id')->get();
        $parties = DB::table('parties')->whereIn('id', $moves->pluck('party_id')->filter()->unique())->pluck('name', 'id');

        $qty = $openingQty;
        $value = $openingValue;
        $lines = $moves->map(function (StockMove $m) use (&$qty, &$value, $parties, $showCost) {
            $qty = Money::qty($qty + (float) $m->quantity);
            $value = Money::round($value + (float) $m->total_cost);
            $row = [
                'id' => $m->id,
                'date' => $m->date->toDateString(),
                'source_type' => $m->source_type,
                'source_id' => $m->source_id,
                'reference' => $m->reference,
                'party' => $m->party_id ? ($parties[$m->party_id] ?? null) : null,
                'warehouse' => $m->warehouse,
                'batch' => $m->batch,
                'in' => (float) $m->quantity > 0 ? (float) $m->quantity : 0,
                'out' => (float) $m->quantity < 0 ? abs((float) $m->quantity) : 0,
                'balance' => $qty,
            ];
            if ($showCost) {
                $row['unit_cost'] = (float) $m->unit_cost;
                $row['value'] = $value;
            }

            return $row;
        });

        return response()->json([
            'product' => $product->load('baseUnit:id,name,name_en')->only(['id', 'code', 'name', 'name_en', 'base_unit']),
            'from' => $from,
            'to' => $to,
            'opening_quantity' => $openingQty,
            'opening_value' => $showCost ? $openingValue : null,
            'lines' => $lines,
            'total_in' => Money::qty($lines->sum('in')),
            'total_out' => Money::qty($lines->sum('out')),
            'closing_quantity' => $qty,
            'closing_value' => $showCost ? $value : null,
        ]);
    }

    /**
     * Batches expiring within N days (or already expired) that still have stock.
     */
    public function expiring(Request $request, SettingsService $settings)
    {
        $this->allow('stock.view');
        $days = $request->integer('days', (int) $settings->get('inventory.expiry_alert_days', 60));
        $rows = DB::table('stock_balances as sb')
            ->join('batches as b', 'b.id', '=', 'sb.batch_id')
            ->join('products as p', 'p.id', '=', 'sb.product_id')
            ->join('warehouses as w', 'w.id', '=', 'sb.warehouse_id')
            ->where('sb.quantity', '>', 0)
            ->whereNotNull('b.expiry_date')
            ->whereDate('b.expiry_date', '<=', now()->addDays($days)->toDateString())
            ->orderBy('b.expiry_date')
            ->get(['p.id as product_id', 'p.code', 'p.name', 'p.name_en', 'b.id as batch_id', 'b.batch_no', 'b.expiry_date', 'w.name as warehouse', 'w.name_en as warehouse_en', 'sb.quantity']);

        return response()->json(['data' => $rows->map(function ($r) {
            $r->days_left = (int) floor((strtotime($r->expiry_date) - strtotime(now()->toDateString())) / 86400);

            return $r;
        })]);
    }

    /**
     * Products at or below their reorder level, with a suggested order quantity.
     */
    public function reorder(Request $request)
    {
        $this->allow('stock.view');
        $rows = DB::table('products as p')
            ->leftJoin('units as u', 'u.id', '=', 'p.base_unit_id')
            ->where('p.type', 'stock')->where('p.is_active', true)->whereNull('p.deleted_at')->where('p.reorder_level', '>', 0)
            ->selectRaw('p.id, p.code, p.name, p.name_en, p.reorder_level, p.reorder_qty, p.purchase_price, u.name as unit, u.name_en as unit_en,
                (SELECT COALESCE(SUM(quantity),0) FROM stock_balances sb WHERE sb.product_id = p.id) as on_hand,
                (SELECT COALESCE(SUM(l.base_quantity - l.processed_quantity * l.factor),0) FROM trade_document_lines l JOIN trade_documents d ON d.id = l.trade_document_id
                    WHERE l.product_id = p.id AND d.type = \'purchase_order\' AND d.status IN (\'confirmed\', \'partially_received\')) as on_order')
            ->get()
            ->filter(fn ($r) => (float) $r->on_hand <= (float) $r->reorder_level)
            ->map(function ($r) {
                $target = (float) $r->reorder_qty > 0 ? (float) $r->reorder_qty : (float) $r->reorder_level * 2;
                $r->suggested = Money::qty(max(0, $target - (float) $r->on_hand - (float) $r->on_order));

                return $r;
            })->values();

        return response()->json(['data' => $rows]);
    }

    /**
     * Products without sales in the last N days that still hold stock.
     */
    public function slowMoving(Request $request)
    {
        $this->allow('stock.view');
        $days = $request->integer('days', 90);
        $since = now()->subDays($days)->toDateString();
        $rows = DB::table('products as p')
            ->where('p.type', 'stock')->whereNull('p.deleted_at')
            ->selectRaw('p.id, p.code, p.name, p.name_en, p.avg_cost,
                (SELECT COALESCE(SUM(quantity),0) FROM stock_balances sb WHERE sb.product_id = p.id) as on_hand,
                (SELECT MAX(m.date) FROM stock_moves m WHERE m.product_id = p.id AND m.source_type = \'sales_invoice\') as last_sale')
            ->get()
            ->filter(fn ($r) => (float) $r->on_hand > 0 && (! $r->last_sale || $r->last_sale < $since))
            ->map(function ($r) {
                $r->value = $this->can('inventory.view_cost') ? Money::round((float) $r->on_hand * (float) $r->avg_cost) : null;
                if (! $this->can('inventory.view_cost')) {
                    unset($r->avg_cost);
                }

                return $r;
            })->sortByDesc('value')->values();

        return response()->json(['data' => $rows]);
    }

    public function batches(Product $product)
    {
        $this->allow('stock.view', 'sales.invoices', 'purchases.invoices');
        $rows = Batch::query()->where('product_id', $product->id)->orderByRaw('CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END')->orderBy('expiry_date')->get();
        $balances = DB::table('stock_balances')->where('product_id', $product->id)->groupBy('batch_id')->selectRaw('batch_id, SUM(quantity) q')->pluck('q', 'batch_id');

        return response()->json(['data' => $rows->map(fn ($b) => $b->toArray() + ['on_hand' => Money::qty($balances[$b->id] ?? 0)])]);
    }

    /**
     * Inventory sub-ledger vs. the inventory account in the general ledger.
     */
    public function reconcile(\App\Modules\Inventory\Services\StockService $stock, \App\Modules\Finance\Services\JournalService $journal, \App\Modules\Finance\Services\AccountResolver $accounts)
    {
        $this->allow('inventory.view_cost');
        $date = request('date', now()->toDateString());
        $stockValue = $stock->valueAsOf($date);
        $glValue = $journal->balance($accounts->id('inventory'), $date);

        return response()->json(['date' => $date, 'stock_value' => $stockValue, 'gl_value' => $glValue, 'difference' => Money::round($glValue - $stockValue)]);
    }
}
