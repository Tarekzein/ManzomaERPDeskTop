<?php

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Core\Models\CustomField;
use App\Modules\Core\Services\SettingsService;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\MaintenanceProfile;
use App\Modules\Service\Models\ServiceRequest;
use App\Modules\Service\Models\ServiceVisit;
use App\Modules\Service\Services\MaintenanceService;
use App\Modules\Service\Services\ServiceReports;
use App\Modules\Service\Services\VisitCorrectionService;
use App\Modules\Service\Services\VisitService;
use App\Modules\Trading\Services\TradingService;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class ReleaseImprovementsTest extends TestCase
{
    private function fixture(): array
    {
        $this->travelTo(Carbon::parse('2026-10-27 00:15:00', 'Africa/Cairo'));
        $filter = $this->product();
        $part = $this->product();
        $party = $this->customer();
        $profile = MaintenanceProfile::create(['product_id' => $filter->id, 'name' => 'RO', 'version' => 1]);
        $profile->stages()->create(['stage_key' => 'sediment', 'label_ar' => 'شمعة', 'label_en' => 'Sediment', 'replacement_product_id' => $part->id, 'interval_count' => 3, 'interval_unit' => 'months']);
        $unit = CustomerUnit::create(['party_id' => $party->id, 'product_id' => $filter->id, 'profile_id' => $profile->id, 'unit_code' => 'LEGACY-1']);
        app(MaintenanceService::class)->install($unit, '2026-01-31');

        return [$unit->refresh(), $part, $party, $profile, $filter];
    }

    private function completed(): array
    {
        [$unit, $part, $party] = $this->fixture();
        $this->stockIn($part, 10, 60);
        $request = ServiceRequest::create(['party_id' => $party->id, 'unit_id' => $unit->id, 'description' => 'Replacement']);
        $visit = ServiceVisit::create(['request_id' => $request->id, 'technician_id' => $this->admin->id, 'warehouse_id' => $this->warehouse->id, 'status' => 'scheduled', 'report' => 'Actual work']);
        $visit->parts()->create(['product_id' => $part->id, 'quantity' => 1, 'base_quantity' => 1, 'unit_price' => 100]);
        $visit->stageActions()->create(['schedule_id' => $unit->schedules()->first()->id, 'action' => 'replace', 'replaced_on' => '2026-10-26']);
        app(VisitService::class)->complete($visit, 'completion-test-key', '2026-10-26');

        return [$visit->refresh(), $unit, $part, $party];
    }

    public function test_completion_keeps_cairo_business_date_and_real_utc_timestamp(): void
    {
        [$visit] = $this->completed();
        $this->assertSame('2026-10-26', $visit->completed_on->toDateString());
        $this->assertSame(now()->timestamp, $visit->completed_at->timestamp);
        $this->assertTrue($visit->completion_time_known);
    }

    public function test_configurable_reminder_offsets_and_owner_do_not_duplicate_cycles(): void
    {
        [$unit] = $this->fixture();
        $unit->schedules()->update(['next_due_on' => '2026-11-10']);
        app(SettingsService::class)->setMany(['maintenance.reminder_days' => 14, 'maintenance.owner_id' => $this->admin->id]);
        $this->assertSame(1, app(MaintenanceService::class)->scan()['created']);
        app(SettingsService::class)->set('maintenance.reminder_days', 20);
        $this->assertSame(0, app(MaintenanceService::class)->scan()['created']);
        $this->assertDatabaseHas('maintenance_followups', ['owner_id' => $this->admin->id]);
        $this->actingAs($this->admin)->putJson('/api/settings', ['values' => ['maintenance.reminder_days' => -1]])->assertUnprocessable();
        $technician = $this->asUserWithRole('technician');
        $this->actingAs($this->admin)->putJson('/api/settings', ['values' => ['maintenance.owner_id' => $technician->id]])->assertUnprocessable()->assertJsonValidationErrors('maintenance.owner_id');
        app(SettingsService::class)->set('maintenance.owner_id', $technician->id);
        $unit->schedules()->update(['cycle_number' => 2]);
        app(MaintenanceService::class)->scan();
        $this->assertDatabaseHas('maintenance_followups', ['cycle_number' => 2, 'owner_id' => $this->admin->id]);

    }

    public function test_unbilled_correction_reverses_stock_cost_and_stage_history_once(): void
    {
        [$visit, $unit, $part] = $this->completed();
        $payload = ['kind' => 'reverse_consumption', 'effective_on' => '2026-10-27', 'reason' => 'Parts returned; no work occurred', 'restock_confirmed' => true, 'restore_stage_history' => true];
        $service = app(VisitCorrectionService::class);
        $first = $service->correct($visit, 'correction-key-test', $payload);
        $this->assertSame($first, $service->correct($visit, 'correction-key-test', $payload));
        $this->assertSame(10.0, $this->onHand($part));
        $this->assertSame(0.0, $this->balance('cogs'));
        $this->assertSame('reversed', $visit->fresh()->status);
        $this->assertSame('2026-04-30', $unit->schedules()->first()->next_due_on->toDateString());
        $this->assertDatabaseCount('service_visit_corrections', 1);
        $this->assertSame(0.0, app(ServiceReports::class)->technicians()->first()->net_parts_cost);
        $row = app(ServiceReports::class)->technicians(['from' => '2026-10-27', 'to' => '2026-10-27'])->first();
        $this->assertSame(-60.0, $row->net_parts_cost);
    }

    public function test_billed_correction_requires_invoice_return_and_preserves_stock(): void
    {
        [$visit, , $part] = $this->completed();
        app(VisitService::class)->invoice($visit);
        $this->actingAs($this->admin)->postJson('/api/service-visits/'.$visit->id.'/corrections', ['kind' => 'reverse_consumption', 'effective_on' => '2026-10-27', 'reason' => 'Return request', 'restock_confirmed' => true, 'restore_stage_history' => true], ['Idempotency-Key' => 'billed-correction-key'])->assertUnprocessable();
        $this->assertSame(9.0, $this->onHand($part));
        $this->assertDatabaseCount('service_visit_corrections', 0);
    }

    public function test_correction_is_role_protected_and_notes_preserve_original_report(): void
    {
        [$visit] = $this->completed();
        $payload = ['kind' => 'note', 'effective_on' => '2026-10-27', 'reason' => 'Customer confirmed the report.'];
        $user = User::create(['name' => 'Restricted', 'username' => 'restricted', 'password' => 'secret123', 'is_active' => true]);
        $this->actingAs($user)->postJson('/api/service-visits/'.$visit->id.'/corrections', $payload, ['Idempotency-Key' => 'note-correction-key'])->assertForbidden();
        $this->actingAs($this->admin)->postJson('/api/service-visits/'.$visit->id.'/corrections', $payload, ['Idempotency-Key' => 'note-correction-key'])->assertOk();
        $this->assertSame('Actual work', $visit->fresh()->report);
        $this->getJson('/api/service-visits/'.$visit->id)->assertJsonCount(1, 'data.corrections');
    }

    public function test_unit_history_import_dry_run_retry_and_unknown_dates_never_issue_stock(): void
    {
        [, , $party, $profile, $filter] = $this->fixture();
        $row = ['unit_code' => 'IMPORT-1', 'customer_code' => $party->code, 'product_code' => $filter->code, 'profile_name' => $profile->name, 'installed_on' => '2026-01-31', 'address' => 'House 1', 'stage.sediment' => '2026-09-30'];
        $this->actingAs($this->admin)->postJson('/api/import/customer-units', ['rows' => [$row], 'dry_run' => true])->assertOk()->assertJsonPath('created', 1)->assertJsonCount(0, 'errors');
        $this->assertDatabaseMissing('customer_units', ['unit_code' => 'IMPORT-1']);
        $this->postJson('/api/import/customer-units', ['rows' => [$row]])->assertJsonPath('created', 1)->assertJsonCount(0, 'errors');
        $this->postJson('/api/import/customer-units', ['rows' => [$row]])->assertJsonPath('skipped', 1);
        $imported = CustomerUnit::where('unit_code', 'IMPORT-1')->firstOrFail();
        $this->assertSame('2026-12-30', $imported->schedules()->first()->next_due_on->toDateString());
        $this->postJson('/api/import/customer-units', ['rows' => [array_replace($row, ['installed_on' => '2026-02-01'])]])->assertJsonCount(1, 'errors');
        unset($row['installed_on'], $row['stage.sediment']);
        $row['unit_code'] = 'IMPORT-UNKNOWN';
        $this->postJson('/api/import/customer-units', ['rows' => [$row]])->assertJsonPath('created', 1);
        $this->assertNull(CustomerUnit::where('unit_code', 'IMPORT-UNKNOWN')->first()->installed_on);
        $this->assertDatabaseCount('stock_moves', 0);
    }

    public function test_report_period_filters_and_localized_domain_failures(): void
    {
        $this->completed();
        $this->actingAs($this->admin)->getJson('/api/reports/maintenance?from=2026-10-26&to=2026-10-26')->assertOk()->assertJsonPath('technicians.0.net_parts_cost', 60);
        $this->getJson('/api/reports/maintenance?from=2027-01-01&to=2027-01-02')->assertOk()->assertJsonCount(0, 'technicians');
        $this->getJson('/api/reports/maintenance?from=2027-01-01&to=2026-01-01', ['X-Locale' => 'ar'])->assertUnprocessable()->assertJsonPath('message', 'تاريخ النهاية يجب ألا يسبق تاريخ البداية.');
        $this->getJson('/api/reports/maintenance?from=2027-01-01&to=2026-01-01', ['X-Locale' => 'en'])->assertUnprocessable()->assertJsonPath('message', 'End date must not precede start date.');
    }

    public function test_profile_custom_fields_are_atomic_and_transaction_headers_expose_protected_controls(): void
    {
        [$unit, $part, , $profile, $filter] = $this->fixture();
        CustomField::create(['entity_type' => 'maintenance_profiles', 'key' => 'manual_reference', 'type' => 'text', 'label_ar' => 'مرجع الكتيب', 'label_en' => 'Manual reference', 'required' => true, 'active' => true]);
        $payload = ['product_id' => $filter->id, 'name' => 'New version', 'stages' => [['stage_key' => 'sediment', 'label_ar' => 'شمعة', 'label_en' => 'Sediment', 'replacement_product_id' => $part->id, 'interval_count' => 3, 'interval_unit' => 'months']]];
        $this->actingAs($this->admin)->postJson('/api/maintenance/profiles', $payload, ['X-Locale' => 'ar'])->assertUnprocessable()->assertJsonValidationErrors('custom_fields.manual_reference');
        $this->assertDatabaseCount('maintenance_profiles', 1);
        $this->postJson('/api/maintenance/profiles', $payload + ['custom_fields' => ['manual_reference' => 'RO-2026']])->assertCreated()->assertJsonPath('data.custom_fields.manual_reference', 'RO-2026');
        foreach (TradingService::TYPES as $type) {
            $schema = $this->getJson('/api/forms/'.$type)->assertOk()->json();
            $fields = collect($schema['core_fields'])->keyBy('property');
            $this->assertTrue($fields['party_id']['protected']);
            $this->assertTrue($fields['date']['protected']);
        }
    }

    public function test_later_stage_events_and_fiscal_locks_block_consumption_reversal_atomically(): void
    {
        [$visit, $unit, $part] = $this->completed();
        app(MaintenanceService::class)->replace($unit->schedules()->first(), '2026-10-27', null, 'correction', 'Later reviewed history');
        $payload = ['kind' => 'reverse_consumption', 'effective_on' => '2026-10-27', 'reason' => 'Attempt to reverse older work', 'restock_confirmed' => true, 'restore_stage_history' => true];
        $this->actingAs($this->admin)->postJson('/api/service-visits/'.$visit->id.'/corrections', $payload, ['Idempotency-Key' => 'later-history-key'])->assertUnprocessable();
        $this->assertSame(9.0, $this->onHand($part));
        $this->assertSame(60.0, $this->balance('cogs'));
        $this->assertDatabaseCount('service_visit_corrections', 0);
        app(SettingsService::class)->set('accounting.lock_date', '2026-10-27');
        $this->postJson('/api/service-visits/'.$visit->id.'/corrections', $payload, ['Idempotency-Key' => 'locked-period-key'])->assertUnprocessable();
        $this->assertSame(9.0, $this->onHand($part));
    }
}
