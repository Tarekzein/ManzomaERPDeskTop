<?php

namespace Tests\Feature;

use App\Modules\Core\Services\SettingsService;
use App\Modules\Inventory\Models\Warehouse;
use App\Modules\Inventory\Services\StockDocumentService;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use App\Support\BusinessException;
use Tests\TestCase;

class InventoryTest extends TestCase
{
    public function test_fefo_picks_the_batch_that_expires_first(): void
    {
        $product = $this->product(['track_batches' => true]);
        $this->stockIn($product, 10, 20, 'LATE', now()->addDays(300)->toDateString());
        $this->stockIn($product, 5, 20, 'SOON', now()->addDays(10)->toDateString());
        $invoice = app(TradingPoster::class)->post(app(TradingService::class)->save('sales_invoice', ['party_id' => $this->customer()->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 7, 'unit_price' => 30]]]));
        $soon = $product->batches()->where('batch_no', 'SOON')->first();
        $late = $product->batches()->where('batch_no', 'LATE')->first();
        $this->assertEquals(0, app(\App\Modules\Inventory\Services\StockService::class)->onHand($product->id, $this->warehouse->id, $soon->id));
        $this->assertEquals(8, app(\App\Modules\Inventory\Services\StockService::class)->onHand($product->id, $this->warehouse->id, $late->id));
        $this->assertSame('posted', $invoice->status);
    }

    public function test_nobody_sells_stock_that_is_not_there_unless_allowed(): void
    {
        $product = $this->product();
        $this->stockIn($product, 3, 20);
        $sell = fn () => app(TradingPoster::class)->post(app(TradingService::class)->save('sales_invoice', ['party_id' => $this->customer()->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 5, 'unit_price' => 30]]]));

        // Even the administrator is stopped: the admin gate does not grant this.
        try {
            $sell();
            $this->fail('Selling more than on hand should be refused.');
        } catch (BusinessException $e) {
            $this->assertSame(3.0, $this->onHand($product));
        }

        // The company can allow it explicitly.
        app(SettingsService::class)->set('inventory.allow_negative', true);
        $this->assertSame('posted', $sell()->status);
        $this->assertSame(-2.0, $this->onHand($product));
        $this->assertBooksBalanced();
    }

    public function test_two_step_transfer_with_shortage(): void
    {
        $product = $this->product();
        $this->stockIn($product, 50, 10);
        $alex = Warehouse::query()->create(['code' => 'W2', 'name' => 'مخزن 2']);
        $svc = app(StockDocumentService::class);
        $doc = $svc->post($svc->save('transfer', ['date' => now()->toDateString(), 'warehouse_id' => $this->warehouse->id, 'to_warehouse_id' => $alex->id, 'lines' => [['product_id' => $product->id, 'quantity' => 20]]]));
        $this->assertSame('in_transit', $doc->status);
        $this->assertEquals(30, $this->onHand($product));
        $this->assertEquals(0, $this->onHand($product, $alex->id));

        $doc = $svc->receiveTransfer($doc, [$doc->lines->first()->id => 18]);
        $this->assertSame('received', $doc->status);
        $this->assertEquals(18, $this->onHand($product, $alex->id));
        $this->assertEquals(20, $this->balance('inventory_adjustment')); // 2 × 10 lost
        $this->assertBooksBalanced();
    }

    public function test_stock_count_posts_the_difference(): void
    {
        $product = $this->product();
        $other = $this->product();
        $this->stockIn($product, 40, 5);
        $this->stockIn($other, 10, 7);
        $svc = app(StockDocumentService::class);
        $count = $svc->startCount($svc->save('count', ['date' => now()->toDateString(), 'warehouse_id' => $this->warehouse->id, 'lines' => []]));
        $this->assertSame('in_progress', $count->status);
        foreach ($count->lines as $line) {
            $line->update(['counted_quantity' => $line->product_id === $product->id ? 37 : 12]);
        }
        $svc->post($count->refresh());
        $this->assertEquals(37, $this->onHand($product));
        $this->assertEquals(12, $this->onHand($other));
        $this->assertEquals(15 - 14, $this->balance('inventory_adjustment')); // −3×5 loss, +2×7 gain
        $this->assertBooksBalanced();
    }

    public function test_adjustment_needs_a_reason_and_posts_to_the_ledger(): void
    {
        $product = $this->product();
        $this->stockIn($product, 10, 12);
        $svc = app(StockDocumentService::class);
        try {
            $svc->save('adjustment', ['date' => now()->toDateString(), 'warehouse_id' => $this->warehouse->id, 'lines' => [['product_id' => $product->id, 'quantity' => 1, 'direction' => 'out']]]);
            $this->fail('Reason required');
        } catch (BusinessException $e) {
            $this->assertSame('reason_required', $e->errorCode);
        }
        $svc->post($svc->save('adjustment', ['date' => now()->toDateString(), 'warehouse_id' => $this->warehouse->id, 'reason' => 'damage', 'lines' => [['product_id' => $product->id, 'quantity' => 2, 'direction' => 'out']]]));
        $this->assertEquals(8, $this->onHand($product));
        $this->assertEquals(24, $this->balance('inventory_adjustment'));
        $this->assertBooksBalanced();
    }

    public function test_fifo_costing(): void
    {
        app(SettingsService::class)->set('accounting.costing_method', 'fifo');
        $product = $this->product();
        $this->stockIn($product, 10, 10);
        $this->stockIn($product, 10, 20);
        $invoice = app(TradingPoster::class)->post(app(TradingService::class)->save('sales_invoice', ['party_id' => $this->customer()->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 15, 'unit_price' => 30]]]));
        $this->assertEquals(10 * 10 + 5 * 20, (float) $invoice->cost_total);
        $this->assertBooksBalanced();
    }
}
