<?php

namespace Tests\Feature;

use App\Modules\Finance\Models\TaxRate;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use App\Support\BusinessException;
use Tests\TestCase;

class SalesFlowTest extends TestCase
{
    private function trading(): TradingService
    {
        return app(TradingService::class);
    }

    private function poster(): TradingPoster
    {
        return app(TradingPoster::class);
    }

    public function test_sales_invoice_moves_stock_and_posts_revenue_vat_and_cost(): void
    {
        $vat = TaxRate::query()->where('is_default', true)->first();
        $product = $this->product(['tax_rate_id' => $vat->id], [12]);
        $this->stockIn($product, 100, 60);
        $customer = $this->customer();
        $carton = $product->units->firstWhere('factor', 12);

        $invoice = $this->trading()->save('sales_invoice', ['party_id' => $customer->id, 'date' => now()->toDateString(), 'lines' => [
            ['product_id' => $product->id, 'product_unit_id' => $carton->id, 'quantity' => 2, 'unit_price' => 1100, 'discount_percent' => 10],
        ]]);
        $this->assertSame('draft', $invoice->status);
        $this->assertStringStartsWith('D-', $invoice->number);
        // 2 cartons × 1100 = 2200, 10% off = 1980, VAT 14% = 277.20
        $this->assertEquals(2200, (float) $invoice->gross_total);
        $this->assertEquals(220, (float) $invoice->discount_total);
        $this->assertEquals(1980, (float) $invoice->net_total);
        $this->assertEquals(277.2, (float) $invoice->tax_total);
        $this->assertEquals(2257.2, (float) $invoice->total);

        $posted = $this->poster()->post($invoice, ['payment' => ['amount' => 1000, 'cash_account_id' => $this->cash->id]]);
        $this->assertSame('posted', $posted->status);
        $this->assertStringStartsWith('SI-'.now()->year, $posted->number);
        $this->assertEquals(76, $this->onHand($product)); // 100 − 24 pieces
        $this->assertEquals(1440, (float) $posted->cost_total);   // 24 × 60
        $this->assertEquals(1000, (float) $posted->paid_amount);
        $this->assertSame('partial', $posted->payment_status);
        $this->assertEquals(1257.2, $this->balance('ar', $customer->id));
        $this->assertEquals(-277.2, $this->balance('vat_output'));
        $this->assertEquals(1440, $this->balance('cogs'));
        $this->assertEquals(1000, $this->balance('cash_group') + app(\App\Modules\Finance\Services\JournalService::class)->balance($this->cash->account_id));
        $this->assertBooksBalanced();
    }

    public function test_tax_inclusive_prices_charge_exactly_quantity_times_price(): void
    {
        $vat = TaxRate::query()->where('is_default', true)->first();
        $product = $this->product(['tax_rate_id' => $vat->id]);
        $this->stockIn($product, 10, 50);
        $invoice = $this->trading()->save('sales_invoice', ['party_id' => $this->customer()->id, 'date' => now()->toDateString(), 'price_includes_tax' => true, 'lines' => [
            ['product_id' => $product->id, 'quantity' => 3, 'unit_price' => 99.99],
        ]]);
        $this->assertEquals(299.97, (float) $invoice->total);
        $this->assertEquals(round(299.97 / 1.14, 2), (float) $invoice->net_total);
        $this->poster()->post($invoice, ['payment' => ['amount' => 299.97, 'cash_account_id' => $this->cash->id]]);
        $this->assertBooksBalanced();
    }

    public function test_quotation_to_order_to_partial_invoice_tracks_remaining_quantity(): void
    {
        $product = $this->product();
        $this->stockIn($product, 50, 40);
        $customer = $this->customer();
        $quote = $this->trading()->save('sales_quotation', ['party_id' => $customer->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 20, 'unit_price' => 90]]]);
        $order = $this->trading()->convert($quote, 'sales_order');
        $this->assertSame('accepted', $quote->refresh()->status);
        $this->trading()->transition($order, 'confirm');

        $line = $order->refresh()->lines->first();
        $invoice = $this->trading()->convert($order, 'sales_invoice', ['lines' => [['product_id' => $product->id, 'quantity' => 8, 'unit_price' => 90, 'source_line_id' => $line->id]]]);
        $this->poster()->post($invoice);
        $this->assertSame('partially_invoiced', $order->refresh()->status);
        $this->assertEquals(12, $order->lines->first()->remainingQuantity());

        // The rest, then nothing is left.
        $second = $this->trading()->convert($order->refresh(), 'sales_invoice');
        $this->assertEquals(12, (float) $second->lines->first()->quantity);
        $this->poster()->post($second);
        $this->assertSame('invoiced', $order->refresh()->status);

        $this->expectException(BusinessException::class);
        $this->trading()->convert($order->refresh(), 'sales_invoice');
    }

    public function test_sales_return_restocks_at_original_cost_and_settles_the_invoice(): void
    {
        $product = $this->product();
        $this->stockIn($product, 10, 30);
        $customer = $this->customer();
        $invoice = $this->poster()->post($this->trading()->save('sales_invoice', ['party_id' => $customer->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 5, 'unit_price' => 80]]]));
        // Cost changes after the sale; the return must still come back at 30.
        $this->stockIn($product, 10, 50);

        $line = $invoice->lines->first();
        $return = $this->trading()->convert($invoice, 'sales_return', ['lines' => [['product_id' => $product->id, 'quantity' => 2, 'source_line_id' => $line->id]]]);
        $this->assertEquals(160, (float) $return->net_total);
        $return = $this->poster()->post($return);
        $this->assertEquals(60, (float) $return->cost_total);
        $this->assertEquals(17, $this->onHand($product));
        $this->assertEquals(160, (float) $invoice->refresh()->paid_amount);
        $this->assertEquals(240, $this->balance('ar', $customer->id));

        // Cannot return more than was sold.
        $this->expectException(BusinessException::class);
        $this->poster()->post($this->trading()->convert($invoice->refresh(), 'sales_return', ['lines' => [['product_id' => $product->id, 'quantity' => 4, 'source_line_id' => $line->id]]]));
    }

    public function test_void_reverses_stock_and_journal(): void
    {
        $product = $this->product();
        $this->stockIn($product, 10, 30);
        $invoice = $this->poster()->post($this->trading()->save('sales_invoice', ['party_id' => $this->customer()->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 4, 'unit_price' => 80]]]));
        $this->assertEquals(6, $this->onHand($product));
        $void = $this->poster()->void($invoice, 'خطأ في الإدخال');
        $this->assertSame('void', $void->status);
        $this->assertEquals(10, $this->onHand($product));
        $this->assertEquals(0, $this->balance('ar'));
        $this->assertBooksBalanced();
    }

    public function test_paid_invoice_cannot_be_voided_until_payment_is_voided(): void
    {
        $product = $this->product();
        $this->stockIn($product, 10, 30);
        $invoice = $this->poster()->post($this->trading()->save('sales_invoice', ['party_id' => $this->customer()->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 80]]]), ['payment' => ['amount' => 80, 'cash_account_id' => $this->cash->id]]);
        try {
            $this->poster()->void($invoice, 'x');
            $this->fail('Expected void to be refused');
        } catch (BusinessException $e) {
            $this->assertSame('has_payments', $e->errorCode);
        }
    }

    public function test_insufficient_stock_is_refused(): void
    {
        $product = $this->product();
        $this->stockIn($product, 3, 30);
        $invoice = $this->trading()->save('sales_invoice', ['party_id' => $this->customer()->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 5, 'unit_price' => 80]]]);
        $this->asUserWithRole('cashier');
        try {
            $this->poster()->post($invoice);
            $this->fail('Expected insufficient stock');
        } catch (BusinessException $e) {
            $this->assertSame('insufficient_stock', $e->errorCode);
        }
        $this->assertEquals(3, $this->onHand($product));
    }

    public function test_withholding_tax_reduces_the_receivable(): void
    {
        $product = $this->product();
        $this->stockIn($product, 10, 30);
        $customer = $this->customer(['subject_to_wht' => true, 'wht_rate' => 1]);
        $invoice = $this->poster()->post($this->trading()->save('sales_invoice', ['party_id' => $customer->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 10, 'unit_price' => 100]]]));
        $this->assertEquals(10, (float) $invoice->wht_amount);
        $this->assertEquals(990, (float) $invoice->balance_due);
        $this->assertEquals(990, $this->balance('ar', $customer->id));
        $this->assertEquals(10, $this->balance('wht_receivable'));
        $this->assertBooksBalanced();
    }
}
