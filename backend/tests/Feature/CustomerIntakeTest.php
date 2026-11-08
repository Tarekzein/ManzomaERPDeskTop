<?php

namespace Tests\Feature;

use App\Modules\Core\Models\CustomField;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\MaintenanceProfile;
use App\Modules\Trading\Models\TradeDocument;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class CustomerIntakeTest extends TestCase
{
    private function existingEntry(): array
    {
        $product = $this->product(['track_serials' => true]);
        $profile = MaintenanceProfile::query()->create(['product_id' => $product->id, 'name' => 'RO', 'version' => 1]);
        $profile->stages()->create(['stage_key' => 'sediment', 'label_ar' => 'شمعة', 'label_en' => 'Sediment', 'replacement_product_id' => $this->product()->id, 'interval_count' => 3, 'interval_unit' => 'months']);

        return ['mode' => 'existing', 'product_id' => $product->id, 'profile_id' => $profile->id, 'serial_number' => 'RO-INTAKE', 'purchased_on' => '2026-01-15', 'installed_on' => '2026-01-31'];
    }

    public function test_customer_can_be_created_without_a_product(): void
    {
        $this->actingAs($this->admin)->postJson('/api/parties', ['name' => 'Contact only', 'is_customer' => true])->assertCreated()->assertJsonPath('product_entry_result', null);
        $this->assertDatabaseCount('customer_units', 0);
        $this->assertDatabaseCount('trade_documents', 0);
    }

    public function test_one_save_records_customer_location_filter_custom_values_and_actual_schedule(): void
    {
        $this->travelTo(Carbon::parse('2026-10-26 12:00:00', 'Africa/Cairo'));
        CustomField::query()->create(['entity_type' => 'customer_units', 'key' => 'kitchen', 'type' => 'text', 'label_ar' => 'المطبخ', 'label_en' => 'Kitchen', 'required' => true]);
        CustomField::query()->create(['entity_type' => 'party_addresses', 'key' => 'gate', 'type' => 'text', 'label_ar' => 'البوابة', 'label_en' => 'Gate', 'required' => true]);
        $entry = $this->existingEntry() + ['warranty_ends_on' => '2027-01-31', 'custom_fields' => ['kitchen' => 'Main'], 'address_form' => ['custom_fields' => ['gate' => '2']]];
        $response = $this->actingAs($this->admin)->postJson('/api/parties', ['name' => 'Connected household', 'is_customer' => true, 'city' => 'Cairo', 'address' => 'Street 12', 'product_entry' => $entry])->assertCreated();
        $partyId = $response->json('data.id');
        $unitId = $response->json('product_entry_result.unit_id');
        $unit = CustomerUnit::query()->findOrFail($unitId);
        $this->assertSame($partyId, $unit->party_id);
        $this->assertSame('active', $unit->status);
        $this->assertSame('2026-04-30', $unit->schedules()->first()->next_due_on->toDateString());
        $this->assertDatabaseHas('party_addresses', ['id' => $unit->address_id, 'party_id' => $partyId, 'street' => 'Street 12']);
        $this->getJson('/api/customer-units/'.$unitId)->assertOk()->assertJsonPath('data.custom_fields.kitchen', 'Main');
        $this->getJson('/api/parties/'.$partyId.'/addresses')->assertOk()->assertJsonPath('data.0.custom_fields.gate', '2');
        $this->assertDatabaseCount('stock_moves', 0);
        $this->assertDatabaseCount('trade_documents', 0);
        $this->assertDatabaseHas('maintenance_events', ['unit_id' => $unitId, 'kind' => 'installation']);
    }

    public function test_unknown_installation_date_remains_pending_instead_of_inventing_history(): void
    {
        $entry = $this->existingEntry();
        unset($entry['installed_on']);
        $response = $this->actingAs($this->admin)->postJson('/api/parties', ['name' => 'Unknown date', 'is_customer' => true, 'product_entry' => $entry])->assertCreated()->assertJsonPath('product_entry_result.status', 'pending_installation');
        $this->assertDatabaseHas('customer_units', ['id' => $response->json('product_entry_result.unit_id'), 'installed_on' => null]);
        $this->assertDatabaseCount('unit_stage_schedules', 0);
    }

    public function test_invalid_or_duplicate_serial_rolls_back_the_entire_customer_entry(): void
    {
        $entry = $this->existingEntry();
        $this->actingAs($this->admin)->postJson('/api/parties', ['name' => 'Original', 'is_customer' => true, 'product_entry' => $entry])->assertCreated();
        $this->postJson('/api/parties', ['name' => 'Duplicate', 'is_customer' => true, 'city' => 'Cairo', 'product_entry' => $entry])->assertUnprocessable()->assertJsonValidationErrors('product_entry.serial_number');
        $this->assertDatabaseMissing('parties', ['name' => 'Duplicate']);
        $this->assertDatabaseCount('customer_units', 1);
        $this->assertDatabaseCount('party_addresses', 0);
        $this->assertDatabaseCount('product_serials', 1);
    }

    public function test_missing_child_fields_and_invalid_dates_never_leave_partial_records(): void
    {
        $entry = $this->existingEntry();
        CustomField::query()->create(['entity_type' => 'customer_units', 'key' => 'required_detail', 'type' => 'text', 'label_ar' => 'بيانات', 'label_en' => 'Details', 'required' => true]);
        $this->actingAs($this->admin)->postJson('/api/parties', ['name' => 'Missing detail', 'is_customer' => true, 'city' => 'Cairo', 'product_entry' => $entry])->assertUnprocessable()->assertJsonValidationErrors('product_entry.custom_fields.required_detail');
        $this->assertDatabaseMissing('parties', ['name' => 'Missing detail']);
        $this->assertDatabaseCount('customer_units', 0);
        $this->assertDatabaseCount('party_addresses', 0);
        $this->assertDatabaseCount('product_serials', 0);
        $entry['custom_fields'] = ['required_detail' => 'Present'];
        $entry['installed_on'] = '2025-01-01';
        $this->postJson('/api/parties', ['name' => 'Invalid date', 'is_customer' => true, 'product_entry' => $entry])->assertUnprocessable();
        $this->assertDatabaseMissing('parties', ['name' => 'Invalid date']);
        $this->assertDatabaseCount('maintenance_events', 0);
    }

    public function test_new_sale_creates_a_linked_invoice_draft_and_uses_normal_stock_posting(): void
    {
        $product = $this->product();
        $this->stockIn($product, 10, 60);
        $response = $this->actingAs($this->admin)->postJson('/api/parties', ['name' => 'New buyer', 'is_customer' => true, 'product_entry' => ['mode' => 'new_sale', 'product_id' => $product->id, 'quantity' => 2, 'unit_price' => 100, 'warehouse_id' => $this->warehouse->id]])->assertCreated()->assertJsonPath('product_entry_result.status', 'draft');
        $invoiceId = $response->json('product_entry_result.invoice_id');
        $invoice = TradeDocument::query()->findOrFail($invoiceId);
        $this->assertSame($response->json('data.id'), $invoice->party_id);
        $this->assertEquals(2, $invoice->lines()->first()->quantity);
        $this->assertSame(10.0, $this->onHand($product));
        $this->assertDatabaseCount('customer_units', 0);
        $this->postJson('/api/documents/sales_invoice/'.$invoiceId.'/post')->assertOk();
        $this->assertSame(8.0, $this->onHand($product));
        $this->assertBooksBalanced();
    }

    public function test_nested_permissions_and_supplier_entry_cannot_bypass_domain_access(): void
    {
        $entry = $this->existingEntry();
        $sales = $this->asUserWithRole('salesperson');
        $this->actingAs($sales)->postJson('/api/parties', ['name' => 'Unauthorized', 'is_customer' => true, 'product_entry' => $entry])->assertForbidden();
        $this->assertDatabaseMissing('parties', ['name' => 'Unauthorized']);
        $this->actingAs($this->admin)->postJson('/api/parties', ['name' => 'Supplier mismatch', 'is_supplier' => true, 'product_entry' => $entry])->assertUnprocessable();
        $this->assertDatabaseMissing('parties', ['name' => 'Supplier mismatch']);
    }

    public function test_outer_customer_custom_field_failure_also_rolls_back_the_linked_filter(): void
    {
        $entry = $this->existingEntry();
        CustomField::query()->create(['entity_type' => 'parties', 'key' => 'required_household', 'type' => 'text', 'label_ar' => 'بيانات', 'label_en' => 'Details', 'required' => true]);
        $this->actingAs($this->admin)->postJson('/api/parties', ['name' => 'Missing household', 'is_customer' => true, 'product_entry' => $entry])->assertUnprocessable();
        $this->assertDatabaseMissing('parties', ['name' => 'Missing household']);
        $this->assertDatabaseCount('customer_units', 0);
        $this->assertDatabaseCount('product_serials', 0);
        $this->assertDatabaseCount('maintenance_events', 0);
    }

    public function test_invoice_custom_fields_are_required_and_persisted_in_combined_entry(): void
    {
        $product = $this->product();
        CustomField::query()->create(['entity_type' => 'trade_documents', 'key' => 'delivery_note', 'type' => 'text', 'label_ar' => 'التوصيل', 'label_en' => 'Delivery note', 'required' => true]);
        $body = ['name' => 'Invoice metadata', 'is_customer' => true, 'product_entry' => ['mode' => 'new_sale', 'product_id' => $product->id, 'quantity' => 1, 'unit_price' => 100, 'warehouse_id' => $this->warehouse->id]];
        $this->actingAs($this->admin)->postJson('/api/parties', $body)->assertUnprocessable()->assertJsonValidationErrors('product_entry.custom_fields.delivery_note');
        $this->assertDatabaseMissing('parties', ['name' => 'Invoice metadata']);
        $this->assertDatabaseCount('trade_documents', 0);
        $body['product_entry']['custom_fields'] = ['delivery_note' => 'After 6 pm'];
        $response = $this->postJson('/api/parties', $body)->assertCreated();
        $this->getJson('/api/documents/sales_invoice/'.$response->json('product_entry_result.invoice_id'))->assertOk()->assertJsonPath('data.custom_fields.delivery_note', 'After 6 pm');
    }

    public function test_invoice_field_permissions_cannot_be_bypassed_through_customer_entry(): void
    {
        $product = $this->product();
        CustomField::query()->create(['entity_type' => 'trade_documents', 'key' => 'internal', 'type' => 'text', 'label_ar' => 'داخلي', 'label_en' => 'Internal', 'role_access_json' => ['read' => ['accountant'], 'write' => ['accountant']]]);
        $sales = $this->asUserWithRole('salesperson');
        $this->actingAs($sales)->postJson('/api/parties', ['name' => 'Unauthorized invoice field', 'is_customer' => true, 'product_entry' => ['mode' => 'new_sale', 'product_id' => $product->id, 'quantity' => 1, 'unit_price' => 100, 'warehouse_id' => $this->warehouse->id, 'custom_fields' => ['internal' => 'Forbidden']]])->assertForbidden();
        $this->assertDatabaseMissing('parties', ['name' => 'Unauthorized invoice field']);
        $this->assertDatabaseCount('trade_documents', 0);
    }

    public function test_customer_with_filter_history_is_deactivated_without_losing_the_relationship(): void
    {
        $entry = $this->existingEntry();
        $response = $this->actingAs($this->admin)->postJson('/api/parties', ['name' => 'Keep service history', 'is_customer' => true, 'product_entry' => $entry])->assertCreated();
        $partyId = $response->json('data.id');
        $this->deleteJson('/api/parties/'.$partyId)->assertOk()->assertJsonPath('deactivated', true);
        $this->assertDatabaseHas('parties', ['id' => $partyId, 'is_active' => false, 'deleted_at' => null]);
        $this->assertSame($partyId, CustomerUnit::query()->first()->party->id);
    }
}
