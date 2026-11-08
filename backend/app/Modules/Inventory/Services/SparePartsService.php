<?php

namespace App\Modules\Inventory\Services;

use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\ProductSparePart;
use App\Modules\Inventory\Models\StockBalance;
use App\Modules\Trading\Models\TradeDocumentLine;
use App\Modules\Trading\Models\TradeLineComponent;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SparePartsService
{
    public function __construct(private readonly StockService $stock) {}

    /** Called inside the product transaction; recipe edits share locks with postings. */
    public function configure(Product $product, array $data): void
    {
        if (! array_key_exists('uses_spare_parts', $data) && ! array_key_exists('spare_parts', $data)) {
            return;
        }
        $enabled = (bool) ($data['uses_spare_parts'] ?? $product->uses_spare_parts);
        $rows = $data['spare_parts'] ?? $product->spareParts()->get()->map(fn ($r) => ['product_id' => $r->spare_part_id, 'quantity_per_unit' => $r->quantity_per_unit])->all();
        if ($enabled && (! $product->isStock() || count($rows) === 0 || ProductSparePart::query()->where('spare_part_id', $product->id)->exists())) {
            throw ValidationException::withMessages(['spare_parts' => __('erp.spare_parts_flat')]);
        }
        if ($enabled) {
            $seen = [];
            foreach ($rows as $i => $row) {
                $part = Product::query()->find($row['product_id']);
                if (! $part || ! $part->is_active || ! $part->isStock() || $part->track_serials || $part->uses_spare_parts || $part->id === $product->id || isset($seen[$part->id])) {
                    throw ValidationException::withMessages(["spare_parts.$i.product_id" => __('erp.spare_parts_invalid')]);
                }
                if (Money::qty($row['quantity_per_unit']) <= 0) {
                    throw ValidationException::withMessages(["spare_parts.$i.quantity_per_unit" => __('erp.quantity_positive')]);
                }
                $seen[$part->id] = true;
            }
        }
        $product->update(['uses_spare_parts' => $enabled]);
        $product->spareParts()->delete();
        foreach ($enabled ? $rows : [] as $row) {
            $product->spareParts()->create(['spare_part_id' => $row['product_id'], 'quantity_per_unit' => Money::qty($row['quantity_per_unit'])]);
        }
        $product->unsetRelation('spareParts');
    }

    /** Enforced by model events, including CSV import and deactivation. */
    public function guardChange(Product $product, bool $deleting = false): void
    {
        if (! $product->exists) {
            return;
        }
        $referenced = ProductSparePart::query()->where('spare_part_id', $product->id)->exists();
        if ($referenced && ($deleting || ! $product->is_active || ! $product->isStock() || $product->track_serials || $product->uses_spare_parts || $product->isDirty('base_unit_id') || $product->isDirty('track_batches'))) {
            throw BusinessException::make(__('erp.spare_part_in_use'), 'spare_part_in_use');
        }
        if ($product->uses_spare_parts && ! $product->isStock()) {
            throw BusinessException::make(__('erp.spare_parts_flat'), 'invalid_recipe');
        }
    }

    public function requirements(Product $product, ?int $warehouseId, ?array $restricted = null): array
    {
        if (! $product->uses_spare_parts) {
            return [];
        }

        return $product->spareParts()->with('product.baseUnit')->get()->map(function ($row) use ($warehouseId, $restricted) {
            $part = $row->product;
            $onHand = StockBalance::query()->where('product_id', $row->spare_part_id)
                ->whereIn('warehouse_id', fn ($q) => $q->from('warehouses')->select('id')->where('is_transit', false))
                ->when($warehouseId, fn ($q) => $q->where('warehouse_id', $warehouseId))
                ->when($restricted !== null, fn ($q) => $q->whereIn('warehouse_id', $restricted))->sum('quantity');

            return ['product_id' => $row->spare_part_id, 'quantity_per_unit' => $row->quantity_per_unit,
                'code' => $part->code, 'name' => $part->name, 'name_en' => $part->name_en,
                'unit_name' => $part->baseUnit?->name, 'unit_name_en' => $part->baseUnit?->name_en,
                'on_hand' => Money::qty($onHand)];
        })->all();
    }

    /** Locks parents and parts in the same global order as all stock operations. */
    public function lockForSale(array $parentIds): array
    {
        $partIds = ProductSparePart::query()->whereIn('product_id', $parentIds)->pluck('spare_part_id')->all();
        $products = $this->stock->lockProducts([...$parentIds, ...$partIds]);
        foreach ($parentIds as $id) {
            $products[$id]->setRelation('spareParts', $products[$id]->spareParts()->lockForUpdate()->get());
            foreach ($products[$id]->spareParts as $row) {
                if (! isset($products[$row->spare_part_id])) {
                    throw BusinessException::make(__('erp.spare_parts_changed'), 'recipe_changed');
                }
            }
        }

        return $products;
    }

    public function consume(TradeDocumentLine $line, Product $parent, array $products, int $warehouseId, array $ctx): float
    {
        if (! $parent->uses_spare_parts) {
            return 0;
        }
        $cost = 0;
        foreach ($parent->spareParts as $row) {
            $part = $products[$row->spare_part_id];
            if (! $part->is_active || ! $part->isStock() || $part->track_serials || $part->uses_spare_parts) {
                throw BusinessException::make(__('erp.spare_parts_invalid'), 'invalid_recipe');
            }
            $quantity = Money::qty((float) $line->base_quantity * (float) $row->quantity_per_unit);
            if ($quantity <= 0) {
                continue;
            }
            foreach ($this->stock->issue($part, $warehouseId, $quantity, null, $ctx + ['source_line_id' => $line->id]) as $move) {
                $snapshot = $line->components()->create([
                    'product_id' => $part->id, 'stock_move_id' => $move->id, 'batch_id' => $move->batch_id,
                    'code' => $part->code, 'name' => $part->name, 'name_en' => $part->name_en,
                    'unit_name' => $part->baseUnit?->name ?? '', 'unit_name_en' => $part->baseUnit?->name_en,
                    'batch_no' => $move->batch_id ? DB::table('batches')->where('id', $move->batch_id)->value('batch_no') : null,
                    'quantity_per_unit' => $row->quantity_per_unit, 'quantity' => abs((float) $move->quantity),
                    'unit_cost' => $move->unit_cost, 'cost_amount' => abs((float) $move->total_cost),
                ]);
                $cost += (float) $snapshot->cost_amount;
            }
        }

        return Money::round($cost);
    }

    /** Restore cumulative shares of each original pick; the last return takes the remainder. */
    public function restore(TradeDocumentLine $line, array $products, int $warehouseId, array $ctx): float
    {
        if (! $line->source_line_id) {
            return 0;
        }
        $source = $line->sourceLine;
        $already = (float) TradeDocumentLine::query()->where('source_line_id', $source->id)
            ->whereHas('document', fn ($q) => $q->where('type', 'sales_return')->where('status', 'posted'))->sum('base_quantity');
        // Include earlier lines in this same draft return (snapshots have already been written).
        $already += (float) TradeDocumentLine::query()->where('trade_document_id', $line->trade_document_id)
            ->where('source_line_id', $source->id)->where('line_no', '<', $line->line_no)->sum('base_quantity');
        $ratio = min(1, ($already + (float) $line->base_quantity) / (float) $source->base_quantity);
        $cost = 0;
        foreach ($source->components as $original) {
            $returned = TradeLineComponent::query()->where('source_component_id', $original->id)
                ->whereIn('trade_document_line_id', TradeDocumentLine::query()->select('id')->whereHas('document', fn ($q) => $q->where('status', 'posted')->orWhere('id', $line->trade_document_id)))
                ->selectRaw('COALESCE(SUM(quantity),0) quantity, COALESCE(SUM(cost_amount),0) cost')->first();
            $quantity = Money::qty((float) $original->quantity * $ratio - (float) $returned->quantity);
            $value = Money::round((float) $original->cost_amount * $ratio - (float) $returned->cost);
            if ($quantity <= 0) {
                continue;
            }
            $move = $this->stock->receive($products[$original->product_id], $warehouseId, $quantity, (float) $original->unit_cost, (int) $original->batch_id,
                $ctx + ['source_line_id' => $line->id], false, $value);
            $line->components()->create(array_replace(collect($original->getAttributes())->except(['id', 'trade_document_line_id'])->all(),
                ['stock_move_id' => $move->id, 'source_component_id' => $original->id, 'quantity' => $quantity, 'cost_amount' => $value]));
            $cost += $value;
        }

        return Money::round($cost);
    }
}
