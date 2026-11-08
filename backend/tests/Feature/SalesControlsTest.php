<?php

namespace Tests\Feature;

use App\Modules\Core\Services\SettingsService;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use App\Support\BusinessException;
use Illuminate\Support\Facades\Auth;
use Tests\TestCase;

class SalesControlsTest extends TestCase
{
    private function invoice(int $customerId, int $productId, float $qty, float $price, array $extra = [])
    {
        return app(TradingService::class)->save('sales_invoice', $extra + ['party_id' => $customerId, 'date' => now()->toDateString(), 'lines' => [['product_id' => $productId, 'quantity' => $qty, 'unit_price' => $price] + ($extra['line'] ?? [])]]);
    }

    public function test_credit_limit_blocks_unless_a_manager_overrides(): void
    {
        $product = $this->product();
        $this->stockIn($product, 100, 10);
        $customer = $this->customer(['credit_limit' => 500]);
        $doc = $this->invoice($customer->id, $product->id, 10, 60);

        $this->asUserWithRole('cashier');
        try {
            app(TradingPoster::class)->post($doc, ['override_credit' => true]);
            $this->fail('Cashier should not override');
        } catch (BusinessException $e) {
            $this->assertSame('credit_limit_exceeded', $e->errorCode);
            $this->assertFalse($e->context['can_override']);
        }

        // Paying the excess at the counter keeps the customer within the limit.
        $ok = app(TradingPoster::class)->post($doc, ['payment' => ['amount' => 100, 'cash_account_id' => $this->cash->id]]);
        $this->assertSame('posted', $ok->status);

        $second = $this->invoice($customer->id, $product->id, 5, 60);
        $this->asUserWithRole('sales_manager');
        $this->assertSame('posted', app(TradingPoster::class)->post($second, ['override_credit' => true])->status);
    }

    public function test_overdue_invoices_block_new_credit_sales(): void
    {
        app(SettingsService::class)->set('sales.block_overdue_days', 30);
        $product = $this->product();
        $this->stockIn($product, 100, 10);
        $customer = $this->customer();
        app(TradingPoster::class)->post($this->invoice($customer->id, $product->id, 1, 50, ['date' => now()->subDays(60)->toDateString(), 'due_date' => now()->subDays(45)->toDateString()]));
        $this->expectExceptionMessage('متأخرة');
        app(TradingPoster::class)->post($this->invoice($customer->id, $product->id, 1, 50));
    }

    public function test_user_discount_limit_and_minimum_price(): void
    {
        $product = $this->product(['min_sale_price' => 80]);
        $this->stockIn($product, 100, 10);
        $customer = $this->customer();
        $this->asUserWithRole('cashier', ['max_discount_percent' => 5]);

        try {
            app(TradingPoster::class)->post($this->invoice($customer->id, $product->id, 1, 100, ['line' => ['discount_percent' => 10]]));
            $this->fail('Discount over the limit');
        } catch (BusinessException $e) {
            $this->assertSame('discount_limit', $e->errorCode);
        }
        try {
            app(TradingPoster::class)->post($this->invoice($customer->id, $product->id, 1, 75));
            $this->fail('Price under the minimum');
        } catch (BusinessException $e) {
            $this->assertSame('price_below_min', $e->errorCode);
        }
        $this->assertSame('posted', app(TradingPoster::class)->post($this->invoice($customer->id, $product->id, 1, 100, ['line' => ['discount_percent' => 5]]))->status);
    }

    public function test_salesperson_cannot_post_invoices_over_the_api(): void
    {
        $product = $this->product();
        $user = $this->asUserWithRole('salesperson');
        $customer = $this->customer();
        $token = $user->createToken('test')->plainTextToken;
        Auth::forgetGuards();

        $draft = $this->withToken($token)->postJson('/api/documents/sales_invoice', [
            'party_id' => $customer->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 50]],
        ])->assertCreated()->json('data');
        $this->withToken($token)->postJson("/api/documents/sales_invoice/{$draft['id']}/post")->assertForbidden();
    }
}
