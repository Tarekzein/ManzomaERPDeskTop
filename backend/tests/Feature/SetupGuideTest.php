<?php

namespace Tests\Feature;

use App\Modules\Core\Models\Setting;
use App\Modules\Core\Services\SettingsService;
use App\Modules\Core\Services\SetupGuideService;
use App\Modules\Finance\Models\FiscalYear;
use Tests\TestCase;

class SetupGuideTest extends TestCase
{
    private function review(string $step, bool $defer = false)
    {
        return $this->postJson('/api/setup-guide', ['action' => 'review', 'step' => $step, 'defer' => $defer]);
    }

    public function test_new_companies_start_a_resumable_guide_but_existing_companies_are_not_forced_into_it(): void
    {
        $this->actingAs($this->admin)->getJson('/api/setup-guide')->assertOk()->assertJsonPath('auto_start', true)->assertJsonPath('current_step', 'company')->assertJsonPath('done', 0);
        $this->review('company')->assertOk()->assertJsonPath('done', 1)->assertJsonPath('current_step', 'locations');
        $this->postJson('/api/setup-guide', ['action' => 'pause'])->assertOk()->assertJsonPath('status', 'paused')->assertJsonPath('auto_start', false)->assertJsonPath('done', 1);
        $this->postJson('/api/setup-guide', ['action' => 'start'])->assertOk()->assertJsonPath('status', 'active')->assertJsonPath('done', 1);
        Setting::whereKey(SetupGuideService::KEY)->delete();
        $this->getJson('/api/setup-guide')->assertOk()->assertJsonPath('status', 'not_started')->assertJsonPath('auto_start', false);
        $this->postJson('/api/setup-guide', ['action' => 'start'])->assertOk()->assertJsonPath('auto_start', true);
    }

    public function test_real_data_and_review_order_are_required_and_mandatory_steps_cannot_be_deferred(): void
    {
        $this->actingAs($this->admin);
        $this->review('finance')->assertUnprocessable();
        $this->review('company', true)->assertUnprocessable();
        $this->review('company')->assertOk();
        $this->review('locations')->assertOk();
        $this->review('finance')->assertOk();
        $this->review('products')->assertUnprocessable();
        $this->product();
        $this->review('products')->assertOk()->assertJsonPath('done', 4);
        $this->review('maintenance')->assertUnprocessable();
        $this->review('maintenance', true)->assertOk()->assertJsonPath('steps.4.deferred', true);
        $this->review('customers', true)->assertOk()->assertJsonPath('can_finish', true);
        $this->postJson('/api/setup-guide', ['action' => 'complete'])->assertOk()->assertJsonPath('status', 'completed')->assertJsonPath('auto_start', false);
        $this->assertDatabaseCount('stock_moves', 0);
        $this->assertDatabaseCount('journal_entries', 0);
        $this->assertDatabaseCount('trade_documents', 0);
        $this->assertDatabaseCount('parties', 0);
        $completed = app(SetupGuideService::class)->status()['completed_at'];
        $this->postJson('/api/setup-guide', ['action' => 'complete'])->assertOk()->assertJsonPath('completed_at', $completed);
        $this->postJson('/api/setup-guide', ['action' => 'start'])->assertOk()->assertJsonPath('current_step', 'maintenance')->assertJsonPath('done', 4)->assertJsonPath('steps.4.deferred', false);
    }

    public function test_completion_rechecks_required_data_and_cannot_fabricate_readiness(): void
    {
        $this->actingAs($this->admin);
        $this->postJson('/api/setup-guide', ['action' => 'complete'])->assertUnprocessable();
        $this->review('company')->assertOk();
        $this->review('locations')->assertOk();
        $this->review('finance')->assertOk();
        $product = $this->product();
        $this->review('products')->assertOk();
        $this->review('maintenance', true)->assertOk();
        $this->review('customers', true)->assertOk();
        $product->update(['is_active' => false]);
        $this->postJson('/api/setup-guide', ['action' => 'complete'])->assertUnprocessable();
        $this->getJson('/api/setup-guide')->assertOk()->assertJsonPath('current_step', 'products')->assertJsonPath('can_finish', false);
    }

    public function test_financial_defaults_must_be_usable_and_guide_state_is_private(): void
    {
        $this->actingAs($this->admin);
        $this->review('company')->assertOk();
        $this->review('locations')->assertOk();
        FiscalYear::query()->update(['status' => 'closed']);
        $this->review('finance')->assertUnprocessable();
        $this->getJson('/api/setup-guide')->assertJsonPath('steps.2.ready', false);
        $this->assertArrayNotHasKey(SetupGuideService::KEY, app(SettingsService::class)->publicSettings());
        $this->getJson('/api/system/info')->assertJsonMissingPath('setup_guide');
    }

    public function test_staff_cannot_read_or_change_the_company_guide_and_unknown_steps_are_rejected(): void
    {
        $staff = $this->asUserWithRole('technician');
        $this->actingAs($staff)->getJson('/api/setup-guide')->assertForbidden();
        $this->postJson('/api/setup-guide', ['action' => 'start'])->assertForbidden();
        $this->actingAs($this->admin)->postJson('/api/setup-guide', ['action' => 'review', 'step' => 'license_limits'])->assertUnprocessable();
        $this->postJson('/api/setup-guide', ['action' => 'complete', 'reviews' => ['company' => true, 'locations' => true]])->assertUnprocessable();
    }
}
