<?php

namespace App\Modules\Inventory\Services;

use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\ProductSerial;
use App\Modules\Inventory\Models\StockMove;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\MaintenanceEvent;
use App\Modules\Service\Services\MaintenanceService;
use Illuminate\Support\Facades\DB;

class SerialService
{
    public function record(Product $product, StockMove $move, array $context): void
    {
        if (! $product->track_serials) {
            return;
        }
        abort_if($product->track_batches, 422, 'Use serials for units and batches for consumables, separately.');
        $quantity = abs((float) $move->quantity);
        $numbers = array_map(fn ($s) => mb_strtoupper(trim((string) $s)), $context['serial_numbers'] ?? []);
        abort_unless($quantity === floor($quantity) && count($numbers) === (int) $quantity && count(array_unique($numbers)) === count($numbers), 422, 'Provide one distinct serial number per base unit.');
        foreach ($numbers as $number) {
            abort_unless($number !== '' && mb_strlen($number) <= 100, 422, 'Invalid serial number.');
            $serial = ProductSerial::query()->where('product_id', $product->id)->where('serial_number', $number)->lockForUpdate()->first();
            if ((float) $move->quantity > 0) {
                if (! $serial) {
                    $source = $context['source_type'];
                    abort_unless(in_array($source, ['purchase_invoice', 'purchase_receipt', 'stock_opening', 'stock_adjustment'], true), 422, 'Unknown serial cannot be returned or transferred.');
                    $serial = ProductSerial::query()->create(['product_id' => $product->id, 'serial_number' => $number, 'warehouse_id' => $move->warehouse_id]);
                } else {
                    abort_unless($serial->status === 'issued' && ! $serial->warehouse_id, 422, 'Serial is already in stock.');
                    $serial->update(['status' => 'available', 'warehouse_id' => $move->warehouse_id]);
                }
            } else {
                abort_unless($serial && $serial->status === 'available' && $serial->warehouse_id === $move->warehouse_id, 422, 'Serial is unavailable in this warehouse.');
                $serial->update(['status' => 'issued', 'warehouse_id' => null]);
            }
            if ((float) $move->quantity > 0 && in_array($context['source_type'], ['sales_return', 'sales_invoice'], true)) {
                $unit = CustomerUnit::query()->where('serial_id', $serial->id)->lockForUpdate()->first();
                if ($unit && ! in_array($unit->status, ['retired', 'returned'], true)) {
                    app(MaintenanceService::class)->suspend($unit, 'returned');
                    MaintenanceEvent::query()->create(['unit_id' => $unit->id, 'kind' => 'return', 'event_on' => $context['date'], 'actor_id' => auth()->id(), 'notes' => $context['source_type'].'#'.$context['source_id']]);
                }
            }
            DB::table('stock_move_serials')->insert(['stock_move_id' => $move->id, 'serial_id' => $serial->id]);
        }
    }

    public function numbers(StockMove $move): array
    {
        return DB::table('stock_move_serials')->join('product_serials', 'product_serials.id', '=', 'stock_move_serials.serial_id')->where('stock_move_id', $move->id)->pluck('serial_number')->all();
    }
}
