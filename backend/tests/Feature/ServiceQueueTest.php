<?php

namespace Tests\Feature;

use App\Modules\Core\Models\CustomField;
use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Inventory\Models\ProductSerial;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\MaintenanceFollowup;
use App\Modules\Service\Models\MaintenanceProfile;
use App\Modules\Service\Models\ServiceRequest;
use App\Modules\Service\Models\ServiceVisit;
use App\Modules\Service\Services\MaintenanceService;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ServiceQueueTest extends TestCase
{
    public function test_invoice_registration_totals_are_not_capped_by_a_unit_list_page(): void
    {
        $unit = $this->unit('SOLD', '01055556666');
        $this->actingAs($this->admin);
        $this->stockIn($unit->product, 1105, 10);
        $invoice = app(TradingService::class)->save('sales_invoice', ['date' => MaintenanceService::today(), 'party_id' => $unit->party_id, 'warehouse_id' => $this->warehouse->id, 'lines' => [['product_id' => $unit->product_id, 'quantity' => 1105, 'unit_price' => 100]]]);
        $invoice = app(TradingPoster::class)->post($invoice);
        $line = $invoice->lines()->first();
        $serial = ProductSerial::create(['product_id' => $unit->product_id, 'serial_number' => 'SALE-SERIAL', 'status' => 'sold']);
        $rows = [];
        for ($i = 1; $i <= 1105; $i++) {
            $rows[] = ['party_id' => $unit->party_id, 'product_id' => $unit->product_id, 'profile_id' => $unit->profile_id, 'invoice_line_id' => $line->id, 'unit_code' => 'SALE-'.$i, 'serial_id' => $i === 1 ? $serial->id : null, 'status' => $i === 1105 ? 'returned' : 'pending_installation'];
        }
        foreach (array_chunk($rows, 100) as $chunk) {
            DB::table('customer_units')->insert($chunk);
        }
        $response = $this->getJson('/api/customer-units/invoice-registrations?invoice_id='.$invoice->id)->assertOk()->assertJsonPath('counts.'.$line->id, 1104)->assertJsonCount(1, 'serial_units')->assertJsonPath('serial_units.0.serial_number', 'SALE-SERIAL');
        $this->assertSame($line->id, $response->json('serial_units.0.invoice_line_id'));
        $technician = $this->asUserWithRole('technician');
        $this->actingAs($technician)->getJson('/api/customer-units/invoice-registrations?invoice_id='.$invoice->id)->assertForbidden();
    }

    public function test_service_custom_columns_search_and_filters_share_the_authorized_form_contract(): void
    {
        $unit = $this->unit('CUSTOM', '01044445555');
        $request = ServiceRequest::create(['party_id' => $unit->party_id, 'unit_id' => $unit->id, 'description' => 'Maintenance']);
        $technician = $this->asUserWithRole('technician');
        $visit = ServiceVisit::create(['request_id' => $request->id, 'technician_id' => $technician->id, 'warehouse_id' => $this->warehouse->id]);
        $this->actingAs($this->admin);
        foreach ([['customer-units', 'customer_units', $unit->id, '/api/customer-units'], ['service-requests', 'service_requests', $request->id, '/api/service-requests'], ['service-visits', 'service_visits', $visit->id, '/api/service-visits'], ['maintenance-profiles', 'maintenance_profiles', $unit->profile_id, '/api/maintenance/profiles']] as [$key, $entity, $id, $path]) {
            CustomField::create(['entity_type' => $entity, 'key' => 'district', 'type' => 'text', 'label_ar' => 'المنطقة', 'label_en' => 'District', 'usage_flags_json' => ['list' => true, 'filter' => true, 'search' => true], 'role_access_json' => ['read' => ['admin'], 'write' => ['admin']]]);
            app(DynamicFormService::class)->flush();
            app(DynamicFormService::class)->save($key, $id, ['custom_fields' => ['district' => 'HiddenPilotZone']]);
            $this->getJson($path.'?'.http_build_query(['search' => 'HiddenPilotZone', 'custom' => ['district' => 'HiddenPilotZone'], 'per_page' => 500]))->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.custom_fields.district', 'HiddenPilotZone');
            $this->getJson($path.'?'.http_build_query(['custom' => ['district' => 'Different'], 'per_page' => 50]))->assertOk()->assertJsonPath('total', 0);
        }
        $this->actingAs($technician)->getJson('/api/service-requests?search=HiddenPilotZone')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/service-requests')->assertOk()->assertJsonMissingPath('data.0.custom_fields.district');
    }

    private function unit(string $code, string $mobile): CustomerUnit
    {
        $party = $this->customer(['name' => 'أسرة '.$code, 'name_en' => 'Household '.$code, 'mobile' => $mobile]);
        $filter = $this->product(['name' => 'فلتر مشترك', 'name_en' => 'Shared filter model']);
        $profile = MaintenanceProfile::create(['product_id' => $filter->id, 'name' => 'RO', 'version' => 1]);
        $profile->stages()->create(['stage_key' => 'sediment', 'label_ar' => 'شمعة الرواسب', 'label_en' => 'Sediment', 'replacement_product_id' => $filter->id, 'interval_count' => 3, 'interval_unit' => 'months']);
        $serial = ProductSerial::create(['product_id' => $filter->id, 'serial_number' => 'SERIAL-'.$code, 'status' => 'sold']);

        return CustomerUnit::create(['party_id' => $party->id, 'product_id' => $filter->id, 'serial_id' => $serial->id, 'profile_id' => $profile->id, 'unit_code' => $code]);
    }

    public function test_customer_model_serial_and_request_search_keep_customer_and_status_filters(): void
    {
        $unit = $this->unit('CAIRO-1', '01011112222');
        $other = $this->unit('GIZA-2', '01299998888');
        $this->actingAs($this->admin);
        foreach (['CAIRO-1', 'SERIAL-CAIRO-1', 'Household CAIRO', '01011112222'] as $term) {
            $this->getJson('/api/customer-units?'.http_build_query(['search' => $term]))->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $unit->id);
        }
        $this->getJson('/api/customer-units?'.http_build_query(['search' => 'Shared filter', 'party_id' => $other->party_id]))->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $other->id);
        $request = ServiceRequest::create(['party_id' => $unit->party_id, 'unit_id' => $unit->id, 'description' => 'Kitchen pressure problem']);
        ServiceRequest::create(['party_id' => $other->party_id, 'unit_id' => $other->id, 'description' => 'Kitchen pressure problem', 'status' => 'completed']);
        foreach (['Kitchen', 'SERIAL-CAIRO', '#'.$request->id, '01011112222'] as $term) {
            $this->getJson('/api/service-requests?'.http_build_query(['search' => $term, 'status' => 'open']))->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $request->id);
        }
        $this->getJson('/api/service-requests?'.http_build_query(['search' => 'Kitchen', 'party_id' => $other->party_id, 'status' => 'completed']))->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/customer-units?search[]=bad')->assertUnprocessable();
        $this->getJson('/api/service-visits?status=invalid')->assertUnprocessable();
    }

    public function test_search_or_conditions_cannot_escape_technician_assignment(): void
    {
        $first = $this->unit('ASSIGNED', '01000000001');
        $second = $this->unit('PRIVATE', '01000000002');
        $technician = $this->asUserWithRole('technician');
        $other = $this->asUserWithRole('technician');
        foreach ([[$first, $technician], [$second, $other]] as [$unit, $person]) {
            $request = ServiceRequest::create(['party_id' => $unit->party_id, 'unit_id' => $unit->id, 'description' => 'Shared search phrase']);
            ServiceVisit::create(['request_id' => $request->id, 'technician_id' => $person->id, 'warehouse_id' => $this->warehouse->id, 'report' => 'Shared search phrase']);
        }
        $this->actingAs($technician);
        $this->getJson('/api/customer-units?search=Shared')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $first->id);
        $this->getJson('/api/service-requests?search=Shared')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.party_id', $first->party_id);
        $this->getJson('/api/service-visits?search=Shared')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.technician_id', $technician->id);
        $this->getJson('/api/customer-units?search=PRIVATE')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/maintenance/followups?owner_id=unassigned')->assertForbidden();
    }

    public function test_due_and_contact_queues_combine_search_period_owner_and_status(): void
    {
        $this->travelTo(Carbon::parse('2026-04-25 12:00:00', 'Africa/Cairo'));
        $first = $this->unit('DUE-ONE', '01000000011');
        $second = $this->unit('DUE-TWO', '01000000022');
        $this->actingAs($this->admin);
        foreach ([$first, $second] as $unit) {
            app(MaintenanceService::class)->install($unit, '2026-01-25');
        }
        app(MaintenanceService::class)->scan();
        MaintenanceFollowup::query()->where('schedule_id', $first->schedules()->first()->id)->update(['owner_id' => $this->admin->id, 'status' => 'booked']);
        MaintenanceFollowup::query()->where('schedule_id', $second->schedules()->first()->id)->update(['owner_id' => null]);
        $this->getJson('/api/maintenance/due?search=01000000011&when=week')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.unit_id', $first->id);
        $this->getJson('/api/maintenance/due?search=Sediment&when=week')->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/maintenance/due?search=Sediment&when=overdue')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/maintenance/followups?search=SERIAL-DUE-ONE&owner_id=me&status=booked')->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/maintenance/followups?search=Shared&owner_id=unassigned')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.owner_id', null);
        $this->getJson('/api/maintenance/followups?owner_id=me&status=open')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/maintenance/followups?owner_id=arbitrary')->assertUnprocessable();
    }

    public function test_paged_lookups_and_export_reads_include_records_beyond_1000_without_side_effects(): void
    {
        $unit = $this->unit('VOLUME', '01033334444');
        $rows = [];
        for ($i = 1; $i <= 1105; $i++) {
            $rows[] = ['party_id' => $unit->party_id, 'unit_id' => $unit->id, 'description' => 'Volume fixture '.$i, 'status' => 'open'];
        }
        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('service_requests')->insert($chunk);
        }
        $this->actingAs($this->admin);
        $this->getJson('/api/service-requests?per_page=20&page=56&sort=id&status=open')->assertOk()->assertJsonPath('total', 1105)->assertJsonCount(5, 'data')->assertJsonPath('data.4.id', 1105);
        $this->getJson('/api/service-requests?id=1105&per_page=1')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', 1105);
        $ids = [];
        for ($page = 1; $page <= 3; $page++) {
            $response = $this->getJson('/api/service-requests?'.http_build_query(['page' => $page, 'per_page' => 500, 'search' => 'Volume fixture', 'sort' => 'id']));
            $response->assertOk()->assertJsonPath('total', 1105)->assertJsonPath('last_page', 3);
            $ids = array_merge($ids, array_column($response->json('data'), 'id'));
        }
        $this->assertCount(1105, array_unique($ids));
        $this->assertSame(range(1, 1105), $ids);
        $this->assertDatabaseCount('stock_moves', 0);
        $this->assertDatabaseCount('journal_entries', 0);
    }
}
