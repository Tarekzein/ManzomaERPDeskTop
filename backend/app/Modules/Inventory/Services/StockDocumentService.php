<?php

namespace App\Modules\Inventory\Services;

use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\NumberingService;
use App\Modules\Core\Services\PeriodGuard;
use App\Modules\Finance\Models\JournalEntry;
use App\Modules\Finance\Services\JournalService;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\StockBalance;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Models\Warehouse;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Adjustments, two-step transfers, stock counts (جرد) and opening stock.
 */
class StockDocumentService
{
    public const TYPES = ['adjustment', 'transfer', 'count', 'opening'];

    public const REASONS = ['damage', 'expiry', 'loss', 'theft', 'gift', 'sample', 'internal_use', 'correction', 'found', 'other'];

    public function __construct(
        private readonly StockService $stock,
        private readonly JournalService $journal,
        private readonly NumberingService $numbers,
        private readonly PeriodGuard $period,
        private readonly AuditService $audit,
    ) {}

    public function relations(): array
    {
        return ['lines.product:id,code,name,name_en,track_batches,track_serials,avg_cost,base_unit_id', 'lines.product.baseUnit:id,name,name_en', 'lines.productUnit.unit', 'lines.batch', 'warehouse:id,code,name,name_en', 'toWarehouse:id,code,name,name_en', 'creator:id,name'];
    }

    public function save(string $type, array $data, ?StockDocument $doc = null): StockDocument
    {
        if (! in_array($type, self::TYPES, true)) {
            throw BusinessException::make(__('erp.unknown_document_type'), 'invalid_type');
        }
        if ($doc && ! in_array($doc->status, ['draft', 'in_progress'], true)) {
            throw BusinessException::make(__('erp.only_draft_editable'), 'not_draft');
        }
        $warehouse = Warehouse::query()->where('is_transit', false)->findOrFail($data['warehouse_id']);
        $toWarehouseId = null;
        if ($type === 'transfer') {
            $to = Warehouse::query()->where('is_transit', false)->findOrFail($data['to_warehouse_id'] ?? 0);
            if ($to->id === $warehouse->id) {
                throw BusinessException::make(__('erp.transfer_same_warehouse'), 'transfer_invalid');
            }
            $toWarehouseId = $to->id;
        }
        if ($type === 'adjustment' && ! in_array($data['reason'] ?? null, self::REASONS, true)) {
            throw BusinessException::make(__('erp.adjustment_reason_required'), 'reason_required');
        }

        $products = Product::query()->with('units')->whereIn('id', collect($data['lines'] ?? [])->pluck('product_id'))->get()->keyBy('id');
        $lines = [];
        foreach ($data['lines'] ?? [] as $row) {
            $product = $products[$row['product_id'] ?? 0] ?? null;
            if (! $product || ! $product->isStock()) {
                throw BusinessException::make(__('erp.product_not_stock'), 'invalid_product');
            }
            $unit = ! empty($row['product_unit_id']) ? $product->units->firstWhere('id', (int) $row['product_unit_id']) : $product->units->firstWhere('unit_id', $product->base_unit_id);
            $factor = $unit ? (float) $unit->factor : 1.0;
            $qty = Money::qty($row['quantity'] ?? 0);
            $counted = array_key_exists('counted_quantity', $row) && $row['counted_quantity'] !== null && $row['counted_quantity'] !== '' ? Money::qty($row['counted_quantity']) : null;
            if ($type !== 'count' && $qty <= 0) {
                continue;
            }
            $lines[] = [
                'id' => $row['id'] ?? null,
                'serial_numbers' => $row['serial_numbers'] ?? [],
                'product_id' => $product->id,
                'product_unit_id' => $unit?->id,
                'factor' => $factor,
                'batch_id' => (int) ($row['batch_id'] ?? 0),
                'batch_no' => $row['batch_no'] ?? null,
                'expiry_date' => $row['expiry_date'] ?? null,
                'direction' => $type === 'adjustment' ? (($row['direction'] ?? 'out') === 'in' ? 'in' : 'out') : 'in',
                'quantity' => $qty,
                'system_quantity' => $type === 'count' ? ($row['system_quantity'] ?? null) : null,
                'counted_quantity' => $type === 'count' ? $counted : null,
                // Unit cost is entered per document unit; stored per base unit.
                'unit_cost' => isset($row['unit_cost']) && $row['unit_cost'] !== '' ? round((float) $row['unit_cost'] / max($factor, 0.0001), 4) : (float) $product->avg_cost,
                'notes' => $row['notes'] ?? null,
            ];
        }
        if ($lines === [] && $type !== 'count') {
            throw BusinessException::make(__('erp.document_needs_lines'), 'no_lines');
        }

        return DB::transaction(function () use ($type, $data, $doc, $warehouse, $toWarehouseId, $lines) {
            $attributes = [
                'type' => $type,
                'date' => $data['date'] ?? now()->toDateString(),
                'branch_id' => $warehouse->branch_id ?? auth()->user()?->branch_id,
                'warehouse_id' => $warehouse->id,
                'to_warehouse_id' => $toWarehouseId,
                'reason' => $type === 'adjustment' ? $data['reason'] : null,
                'notes' => $data['notes'] ?? null,
            ];
            if ($doc) {
                $doc->update($attributes);
                // Preserve identity for line metadata and later movement references.
            } else {
                $docType = $type === 'transfer' ? 'stock_transfer' : $type;
                $doc = StockDocument::query()->create($attributes + [
                    'number' => $this->numbers->next($docType, $attributes['date']),
                    'status' => 'draft',
                    'created_by' => auth()->id(),
                ]);
            }
            $kept = [];
            foreach ($lines as $line) {
                $attributes = collect($line)->except('id')->all();
                $existing = ! empty($line['id']) ? $doc->lines()->whereKey($line['id'])->firstOrFail() : null;
                if ($existing) {
                    $existing->update($attributes);
                    $kept[] = $existing->id;
                } else {
                    $kept[] = $doc->lines()->create($attributes)->id;
                }
            }
            $doc->lines()->whereNotIn('id', $kept)->delete();

            return $doc->refresh()->load($this->relations());
        });
    }

    /**
     * Start a count: list every product (optionally one category) with the
     * system quantity frozen as a reference for the counters.
     */
    public function startCount(StockDocument $doc, ?int $categoryId = null): StockDocument
    {
        if ($doc->type !== 'count' || $doc->status !== 'draft') {
            throw BusinessException::make(__('erp.transition_not_allowed'), 'transition_not_allowed');
        }

        return DB::transaction(function () use ($doc, $categoryId) {
            $existing = $doc->lines()->get()->keyBy(fn ($l) => $l->product_id.':'.$l->batch_id);
            $products = Product::query()->where('type', 'stock')->where('is_active', true)
                ->when($categoryId, fn ($q) => $q->where('category_id', $categoryId))
                ->with('units')->orderBy('code')->get();
            $balances = StockBalance::query()->where('warehouse_id', $doc->warehouse_id)->get()->groupBy('product_id');

            foreach ($products as $product) {
                $rows = $balances[$product->id] ?? collect();
                $rows = $rows->isEmpty() ? collect([(object) ['batch_id' => 0, 'quantity' => 0]]) : $rows;
                foreach ($rows as $row) {
                    $key = $product->id.':'.$row->batch_id;
                    $unit = $product->units->firstWhere('unit_id', $product->base_unit_id);
                    if (isset($existing[$key])) {
                        $existing[$key]->update(['system_quantity' => Money::qty($row->quantity)]);

                        continue;
                    }
                    $doc->lines()->create([
                        'product_id' => $product->id,
                        'product_unit_id' => $unit?->id,
                        'factor' => 1,
                        'batch_id' => (int) $row->batch_id,
                        'system_quantity' => Money::qty($row->quantity),
                        'counted_quantity' => null,
                        'unit_cost' => (float) $product->avg_cost,
                    ]);
                }
            }
            $doc->update(['status' => 'in_progress']);
            $this->audit->record('count_started', $doc);

            return $doc->refresh()->load($this->relations());
        });
    }

    public function post(StockDocument $doc, array $options = []): StockDocument
    {
        return DB::transaction(function () use ($doc, $options) {
            $doc = StockDocument::query()->whereKey($doc->id)->lockForUpdate()->firstOrFail();
            $doc->load('lines.product');
            $allowed = $doc->type === 'count' ? ['draft', 'in_progress'] : ['draft'];
            if (! in_array($doc->status, $allowed, true)) {
                throw BusinessException::make(__('erp.only_draft_postable'), 'not_draft');
            }
            $date = $doc->date->toDateString();
            $this->period->assertOpen($date);
            $ctx = ['date' => $date, 'source_type' => 'stock_'.$doc->type, 'source_id' => $doc->id, 'reference' => $doc->number];
            $products = $this->stock->lockProducts($doc->lines->pluck('product_id')->all());

            match ($doc->type) {
                'adjustment', 'opening' => $this->postAdjustment($doc, $products, $ctx),
                'count' => $this->postCount($doc, $products, $ctx),
                'transfer' => $this->sendTransfer($doc, $products, $ctx, (bool) ($options['direct'] ?? false)),
            };
            $this->audit->record('posted', $doc, $doc->number);

            return $doc->refresh()->load($this->relations());
        });
    }

    /**
     * Destination confirms what arrived. Shortages are written off as a loss.
     *
     * @param  array  $received  [line_id => received quantity in document units]
     */
    public function receiveTransfer(StockDocument $doc, array $received, ?string $date = null, array $receivedSerials = []): StockDocument
    {
        return DB::transaction(function () use ($doc, $received, $date, $receivedSerials) {
            $doc = StockDocument::query()->whereKey($doc->id)->lockForUpdate()->firstOrFail();
            if ($doc->type !== 'transfer' || $doc->status !== 'in_transit') {
                throw BusinessException::make(__('erp.transition_not_allowed'), 'transition_not_allowed');
            }
            $doc->load('lines.product');
            $date ??= now()->toDateString();
            $this->period->assertOpen($date);
            $transit = $this->transitWarehouse();
            $ctx = ['date' => $date, 'source_type' => 'stock_transfer_in', 'source_id' => $doc->id, 'reference' => $doc->number];
            $products = $this->stock->lockProducts($doc->lines->pluck('product_id')->all());

            $loss = 0.0;
            foreach ($doc->lines as $line) {
                $product = $products[$line->product_id];
                $sent = (float) $line->quantity;
                $got = array_key_exists($line->id, $received) ? Money::qty($received[$line->id]) : $sent;
                if ($got < 0 || $got - $sent > 0.0001) {
                    throw BusinessException::make(__('erp.received_exceeds_sent', ['product' => $product->name]), 'received_exceeds');
                }
                $factor = (float) $line->factor;
                $serials = array_map(fn ($number) => mb_strtoupper(trim($number)), $line->serial_numbers ?? []);
                $arrived = $receivedSerials[$line->id] ?? ($got === $sent ? $serials : []);
                if ($product->track_serials) {
                    $arrived = array_map(fn ($number) => mb_strtoupper(trim($number)), $arrived);
                    abort_unless(count($arrived) === (int) ($got * $factor) && ! array_diff($arrived, $serials) && count(array_unique($arrived)) === count($arrived), 422, 'Select the exact serials received.');
                }
                if ($got > 0) {
                    $this->stock->transfer($product, $transit->id, (int) $doc->to_warehouse_id, $got * $factor, $line->batch_id ?: null, $ctx + ['source_line_id' => $line->id, 'serial_numbers' => $arrived]);
                }
                $short = Money::qty($sent - $got);
                if ($short > 0) {
                    $moves = $this->stock->issue($product, $transit->id, $short * $factor, $line->batch_id ?: null, ['source_type' => 'stock_transfer_loss'] + $ctx + ['source_line_id' => $line->id, 'serial_numbers' => array_values(array_diff($serials, $arrived))], true);
                    $loss += abs(collect($moves)->sum(fn ($m) => (float) $m->total_cost));
                }
                $line->update(['received_quantity' => $got]);
            }
            $loss = Money::round($loss);
            if ($loss > 0) {
                $this->journal->post([
                    'date' => $date,
                    'description' => __('erp.je_transfer_shortage', ['number' => $doc->number]),
                    'reference' => $doc->number,
                    'source_type' => 'stock_transfer',
                    'source_id' => $doc->id,
                ], [
                    ['account' => 'inventory_adjustment', 'debit' => $loss],
                    ['account' => 'inventory', 'credit' => $loss],
                ]);
            }
            $doc->update(['status' => 'received', 'received_by' => auth()->id(), 'received_at' => now()]);
            $this->audit->record('received', $doc, $doc->number);

            return $doc->refresh()->load($this->relations());
        });
    }

    public function void(StockDocument $doc, string $reason): StockDocument
    {
        return DB::transaction(function () use ($doc, $reason) {
            $doc = StockDocument::query()->whereKey($doc->id)->lockForUpdate()->firstOrFail();
            if (! in_array($doc->type, ['adjustment', 'opening', 'count'], true) || $doc->status !== 'posted') {
                throw BusinessException::make(__('erp.only_posted_voidable'), 'not_posted');
            }
            $this->period->assertOpen($doc->date->toDateString());
            $this->stock->reverseSource('stock_'.$doc->type, $doc->id, ['date' => $doc->date->toDateString(), 'source_type' => 'stock_'.$doc->type.'_void', 'source_id' => $doc->id, 'reference' => $doc->number]);
            if ($doc->journal_entry_id) {
                $this->journal->reverse(JournalEntry::query()->findOrFail($doc->journal_entry_id), null, $reason);
            }
            $doc->update(['status' => 'cancelled', 'notes' => trim(($doc->notes ?? '')."\n".__('erp.voided').': '.$reason)]);
            $this->audit->record('voided', $doc, $reason);

            return $doc->refresh()->load($this->relations());
        });
    }

    public function cancel(StockDocument $doc): StockDocument
    {
        if (! in_array($doc->status, ['draft', 'in_progress'], true)) {
            throw BusinessException::make(__('erp.transition_not_allowed'), 'transition_not_allowed');
        }
        $doc->update(['status' => 'cancelled']);

        return $doc->refresh()->load($this->relations());
    }

    private function postAdjustment(StockDocument $doc, array $products, array $ctx): void
    {
        $in = 0.0;
        $out = 0.0;
        foreach ($doc->lines as $line) {
            $product = $products[$line->product_id];
            $baseQty = (float) $line->quantity * (float) $line->factor;
            if ($line->direction === 'in' || $doc->type === 'opening') {
                $batchId = $line->batch_id ?: $this->stock->batch($product, $line->batch_no, $line->expiry_date?->toDateString());
                $unitCost = (float) $line->unit_cost > 0 ? (float) $line->unit_cost : (float) $product->avg_cost;
                $move = $this->stock->receive($product, (int) $doc->warehouse_id, $baseQty, $unitCost, $batchId, $ctx + ['source_line_id' => $line->id, 'serial_numbers' => $line->serial_numbers ?? []]);
                $value = Money::round((float) $move->total_cost);
                $line->update(['batch_id' => $batchId, 'unit_cost' => $unitCost, 'total_cost' => $value]);
                $in += $value;
            } else {
                $moves = $this->stock->issue($product, (int) $doc->warehouse_id, $baseQty, $line->batch_id ?: null, $ctx + ['source_line_id' => $line->id, 'serial_numbers' => $line->serial_numbers ?? []]);
                $value = Money::round(abs(collect($moves)->sum(fn ($m) => (float) $m->total_cost)));
                $line->update(['unit_cost' => $baseQty > 0 ? round($value / $baseQty, 4) : 0, 'total_cost' => $value]);
                $out += $value;
            }
        }
        $in = Money::round($in);
        $out = Money::round($out);
        $counter = $doc->type === 'opening' ? 'opening_equity' : 'inventory_adjustment';
        $description = $doc->type === 'opening'
            ? __('erp.je_opening_stock', ['number' => $doc->number])
            : __('erp.je_stock_adjustment', ['number' => $doc->number, 'reason' => __('erp.reason_'.$doc->reason)]);
        $entry = $this->journal->post(['date' => $ctx['date'], 'description' => $description, 'reference' => $doc->number, 'source_type' => 'stock_'.$doc->type, 'source_id' => $doc->id, 'branch_id' => $doc->branch_id], [
            ['account' => 'inventory', 'debit' => $in],
            ['account' => $counter, 'credit' => $in],
            ['account' => $counter, 'debit' => $out],
            ['account' => 'inventory', 'credit' => $out],
        ]);
        $doc->update(['status' => 'posted', 'total_cost' => Money::round($in - $out), 'journal_entry_id' => $entry?->id, 'posted_by' => auth()->id(), 'posted_at' => now()]);
    }

    private function postCount(StockDocument $doc, array $products, array $ctx): void
    {
        $gain = 0.0;
        $loss = 0.0;
        foreach ($doc->lines as $line) {
            if ($line->counted_quantity === null) {
                continue; // not counted: left as is
            }
            $product = $products[$line->product_id];
            $current = $this->stock->onHand($product->id, (int) $doc->warehouse_id, (int) $line->batch_id);
            $counted = (float) $line->counted_quantity * (float) $line->factor;
            $diff = Money::qty($counted - $current);
            $line->update(['quantity' => $diff]);
            if ($diff > 0) {
                $move = $this->stock->receive($product, (int) $doc->warehouse_id, $diff, (float) $product->avg_cost, (int) $line->batch_id, $ctx + ['source_line_id' => $line->id, 'serial_numbers' => $line->serial_numbers ?? []]);
                $value = Money::round((float) $move->total_cost);
                $line->update(['direction' => 'in', 'unit_cost' => $product->avg_cost, 'total_cost' => $value]);
                $gain += $value;
            } elseif ($diff < 0) {
                $moves = $this->stock->issue($product, (int) $doc->warehouse_id, abs($diff), (int) $line->batch_id ?: null, $ctx + ['source_line_id' => $line->id, 'serial_numbers' => $line->serial_numbers ?? []]);
                $value = Money::round(abs(collect($moves)->sum(fn ($m) => (float) $m->total_cost)));
                $line->update(['direction' => 'out', 'total_cost' => $value]);
                $loss += $value;
            }
        }
        $entry = $this->journal->post(['date' => $ctx['date'], 'description' => __('erp.je_stock_count', ['number' => $doc->number]), 'reference' => $doc->number, 'source_type' => 'stock_count', 'source_id' => $doc->id, 'branch_id' => $doc->branch_id], [
            ['account' => 'inventory', 'debit' => Money::round($gain)],
            ['account' => 'inventory_adjustment', 'credit' => Money::round($gain)],
            ['account' => 'inventory_adjustment', 'debit' => Money::round($loss)],
            ['account' => 'inventory', 'credit' => Money::round($loss)],
        ]);
        $doc->update(['status' => 'posted', 'total_cost' => Money::round($gain - $loss), 'journal_entry_id' => $entry?->id, 'posted_by' => auth()->id(), 'posted_at' => now()]);
    }

    private function sendTransfer(StockDocument $doc, array $products, array $ctx, bool $direct): void
    {
        $target = $direct ? (int) $doc->to_warehouse_id : $this->transitWarehouse()->id;
        $value = 0.0;
        foreach ($doc->lines as $line) {
            $product = $products[$line->product_id];
            [$out] = $this->stock->transfer($product, (int) $doc->warehouse_id, $target, (float) $line->quantity * (float) $line->factor, $line->batch_id ?: null, $ctx + ['source_line_id' => $line->id, 'serial_numbers' => $line->serial_numbers ?? []]);
            $cost = Money::round(abs(collect($out)->sum(fn ($m) => (float) $m->total_cost)));
            $line->update(['total_cost' => $cost, 'unit_cost' => (float) $product->avg_cost, 'batch_id' => count($out) === 1 ? (int) $out[0]->batch_id : $line->batch_id]);
            if ($direct) {
                $line->update(['received_quantity' => $line->quantity]);
            }
            $value += $cost;
        }
        $doc->update([
            'status' => $direct ? 'received' : 'in_transit',
            'total_cost' => Money::round($value),
            'posted_by' => auth()->id(),
            'posted_at' => now(),
            'received_by' => $direct ? auth()->id() : null,
            'received_at' => $direct ? now() : null,
        ]);
    }

    private function transitWarehouse(): Warehouse
    {
        return Warehouse::query()->where('is_transit', true)->first()
            ?? Warehouse::query()->create(['code' => 'TRANSIT', 'name' => 'بضاعة بالطريق', 'name_en' => 'Goods in transit', 'is_transit' => true]);
    }
}
