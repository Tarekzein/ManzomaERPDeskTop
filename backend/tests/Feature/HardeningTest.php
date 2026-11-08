<?php

namespace Tests\Feature;

use App\Modules\Core\Services\BackupService;
use App\Modules\CRM\Models\Lead;
use App\Modules\CRM\Models\Task;
use App\Modules\Inventory\Models\Warehouse;
use App\Modules\Inventory\Services\StockDocumentService;
use Tests\TestCase;

class HardeningTest extends TestCase
{
    public function test_backup_list_and_download_paths_are_tenant_isolated(): void
    {
        $root = sys_get_temp_dir().'/manzoma-backup-test-'.bin2hex(random_bytes(6));
        $default = config('database.default');
        $connection = config('database.connections.sqlite');
        config(['erp.multi_company' => true, 'erp.backup_path' => $root, 'database.connections.audit_a' => array_replace($connection, ['database' => 'erp_alpha']), 'database.connections.audit_b' => array_replace($connection, ['database' => 'erp_beta'])]);
        try {
            config(['database.default' => 'audit_a']);
            $service = new BackupService;
            $a = $service->directory();
            file_put_contents($a.'/backup-alpha.sql', 'alpha');
            config(['database.default' => 'audit_b']);
            $b = $service->directory();
            $this->assertNotSame($a, $b);
            $this->assertSame([], $service->list());
            $this->assertNull($service->path('backup-alpha.sql'));
            $this->assertNull($service->path('../backup-alpha.sql'));
        } finally {
            config(['database.default' => $default, 'erp.multi_company' => false]);
            foreach (glob($root.'/*/*') ?: [] as $file) {
                unlink($file);
            }
            foreach (glob($root.'/*') ?: [] as $dir) {
                rmdir($dir);
            }
            if (is_dir($root)) {
                rmdir($root);
            }
        }
    }

    public function test_nested_purchase_prices_and_purchase_price_lookup_are_protected(): void
    {
        $product = $this->product();
        $product->units()->first()->update(['purchase_price' => 55]);
        $user = $this->asUserWithRole('salesperson');
        $this->actingAs($user);
        $this->getJson('/api/products/'.$product->id)->assertOk()->assertJsonMissingPath('data.purchase_price')->assertJsonMissingPath('data.units.0.purchase_price');
        $this->getJson('/api/products/'.$product->id.'/price?kind=purchase')->assertForbidden();
    }

    public function test_task_mutation_and_lead_conversion_check_record_ownership(): void
    {
        $task = Task::query()->create(['title' => 'Private task', 'assigned_to' => $this->admin->id]);
        $lead = Lead::query()->create(['name' => 'Private lead', 'owner_id' => $this->admin->id]);
        $user = $this->asUserWithRole('salesperson');
        $this->actingAs($user);
        $this->putJson('/api/crm/tasks/'.$task->id, ['title' => 'Changed'])->assertForbidden();
        $this->postJson('/api/crm/tasks/'.$task->id.'/complete')->assertForbidden();
        $this->postJson('/api/crm/leads/'.$lead->id.'/convert')->assertForbidden();
        $this->assertDatabaseHas('crm_tasks', ['id' => $task->id, 'title' => 'Private task', 'status' => 'open']);
    }

    public function test_import_cannot_change_tracking_on_moved_products(): void
    {
        $product = $this->product(['track_batches' => true]);
        $this->stockIn($product, 5, 60, 'BATCH-1', '2027-01-01');
        $this->actingAs($this->admin)->postJson('/api/import/products', ['rows' => [['code' => $product->code, 'name' => 'Changed', 'track_batches' => 'false']]])->assertOk()->assertJsonCount(1, 'errors');
        $this->assertTrue($product->refresh()->track_batches);
    }

    public function test_technician_product_balances_only_include_their_van(): void
    {
        $product = $this->product();
        $this->stockIn($product, 12, 60);
        $tech = $this->asUserWithRole('technician');
        $van = Warehouse::query()->create(['code' => 'VAN', 'name' => 'Van', 'kind' => 'van', 'technician_id' => $tech->id]);
        $this->actingAs($this->admin);
        $stock = app(StockDocumentService::class);
        $transfer = $stock->save('transfer', ['warehouse_id' => $this->warehouse->id, 'to_warehouse_id' => $van->id, 'lines' => [['product_id' => $product->id, 'quantity' => 3]]]);
        $stock->post($transfer, ['direct' => true]);
        $this->actingAs($tech)->getJson('/api/products')->assertOk()->assertJsonPath('data.0.on_hand', fn ($value) => (float) $value === 3.0);
        $this->getJson('/api/products/'.$product->id)->assertOk()->assertJsonCount(1, 'data.balances')->assertJsonPath('data.balances.0.warehouse_id', $van->id);
        $this->getJson('/api/products?warehouse_id='.$this->warehouse->id)->assertForbidden();
    }
}
