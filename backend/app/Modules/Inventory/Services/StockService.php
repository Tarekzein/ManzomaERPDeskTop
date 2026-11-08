<?php

namespace App\Modules\Inventory\Services;

use App\Modules\Core\Services\SettingsService;
use App\Modules\Inventory\Models\Batch;
use App\Modules\Inventory\Models\CostLayer;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\StockBalance;
use App\Modules\Inventory\Models\StockMove;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Exceptions\PermissionDoesNotExist;

/**
 * Every stock quantity change goes through this service and leaves an
 * immutable stock move. Cost is a moving average per product (company-wide),
 * or FIFO layers when the company chooses FIFO.
 *
 * Context keys: date, source_type, source_id, source_line_id, reference, party_id.
 */
class StockService
{
    public function __construct(private readonly SettingsService $settings) {}

    public function method(): string
    {
        return (string) $this->settings->get('accounting.costing_method', 'average');
    }

    public function allowNegative(): bool
    {
        if ($this->settings->get('inventory.allow_negative', false)) {
            return true;
        }
        $user = auth()->user();
        // Checked against the user's roles directly, not through the admin
        // gate: selling stock that is not on the shelf must be a deliberate grant.
        try {
            return $user !== null && $user->hasPermissionTo('stock.allow_negative');
        } catch (PermissionDoesNotExist) {
            return false;
        }
    }

    /**
     * Lock product rows (for cost) in a fixed order so concurrent postings
     * over overlapping products queue instead of deadlocking.
     *
     * @return array<int, Product>
     */
    public function lockProducts(array $productIds): array
    {
        $ids = collect($productIds)->map(fn ($id) => (int) $id)->unique()->sort()->values();

        return Product::query()->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id')->all();
    }

    public function onHand(int $productId, ?int $warehouseId = null, ?int $batchId = null): float
    {
        $query = StockBalance::query()->where('product_id', $productId);
        if ($warehouseId) {
            $query->where('warehouse_id', $warehouseId);
        }
        if ($batchId !== null) {
            $query->where('batch_id', $batchId);
        }

        return Money::qty($query->sum('quantity'));
    }

    /**
     * Find or create a batch by number for batch-tracked products.
     */
    public function batch(Product $product, ?string $batchNo, ?string $expiry = null, ?string $mfg = null): int
    {
        if (! $product->track_batches) {
            return 0;
        }
        $batchNo = trim((string) $batchNo);
        if ($batchNo === '') {
            throw BusinessException::make(__('erp.batch_required', ['product' => $product->name]), 'batch_required');
        }
        $batch = Batch::query()->firstOrCreate(
            ['product_id' => $product->id, 'batch_no' => $batchNo],
            ['expiry_date' => $expiry, 'mfg_date' => $mfg],
        );
        if ($expiry && ! $batch->expiry_date) {
            $batch->update(['expiry_date' => $expiry]);
        }

        return (int) $batch->id;
    }

    /**
     * Stock in. Updates the moving average unless $keepCost (transfers).
     */
    public function receive(Product $product, int $warehouseId, float $quantity, float $unitCost, int $batchId, array $ctx, bool $keepCost = false, ?float $totalCost = null): StockMove
    {
        $quantity = Money::qty($quantity);
        if ($quantity <= 0) {
            throw BusinessException::make(__('erp.quantity_positive'), 'invalid_quantity');
        }
        $unitCost = max(0, round($unitCost, 4));

        if (! $keepCost) {
            $this->updateCostOnReceipt($product, $quantity, $unitCost);
        }

        $balance = $this->balanceRow($product->id, $warehouseId, $batchId);
        $balance->update(['quantity' => Money::qty((float) $balance->quantity + $quantity)]);

        $move = $this->writeMove($product, $warehouseId, $batchId, $quantity, $unitCost, $ctx, $totalCost);

        if (! $keepCost && $this->method() === 'fifo') {
            CostLayer::query()->create([
                'product_id' => $product->id,
                'stock_move_id' => $move->id,
                'date' => $ctx['date'],
                'original_quantity' => $quantity,
                'remaining_quantity' => $quantity,
                'unit_cost' => $unitCost,
            ]);
        }

        return $move;
    }

    /**
     * Stock out. Batch-tracked products without a given batch are picked
     * first-expiry-first-out across batches. Returns the moves written.
     *
     * @return array<int, StockMove>
     */
    public function issue(Product $product, int $warehouseId, float $quantity, ?int $batchId, array $ctx, bool $keepCost = false): array
    {
        $quantity = Money::qty($quantity);
        if ($quantity <= 0) {
            throw BusinessException::make(__('erp.quantity_positive'), 'invalid_quantity');
        }

        $picks = $this->pick($product, $warehouseId, $quantity, $batchId);
        $moves = [];
        foreach ($picks as [$pickBatch, $pickQty]) {
            $balance = $this->balanceRow($product->id, $warehouseId, $pickBatch);
            $available = (float) $balance->quantity;
            if ($available + 0.00001 < $pickQty && ! $this->allowNegative()) {
                throw BusinessException::make(
                    __('erp.insufficient_stock', ['product' => $product->name, 'available' => Money::qty($available), 'required' => $pickQty]),
                    'insufficient_stock',
                    ['product_id' => $product->id, 'available' => Money::qty($available), 'required' => $pickQty],
                );
            }
            $unitCost = $keepCost ? (float) $product->avg_cost : $this->issueCost($product, $pickQty);
            $balance->update(['quantity' => Money::qty($available - $pickQty)]);
            $moves[] = $this->writeMove($product, $warehouseId, $pickBatch, -$pickQty, $unitCost, $ctx);
        }

        return $moves;
    }

    /**
     * Move between warehouses at the current cost (cost is company-wide).
     *
     * @return array{0: array<int, StockMove>, 1: array<int, StockMove>}
     */
    public function transfer(Product $product, int $fromWarehouseId, int $toWarehouseId, float $quantity, ?int $batchId, array $ctx): array
    {
        $out = $this->issue($product, $fromWarehouseId, $quantity, $batchId, $ctx, true);
        $in = [];
        foreach ($out as $move) {
            $in[] = $this->receive($product, $toWarehouseId, abs((float) $move->quantity), (float) $move->unit_cost, (int) $move->batch_id, $ctx, true);
        }

        return [$out, $in];
    }

    /**
     * Undo every move of a source document (used when voiding). Stock that
     * went out comes back at the same cost; stock that came in goes out.
     */
    public function reverseSource(string $sourceType, int $sourceId, array $ctx, bool $keepCost = false): void
    {
        $moves = StockMove::query()->where('source_type', $sourceType)->where('source_id', $sourceId)->orderBy('id')->get();
        if ($moves->isEmpty()) {
            return;
        }
        $products = $this->lockProducts($moves->pluck('product_id')->all());
        $isTransfer = $keepCost;

        foreach ($moves as $move) {
            $product = $products[$move->product_id];
            $qty = abs((float) $move->quantity);
            $moveCtx = $ctx + ['source_line_id' => $move->source_line_id, 'serial_numbers' => app(SerialService::class)->numbers($move)];
            if ((float) $move->quantity < 0) {
                $this->receive($product, (int) $move->warehouse_id, $qty, (float) $move->unit_cost, (int) $move->batch_id, $moveCtx, $isTransfer, abs((float) $move->total_cost));
            } else {
                $balance = $this->balanceRow($product->id, (int) $move->warehouse_id, (int) $move->batch_id);
                if ((float) $balance->quantity + 0.00001 < $qty && ! $this->allowNegative()) {
                    throw BusinessException::make(__('erp.cannot_reverse_stock_consumed', ['product' => $product->name]), 'insufficient_stock');
                }
                $balance->update(['quantity' => Money::qty((float) $balance->quantity - $qty)]);
                if (! $isTransfer) {
                    $this->updateCostOnRemoval($product, $qty, (float) $move->unit_cost, (int) $move->id);
                }
                $this->writeMove($product, (int) $move->warehouse_id, (int) $move->batch_id, -$qty, (float) $move->unit_cost, $moveCtx, -abs((float) $move->total_cost));
            }
        }
    }

    /**
     * Inventory value as of a date: the signed sum of move costs.
     */
    public function valueAsOf(?string $date = null, ?int $warehouseId = null): float
    {
        $query = StockMove::query();
        if ($date) {
            $query->whereDate('date', '<=', $date);
        }
        if ($warehouseId) {
            $query->where('warehouse_id', $warehouseId);
        }

        return Money::round($query->sum('total_cost'));
    }

    /**
     * @return array<int, array{0:int,1:float}> [batch_id, quantity]
     */
    private function pick(Product $product, int $warehouseId, float $quantity, ?int $batchId): array
    {
        if (! $product->track_batches) {
            return [[0, $quantity]];
        }
        if ($batchId) {
            return [[$batchId, $quantity]];
        }

        // First expiry, first out; batches without expiry last, oldest first.
        $balances = StockBalance::query()
            ->leftJoin('batches', 'batches.id', '=', 'stock_balances.batch_id')
            ->where('stock_balances.product_id', $product->id)
            ->where('stock_balances.warehouse_id', $warehouseId)
            ->where('stock_balances.quantity', '>', 0)
            ->orderByRaw('CASE WHEN batches.expiry_date IS NULL THEN 1 ELSE 0 END')
            ->orderBy('batches.expiry_date')
            ->orderBy('stock_balances.batch_id')
            ->select('stock_balances.batch_id', 'stock_balances.quantity')
            ->get();

        $picks = [];
        $remaining = $quantity;
        foreach ($balances as $row) {
            if ($remaining <= 0) {
                break;
            }
            $take = min($remaining, (float) $row->quantity);
            $picks[] = [(int) $row->batch_id, Money::qty($take)];
            $remaining = Money::qty($remaining - $take);
        }
        if ($remaining > 0) {
            if (! $this->allowNegative()) {
                $available = Money::qty($quantity - $remaining);
                throw BusinessException::make(
                    __('erp.insufficient_stock', ['product' => $product->name, 'available' => $available, 'required' => $quantity]),
                    'insufficient_stock',
                    ['product_id' => $product->id, 'available' => $available, 'required' => $quantity],
                );
            }
            // Over-issue lands on the last batch picked (or a no-batch row).
            $last = end($picks);
            $picks[] = [$last ? $last[0] : 0, $remaining];
        }

        return $picks;
    }

    private function issueCost(Product $product, float $quantity): float
    {
        if ($this->method() !== 'fifo') {
            return (float) $product->avg_cost;
        }

        $remaining = $quantity;
        $cost = 0.0;
        $layers = CostLayer::query()->where('product_id', $product->id)->where('remaining_quantity', '>', 0)
            ->orderBy('date')->orderBy('id')->lockForUpdate()->get();
        foreach ($layers as $layer) {
            if ($remaining <= 0) {
                break;
            }
            $take = min($remaining, (float) $layer->remaining_quantity);
            $cost += $take * (float) $layer->unit_cost;
            $layer->update(['remaining_quantity' => Money::qty((float) $layer->remaining_quantity - $take)]);
            $remaining = Money::qty($remaining - $take);
        }
        if ($remaining > 0) {
            // No layers left (negative stock): use the last known cost.
            $cost += $remaining * (float) $product->avg_cost;
        }
        $unit = round($cost / $quantity, 4);
        $this->refreshFifoAverage($product);

        return $unit;
    }

    private function updateCostOnReceipt(Product $product, float $quantity, float $unitCost): void
    {
        if ($this->method() === 'fifo') {
            // Keep avg_cost as the fallback/last cost for FIFO companies.
            $onHand = max(0, $this->onHand($product->id));
            $value = $onHand * (float) $product->avg_cost + $quantity * $unitCost;
            $product->avg_cost = round($value / ($onHand + $quantity), 4);
            $product->save();

            return;
        }

        $onHand = $this->onHand($product->id);
        if ($onHand <= 0) {
            $product->avg_cost = $unitCost;
        } else {
            $product->avg_cost = round(($onHand * (float) $product->avg_cost + $quantity * $unitCost) / ($onHand + $quantity), 4);
        }
        $product->save();
    }

    /**
     * Reversing a receipt removes its value from the average.
     */
    private function updateCostOnRemoval(Product $product, float $quantity, float $unitCost, int $moveId): void
    {
        if ($this->method() === 'fifo') {
            CostLayer::query()->where('stock_move_id', $moveId)->update(['remaining_quantity' => 0]);
            $this->refreshFifoAverage($product);

            return;
        }
        $onHand = $this->onHand($product->id); // already reduced by caller
        $before = $onHand + $quantity;
        if ($onHand > 0) {
            $product->avg_cost = max(0, round(($before * (float) $product->avg_cost - $quantity * $unitCost) / $onHand, 4));
            $product->save();
        }
    }

    private function refreshFifoAverage(Product $product): void
    {
        $row = CostLayer::query()->where('product_id', $product->id)->where('remaining_quantity', '>', 0)
            ->selectRaw('SUM(remaining_quantity) q, SUM(remaining_quantity * unit_cost) v')->first();
        if ($row && (float) $row->q > 0) {
            $product->avg_cost = round((float) $row->v / (float) $row->q, 4);
            $product->save();
        }
    }

    private function balanceRow(int $productId, int $warehouseId, int $batchId): StockBalance
    {
        $balance = StockBalance::query()->firstOrCreate(
            ['product_id' => $productId, 'warehouse_id' => $warehouseId, 'batch_id' => $batchId],
            ['quantity' => 0],
        );

        return StockBalance::query()->whereKey($balance->id)->lockForUpdate()->firstOrFail();
    }

    /**
     * Move values are rounded to the cent so the stock ledger and the
     * inventory account in the general ledger agree exactly.
     */
    private function writeMove(Product $product, int $warehouseId, int $batchId, float $quantity, float $unitCost, array $ctx, ?float $totalCost = null): StockMove
    {
        $move = StockMove::query()->create([
            'date' => $ctx['date'],
            'product_id' => $product->id,
            'warehouse_id' => $warehouseId,
            'batch_id' => $batchId,
            'quantity' => Money::qty($quantity),
            'unit_cost' => round($unitCost, 4),
            'total_cost' => $totalCost !== null ? round($totalCost, 2) : round($quantity * $unitCost, 2),
            'source_type' => $ctx['source_type'],
            'source_id' => $ctx['source_id'],
            'source_line_id' => $ctx['source_line_id'] ?? null,
            'reference' => $ctx['reference'] ?? null,
            'party_id' => $ctx['party_id'] ?? null,
            'created_by' => auth()->id(),
        ]);
        app(SerialService::class)->record($product, $move, $ctx);

        return $move;
    }

    public function transaction(callable $callback): mixed
    {
        return DB::transaction($callback);
    }
}
