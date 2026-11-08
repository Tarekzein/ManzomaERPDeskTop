<?php

namespace App\Modules\Inventory\Http\Controllers;

use App\Modules\Core\Services\NumberingService;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\ProductSerial;
use App\Modules\Inventory\Models\ProductUnit;
use App\Modules\Inventory\Models\StockBalance;
use App\Modules\Inventory\Models\StockMove;
use App\Modules\Inventory\Models\Warehouse;
use App\Modules\Inventory\Services\SparePartsService;
use App\Modules\Inventory\Services\StockDocumentService;
use App\Modules\Trading\Models\TradeDocumentLine;
use App\Modules\Trading\Services\TradingService;
use App\Support\ApiController;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ProductController extends ApiController
{
    public function index(Request $request)
    {
        $this->allow('products.manage', 'products.view', 'sales.invoices', 'purchases.invoices', 'stock.view');
        $warehouseId = $request->integer('warehouse_id') ?: null;
        $restricted = $this->restrictedWarehouses();
        if ($warehouseId && $restricted !== null) {
            abort_unless(in_array($warehouseId, $restricted, true), 403);
        }

        $query = Product::query()
            ->with('category:id,name,name_en', 'brand:id,name', 'baseUnit:id,name,name_en', 'taxRate:id,name,rate', 'units.unit:id,name,name_en')
            ->select('products.*')
            ->selectSub(function ($q) use ($warehouseId, $restricted) {
                $q->from('stock_balances')->selectRaw('COALESCE(SUM(quantity), 0)')->whereColumn('stock_balances.product_id', 'products.id')
                    ->whereNotIn('warehouse_id', fn ($w) => $w->from('warehouses')->select('id')->where('is_transit', true));
                if ($restricted !== null) {
                    $q->whereIn('warehouse_id', $restricted);
                }
                if ($warehouseId) {
                    $q->where('warehouse_id', $warehouseId);
                }
            }, 'on_hand');

        if ($request->boolean('recipe_part')) {
            $query->where('type', 'stock')->where('track_serials', false)->where('uses_spare_parts', false)->where('is_active', true);
        }
        if ($request->integer('exclude_id')) {
            $query->where('products.id', '!=', $request->integer('exclude_id'));
        }
        if ($request->filled('category_id')) {
            $query->where('category_id', $request->integer('category_id'));
        }
        if ($request->filled('brand_id')) {
            $query->where('brand_id', $request->integer('brand_id'));
        }
        if ($request->filled('type')) {
            $query->where('type', $request->string('type'));
        }
        if ($request->filled('active')) {
            $query->where('is_active', $request->boolean('active'));
        }
        if ($request->boolean('low_stock')) {
            abort_if($restricted !== null, 403);
            $query->where('type', 'stock')->where('reorder_level', '>', 0)
                ->whereRaw('(SELECT COALESCE(SUM(quantity),0) FROM stock_balances sb WHERE sb.product_id = products.id) <= products.reorder_level');
        }
        $term = trim((string) $request->query('search'));
        if ($term !== '') {
            $query->where(function ($q) use ($term) {
                $q->where('products.code', 'like', "%{$term}%")
                    ->orWhere('products.name', 'like', "%{$term}%")
                    ->orWhere('products.name_en', 'like', "%{$term}%")
                    ->orWhereIn('products.id', ProductUnit::query()->where('barcode', $term)->select('product_id'));
                $this->searchCustom($q, $term);
            });
        }

        $result = $this->paginate($query, $request, ['id', 'code', 'name', 'sale_price', 'on_hand'], 'code');

        return $this->hideCosts($result);
    }

    private function restrictedWarehouses(): ?array
    {
        return $this->user()->hasRole('technician') && ! $this->can('service.view_all')
            ? Warehouse::query()->where('technician_id', $this->user()->id)->pluck('id')->map(fn ($id) => (int) $id)->all() : null;
    }

    public function serials(Request $request, Product $product)
    {
        $this->allow('products.manage', 'products.view', 'stock.view');
        $query = ProductSerial::query()->where('product_id', $product->id);
        if ($this->user()->hasRole('technician') && ! $this->can('service.view_all')) {
            $query->whereIn('warehouse_id', Warehouse::query()->where('technician_id', $this->user()->id)->select('id'));
        }

        return $this->paginate($query, $request, ['id', 'serial_number'], 'serial_number');
    }

    public function show(Product $product)
    {
        $this->allow('products.manage', 'products.view', 'sales.invoices', 'purchases.invoices', 'stock.view');
        $product->load('category', 'brand', 'baseUnit', 'taxRate', 'units.unit');
        $balances = StockBalance::query()->with('warehouse:id,code,name,name_en,is_transit', 'batch')
            ->where('product_id', $product->id)->where('quantity', '!=', 0)
            ->when($this->restrictedWarehouses() !== null, fn ($q) => $q->whereIn('warehouse_id', $this->restrictedWarehouses()))->get();
        $data = $product->toArray();
        $data['balances'] = $balances;
        $data['spare_parts'] = app(SparePartsService::class)->requirements($product, null, $this->restrictedWarehouses());
        $data['warehouse_settings'] = DB::table('product_warehouse_settings')->where('product_id', $product->id)->when($this->restrictedWarehouses() !== null, fn ($q) => $q->whereIn('warehouse_id', $this->restrictedWarehouses()))->get();
        $data['on_hand'] = Money::qty($balances->sum('quantity'));
        $data['price_list_items'] = DB::table('price_list_items')->where('product_id', $product->id)->get(['price_list_id', 'product_unit_id', 'price']);
        if (! $this->canSeeCost()) {
            unset($data['avg_cost'], $data['purchase_price']);
        }

        return response()->json(['data' => $data]);
    }

    /**
     * Barcode scanner lookup: returns the product and the scanned unit.
     */
    public function scan(string $code)
    {
        $this->allow('products.manage', 'products.view', 'sales.invoices', 'purchases.invoices', 'stock.view');
        $unit = ProductUnit::query()->with('product.units.unit', 'product.taxRate', 'unit')->where('barcode', $code)->first();
        $product = $unit?->product ?? Product::query()->with('units.unit', 'taxRate')->where('code', $code)->first();
        if (! $product || ! $product->is_active) {
            return response()->json(['message' => __('erp.barcode_not_found', ['code' => $code]), 'code' => 'not_found'], 404);
        }
        $unit ??= $product->units->firstWhere('unit_id', $product->base_unit_id);

        return response()->json(['data' => ['product' => $this->hideCosts($product->toArray()), 'product_unit_id' => $unit?->id]]);
    }

    /**
     * Price for the line grid: price list, unit price and last price to this party.
     */
    public function price(Request $request, Product $product, TradingService $trading)
    {
        $this->allow('products.manage', 'products.view', 'sales.invoices', 'purchases.invoices', 'stock.view');
        if ($request->query('kind') === 'purchase') {
            $this->allow('inventory.view_cost', 'sales.view_cost', 'purchases.invoices', 'purchases.orders');
        }
        $unit = $request->filled('product_unit_id') ? $product->units()->find($request->integer('product_unit_id')) : null;
        $kind = $request->query('kind', 'sale') === 'purchase' ? 'purchase' : 'sale';
        $result = $trading->priceFor($product, $unit, $request->integer('price_list_id') ?: null, $request->integer('party_id') ?: null, $kind);
        $result['on_hand'] = Money::qty(StockBalance::query()->where('product_id', $product->id)
            ->when($request->integer('warehouse_id'), fn ($q, $w) => $q->where('warehouse_id', $w))->sum('quantity'));
        $warehouseId = $request->integer('warehouse_id') ?: null;
        $restricted = $this->restrictedWarehouses();
        abort_if($warehouseId && $restricted !== null && ! in_array($warehouseId, $restricted, true), 403);
        if ($kind === 'sale') {
            $result['spare_parts'] = app(SparePartsService::class)->requirements($product, $warehouseId, $restricted);
        }
        if ($this->canSeeCost()) {
            $result['avg_cost'] = (float) $product->avg_cost;
            $componentEstimate = $kind === 'sale' && $product->uses_spare_parts
                ? $product->spareParts()->join('products as parts', 'parts.id', '=', 'product_spare_parts.spare_part_id')->sum(DB::raw('product_spare_parts.quantity_per_unit * parts.avg_cost')) : 0;
            $result['estimated_sale_cost'] = round((float) $product->avg_cost + (float) $componentEstimate, 4);
        }

        return response()->json(['data' => $result]);
    }

    public function store(Request $request, NumberingService $numbers)
    {
        $this->allow('products.manage');
        $data = $this->validated($request);

        return DB::transaction(function () use ($data, $numbers) {
            $this->lockRecipeEdits();
            $product = Product::query()->create(collect($data)->except(['units', 'prices', 'warehouse_settings', 'uses_spare_parts', 'spare_parts', 'initial_stock'])->all() + ['code' => $data['code'] ?? $numbers->code('product')]);
            $this->syncUnits($product, $data);
            app(SparePartsService::class)->configure($product, $data);
            $this->initialStock($product, $data['initial_stock'] ?? null);

            $response = $this->show($product->refresh());

            return $response->setStatusCode(201);
        });
    }

    public function update(Request $request, Product $product)
    {
        $this->allow('products.manage');
        $data = $this->validated($request, $product);
        DB::transaction(function () use ($product, $data) {
            $this->lockRecipeEdits();
            $product->refresh();
            $moved = StockMove::query()->where('product_id', $product->id)->exists();
            if ($moved && array_key_exists('track_serials', $data) && (bool) $data['track_serials'] !== (bool) $product->track_serials) {
                abort(422, 'Serial tracking is locked after movements.');
            }
            if ($moved && isset($data['base_unit_id']) && (int) $data['base_unit_id'] !== (int) $product->base_unit_id) {
                throw BusinessException::make(__('erp.base_unit_locked'), 'base_unit_locked');
            }
            if ($moved && array_key_exists('type', $data) && $data['type'] !== $product->type) {
                throw BusinessException::make(__('erp.product_type_locked'), 'product_type_locked');
            }
            if ($moved && array_key_exists('track_batches', $data) && (bool) $data['track_batches'] !== (bool) $product->track_batches) {
                throw BusinessException::make(__('erp.track_batches_locked'), 'track_batches_locked');
            }

            // Clear an explicitly disabled recipe before changing the item type.
            if (array_key_exists('uses_spare_parts', $data) && ! $data['uses_spare_parts']) {
                app(SparePartsService::class)->configure($product, ['uses_spare_parts' => false]);
            }
            $product->update(collect($data)->except(['units', 'prices', 'warehouse_settings', 'uses_spare_parts', 'spare_parts', 'initial_stock', 'code'])->all() + (isset($data['code']) ? ['code' => $data['code']] : []));
            $this->syncUnits($product, $data);
            app(SparePartsService::class)->configure($product, $data);
        });

        return $this->show($product->refresh());
    }

    public function destroy(Product $product)
    {
        $this->allow('products.manage');

        return DB::transaction(function () use ($product) {
            $this->lockRecipeEdits();
            $product->refresh();
            $used = StockMove::query()->where('product_id', $product->id)->exists() || TradeDocumentLine::query()->where('product_id', $product->id)->exists();
            if ($used) {
                $product->update(['is_active' => false]);

                return response()->json(['ok' => true, 'deactivated' => true]);
            }
            $product->spareParts()->delete();
            $product->update(['uses_spare_parts' => false]);
            $product->delete();

            return response()->json(['ok' => true]);
        });
    }

    private function lockRecipeEdits(): void
    {
        // Configuration is infrequent. Lock the catalog in stock's global order so
        // changing the parent and part roles cannot race with each other or a sale.
        Product::query()->orderBy('id')->lockForUpdate()->get(['id']);
    }

    private function initialStock(Product $product, ?array $initial): void
    {
        $quantity = Money::qty($initial['quantity'] ?? 0);
        if ($quantity <= 0) {
            return;
        }
        $this->allow('stock.adjust');
        abort_unless($product->isStock(), 422, __('erp.product_not_stock'));
        $warehouseId = (int) ($initial['warehouse_id'] ?? 0);
        abort_unless(Warehouse::query()->whereKey($warehouseId)->where('is_active', true)->where('is_transit', false)->exists(), 422, __('erp.warehouse_required'));
        $restricted = $this->restrictedWarehouses();
        abort_if($restricted !== null && ! in_array($warehouseId, $restricted, true), 403);
        $stock = app(StockDocumentService::class);
        $document = $stock->save('opening', ['date' => $initial['date'] ?? now()->toDateString(), 'warehouse_id' => $warehouseId,
            'lines' => [array_replace($initial, ['product_id' => $product->id, 'quantity' => $quantity, 'unit_cost' => $initial['unit_cost'] ?? $product->purchase_price])]]);
        $stock->post($document);
    }

    private function syncUnits(Product $product, array $data): void
    {
        if (isset($data['warehouse_settings'])) {
            foreach ($data['warehouse_settings'] as $row) {
                DB::table('product_warehouse_settings')->updateOrInsert(['product_id' => $product->id, 'warehouse_id' => $row['warehouse_id']], ['reorder_level' => $row['reorder_level'], 'reorder_qty' => $row['reorder_qty']]);
            }
        }
        $rows = $data['units'] ?? null;
        if ($rows === null) {
            // Make sure the base unit row exists.
            ProductUnit::query()->firstOrCreate(['product_id' => $product->id, 'unit_id' => $product->base_unit_id], ['factor' => 1, 'is_default_sale' => true, 'is_default_purchase' => true]);

            return;
        }

        $hasBase = collect($rows)->contains(fn ($r) => (int) $r['unit_id'] === (int) $product->base_unit_id);
        if (! $hasBase) {
            array_unshift($rows, ['unit_id' => $product->base_unit_id, 'factor' => 1]);
        }
        $keep = [];
        foreach ($rows as $row) {
            $isBase = (int) $row['unit_id'] === (int) $product->base_unit_id;
            $factor = $isBase ? 1 : (float) ($row['factor'] ?? 1);
            if ($factor <= 0) {
                throw BusinessException::make(__('erp.unit_factor_positive'), 'invalid_factor');
            }
            $existing = ProductUnit::query()->where('product_id', $product->id)->where('unit_id', $row['unit_id'])->first();
            if ($existing && abs((float) $existing->factor - $factor) > 0.00001 && StockMove::query()->where('product_id', $product->id)->exists()) {
                // Conversion factors are history; changing them would rewrite past quantities.
                $used = TradeDocumentLine::query()->where('product_unit_id', $existing->id)->exists();
                if ($used) {
                    throw BusinessException::make(__('erp.unit_factor_locked'), 'unit_factor_locked');
                }
            }
            $unit = ProductUnit::query()->updateOrCreate(['product_id' => $product->id, 'unit_id' => $row['unit_id']], [
                'factor' => $factor,
                'barcode' => ($row['barcode'] ?? null) ?: null,
                'sale_price' => isset($row['sale_price']) && $row['sale_price'] !== '' ? $row['sale_price'] : null,
                'purchase_price' => isset($row['purchase_price']) && $row['purchase_price'] !== '' ? $row['purchase_price'] : null,
                'is_default_sale' => (bool) ($row['is_default_sale'] ?? $isBase),
                'is_default_purchase' => (bool) ($row['is_default_purchase'] ?? $isBase),
            ]);
            $keep[] = $unit->id;

            foreach ($row['prices'] ?? [] as $priceListId => $price) {
                if ($price === null || $price === '') {
                    DB::table('price_list_items')->where('price_list_id', $priceListId)->where('product_unit_id', $unit->id)->delete();

                    continue;
                }
                DB::table('price_list_items')->updateOrInsert(
                    ['price_list_id' => $priceListId, 'product_unit_id' => $unit->id],
                    ['product_id' => $product->id, 'price' => $price, 'updated_at' => now(), 'created_at' => now()],
                );
            }
        }
        $stale = ProductUnit::query()->where('product_id', $product->id)->whereNotIn('id', $keep)->get();
        foreach ($stale as $unit) {
            if (TradeDocumentLine::query()->where('product_unit_id', $unit->id)->exists()) {
                throw BusinessException::make(__('erp.unit_in_use'), 'unit_in_use');
            }
            $unit->delete();
        }
    }

    private function validated(Request $request, ?Product $product = null): array
    {
        $data = $request->validate([
            'uses_spare_parts' => ['sometimes', 'boolean'],
            'spare_parts' => ['sometimes', 'array', 'max:200'],
            'spare_parts.*.product_id' => ['required', 'integer', 'distinct', 'exists:products,id'],
            'spare_parts.*.quantity_per_unit' => ['required', 'numeric', 'gt:0', 'decimal:0,4'],
            'initial_stock' => [$product ? 'prohibited' : 'nullable', 'array'],
            'initial_stock.quantity' => ['nullable', 'numeric', 'min:0', 'decimal:0,4'],
            'initial_stock.warehouse_id' => ['nullable', 'integer', 'exists:warehouses,id'],
            'initial_stock.date' => ['nullable', 'date', 'before_or_equal:today'],
            'initial_stock.unit_cost' => ['nullable', 'numeric', 'min:0'],
            'initial_stock.batch_no' => ['nullable', 'string', 'max:60'],
            'initial_stock.expiry_date' => ['nullable', 'date'],
            'initial_stock.serial_numbers' => ['nullable', 'array'],
            'initial_stock.serial_numbers.*' => ['required', 'string', 'max:100', 'distinct'],
            'code' => ['nullable', 'string', 'max:40', Rule::unique('products', 'code')->ignore($product?->id)],
            'name' => ['required', 'string', 'max:190'],
            'name_en' => ['nullable', 'string', 'max:190'],
            'type' => ['required', 'in:stock,service'],
            'category_id' => ['nullable', 'exists:categories,id'],
            'brand_id' => ['nullable', 'exists:brands,id'],
            'base_unit_id' => ['required', 'exists:units,id'],
            'tax_rate_id' => ['nullable', 'exists:tax_rates,id'],
            'description' => ['nullable', 'string', 'max:2000'],
            'track_batches' => ['boolean'],
            'track_serials' => ['boolean'],
            'sale_price' => ['nullable', 'numeric', 'min:0'],
            'min_sale_price' => ['nullable', 'numeric', 'min:0'],
            'purchase_price' => ['nullable', 'numeric', 'min:0'],
            'reorder_level' => ['nullable', 'numeric', 'min:0'],
            'reorder_qty' => ['nullable', 'numeric', 'min:0'],
            'eta_code_type' => ['nullable', 'in:GS1,EGS'],
            'eta_item_code' => ['nullable', 'string', 'max:60'],
            'is_active' => ['boolean'],
            'warehouse_settings' => ['nullable', 'array', 'max:200'],
            'warehouse_settings.*.warehouse_id' => ['required', 'exists:warehouses,id', 'distinct'],
            'warehouse_settings.*.reorder_level' => ['required', 'numeric', 'min:0'],
            'warehouse_settings.*.reorder_qty' => ['required', 'numeric', 'min:0'],
            'units' => ['nullable', 'array'],
            'units.*.unit_id' => ['required', 'exists:units,id'],
            'units.*.factor' => ['nullable', 'numeric', 'gt:0'],
            'units.*.barcode' => ['nullable', 'string', 'max:64'],
            'units.*.sale_price' => ['nullable', 'numeric', 'min:0'],
            'units.*.purchase_price' => ['nullable', 'numeric', 'min:0'],
            'units.*.is_default_sale' => ['nullable', 'boolean'],
            'units.*.is_default_purchase' => ['nullable', 'boolean'],
            'units.*.prices' => ['nullable', 'array'],
        ]);
        foreach (['sale_price', 'min_sale_price', 'purchase_price', 'reorder_level', 'reorder_qty'] as $field) {
            if (array_key_exists($field, $data)) {
                $data[$field] = (float) ($data[$field] ?? 0);
            }
        }
        if (array_key_exists('code', $data) && $data['code'] === null) {
            unset($data['code']);
        }
        abort_if(($data['track_serials'] ?? $product?->track_serials ?? false) && ($data['track_batches'] ?? $product?->track_batches ?? false), 422, 'Serial and batch tracking cannot be combined.');
        // Barcodes are unique across all products and units.
        $barcodes = collect($data['units'] ?? [])->pluck('barcode')->filter();
        if ($barcodes->duplicates()->isNotEmpty()) {
            throw BusinessException::make(__('erp.barcode_duplicate', ['code' => $barcodes->duplicates()->first()]), 'barcode_duplicate');
        }
        foreach ($barcodes as $barcode) {
            $taken = ProductUnit::query()->where('barcode', $barcode)->when($product, fn ($q) => $q->where('product_id', '!=', $product->id))->exists();
            if ($taken) {
                throw BusinessException::make(__('erp.barcode_duplicate', ['code' => $barcode]), 'barcode_duplicate');
            }
        }

        return $data;
    }

    private function canSeeCost(): bool
    {
        return $this->can('inventory.view_cost') || $this->can('sales.view_cost');
    }

    private function hideCosts(mixed $result): mixed
    {
        if ($this->canSeeCost()) {
            return $result;
        }
        $strip = function ($item) {
            if (is_array($item)) {
                unset($item['avg_cost'], $item['purchase_price']);
            } elseif ($item instanceof Product) {
                $item->makeHidden(['avg_cost', 'purchase_price']);
            }

            return $item;
        };
        if (is_array($result) && isset($result['data'])) {
            $result['data'] = collect($result['data'])->map($strip);

            return $result;
        }
        if ($result instanceof LengthAwarePaginator) {
            $result->getCollection()->each(fn ($p) => $p->makeHidden(['avg_cost', 'purchase_price']));

            return $result;
        }

        return $strip($result);
    }
}
