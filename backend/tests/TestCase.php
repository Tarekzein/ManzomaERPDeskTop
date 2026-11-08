<?php

namespace Tests;

use App\Models\User;
use App\Modules\Core\Services\InstallService;
use App\Modules\Finance\Models\CashAccount;
use App\Modules\Finance\Services\AccountResolver;
use App\Modules\Finance\Services\JournalService;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\ProductUnit;
use App\Modules\Inventory\Models\Unit;
use App\Modules\Inventory\Models\Warehouse;
use App\Modules\Inventory\Services\StockService;
use App\Modules\Parties\Models\Party;
use App\Modules\Reports\Services\FinancialReports;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Auth;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    protected User $admin;

    protected Warehouse $warehouse;

    protected CashAccount $cash;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = app(InstallService::class)->install([
            'company_name' => 'شركة الاختبار',
            'admin_password' => 'secret123',
            'vat_rate' => 14,
        ]);
        Auth::setUser($this->admin);
        $this->warehouse = Warehouse::query()->where('code', 'WH1')->firstOrFail();
        $this->cash = CashAccount::query()->where('code', 'CASH1')->firstOrFail();
    }

    protected function product(array $attributes = [], ?array $carton = null): Product
    {
        static $n = 0;
        $n++;
        $piece = Unit::query()->where('name', 'قطعة')->value('id');
        $product = Product::query()->create($attributes + [
            'code' => 'T'.str_pad((string) $n, 4, '0', STR_PAD_LEFT),
            'name' => 'صنف اختبار '.$n,
            'type' => 'stock',
            'base_unit_id' => $piece,
            'sale_price' => 100,
            'purchase_price' => 60,
        ]);
        ProductUnit::query()->create(['product_id' => $product->id, 'unit_id' => $product->base_unit_id, 'factor' => 1, 'is_default_sale' => true, 'is_default_purchase' => true, 'barcode' => 'BC'.$n]);
        if ($carton) {
            ProductUnit::query()->create(['product_id' => $product->id, 'unit_id' => Unit::query()->where('name', 'كرتونة')->value('id'), 'factor' => $carton[0], 'sale_price' => $carton[1] ?? null, 'barcode' => 'CT'.$n]);
        }

        return $product->load('units');
    }

    protected function customer(array $attributes = []): Party
    {
        static $n = 0;
        $n++;

        return Party::query()->create($attributes + ['code' => 'C'.$n, 'name' => 'عميل '.$n, 'is_customer' => true]);
    }

    protected function supplier(array $attributes = []): Party
    {
        static $n = 0;
        $n++;

        return Party::query()->create($attributes + ['code' => 'S'.$n, 'name' => 'مورد '.$n, 'is_supplier' => true]);
    }

    protected function stockIn(Product $product, float $quantity, float $cost, ?string $batch = null, ?string $expiry = null): void
    {
        $svc = app(\App\Modules\Inventory\Services\StockDocumentService::class);
        $doc = $svc->save('opening', ['date' => now()->toDateString(), 'warehouse_id' => $this->warehouse->id, 'lines' => [
            ['product_id' => $product->id, 'quantity' => $quantity, 'unit_cost' => $cost, 'batch_no' => $batch, 'expiry_date' => $expiry],
        ]]);
        $svc->post($doc);
    }

    protected function onHand(Product $product, ?int $warehouseId = null): float
    {
        return app(StockService::class)->onHand($product->id, $warehouseId ?? $this->warehouse->id);
    }

    protected function balance(string $key, ?int $partyId = null): float
    {
        return app(JournalService::class)->balance(app(AccountResolver::class)->id($key), null, $partyId);
    }

    protected function assertBooksBalanced(): void
    {
        $tb = app(FinancialReports::class)->trialBalance('1900-01-01', now()->addYear()->toDateString());
        $this->assertEqualsWithDelta($tb['totals']['period_debit'], $tb['totals']['period_credit'], 0.001, 'Trial balance does not balance');
        $stock = app(StockService::class)->valueAsOf();
        $this->assertEqualsWithDelta($stock, $this->balance('inventory'), 0.001, 'Stock ledger does not match the inventory account');
    }

    protected function asUserWithRole(string $role, array $extra = []): User
    {
        $user = User::query()->create($extra + ['name' => $role, 'username' => $role.uniqid(), 'password' => 'secret123', 'branch_id' => $this->admin->branch_id, 'default_warehouse_id' => $this->warehouse->id, 'default_cash_account_id' => $this->cash->id]);
        $user->assignRole($role);
        Auth::setUser($user);

        return $user;
    }
}
