<?php

namespace Tests\Feature;

use App\Modules\Inventory\Services\StockAlertService;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\MaintenanceProfile;
use App\Modules\Service\Models\ServiceRequest;
use App\Modules\Service\Models\ServiceVisit;
use App\Modules\Service\Services\MaintenanceService;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class OperationsWorkspaceTest extends TestCase
{
    private function requestForCustomer(): ServiceRequest
    {
        return ServiceRequest::query()->create(['party_id' => $this->customer()->id, 'description' => 'Change candles']);
    }

    private function visitFor(ServiceRequest $request, string $date, array $attributes = []): ServiceVisit
    {
        return ServiceVisit::query()->create($attributes + ['request_id' => $request->id, 'technician_id' => $this->admin->id, 'warehouse_id' => $this->warehouse->id, 'status' => 'scheduled', 'scheduled_start' => $date]);
    }

    public function test_today_uses_cairo_dates_and_only_actionable_visits_and_requests(): void
    {
        $this->travelTo(Carbon::parse('2026-10-26 10:00:00', 'Africa/Cairo'));
        $request = $this->requestForCustomer();
        // Cairo is UTC+3 on this date: the preceding UTC evening is part of today.
        $today = $this->visitFor($request, '2026-10-25 22:30:00');
        $this->visitFor($request, '2026-10-26 21:30:00'); // tomorrow in Cairo
        $this->visitFor($request, '2026-10-25 20:30:00'); // yesterday
        $this->visitFor($request, '2026-10-26 12:00:00', ['status' => 'completed']);
        $waiting = $this->requestForCustomer();
        $cancelled = $this->requestForCustomer();
        $cancelled->update(['status' => 'cancelled']);
        $this->actingAs($this->admin)->getJson('/api/operations/today')->assertOk()
            ->assertJsonPath('business_date', '2026-10-26')->assertJsonPath('service.visits_today', 1)
            ->assertJsonPath('service.late_visits', 1)->assertJsonPath('service.visits.0.id', $today->id)
            ->assertJsonPath('service.awaiting_scheduling', 1)->assertJsonPath('service.requests.0.id', $waiting->id)
            ->assertJsonMissingPath('finance')->assertJsonMissingPath('service.visits.0.cost_total');
        $this->getJson('/api/service-visits?when=today')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $today->id);
        $this->getJson('/api/service-visits?when=late')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_customer_context_filters_requests_visits_due_and_followups(): void
    {
        $this->travelTo(Carbon::parse('2026-10-26 12:00:00', 'Africa/Cairo'));
        $first = $this->requestForCustomer();
        $second = $this->requestForCustomer();
        $visit = $this->visitFor($first, '2026-10-26 08:00:00');
        $this->visitFor($second, '2026-10-26 09:00:00');
        $product = $this->product();
        $profile = MaintenanceProfile::query()->create(['product_id' => $product->id, 'name' => 'RO', 'version' => 1]);
        $profile->stages()->create(['stage_key' => 'sediment', 'label_ar' => 'شمعة', 'label_en' => 'Sediment', 'replacement_product_id' => $product->id, 'interval_count' => 3, 'interval_unit' => 'months']);
        foreach ([$first, $second] as $i => $request) {
            $unit = CustomerUnit::query()->create(['party_id' => $request->party_id, 'product_id' => $product->id, 'profile_id' => $profile->id, 'unit_code' => 'UNIT-'.$i]);
            app(MaintenanceService::class)->install($unit, '2026-07-27');
        }
        app(MaintenanceService::class)->scan();
        $this->actingAs($this->admin);
        $this->getJson('/api/service-requests?party_id='.$first->party_id)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $first->id);
        $this->getJson('/api/service-requests?id='.$second->id)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $second->id);
        $this->getJson('/api/service-visits?party_id='.$first->party_id)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $visit->id);
        $this->getJson('/api/service-visits?request_id='.$first->id)->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/maintenance/due?party_id='.$first->party_id)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.unit.party_id', $first->party_id);
        $this->getJson('/api/maintenance/followups?party_id='.$first->party_id)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.schedule.unit.party_id', $first->party_id);
        $this->getJson('/api/operations/today')->assertOk()->assertJsonPath('service.due_week', 2);
    }

    public function test_technician_queues_and_customer_filters_never_expand_assignment_scope(): void
    {
        $private = $this->requestForCustomer();
        $this->visitFor($private, now()->utc()->format('Y-m-d H:i:s'));
        $technician = $this->asUserWithRole('technician');
        $own = $this->requestForCustomer();
        $visit = $this->visitFor($own, now()->utc()->format('Y-m-d H:i:s'), ['technician_id' => $technician->id]);
        $this->actingAs($technician)->getJson('/api/operations/today')->assertOk()->assertJsonPath('service.visits_today', 1)
            ->assertJsonPath('service.visits.0.id', $visit->id)->assertJsonPath('service.awaiting_scheduling', 0)->assertJsonCount(0, 'service.requests')->assertJsonMissingPath('stock');
        $this->getJson('/api/service-visits?party_id='.$private->party_id)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/service-requests?id='.$private->id)->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_stock_staff_see_stock_alerts_without_customer_or_financial_queues(): void
    {
        $product = $this->product(['reorder_level' => 2]);
        app(StockAlertService::class)->scan();
        $storekeeper = $this->asUserWithRole('storekeeper');
        $this->actingAs($storekeeper)->getJson('/api/operations/today')->assertOk()->assertJsonMissingPath('service')
            ->assertJsonPath('stock.low_stock', 1)->assertJsonPath('stock.alerts.0.product_id', $product->id)->assertJsonMissingPath('stock.alerts.0.avg_cost');
    }
    public function test_invoice_registration_cannot_exceed_sold_filter_quantity(): void
    {
        $product = $this->product();
        $this->stockIn($product, 1, 60);
        $party = $this->customer();
        $invoice = app(\App\Modules\Trading\Services\TradingService::class)->save('sales_invoice', ['party_id' => $party->id, 'lines' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 100]]]);
        app(\App\Modules\Trading\Services\TradingPoster::class)->post($invoice);
        $profile = MaintenanceProfile::query()->create(['product_id' => $product->id, 'name' => 'RO', 'version' => 1]);
        $body = ['party_id' => $party->id, 'product_id' => $product->id, 'profile_id' => $profile->id, 'invoice_line_id' => $invoice->lines->first()->id, 'unit_code' => 'SOLD-1'];
        $this->actingAs($this->admin)->postJson('/api/customer-units', $body)->assertCreated();
        $this->postJson('/api/customer-units', array_replace($body, ['unit_code' => 'SOLD-2']))->assertUnprocessable();
        $this->getJson('/api/customer-units?invoice_id='.$invoice->id)->assertOk()->assertJsonCount(1, 'data');
        $this->assertSame(0.0, $this->onHand($product));
        $this->assertDatabaseCount('customer_units', 1);
    }

    public function test_invoice_links_back_to_visit_only_with_service_visibility(): void
    {
        $request = $this->requestForCustomer();
        $product = $this->product(['type' => 'service']);
        $invoice = app(\App\Modules\Trading\Services\TradingService::class)->save('sales_invoice', ['party_id' => $request->party_id, 'lines' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 100]]]);
        $visit = $this->visitFor($request, now()->utc()->format('Y-m-d H:i:s'), ['status' => 'completed', 'invoice_id' => $invoice->id]);
        $this->actingAs($this->admin)->getJson('/api/documents/sales_invoice/'.$invoice->id)->assertOk()->assertJsonPath('data.service_visit_id', $visit->id);
        $salesperson = $this->asUserWithRole('salesperson');
        $this->actingAs($salesperson)->getJson('/api/documents/sales_invoice/'.$invoice->id)->assertOk()->assertJsonMissingPath('data.service_visit_id');
    }

    public function test_saved_draft_visit_stays_in_the_scheduling_queue(): void
    {
        $request = $this->requestForCustomer();
        $visit = $this->visitFor($request, now()->utc()->format('Y-m-d H:i:s'), ['status' => 'draft']);
        $this->actingAs($this->admin)->getJson('/api/operations/today')->assertOk()->assertJsonPath('service.awaiting_scheduling', 1)->assertJsonPath('service.requests.0.visits.0.id', $visit->id);
    }

    public function test_new_visit_can_save_and_schedule_atomically_with_overlap_validation(): void
    {
        $request = $this->requestForCustomer();
        $technician = $this->asUserWithRole('technician');
        $body = ['request_id' => $request->id, 'technician_id' => $technician->id, 'warehouse_id' => $this->warehouse->id,
            'schedule' => true, 'scheduled_start' => '2026-10-26T09:00:00Z', 'scheduled_end' => '2026-10-26T10:00:00Z'];
        $this->actingAs($this->admin)->postJson('/api/service-visits', $body)->assertOk()->assertJsonPath('data.status', 'scheduled');
        $this->postJson('/api/service-visits', $body)->assertUnprocessable();
        $this->postJson('/api/service-visits', array_replace($body, ['scheduled_start' => '2026-10-26T11:00:00+02:00', 'scheduled_end' => '2026-10-26T12:00:00+02:00']))->assertUnprocessable();
        $this->postJson('/api/service-visits', array_replace($body, ['scheduled_start' => null, 'scheduled_end' => null]))->assertUnprocessable();
        $this->assertDatabaseCount('service_visits', 1);
    }

    public function test_installation_visit_starts_reminders_only_after_explicit_confirmation(): void
    {
        $this->travelTo(Carbon::parse('2026-10-26 14:00:00', 'Africa/Cairo'));
        $product = $this->product();
        $party = $this->customer();
        $profile = MaintenanceProfile::query()->create(['product_id' => $product->id, 'name' => 'RO', 'version' => 1]);
        $profile->stages()->create(['stage_key' => 'sediment', 'label_ar' => 'شمعة', 'label_en' => 'Sediment', 'replacement_product_id' => $product->id, 'interval_count' => 3, 'interval_unit' => 'months']);
        foreach ([false, true] as $i => $confirmed) {
            $unit = CustomerUnit::query()->create(['party_id' => $party->id, 'product_id' => $product->id, 'profile_id' => $profile->id, 'unit_code' => 'INSTALL-'.$i]);
            $request = ServiceRequest::query()->create(['party_id' => $party->id, 'unit_id' => $unit->id, 'type' => 'installation', 'description' => 'Fit RO']);
            $visit = $this->visitFor($request, '2026-10-26 09:00:00', ['report' => 'Installation report']);
            $this->actingAs($this->admin)->withHeaders(['Idempotency-Key' => 'installation-key-'.$i])
                ->postJson('/api/service-visits/'.$visit->id.'/complete', ['completed_on' => '2026-10-26', 'confirm_installation' => $confirmed])->assertOk();
            $this->assertSame($confirmed ? 'active' : 'pending_installation', $unit->refresh()->status);
            $this->assertSame($confirmed ? 1 : 0, $unit->schedules()->count());
            if ($confirmed) {
                $this->assertSame('2027-01-26', $unit->schedules()->first()->next_due_on->toDateString());
                $this->assertDatabaseHas('maintenance_events', ['unit_id' => $unit->id, 'visit_id' => $visit->id, 'kind' => 'installation']);
                $this->postJson('/api/service-visits/'.$visit->id.'/complete', ['completed_on' => '2026-10-26', 'confirm_installation' => true])->assertOk();
                $this->assertSame(1, $unit->events()->count());
            }
        }
        $this->assertSame(0.0, $this->onHand($product)); // Installing never issues a sold/external filter again.
    }

}
