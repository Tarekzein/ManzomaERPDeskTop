<?php

namespace Tests\Feature;

use App\Modules\Inventory\Models\Warehouse;
use App\Modules\Inventory\Services\StockAlertService;
use App\Modules\Inventory\Services\StockDocumentService;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\MaintenanceProfile;
use App\Modules\Service\Models\ServiceRequest;
use App\Modules\Service\Models\ServiceVisit;
use App\Modules\Service\Services\MaintenanceService;
use App\Modules\Service\Services\ServiceReports;
use App\Modules\Service\Services\VisitService;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class WaterFilterServiceTest extends TestCase
{
    private function installed(): array
    {
        $filter = $this->product();
        $part = $this->product();
        $party = $this->customer();
        $profile = MaintenanceProfile::query()->create(['product_id' => $filter->id, 'name' => 'RO', 'version' => 1]);
        $profile->stages()->create(['stage_key' => 'sediment', 'label_ar' => 'شمعة', 'label_en' => 'Sediment', 'replacement_product_id' => $part->id, 'interval_count' => 3, 'interval_unit' => 'months']);
        $profile->stages()->create(['stage_key' => 'membrane', 'label_ar' => 'ممبرين', 'label_en' => 'Membrane', 'replacement_product_id' => $part->id, 'interval_count' => 12, 'interval_unit' => 'months']);
        $unit = CustomerUnit::query()->create(['party_id' => $party->id, 'product_id' => $filter->id, 'profile_id' => $profile->id, 'unit_code' => 'UNIT-1']);
        app(MaintenanceService::class)->install($unit, '2026-01-31');

        return [$unit->refresh(), $part, $party];
    }

    public function test_stage_dates_use_calendar_months_and_scan_is_deduplicated(): void
    {
        $this->travelTo(Carbon::parse('2026-04-25 12:00:00', 'Africa/Cairo'));
        [$unit] = $this->installed();
        $this->assertSame('2026-04-30', $unit->schedules->first()->next_due_on->toDateString());
        $this->assertSame('2027-01-31', $unit->schedules->last()->next_due_on->toDateString());
        $this->assertSame('2024-02-29', app(MaintenanceService::class)->nextDue('2024-01-31', 1, 'months'));
        $this->assertSame('2025-02-28', app(MaintenanceService::class)->nextDue('2024-02-29', 12, 'months'));
        $service = app(MaintenanceService::class);
        $this->assertSame(1, $service->scan()['created']);
        $this->assertSame(0, $service->scan()['created']);
        $this->assertDatabaseCount('maintenance_followups', 1);
        $this->travelTo(Carbon::parse('2026-05-10 12:00:00', 'Africa/Cairo'));
        $this->assertSame(1, $service->scan()['escalated']);
        $this->assertDatabaseHas('maintenance_followups', ['escalation' => 2]);
        $this->assertSame('2026-04-30', $unit->schedules()->first()->next_due_on->toDateString());
    }

    public function test_visit_consumes_once_and_invoice_does_not_issue_again(): void
    {
        $this->travelTo(Carbon::parse('2026-05-10 12:00:00', 'Africa/Cairo'));
        [$unit, $part, $party] = $this->installed();
        $this->stockIn($part, 10, 60);
        $request = ServiceRequest::query()->create(['party_id' => $party->id, 'unit_id' => $unit->id, 'description' => 'Replace sediment']);
        $visit = ServiceVisit::query()->create(['request_id' => $request->id, 'technician_id' => $this->admin->id, 'warehouse_id' => $this->warehouse->id, 'status' => 'scheduled', 'report' => 'Completed']);
        $visit->parts()->create(['product_id' => $part->id, 'quantity' => 1, 'base_quantity' => 1, 'unit_price' => 100]);
        $visit->stageActions()->create(['schedule_id' => $unit->schedules()->first()->id, 'action' => 'replace', 'replaced_on' => '2026-05-10']);
        $service = app(VisitService::class);
        $service->complete($visit, 'visit-key-1234', '2026-05-10');
        $this->assertSame(9.0, $this->onHand($part));
        $this->assertSame(60.0, $this->balance('cogs'));
        $service->complete($visit, 'visit-key-1234', '2026-05-10');
        $this->assertSame(9.0, $this->onHand($part));
        $this->assertSame('2026-08-10', $unit->schedules()->first()->next_due_on->toDateString());
        $this->assertSame('2027-01-31', $unit->schedules()->where('stage_key', 'membrane')->first()->next_due_on->toDateString());
        $invoice = $service->invoice($visit);
        $this->assertSame($invoice->id, $service->invoice($visit)->id);
        $posted = app(TradingPoster::class)->post($invoice);
        $this->assertSame(9.0, $this->onHand($part));
        $this->assertSame(60.0, $this->balance('cogs'));
        $this->assertEquals(60, $posted->cost_total);
        $this->assertBooksBalanced();
        $report = app(ServiceReports::class)->technicians()->first();
        $this->assertEquals(100, $report->parts_revenue);
        $this->assertEquals(40, $report->contribution_after_parts);
    }

    public function test_trading_edits_keep_fulfillment_links_and_reject_quantity_changes(): void
    {
        $this->travelTo(Carbon::parse('2026-05-10'));
        [$unit, $part, $party] = $this->installed();
        $this->stockIn($part, 3, 60);
        $request = ServiceRequest::query()->create(['party_id' => $party->id, 'description' => 'Repair']);
        $visit = ServiceVisit::query()->create(['request_id' => $request->id, 'technician_id' => $this->admin->id, 'warehouse_id' => $this->warehouse->id, 'status' => 'scheduled', 'report' => 'Done']);
        $visit->parts()->create(['product_id' => $part->id, 'quantity' => 1, 'base_quantity' => 1, 'unit_price' => 100]);
        app(VisitService::class)->complete($visit, 'complete-key-123', '2026-05-10');
        $doc = app(VisitService::class)->invoice($visit);
        $line = $doc->lines->first();
        $updated = app(TradingService::class)->save('sales_invoice', ['party_id' => $party->id, 'lines' => [['id' => $line->id, 'product_id' => $part->id, 'quantity' => 1, 'unit_price' => 120]]], $doc);
        $this->assertSame($line->id, $updated->lines->first()->id);
        $this->assertDatabaseHas('trade_line_service_parts', ['trade_line_id' => $line->id]);
        $this->actingAs($this->admin)->putJson('/api/documents/sales_invoice/'.$doc->id, ['party_id' => $party->id, 'date' => '2026-05-10', 'lines' => [['id' => $line->id, 'product_id' => $part->id, 'quantity' => 2, 'unit_price' => 120]]])->assertUnprocessable();
    }

    public function test_serials_follow_stock_and_duplicate_receipt_rolls_back(): void
    {
        $product = $this->product(['track_serials' => true]);
        $stock = app(StockDocumentService::class);
        $doc = $stock->save('opening', ['warehouse_id' => $this->warehouse->id, 'lines' => [['product_id' => $product->id, 'quantity' => 2, 'unit_cost' => 60, 'serial_numbers' => ['RO-1', 'RO-2']]]]);
        $stock->post($doc);
        $this->assertDatabaseCount('product_serials', 2);
        $invoice = app(TradingService::class)->save('sales_invoice', ['party_id' => $this->customer()->id, 'warehouse_id' => $this->warehouse->id, 'lines' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 100, 'serial_numbers' => ['RO-1']]]]);
        app(TradingPoster::class)->post($invoice);
        $this->assertDatabaseHas('product_serials', ['serial_number' => 'RO-1', 'status' => 'issued', 'warehouse_id' => null]);
        $this->assertSame(1.0, $this->onHand($product));
        $this->assertBooksBalanced();
    }

    public function test_technician_cannot_complete_another_technicians_visit(): void
    {
        [$unit, $part, $party] = $this->installed();
        $request = ServiceRequest::query()->create(['party_id' => $party->id, 'description' => 'Repair']);
        $visit = ServiceVisit::query()->create(['request_id' => $request->id, 'technician_id' => $this->admin->id, 'warehouse_id' => $this->warehouse->id]);
        $tech = $this->asUserWithRole('technician');
        $tech->givePermissionTo('service.complete');
        $this->actingAs($tech)->getJson('/api/service-visits/'.$visit->id)->assertForbidden();
        $this->postJson('/api/service-visits/'.$visit->id.'/complete', ['completed_on' => MaintenanceService::today()])->assertForbidden();
    }

    public function test_pausing_and_resuming_restores_one_current_followup(): void
    {
        $this->travelTo(Carbon::parse('2026-05-10 12:00:00', 'Africa/Cairo'));
        [$unit] = $this->installed();
        $service = app(MaintenanceService::class);
        $service->scan();
        $this->actingAs($this->admin)->putJson('/api/customer-units/'.$unit->id, ['status' => 'paused'])->assertOk();
        $this->assertSame(0, $service->scan()['created']);
        $this->assertDatabaseHas('maintenance_followups', ['status' => 'cancelled']);
        $this->putJson('/api/customer-units/'.$unit->id, ['status' => 'active'])->assertOk();
        $this->assertSame(1, $service->scan()['created']);
        $this->assertSame(0, $service->scan()['created']);
        $this->assertDatabaseCount('maintenance_followups', 1);
        $this->assertDatabaseHas('maintenance_followups', ['status' => 'open']);
    }

    public function test_unknown_installation_history_is_visible_in_review_queue(): void
    {
        [$unit] = $this->installed();
        $pending = CustomerUnit::query()->create(['party_id' => $unit->party_id, 'product_id' => $unit->product_id, 'profile_id' => $unit->profile_id, 'unit_code' => 'UNKNOWN-DATE']);
        $this->actingAs($this->admin)->getJson('/api/maintenance/due?when=review')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.unit.id', $pending->id);
        $this->assertDatabaseMissing('unit_stage_schedules', ['unit_id' => $pending->id]);
    }

    public function test_serialized_transfer_shortage_requires_the_exact_arrived_serials(): void
    {
        $product = $this->product(['track_serials' => true]);
        $stock = app(StockDocumentService::class);
        $opening = $stock->save('opening', ['warehouse_id' => $this->warehouse->id, 'lines' => [['product_id' => $product->id, 'quantity' => 2, 'unit_cost' => 60, 'serial_numbers' => ['ro-a', 'ro-b']]]]);
        $stock->post($opening);
        $van = Warehouse::query()->create(['code' => 'VAN-1', 'name' => 'Van', 'kind' => 'van']);
        $transfer = $stock->save('transfer', ['warehouse_id' => $this->warehouse->id, 'to_warehouse_id' => $van->id, 'lines' => [['product_id' => $product->id, 'quantity' => 2, 'serial_numbers' => ['ro-a', 'ro-b']]]]);
        $transfer = $stock->post($transfer);
        $lineId = $transfer->lines->first()->id;
        $stock->receiveTransfer($transfer, [$lineId => 1], null, [$lineId => ['ro-b']]);
        $this->assertDatabaseHas('product_serials', ['serial_number' => 'RO-B', 'warehouse_id' => $van->id, 'status' => 'available']);
        $this->assertDatabaseHas('product_serials', ['serial_number' => 'RO-A', 'warehouse_id' => null, 'status' => 'issued']);
        $this->assertSame(1.0, $this->onHand($product, $van->id));
        $this->assertBooksBalanced();
    }

    public function test_low_stock_tasks_follow_threshold_cycles_and_disabled_thresholds(): void
    {
        $product = $this->product(['reorder_level' => 2]);
        $alerts = app(StockAlertService::class);
        $this->assertSame(1, $alerts->scan());
        $this->assertSame(0, $alerts->scan());
        $this->stockIn($product, 5, 60);
        $this->assertSame(0, $alerts->scan());
        $this->assertDatabaseHas('stock_alerts', ['product_id' => $product->id, 'active' => false]);
        $product->update(['reorder_level' => 10]);
        $this->assertSame(1, $alerts->scan());
        $taskId = DB::table('stock_alerts')->where('product_id', $product->id)->value('task_id');
        $product->update(['reorder_level' => 0]);
        $alerts->scan();
        $this->assertDatabaseHas('crm_tasks', ['id' => $taskId, 'status' => 'cancelled']);
    }
}
