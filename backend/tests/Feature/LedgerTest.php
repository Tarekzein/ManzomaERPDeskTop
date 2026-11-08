<?php

namespace Tests\Feature;

use App\Modules\Core\Services\SettingsService;
use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Models\FiscalYear;
use App\Modules\Finance\Services\FiscalService;
use App\Modules\Finance\Services\JournalService;
use App\Modules\Reports\Services\FinancialReports;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use App\Support\BusinessException;
use Tests\TestCase;

class LedgerTest extends TestCase
{
    public function test_manual_journal_must_balance_and_name_the_party_on_control_accounts(): void
    {
        $journal = app(JournalService::class);
        $cash = $this->cash->account_id;
        $capital = Account::query()->where('system_key', 'capital')->value('id');
        // A draft may be saved unfinished; posting enforces the balance.
        $unbalanced = $journal->saveDraft(['date' => now()->toDateString(), 'description' => 'x'], [['account' => $cash, 'debit' => 100], ['account' => $capital, 'credit' => 90]]);
        try {
            $journal->postDraft($unbalanced);
            $this->fail('Unbalanced');
        } catch (BusinessException $e) {
            $this->assertSame('journal_unbalanced', $e->errorCode);
        }
        $draft = $journal->saveDraft(['date' => now()->toDateString(), 'description' => 'تجربة'], [['account' => 'ar', 'debit' => 100], ['account' => $capital, 'credit' => 100]]);
        $this->expectException(BusinessException::class);
        $journal->postDraft($draft);
    }

    public function test_lock_date_blocks_posting(): void
    {
        app(SettingsService::class)->set('accounting.lock_date', now()->toDateString());
        $product = $this->product();
        try {
            $this->stockIn($product, 1, 1);
            $this->fail('Period locked');
        } catch (BusinessException $e) {
            $this->assertSame('period_locked', $e->errorCode);
        }
    }

    public function test_year_end_close_moves_profit_to_retained_earnings(): void
    {
        $product = $this->product();
        $this->stockIn($product, 10, 40);
        app(TradingPoster::class)->post(app(TradingService::class)->save('sales_invoice', ['party_id' => $this->customer()->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 10, 'unit_price' => 100]]]));
        $year = FiscalYear::query()->firstOrFail();
        $year->update(['end_date' => now()->toDateString()]);
        app(FiscalService::class)->closeYear($year, $this->admin);
        $this->assertEquals(-600, $this->balance('retained_earnings'));
        $is = app(FinancialReports::class)->incomeStatement('1900-01-01', now()->addDay()->toDateString());
        $this->assertEquals(0, $is['net_profit']);
        $bs = app(FinancialReports::class)->balanceSheet(now()->toDateString());
        $this->assertTrue($bs['balanced']);
    }

    public function test_party_statement_runs_a_balance(): void
    {
        $customer = $this->customer();
        app(FiscalService::class)->partyOpening($customer, 500, now()->subDays(10)->toDateString());
        $product = $this->product();
        $this->stockIn($product, 10, 1);
        app(TradingPoster::class)->post(app(TradingService::class)->save('sales_invoice', ['party_id' => $customer->id, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 100]]]));
        $token = $this->admin->createToken('t')->plainTextToken;
        $statement = $this->withToken($token)->getJson("/api/parties/{$customer->id}/statement?from=".now()->subDays(5)->toDateString())->assertOk()->json();
        $this->assertEquals(500, $statement['opening_balance']);
        $this->assertEquals(700, $statement['closing_balance']);
    }
}
