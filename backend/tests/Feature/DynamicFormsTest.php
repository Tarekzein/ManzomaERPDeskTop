<?php

namespace Tests\Feature;

use App\Modules\Core\Models\CustomField;
use App\Modules\Core\Services\DynamicFormService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class DynamicFormsTest extends TestCase
{
    private function field(array $attributes = []): CustomField
    {
        return CustomField::query()->create($attributes + ['entity_type' => 'parties', 'key' => 'water_source', 'type' => 'text', 'label_ar' => 'مصدر المياه', 'label_en' => 'Water source', 'usage_flags_json' => ['list' => true, 'filter' => true, 'print' => true]]);
    }

    public function test_custom_values_validate_atomically_and_are_indexed(): void
    {
        $field = $this->field(['required' => true]);
        $this->actingAs($this->admin)->postJson('/api/parties', ['is_customer' => true, 'name' => 'Incomplete'])->assertUnprocessable();
        $this->assertDatabaseMissing('parties', ['name' => 'Incomplete']);
        $response = $this->postJson('/api/parties', ['is_customer' => true, 'name' => 'Household', 'custom_fields' => ['water_source' => 'Nile']])->assertCreated();
        $id = $response->json('data.id');
        $this->assertSame('Nile', $response->json('data.custom_fields.water_source'));
        $this->assertDatabaseHas('custom_field_index', ['field_id' => $field->id, 'entity_id' => $id, 'text_value' => 'Nile']);
        $this->getJson('/api/parties?role=customer&custom[water_source]=Nile')->assertOk()->assertJsonCount(1, 'data');
        $this->putJson('/api/parties/'.$id, ['name' => 'New name', 'lock_version' => 0, 'custom_fields' => ['water_source' => 'Tap']])->assertConflict();
        $this->assertDatabaseHas('parties', ['id' => $id, 'name' => 'Household']);
    }

    public function test_hidden_fields_cannot_be_written_filtered_or_read(): void
    {
        $this->field(['role_access_json' => ['read' => ['accountant'], 'write' => ['accountant']]]);
        $party = $this->actingAs($this->admin)->postJson('/api/parties', ['is_customer' => true, 'name' => 'Private', 'custom_fields' => ['water_source' => 'Secret']])->json('data.id');
        $user = $this->asUserWithRole('salesperson');
        $this->actingAs($user);
        $this->getJson('/api/parties/'.$party)->assertOk()->assertJsonMissingPath('data.custom_fields.water_source');
        $this->getJson('/api/forms/customers')->assertOk()->assertJsonCount(0, 'fields');
        $this->putJson('/api/parties/'.$party, ['name' => 'Attempt', 'custom_fields' => ['water_source' => 'Changed']])->assertForbidden();
        $this->getJson('/api/parties?role=customer&custom[water_source]=Secret')->assertUnprocessable();
        $this->assertDatabaseHas('parties', ['id' => $party, 'name' => 'Private']);
    }

    public function test_publishing_rejects_cycles_and_stale_schema_writes(): void
    {
        $this->field();
        $this->actingAs($this->admin)->postJson('/api/admin/forms/customers/draft')->assertOk();
        $this->postJson('/api/admin/forms/customers/publish')->assertOk();
        $this->postJson('/api/parties', ['is_customer' => true, 'name' => 'Old schema', 'form_version' => 0])->assertConflict();
        $this->field(['key' => 'loop', 'condition_json' => ['field' => 'loop', 'operator' => 'not_empty']]);
        $this->postJson('/api/admin/forms/customers/draft')->assertOk();
        $this->postJson('/api/admin/forms/customers/publish')->assertUnprocessable();
    }

    public function test_typed_multi_select_and_conditional_required_fields(): void
    {
        $this->field(['type' => 'dropdown', 'options_json' => [['value' => 'well', 'label_ar' => 'بئر', 'label_en' => 'Well'], ['value' => 'tap', 'label_ar' => 'حنفية', 'label_en' => 'Tap']]]);
        $this->field(['key' => 'depth', 'type' => 'decimal', 'required' => true, 'condition_json' => ['field' => 'water_source', 'operator' => 'equals', 'value' => 'well'], 'validation_json' => ['min' => 1]]);
        $this->actingAs($this->admin)->postJson('/api/parties', ['is_customer' => true, 'name' => 'Tap', 'custom_fields' => ['water_source' => 'tap']])->assertCreated();
        $this->postJson('/api/parties', ['is_customer' => true, 'name' => 'Well', 'custom_fields' => ['water_source' => 'well']])->assertUnprocessable();
        $this->postJson('/api/parties', ['is_customer' => true, 'name' => 'Well', 'custom_fields' => ['water_source' => 'well', 'depth' => 12.5]])->assertCreated();
        $this->assertDatabaseHas('custom_field_index', ['number_value' => 12.5]);
    }

    public function test_long_custom_text_is_searchable_on_products_beyond_index_prefix(): void
    {
        $this->field(['entity_type' => 'products', 'type' => 'long_text', 'usage_flags_json' => ['search' => true]]);
        $product = $this->product();
        $this->actingAs($this->admin)->putJson('/api/products/'.$product->id, ['name' => $product->name, 'type' => 'stock', 'base_unit_id' => $product->base_unit_id, 'custom_fields' => ['water_source' => str_repeat('x', 250).'unique-search-tail']])->assertOk();
        $this->getJson('/api/products?search=unique-search-tail')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/products?search=absent-tail')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_private_attachment_cannot_be_reassigned_to_a_public_field(): void
    {
        Storage::fake('local');
        $private = $this->field(['type' => 'file', 'role_access_json' => ['read' => ['accountant'], 'write' => ['accountant']]]);
        $this->field(['key' => 'public_file', 'type' => 'file']);
        $party = $this->customer();
        $attachment = $this->actingAs($this->admin)->post('/api/attachments', ['form_key' => 'customers', 'entity_id' => $party->id, 'field_key' => 'water_source', 'file' => UploadedFile::fake()->create('private.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertCreated()->json('data.id');
        $this->putJson('/api/parties/'.$party->id, ['name' => $party->name, 'custom_fields' => ['public_file' => $attachment]])->assertForbidden();
        $sales = $this->asUserWithRole('salesperson');
        $this->actingAs($sales);
        $this->get('/api/attachments/'.$attachment)->assertForbidden();
        $this->post('/api/attachments', ['form_key' => 'customers', 'entity_id' => $party->id, 'field_key' => 'water_source', 'file' => UploadedFile::fake()->create('attempt.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->assertForbidden();
    }

    public function test_import_validates_custom_fields_and_preview_has_no_side_effects(): void
    {
        $this->field(['required' => true]);
        $this->actingAs($this->admin)->postJson('/api/import/customers', ['rows' => [['code' => 'IMPORT', 'name' => 'Missing water source']]])->assertOk()->assertJsonCount(1, 'errors');
        $this->assertDatabaseMissing('parties', ['code' => 'IMPORT']);
        $row = ['code' => 'IMPORT', 'name' => 'Imported household', 'custom.water_source' => 'Tap'];
        $this->postJson('/api/import/customers', ['dry_run' => true, 'rows' => [$row]])->assertOk()->assertJsonPath('created', 1)->assertJsonCount(0, 'errors');
        $this->assertDatabaseMissing('parties', ['code' => 'IMPORT']);
        $this->postJson('/api/import/customers', ['rows' => [$row]])->assertOk()->assertJsonPath('created', 1)->assertJsonCount(0, 'errors');
        $this->assertDatabaseHas('custom_field_index', ['text_value' => 'Tap']);
    }

    public function test_posted_custom_print_values_keep_the_original_labels(): void
    {
        $field = $this->field(['entity_type' => 'trade_documents']);
        $product = $this->product(['type' => 'service']);
        $party = $this->customer();
        $doc = $this->actingAs($this->admin)->postJson('/api/documents/sales_invoice', ['party_id' => $party->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 100]], 'custom_fields' => ['water_source' => 'Original']])->assertCreated()->json('data.id');
        $this->postJson('/api/documents/sales_invoice/'.$doc.'/post')->assertOk();
        $field->update(['label_en' => 'Renamed later']);
        app(DynamicFormService::class)->flush();
        $this->getJson('/api/documents/sales_invoice/'.$doc)->assertOk()->assertJsonPath('data.custom_print_fields.0.label_en', 'Water source')->assertJsonPath('data.custom_print_fields.0.value', 'Original');
    }

    public function test_typed_sort_and_checkbox_filter_use_authorized_projections(): void
    {
        $field = $this->field(['type' => 'decimal', 'usage_flags_json' => ['list' => true, 'filter' => true]]);
        $this->field(['key' => 'contract', 'type' => 'checkbox', 'usage_flags_json' => ['filter' => true]]);
        $this->actingAs($this->admin)->postJson('/api/parties', ['is_customer' => true, 'name' => 'Ten', 'custom_fields' => ['water_source' => 10, 'contract' => true]])->assertCreated();
        $this->postJson('/api/parties', ['is_customer' => true, 'name' => 'Two', 'custom_fields' => ['water_source' => 2, 'contract' => false]])->assertCreated();
        $this->getJson('/api/parties?role=customer&sort=custom:water_source')->assertOk()->assertJsonPath('data.0.name', 'Two');
        $this->getJson('/api/parties?role=customer&custom[contract]=true')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Ten');
        DB::table('custom_field_index')->where('field_id', $field->id)->delete();
        $this->artisan('erp:custom-fields-rebuild')->assertSuccessful();
        $this->assertDatabaseHas('custom_field_index', ['field_id' => $field->id, 'number_value' => 10]);
    }

    public function test_read_only_custom_values_can_be_retained_while_editing_core_fields(): void
    {
        $this->field(['role_access_json' => ['read' => ['salesperson'], 'write' => ['accountant']]]);
        $party = $this->actingAs($this->admin)->postJson('/api/parties', ['is_customer' => true, 'name' => 'Original', 'custom_fields' => ['water_source' => 'Office verified']])->assertCreated()->json('data.id');
        $sales = $this->asUserWithRole('salesperson');
        $this->actingAs($sales)->getJson('/api/forms/customers')->assertOk()->assertJsonPath('fields.0.writable', false);
        $this->putJson('/api/parties/'.$party, ['form_key' => 'customers', 'name' => 'Updated', 'custom_fields' => []])->assertOk()->assertJsonPath('data.custom_fields.water_source', 'Office verified');
        $this->putJson('/api/parties/'.$party, ['form_key' => 'customers', 'name' => 'Attempt', 'custom_fields' => ['water_source' => 'Tampered']])->assertForbidden();
    }
}
