<?php

namespace Tests\Feature;

use App\Modules\Core\Services\DemoDataService;
use Tests\TestCase;

/**
 * Loads the demo company and calls every read endpoint the desktop uses.
 */
class ApiSmokeTest extends TestCase
{
    public function test_login_and_read_endpoints_answer(): void
    {
        app(DemoDataService::class)->seed();
        $this->assertBooksBalanced();

        $login = $this->postJson('/api/auth/login', ['username' => 'admin', 'password' => 'secret123', 'device_name' => 'test'])->assertOk();
        $token = $login->json('token');
        $this->assertContains('sales.invoices.post', $login->json('user.permissions'));
        $this->postJson('/api/auth/login', ['username' => 'admin', 'password' => 'wrong'])->assertStatus(422);

        $party = \App\Modules\Parties\Models\Party::query()->where('is_customer', true)->first();
        $product = \App\Modules\Inventory\Models\Product::query()->first();
        $invoice = \App\Modules\Trading\Models\TradeDocument::query()->where('type', 'sales_invoice')->first();
        $account = \App\Modules\Finance\Models\Account::query()->where('system_key', 'ar')->first();
        $cash = \App\Modules\Finance\Models\CashAccount::query()->first();
        $cheque = \App\Modules\Finance\Models\Cheque::query()->first();
        $year = now()->startOfYear()->toDateString();

        $urls = [
            '/api/system/info', '/api/auth/me', '/api/lookups', '/api/settings', '/api/users', '/api/roles', '/api/audit-logs',
            '/api/master/units', '/api/master/categories', '/api/master/warehouses', '/api/master/tax-rates', '/api/master/crm-stages',
            '/api/parties?role=customer', '/api/parties?role=supplier', "/api/parties/{$party->id}", "/api/parties/{$party->id}/statement",
            "/api/parties/{$party->id}/overview", "/api/parties/{$party->id}/open-invoices",
            '/api/products', '/api/products?low_stock=1', "/api/products/{$product->id}", "/api/products/{$product->id}/card", "/api/products/{$product->id}/price?party_id={$party->id}",
            '/api/products/scan/6221000000001', '/api/stock/on-hand', '/api/stock/on-hand?by_batch=1', '/api/stock/expiring', '/api/stock/reorder', '/api/stock/slow-moving', '/api/stock/reconcile',
            '/api/stock-documents/transfer', '/api/stock-documents/adjustment', '/api/stock-documents/opening',
            '/api/documents/sales_invoice', '/api/documents/sales_invoice?payment_status=open', "/api/documents/sales_invoice/{$invoice->id}",
            '/api/documents/purchase_invoice', '/api/documents/sales_quotation', '/api/documents/purchase_order',
            '/api/accounts', "/api/accounts/{$account->id}/ledger", '/api/journals', '/api/fiscal-years',
            '/api/cash-accounts', "/api/cash-accounts/{$cash->id}/statement?from={$year}", '/api/vouchers', '/api/vouchers?expenses=1', '/api/cheques', "/api/cheques/{$cheque->id}",
            '/api/crm/leads', '/api/crm/opportunities', '/api/crm/board', '/api/crm/activities', '/api/crm/tasks', '/api/crm/agenda',
            '/api/reports/dashboard', "/api/reports/finance/trial-balance?from={$year}", "/api/reports/finance/income-statement?from={$year}",
            '/api/reports/finance/balance-sheet', "/api/reports/finance/cash-flow?from={$year}", "/api/reports/finance/vat?from={$year}",
            '/api/reports/aging/receivable', '/api/reports/aging/payable', "/api/reports/analysis/sales?by=product&from={$year}",
            "/api/reports/analysis/sales?by=salesperson&from={$year}", "/api/reports/analysis/purchases?by=party&from={$year}", "/api/reports/salespeople?from={$year}", "/api/reports/crm?from={$year}",
        ];
        foreach ($urls as $url) {
            $response = $this->withToken($token)->getJson($url);
            $this->assertSame(200, $response->status(), $url.' → '.$response->getContent());
        }

        $this->flushHeaders();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/auth/me')->assertUnauthorized();
    }
}
