<?php

namespace Tests\Feature;

use App\Modules\Core\Models\CustomField;
use App\Modules\Core\Models\FormDefinition;
use App\Modules\Core\Services\BuiltinFormRegistry;
use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Core\Services\FormRegistry;
use App\Modules\CRM\Models\Opportunity;
use App\Modules\CRM\Models\Stage;
use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Models\Voucher;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class UniversalFormsTest extends TestCase
{
    private function custom(array $values = []): CustomField
    {
        return CustomField::query()->create($values + ['entity_type' => 'parties', 'key' => 'water_source', 'type' => 'text', 'label_ar' => 'مصدر المياه', 'label_en' => 'Water source']);
    }

    public function test_legacy_custom_layouts_gain_core_controls_without_losing_custom_order(): void
    {
        $field = $this->custom();
        FormDefinition::query()->create(['form_key' => 'customers', 'entity_type' => 'parties', 'version' => 1, 'status' => 'published', 'fields_json' => [$field->toArray()], 'layout_json' => ['sections' => [['key' => 'legacy', 'label_ar' => 'قديم', 'label_en' => 'Legacy', 'columns' => 1, 'fields' => ['water_source']]]]]);
        $schema = $this->actingAs($this->admin)->getJson('/api/forms/customers')->assertOk();
        $this->assertContains('core.name', array_column($schema->json('core_fields'), 'key'));
        $sections = collect($schema->json('layout.sections'));
        $this->assertSame(['water_source'], $sections->last()['fields']);
        $this->assertSame('legacy', $sections->last()['key']);
        $this->assertSame(1, $schema->json('version'));
    }

    public function test_admin_can_mix_core_and_custom_fields_but_cannot_hide_protected_controls(): void
    {
        $this->custom();
        $draft = $this->actingAs($this->admin)->postJson('/api/admin/forms/customers/draft')->assertOk()->json('data.layout_json');
        $all = collect($draft['sections'])->flatMap(fn ($section) => $section['fields'])->values()->all();
        $layout = ['engine_version' => 2, 'core_version' => 1, 'sections' => [['key' => 'mixed', 'label_ar' => 'موحد', 'label_en' => 'Combined', 'columns' => 3, 'fields' => ['water_source', ...array_values(array_diff($all, ['water_source', 'core.phone']))]]]];
        $this->putJson('/api/admin/forms/customers/draft', ['layout' => $layout])->assertOk();
        $this->postJson('/api/admin/forms/customers/publish')->assertOk();
        $this->getJson('/api/forms/customers')->assertOk()->assertJsonPath('layout.sections.0.fields.0', 'water_source')->assertJsonPath('layout.sections.0.fields.1', 'core.name');
        $this->postJson('/api/admin/forms/customers/draft')->assertOk();
        $layout['sections'][0]['fields'] = array_values(array_diff($layout['sections'][0]['fields'], ['core.name']));
        $this->putJson('/api/admin/forms/customers/draft', ['layout' => $layout])->assertOk();
        $this->postJson('/api/admin/forms/customers/publish')->assertUnprocessable();
        $this->postJson('/api/parties', ['is_customer' => true, 'name' => ''])->assertUnprocessable();
    }

    public function test_core_conditions_use_saved_domain_values_including_partial_updates(): void
    {
        $this->custom(['required' => true, 'condition_json' => ['field' => 'core.kind', 'operator' => 'equals', 'value' => 'company']]);
        $this->actingAs($this->admin)->postJson('/api/admin/forms/customers/draft')->assertOk();
        $this->postJson('/api/admin/forms/customers/publish')->assertOk();
        $party = $this->postJson('/api/parties', ['name' => 'Household', 'is_customer' => true, 'kind' => 'individual'])->assertCreated()->json('data.id');
        $this->putJson('/api/parties/'.$party, ['name' => 'Company', 'kind' => 'company', 'core.kind' => 'individual'])->assertUnprocessable();
        $this->assertDatabaseHas('parties', ['id' => $party, 'kind' => 'individual']);
        $this->putJson('/api/parties/'.$party, ['name' => 'Company', 'kind' => 'company', 'custom_fields' => ['water_source' => 'Tap']])->assertOk();
        $this->putJson('/api/parties/'.$party, ['name' => 'Company updated', 'custom_fields' => ['water_source' => null]])->assertUnprocessable();
    }

    public function test_supplier_detail_and_explicit_party_form_choose_the_correct_schema(): void
    {
        $this->custom(['applicable_forms_json' => ['suppliers']]);
        $supplier = $this->actingAs($this->admin)->postJson('/api/parties', ['name' => 'Supplier', 'is_supplier' => true, 'is_customer' => false, 'custom_fields' => ['water_source' => 'Factory']])->assertCreated()->json('data.id');
        $this->getJson('/api/parties/'.$supplier)->assertOk()->assertJsonPath('data.custom_fields.water_source', 'Factory');
        $this->postJson('/api/parties', ['form_key' => 'users', 'name' => 'Invalid', 'is_customer' => true])->assertUnprocessable();
        $this->putJson('/api/parties/'.$supplier, ['form_key' => 'suppliers', 'name' => 'Both roles', 'is_customer' => true, 'is_supplier' => true, 'custom_fields' => ['water_source' => 'Factory updated']])->assertOk()->assertJsonPath('data.custom_fields.water_source', 'Factory updated');
    }

    public function test_record_lists_fetch_custom_values_in_one_query(): void
    {
        $this->custom();
        for ($i = 0; $i < 5; $i++) {
            $this->customer();
        }
        DB::enableQueryLog();
        $this->actingAs($this->admin)->getJson('/api/parties?role=customer')->assertOk()->assertJsonCount(5, 'data');
        $queries = collect(DB::getQueryLog())->pluck('query');
        DB::disableQueryLog();
        $this->assertCount(1, $queries->filter(fn ($query) => str_contains($query, 'select') && str_contains($query, 'entity_custom_data')));
        $this->assertCount(1, $queries->filter(fn ($query) => str_contains($query, 'select') && str_contains($query, 'form_definitions')));
    }

    public function test_every_migrated_form_has_unique_domain_fields_and_registered_widgets(): void
    {
        $registry = app(BuiltinFormRegistry::class);
        $keys = array_keys(app(FormRegistry::class)->all());
        $this->assertCount(48, $keys);
        $widgets = ['branch', 'category', 'price_list', 'crm_source', 'user', 'salesperson', 'technician', 'credit_limit', 'tags', 'contacts', 'follow_up', 'party_customer', 'crm_stage', 'account_parent', 'warehouse', 'product_category', 'brand', 'trade_party', 'stock_warehouse', 'stock_to', 'stock_category', 'default_warehouse', 'cash_account'];
        foreach ($keys as $key) {
            $fields = $registry->fields($key);
            $this->assertNotEmpty($fields);
            $this->assertCount(count($fields), array_unique(array_column($fields, 'key')));
            foreach ($fields as $field) {
                if (isset($field['widget'])) {
                    $this->assertContains($field['widget'], $widgets);
                }
            }
        }
    }

    public function test_account_tree_cannot_cycle_or_move_system_accounts(): void
    {
        $root = Account::query()->where('is_group', true)->whereNull('parent_id')->firstOrFail();
        $parent = Account::query()->create(['code' => '998', 'name' => 'Parent', 'type' => $root->type, 'parent_id' => $root->id, 'is_group' => true]);
        $child = Account::query()->create(['code' => '99801', 'name' => 'Child', 'type' => $root->type, 'parent_id' => $parent->id, 'is_group' => true]);
        $this->actingAs($this->admin)->putJson('/api/accounts/'.$parent->id, ['name' => 'Cycle', 'parent_id' => $child->id])->assertUnprocessable();
        $system = Account::query()->whereNotNull('system_key')->whereNotNull('parent_id')->firstOrFail();
        $this->putJson('/api/accounts/'.$system->id, ['name' => $system->name, 'parent_id' => null])->assertUnprocessable();
        $this->assertDatabaseHas('accounts', ['id' => $parent->id, 'parent_id' => $root->id]);
        $this->putJson('/api/accounts/'.$parent->id, ['name' => 'Lose children', 'parent_id' => $root->id, 'is_group' => false])->assertUnprocessable();
    }

    public function test_opportunity_record_access_matches_the_scoped_pipeline(): void
    {
        $opportunity = Opportunity::query()->create(['title' => 'Private', 'party_id' => $this->customer()->id, 'stage_id' => Stage::query()->firstOrFail()->id, 'owner_id' => $this->admin->id]);
        $user = $this->asUserWithRole('salesperson');
        $this->actingAs($user)->getJson('/api/crm/opportunities/'.$opportunity->id)->assertForbidden();
        $this->putJson('/api/crm/opportunities/'.$opportunity->id, ['title' => 'Attempt', 'party_id' => $opportunity->party_id])->assertForbidden();
        $this->deleteJson('/api/crm/opportunities/'.$opportunity->id)->assertForbidden();
    }

    public function test_party_form_selection_cannot_bypass_entity_form_permissions(): void
    {
        $purchaser = $this->asUserWithRole('purchaser');
        $this->actingAs($purchaser)->postJson('/api/parties', ['form_key' => 'customers', 'name' => 'Unauthorized form', 'is_supplier' => true, 'is_customer' => false])->assertForbidden();
        $this->assertDatabaseMissing('parties', ['name' => 'Unauthorized form']);
    }

    public function test_legacy_section_names_cannot_collide_with_added_domain_sections(): void
    {
        $layout = app(BuiltinFormRegistry::class)->layout('brands', ['sections' => [['key' => 'core.details', 'label_ar' => 'قديم', 'label_en' => 'Legacy', 'columns' => 1, 'fields' => []]]], []);
        $keys = array_column($layout['sections'], 'key');
        $this->assertCount(count($keys), array_unique($keys));
        $this->assertSame('core.details', $keys[1]);
    }

    public function test_a_form_published_before_its_core_migration_can_upgrade_without_duplicate_controls(): void
    {
        $registry = app(BuiltinFormRegistry::class);
        $layout = ['engine_version' => 2, 'core_version' => 0, 'sections' => [['key' => 'custom', 'label_ar' => 'إضافي', 'label_en' => 'Custom', 'columns' => 1, 'fields' => ['example']]]];
        $migrated = $registry->layout('brands', $layout, ['example']);
        $this->assertSame(1, $migrated['core_version']);
        $keys = collect($migrated['sections'])->flatMap(fn ($section) => $section['fields'])->all();
        $this->assertSame(['core.name', 'example'], $keys);
        $this->assertSame($migrated, $registry->layout('brands', $migrated, ['example']));
    }

    public function test_core_money_and_date_conditions_match_database_casts(): void
    {
        $this->custom(['entity_type' => 'crm_opportunities', 'required' => true, 'condition_json' => ['field' => 'core.value', 'operator' => 'equals', 'value' => 100]]);
        $this->custom(['entity_type' => 'crm_opportunities', 'key' => 'access_note', 'required' => true, 'condition_json' => ['field' => 'core.expected_close_date', 'operator' => 'equals', 'value' => '2026-12-31']]);
        $this->actingAs($this->admin)->postJson('/api/admin/forms/opportunities/draft')->assertOk();
        $this->postJson('/api/admin/forms/opportunities/publish')->assertOk();
        $body = ['title' => 'Install filter', 'party_id' => $this->customer()->id, 'value' => 100, 'expected_close_date' => '2026-12-31'];
        $this->postJson('/api/crm/opportunities', $body)->assertUnprocessable()->assertJsonValidationErrors(['custom_fields.water_source', 'custom_fields.access_note']);
        $this->postJson('/api/crm/opportunities', $body + ['custom_fields' => ['water_source' => 'Tap', 'access_note' => 'After 6pm']])->assertCreated();
    }

    public function test_company_setting_conditions_read_actual_settings_and_rollback_invalid_changes(): void
    {
        $this->custom(['entity_type' => 'settings', 'key' => 'fiscal_note', 'required' => true, 'condition_json' => ['field' => 'core.company.tax_number', 'operator' => 'not_empty']]);
        $this->actingAs($this->admin)->postJson('/api/admin/forms/company-settings/draft')->assertOk();
        $this->postJson('/api/admin/forms/company-settings/publish')->assertOk();
        $this->putJson('/api/settings', ['values' => ['company.tax_number' => '123456789']])->assertUnprocessable()->assertJsonValidationErrors('custom_fields.fiscal_note');
        $this->assertDatabaseMissing('settings', ['key' => 'company.tax_number', 'value' => json_encode('123456789')]);
        $this->putJson('/api/settings', ['values' => ['company.tax_number' => '123456789'], 'custom_fields' => ['fiscal_note' => 'Accountant reviewed']])->assertOk()->assertJsonPath('custom_meta.custom_fields.fiscal_note', 'Accountant reviewed');
        $this->getJson('/api/settings')->assertOk()->assertJsonPath('data', fn ($values) => $values['company.tax_number'] === '123456789');
        $this->getJson('/api/forms/users')->assertOk()->assertJsonPath('core_fields.0.key', 'core.name');
        $this->getJson('/api/forms/roles')->assertOk()->assertJsonPath('core_fields.0.protected', true);
    }

    public function test_grouped_custom_reports_use_the_company_singleton_and_correct_voucher_kind(): void
    {
        $this->actingAs($this->admin);
        $forms = app(DynamicFormService::class);
        $this->custom(['entity_type' => 'settings', 'key' => 'region', 'usage_flags_json' => ['report' => true, 'filter' => true]]);
        $forms->save('company-settings', 1, ['custom_fields' => ['region' => 'Cairo']]);
        $this->getJson('/api/reports/custom-fields/company-settings?field=region')->assertOk()->assertJsonPath('total_values', 1)->assertJsonPath('rows.data.0.value', 'Cairo');
        $this->getJson('/api/reports/custom-fields/company-settings?field=region&custom[region]=Alex')->assertOk()->assertJsonPath('total_values', 0);
        $this->custom(['entity_type' => 'vouchers', 'key' => 'region', 'usage_flags_json' => ['report' => true]]);
        $party = $this->customer();
        foreach (['receipt', 'payment', 'expense'] as $index => $kind) {
            $voucher = Voucher::create(['number' => 'REPORT-'.$index, 'date' => '2026-10-27', 'type' => $kind === 'expense' ? 'payment' : $kind, 'amount' => 10, 'cash_account_id' => $this->cash->id, 'party_id' => $kind === 'expense' ? null : $party->id]);
            $forms->save('voucher_'.$kind, $voucher->id, ['custom_fields' => ['region' => $kind]]);
        }
        foreach (['receipt', 'payment', 'expense'] as $kind) {
            $this->getJson('/api/reports/custom-fields/voucher_'.$kind.'?field=region')->assertOk()->assertJsonPath('total_values', 1)->assertJsonPath('rows.data.0.value', $kind);
        }
    }
}
