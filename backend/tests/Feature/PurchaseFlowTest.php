<?php

namespace Tests\Feature;

use App\Modules\Finance\Models\TaxRate;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use Tests\TestCase;

class PurchaseFlowTest extends TestCase
{
    public function test_order_receipt_and_bill_clear_grni_and_book_price_variance(): void
    {
        $vat = TaxRate::query()->where('is_default', true)->first();
        $product = $this->product(['tax_rate_id' => $vat->id]);
        $supplier = $this->supplier();
        $trading = app(TradingService::class);
        $poster = app(TradingPoster::class);

        $po = $trading->save('purchase_order', ['party_id' => $supplier->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 100, 'unit_price' => 50]]]);
        $trading->transition($po, 'confirm');
        $receipt = $trading->convert($po->refresh(), 'purchase_receipt', ['lines' => [['product_id' => $product->id, 'quantity' => 60, 'unit_price' => 50, 'source_line_id' => $po->lines->first()->id]]]);
        $poster->post($receipt);
        $this->assertSame('partially_received', $po->refresh()->status);
        $this->assertEquals(60, $this->onHand($product));
        $this->assertEquals(3000, $this->balance('inventory'));
        $this->assertEquals(-3000, $this->balance('grni'));
        $this->assertEquals(50, (float) $product->refresh()->avg_cost);

        // The supplier bills at 52: 120 more than received value.
        $bill = $trading->convert($receipt->refresh(), 'purchase_invoice');
        $bill->lines->first()->update(['unit_price' => 52]);
        $bill = $trading->save('purchase_invoice', ['party_id' => $supplier->id, 'date' => now()->toDateString(), 'source_id' => $receipt->id, 'lines' => [['product_id' => $product->id, 'quantity' => 60, 'unit_price' => 52, 'tax_rate_id' => $vat->id, 'source_line_id' => $receipt->lines->first()->id]]], $bill);
        $poster->post($bill);
        $this->assertEquals(0, $this->balance('grni'));
        $this->assertEquals(120, $this->balance('price_variance'));
        $this->assertEquals(round(3120 * 0.14, 2), $this->balance('vat_input'));
        $this->assertEquals(-round(3120 * 1.14, 2), $this->balance('ap', $supplier->id));
        $this->assertBooksBalanced();
    }

    public function test_direct_purchase_invoice_updates_moving_average_and_creates_batches(): void
    {
        $product = $this->product(['track_batches' => true]);
        $supplier = $this->supplier();
        $this->stockIn($product, 10, 40, 'B-OLD', now()->addDays(30)->toDateString());
        $bill = app(TradingService::class)->save('purchase_invoice', ['party_id' => $supplier->id, 'date' => now()->toDateString(), 'lines' => [
            ['product_id' => $product->id, 'quantity' => 30, 'unit_price' => 48, 'batch_no' => 'B-NEW', 'expiry_date' => now()->addDays(200)->toDateString()],
        ]]);
        app(TradingPoster::class)->post($bill);
        // (10×40 + 30×48) / 40 = 46
        $this->assertEquals(46, (float) $product->refresh()->avg_cost);
        $this->assertEquals(2, $product->batches()->count());
        $this->assertBooksBalanced();
    }

    public function test_purchase_return_reduces_payable_and_stock(): void
    {
        $product = $this->product();
        $supplier = $this->supplier();
        $bill = app(TradingPoster::class)->post(app(TradingService::class)->save('purchase_invoice', ['party_id' => $supplier->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 20, 'unit_price' => 25]]]));
        $return = app(TradingService::class)->convert($bill, 'purchase_return', ['lines' => [['product_id' => $product->id, 'quantity' => 4, 'source_line_id' => $bill->lines->first()->id]]]);
        app(TradingPoster::class)->post($return);
        $this->assertEquals(16, $this->onHand($product));
        $this->assertEquals(-400, $this->balance('ap', $supplier->id));
        $this->assertEquals(100, (float) $bill->refresh()->paid_amount);
        $this->assertBooksBalanced();
    }
}
