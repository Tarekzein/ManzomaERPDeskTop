<?php

namespace Tests\Feature;

use App\Models\User;
use App\Modules\Core\Services\BackupService;
use App\Modules\Core\Services\CompanyImportService;
use App\Modules\Core\Services\InstallService;
use App\Modules\Core\Services\SettingsService;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Services\SparePartsService;
use App\Modules\Inventory\Services\StockDocumentService;
use App\Modules\Parties\Models\Party;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpKernel\Exception\HttpException;

class CompanyImportTest extends TestCase
{
    private string $dir;

    private string $source;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = sys_get_temp_dir().'/manzoma-company-import-'.bin2hex(random_bytes(8));
        mkdir($this->dir, 0700);
        $this->source = $this->dir.'/legacy.sqlite';
        touch($this->source);
        config(['database.default' => 'sqlite', 'database.connections.sqlite.database' => $this->source, 'erp.multi_company' => false, 'licensing.enforce' => false, 'erp.backup_path' => $this->dir.'/backups', 'filesystems.disks.local.root' => $this->dir.'/evidence']);
        DB::purge('sqlite');
        Storage::forgetDisk('local');
        Artisan::call('migrate', ['--force' => true]);
        app(InstallService::class)->install(['company_name' => 'Legacy company', 'admin_username' => 'legacy_owner', 'admin_password' => 'legacy-password-123']);
        Party::create(['code' => 'C-LEGACY', 'name' => 'Existing household', 'is_customer' => true]);
    }

    protected function tearDown(): void
    {
        DB::purge('sqlite');
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->dir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($files as $file) {
            $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
        } rmdir($this->dir);
        parent::tearDown();
    }

    private function target(): string
    {
        $target = $this->dir.'/new-slot/company.sqlite';
        config(['database.connections.sqlite.database' => $target]);
        DB::purge('sqlite');

        return $target;
    }

    public function test_sqlite_import_preserves_records_passwords_and_original_file(): void
    {
        $before = hash_file('sha256', $this->source);
        $target = $this->target();
        $this->assertSame(0, Artisan::call('erp:import-company', ['file' => $this->source, '--json' => true]));
        $this->assertTrue(is_file($target));
        $this->assertSame($before, hash_file('sha256', $this->source));
        $this->assertSame('Existing household', DB::table('parties')->where('code', 'C-LEGACY')->value('name'));
        $this->assertTrue(Hash::check('legacy-password-123', DB::table('users')->where('username', 'legacy_owner')->value('password')));
        $this->postJson('/api/auth/login', ['username' => 'legacy_owner', 'password' => 'legacy-password-123', 'device_name' => 'Imported device'])->assertOk()->assertJsonPath('user.username', 'legacy_owner');
    }

    public function test_zip_import_restores_records_without_requiring_a_preinstalled_company(): void
    {
        $backup = app(BackupService::class)->bundle();
        $this->target();
        $this->assertSame(0, Artisan::call('erp:import-company', ['file' => $backup['path'], '--json' => true]));
        $this->assertTrue(DB::table('parties')->where('code', 'C-LEGACY')->exists());
        $this->assertSame('Legacy company', app(SettingsService::class)->get('company.name'));
    }

    public function test_import_refuses_to_overwrite_an_existing_company(): void
    {
        $target = $this->target();
        mkdir(dirname($target), 0700, true);
        copy($this->source, $target);
        $before = hash_file('sha256', $target);
        try {
            app(CompanyImportService::class)->import($this->source);
            $this->fail('Expected refusal');
        } catch (HttpException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
        $this->assertSame($before, hash_file('sha256', $target));
    }

    public function test_spare_part_recipes_movements_and_snapshots_survive_backup_restore(): void
    {
        $owner = User::query()->first();
        auth()->setUser($owner);
        $unit = DB::table('units')->value('id');
        $warehouse = DB::table('warehouses')->where('is_transit', false)->value('id');
        $parent = Product::create(['code' => 'ASSEMBLY', 'name' => 'Assembly', 'type' => 'stock', 'base_unit_id' => $unit]);
        $part = Product::create(['code' => 'SCREW', 'name' => 'Screw', 'type' => 'stock', 'base_unit_id' => $unit]);
        $stock = app(StockDocumentService::class);
        $stock->post($stock->save('opening', ['warehouse_id' => $warehouse, 'lines' => [
            ['product_id' => $parent->id, 'quantity' => 10, 'unit_cost' => 30], ['product_id' => $part->id, 'quantity' => 100, 'unit_cost' => 2],
        ]]));
        app(SparePartsService::class)->configure($parent, ['uses_spare_parts' => true, 'spare_parts' => [['product_id' => $part->id, 'quantity_per_unit' => 5]]]);
        $invoice = app(TradingPoster::class)->post(app(TradingService::class)->save('sales_invoice', [
            'party_id' => DB::table('parties')->value('id'), 'warehouse_id' => $warehouse,
            'lines' => [['product_id' => $parent->id, 'quantity' => 2, 'unit_price' => 100]],
        ]));
        $backup = app(BackupService::class)->bundle();
        $this->target();
        $this->assertSame(0, Artisan::call('erp:import-company', ['file' => $backup['path'], '--json' => true]));
        $this->assertDatabaseHas('products', ['id' => $parent->id, 'uses_spare_parts' => true]);
        $this->assertDatabaseHas('product_spare_parts', ['product_id' => $parent->id, 'spare_part_id' => $part->id, 'quantity_per_unit' => 5]);
        $component = DB::table('trade_line_components')->first();
        $this->assertEquals(10, $component->quantity);
        $this->assertDatabaseHas('stock_moves', ['id' => $component->stock_move_id, 'source_id' => $invoice->id, 'quantity' => -10]);
        $this->assertEquals(90, DB::table('stock_balances')->where('product_id', $part->id)->sum('quantity'));
    }

    public function test_invalid_files_cannot_create_a_partial_company(): void
    {
        $bad = $this->dir.'/not-a-company.sqlite';
        file_put_contents($bad, 'not a database');
        $target = $this->target();
        try {
            app(CompanyImportService::class)->import($bad);
            $this->fail('Expected invalid file');
        } catch (HttpException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
        $this->assertFileDoesNotExist($target);
    }

    public function test_a_corrupt_zip_cleans_only_the_new_target_and_leaves_the_source_unchanged(): void
    {
        $before = hash_file('sha256', $this->source);
        $bad = $this->dir.'/corrupt.zip';
        $zip = new \ZipArchive;
        $zip->open($bad, \ZipArchive::CREATE);
        $zip->addFile($this->source, 'database/backup-corrupt.sqlite');
        $zip->addFromString('manifest.json', json_encode(['version' => 1, 'company_database' => $this->source, 'files' => [['path' => 'database/backup-corrupt.sqlite', 'sha256' => str_repeat('0', 64)]]]));
        $zip->close();
        $target = $this->target();
        try {
            app(CompanyImportService::class)->import($bad);
            $this->fail('Expected invalid checksum');
        } catch (HttpException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
        $this->assertFileDoesNotExist($target);
        $this->assertSame($before, hash_file('sha256', $this->source));
    }
}
