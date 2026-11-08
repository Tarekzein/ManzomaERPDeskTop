<?php

namespace Tests\Feature;

use App\Modules\Core\Services\SettingsService;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\StockMove;
use App\Modules\Inventory\Services\SparePartsService;
use App\Modules\Service\Models\ServiceRequest;
use App\Modules\Service\Models\ServiceVisit;
use App\Modules\Service\Services\ServiceReports;
use App\Modules\Service\Services\VisitService;
use App\Modules\Trading\Models\TradeDocument;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use App\Support\BusinessException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class SparePartsTest extends TestCase
{
    private function recipe(Product $parent, Product $part, float $quantity = 5): void
    {
        DB::transaction(fn () => app(SparePartsService::class)->configure($parent, ['uses_spare_parts' => true, 'spare_parts' => [['product_id' => $part->id, 'quantity_per_unit' => $quantity]]]));
    }

    private function draft(Product $product, float $quantity = 2, array $extra = []): TradeDocument
    {
        return app(TradingService::class)->save('sales_invoice', $extra + ['party_id' => $this->customer()->id, 'warehouse_id' => $this->warehouse->id,
            'lines' => [['product_id' => $product->id, 'quantity' => $quantity, 'unit_price' => 100]]]);
    }

    private function returnQty(TradeDocument $invoice, float $quantity): TradeDocument
    {
        return app(TradingPoster::class)->post(app(TradingService::class)->convert($invoice->refresh(), 'sales_return', ['lines' => [
            ['product_id' => $invoice->lines->first()->product_id, 'quantity' => $quantity, 'source_line_id' => $invoice->lines->first()->id],
        ]]));
    }

    private function token(): string
    {
        return $this->admin->createToken('spare-parts-test')->plainTextToken;
    }

    public function test_sale_records_parent_and_parts_cost_and_void_restores_both(): void
    {
        $parent = $this->product();
        $part = $this->product();
        $this->stockIn($parent, 10, 30);
        $this->stockIn($part, 100, 2);
        $this->recipe($parent, $part);
        $this->withToken($this->token())->getJson('/api/products/'.$parent->id.'/price?warehouse_id='.$this->warehouse->id)->assertOk()->assertJsonPath('data.estimated_sale_cost', 40);
        $draft = $this->draft($parent);
        $this->assertSame(100.0, $this->onHand($part));
        $invoice = app(TradingPoster::class)->post($draft);
        $this->assertSame(8.0, $this->onHand($parent));
        $this->assertSame(90.0, $this->onHand($part));
        $this->assertEquals(80, $invoice->cost_total);
        $this->assertEquals(30, $invoice->lines->first()->unit_cost);
        $this->assertEquals(20, $invoice->lines->first()->component_cost_amount);
        $this->assertEquals(10, $invoice->lines->first()->components->first()->quantity);
        $this->assertBooksBalanced();
        try {
            app(TradingPoster::class)->post($invoice);
            $this->fail('Repeated posting must fail');
        } catch (BusinessException $e) {
            $this->assertSame('not_draft', $e->errorCode);
        }
        app(TradingPoster::class)->void($invoice, 'test reversal');
        $this->assertSame(10.0, $this->onHand($parent));
        $this->assertSame(100.0, $this->onHand($part));
        $this->assertBooksBalanced();
    }

    public function test_shortage_rolls_back_parent_moves_snapshots_and_accounting(): void
    {
        $parent = $this->product();
        $part = $this->product();
        $this->stockIn($parent, 10, 30);
        $this->stockIn($part, 4, 2);
        $this->recipe($parent, $part);
        $draft = $this->draft($parent);
        $moves = StockMove::query()->count();
        try {
            app(TradingPoster::class)->post($draft);
            $this->fail('Expected shortage');
        } catch (BusinessException $e) {
            $this->assertSame('insufficient_stock', $e->errorCode);
            $this->assertEquals($part->id, $e->context['product_id']);
        }
        $this->assertSame(10.0, $this->onHand($parent));
        $this->assertSame(4.0, $this->onHand($part));
        $this->assertSame($moves, StockMove::query()->count());
        $this->assertDatabaseCount('trade_line_components', 0);
        $this->assertSame('draft', $draft->refresh()->status);
        $this->assertBooksBalanced();
        app(SettingsService::class)->set('inventory.allow_negative', true);
        app(TradingPoster::class)->post($draft);
        $this->assertSame(-6.0, $this->onHand($part));
        $this->assertBooksBalanced();
    }

    public function test_batches_returns_use_original_recipe_and_voided_returns_do_not_count(): void
    {
        $parent = $this->product();
        $part = $this->product(['track_batches' => true]);
        $this->stockIn($parent, 10, 30);
        $this->stockIn($part, 3, 0.3333, 'SOON', now()->addDays(10)->toDateString());
        $this->stockIn($part, 10, 0.7777, 'LATER', now()->addDays(100)->toDateString());
        $this->recipe($parent, $part, 2.3333);
        $invoice = app(TradingPoster::class)->post($this->draft($parent, 3));
        $this->assertCount(2, $invoice->lines->first()->components);
        $this->assertEquals(6.9999, $invoice->lines->first()->components->sum('quantity'));
        app(SparePartsService::class)->configure($parent, ['uses_spare_parts' => false]);
        $first = $this->returnQty($invoice, 1);
        $this->assertEquals(2.3333, $first->lines->first()->components->sum('quantity'));
        app(TradingPoster::class)->void($first, 'replace return');
        $a = $this->returnQty($invoice, 1);
        $b = $this->returnQty($invoice, 1);
        $c = $this->returnQty($invoice, 1);
        $this->assertEquals(13, $this->onHand($part));
        $this->assertEquals(10, $this->onHand($parent));
        $this->assertEqualsWithDelta((float) $invoice->cost_total, (float) $a->cost_total + (float) $b->cost_total + (float) $c->cost_total, 0.001);
        $this->assertBooksBalanced();
    }

    public function test_order_and_carton_conversion_consume_only_invoiced_base_units(): void
    {
        $parent = $this->product([], [12]);
        $part = $this->product();
        $this->stockIn($parent, 100, 10);
        $this->stockIn($part, 1000, 1);
        $this->recipe($parent, $part);
        $service = app(TradingService::class);
        $order = $service->save('sales_order', ['party_id' => $this->customer()->id, 'lines' => [['product_id' => $parent->id,
            'product_unit_id' => $parent->units->firstWhere('factor', 12)->id, 'quantity' => 2, 'unit_price' => 1200]]]);
        $service->transition($order, 'confirm');
        $this->assertEquals(1000, $this->onHand($part));
        $invoice = $service->convert($order->refresh(), 'sales_invoice', ['lines' => [['product_id' => $parent->id,
            'product_unit_id' => $parent->units->firstWhere('factor', 12)->id, 'quantity' => 1, 'unit_price' => 1200, 'source_line_id' => $order->lines->first()->id]]]);
        app(TradingPoster::class)->post($invoice);
        $this->assertEquals(88, $this->onHand($parent));
        $this->assertEquals(940, $this->onHand($part));
        app(TradingPoster::class)->post($service->convert($order->refresh(), 'sales_invoice'));
        $this->assertEquals(880, $this->onHand($part));
        $this->assertBooksBalanced();
    }

    public function test_shared_parts_multiple_lines_and_fractional_requirements(): void
    {
        $a = $this->product();
        $b = $this->product();
        $part = $this->product();
        $other = $this->product();
        foreach ([$a, $b, $part, $other] as $p) {
            $this->stockIn($p, 100, 2);
        }
        $this->recipe($a, $part, 0.25);
        $this->recipe($b, $part, 2);
        app(SparePartsService::class)->configure($a, ['spare_parts' => [['product_id' => $part->id, 'quantity_per_unit' => 0.25], ['product_id' => $other->id, 'quantity_per_unit' => 1]]]);
        $invoice = app(TradingPoster::class)->post($this->draft($a, 1, ['lines' => [
            ['product_id' => $a->id, 'quantity' => 2, 'unit_price' => 100], ['product_id' => $b->id, 'quantity' => 3, 'unit_price' => 100],
        ]]));
        $this->assertEquals(93.5, $this->onHand($part));
        $this->assertEquals(98, $this->onHand($other));
        $this->assertEquals(27, $invoice->cost_total);
        $this->assertBooksBalanced();
    }

    public function test_product_api_creates_initial_stock_atomically_and_omitted_recipe_is_preserved(): void
    {
        $part = $this->product();
        $token = $this->token();
        $body = ['name' => 'New assembly', 'type' => 'stock', 'base_unit_id' => $part->base_unit_id, 'uses_spare_parts' => true,
            'spare_parts' => [['product_id' => $part->id, 'quantity_per_unit' => 5]],
            'initial_stock' => ['quantity' => 10, 'unit_cost' => 30, 'warehouse_id' => $this->warehouse->id]];
        $r = $this->withToken($token)->postJson('/api/products', $body)->assertCreated()->assertJsonPath('data.on_hand', 10);
        $id = $r->json('data.id');
        $this->assertBooksBalanced();
        unset($body['initial_stock'], $body['uses_spare_parts'], $body['spare_parts']);
        $this->withToken($token)->putJson('/api/products/'.$id, $body)->assertOk()->assertJsonPath('data.uses_spare_parts', true)->assertJsonCount(1, 'data.spare_parts');
        $count = Product::query()->count();
        $this->withToken($token)->postJson('/api/products', array_replace($body, ['track_batches' => true, 'initial_stock' => ['quantity' => 5, 'warehouse_id' => $this->warehouse->id]]))->assertUnprocessable();
        $this->assertSame($count, Product::query()->count());
        $this->withToken($token)->putJson('/api/products/'.$id, $body + ['initial_stock' => ['quantity' => 1]])->assertUnprocessable();
    }

    public function test_zero_and_empty_initial_quantity_create_no_moves_and_serial_stock_is_supported(): void
    {
        $part = $this->product();
        $token = $this->token();
        $moves = StockMove::query()->count();
        $base = ['name' => 'Empty item', 'type' => 'stock', 'base_unit_id' => $part->base_unit_id];
        foreach ([0, '', null] as $zero) {
            $this->withToken($token)->postJson('/api/products', $base + ['initial_stock' => ['quantity' => $zero]])->assertCreated();
        }
        $this->assertSame($moves, StockMove::query()->count());
        $this->withToken($token)->postJson('/api/products', $base + ['track_serials' => true, 'initial_stock' => [
            'quantity' => 2, 'unit_cost' => 10, 'warehouse_id' => $this->warehouse->id, 'serial_numbers' => ['SN-1', 'SN-2'],
        ]])->assertCreated()->assertJsonPath('data.on_hand', 2);
        $this->assertDatabaseCount('product_serials', 2);
        $this->assertBooksBalanced();
    }

    public function test_invalid_recipes_and_referenced_item_edits_are_rejected_including_csv(): void
    {
        $a = $this->product();
        $part = $this->product();
        $serial = $this->product(['track_serials' => true]);
        $service = $this->product(['type' => 'service']);
        $token = $this->token();
        $body = ['name' => $a->name, 'type' => 'stock', 'base_unit_id' => $a->base_unit_id, 'uses_spare_parts' => true];
        foreach ([[], [['product_id' => $a->id, 'quantity_per_unit' => 1]], [['product_id' => $serial->id, 'quantity_per_unit' => 1]], [['product_id' => $service->id, 'quantity_per_unit' => 1]], [['product_id' => $part->id, 'quantity_per_unit' => 0]], [['product_id' => $part->id, 'quantity_per_unit' => 1], ['product_id' => $part->id, 'quantity_per_unit' => 2]]] as $rows) {
            $this->withToken($token)->putJson('/api/products/'.$a->id, $body + ['spare_parts' => $rows])->assertUnprocessable();
        }
        $this->recipe($a, $part);
        $this->withToken($token)->deleteJson('/api/products/'.$part->id)->assertUnprocessable();
        $this->withToken($token)->putJson('/api/products/'.$part->id, ['name' => $part->name, 'type' => 'service', 'base_unit_id' => $part->base_unit_id])->assertUnprocessable();
        $this->withToken($token)->postJson('/api/import/products', ['rows' => [['code' => $part->code, 'name' => $part->name, 'type' => 'service']]])->assertOk()->assertJsonCount(1, 'errors');
        $this->assertSame('stock', $part->refresh()->type);
    }

    public function test_service_fulfillment_only_consumes_components_on_invoice_and_reports_additional_cost(): void
    {
        $parent = $this->product();
        $part = $this->product();
        $customer = $this->customer();
        $this->stockIn($parent, 10, 30);
        $this->stockIn($part, 100, 2);
        $this->recipe($parent, $part);
        $request = ServiceRequest::query()->create(['party_id' => $customer->id, 'description' => 'Repair']);
        $visit = ServiceVisit::query()->create(['request_id' => $request->id, 'technician_id' => $this->admin->id, 'warehouse_id' => $this->warehouse->id, 'status' => 'scheduled', 'report' => 'Done']);
        $visit->parts()->create(['product_id' => $parent->id, 'quantity' => 1, 'base_quantity' => 1, 'unit_price' => 100]);
        app(VisitService::class)->complete($visit, 'spare-parts-visit', now()->toDateString());
        $invoice = app(TradingPoster::class)->post(app(VisitService::class)->invoice($visit));
        $this->assertEquals(9, $this->onHand($parent));
        $this->assertEquals(95, $this->onHand($part));
        $this->assertEquals(40, $invoice->cost_total);
        $this->assertEquals(40, $this->balance('cogs'));
        $this->assertEquals(60, app(ServiceReports::class)->technicians()->first()->contribution_after_parts);
        $this->assertBooksBalanced();
    }

    public function test_fifo_costs_and_multiple_return_lines_restore_exact_component_values(): void
    {
        app(SettingsService::class)->set('accounting.costing_method', 'fifo');
        $parent = $this->product();
        $part = $this->product();
        $this->stockIn($parent, 10, 30);
        $this->stockIn($part, 4, 1);
        $this->stockIn($part, 20, 2);
        $this->recipe($parent, $part);
        $invoice = app(TradingPoster::class)->post($this->draft($parent));
        $this->assertEquals(76, $invoice->cost_total);
        $line = $invoice->lines->first();
        $return = app(TradingService::class)->convert($invoice, 'sales_return', ['lines' => [
            ['product_id' => $parent->id, 'quantity' => 1, 'source_line_id' => $line->id],
            ['product_id' => $parent->id, 'quantity' => 1, 'source_line_id' => $line->id],
        ]]);
        $return = app(TradingPoster::class)->post($return);
        $this->assertEquals(76, $return->cost_total);
        $this->assertEquals(24, $this->onHand($part));
        $this->assertBooksBalanced();
    }

    public function test_initial_stock_needs_stock_permission_and_costs_are_hidden_from_sales_users(): void
    {
        $parent = $this->product();
        $part = $this->product();
        $this->stockIn($parent, 10, 30);
        $this->stockIn($part, 100, 2);
        $this->recipe($parent, $part);
        $invoice = app(TradingPoster::class)->post($this->draft($parent));
        $user = $this->asUserWithRole('cashier');
        $user->givePermissionTo('products.manage');
        $token = $user->createToken('permissions')->plainTextToken;
        $body = ['name' => 'Restricted opening', 'type' => 'stock', 'base_unit_id' => $parent->base_unit_id];
        $count = Product::query()->count();
        $this->withToken($token)->postJson('/api/products', $body + ['initial_stock' => ['quantity' => 3, 'warehouse_id' => $this->warehouse->id]])->assertForbidden();
        $this->assertSame($count, Product::query()->count());
        $this->withToken($token)->postJson('/api/products', $body)->assertCreated();
        $response = $this->withToken($token)->getJson('/api/documents/sales_invoice/'.$invoice->id)->assertOk();
        $this->assertArrayNotHasKey('cost_amount', $response->json('data.lines.0.components.0'));
        $this->assertArrayNotHasKey('component_cost_amount', $response->json('data.lines.0'));
        $response->assertJsonPath('data.lines.0.components.0.quantity', '10.0000');
    }

    public function test_batch_initial_stock_and_deleting_an_unused_recipe_release_part_references(): void
    {
        $part = $this->product();
        $token = $this->token();
        $this->withToken($token)->postJson('/api/products', ['name' => 'Batch stock', 'type' => 'stock', 'base_unit_id' => $part->base_unit_id,
            'track_batches' => true, 'purchase_price' => 7, 'initial_stock' => ['quantity' => 3, 'warehouse_id' => $this->warehouse->id, 'batch_no' => 'OPENING-BATCH'],
        ])->assertCreated()->assertJsonPath('data.on_hand', 3)->assertJsonPath('data.avg_cost', '7.0000')->assertJsonPath('data.balances.0.batch.batch_no', 'OPENING-BATCH');
        $parent = $this->product();
        $this->recipe($parent, $part);
        $this->withToken($token)->deleteJson('/api/products/'.$parent->id)->assertOk();
        $this->assertDatabaseMissing('product_spare_parts', ['product_id' => $parent->id]);
        $this->withToken($token)->deleteJson('/api/products/'.$part->id)->assertOk();
        $this->assertBooksBalanced();
    }
}
