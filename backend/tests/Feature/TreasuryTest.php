<?php

namespace Tests\Feature;

use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Models\CashAccount;
use App\Modules\Finance\Models\Cheque;
use App\Modules\Finance\Models\TaxRate;
use App\Modules\Finance\Services\ChequeService;
use App\Modules\Finance\Services\VoucherService;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use App\Support\BusinessException;
use Tests\TestCase;

class TreasuryTest extends TestCase
{
    private function bank(): CashAccount
    {
        $group = Account::query()->where('system_key', 'bank_group')->first();
        $gl = Account::query()->create(['parent_id' => $group->id, 'code' => '12201', 'name' => 'بنك', 'type' => 'asset']);

        return CashAccount::query()->create(['type' => 'bank', 'code' => 'B1', 'name' => 'بنك', 'account_id' => $gl->id]);
    }

    private function creditInvoice(int $customerId, float $amount)
    {
        $product = $this->product();
        $this->stockIn($product, 10, 1);

        return app(TradingPoster::class)->post(app(TradingService::class)->save('sales_invoice', ['party_id' => $customerId, 'date' => now()->toDateString(), 'lines' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => $amount]]]));
    }

    public function test_receipt_auto_allocates_to_oldest_invoices(): void
    {
        $customer = $this->customer();
        $a = $this->creditInvoice($customer->id, 300);
        $b = $this->creditInvoice($customer->id, 500);
        app(VoucherService::class)->createAndPost(['type' => 'receipt', 'date' => now()->toDateString(), 'party_id' => $customer->id, 'amount' => 600, 'cash_account_id' => $this->cash->id, 'auto_allocate' => true]);
        $this->assertSame('paid', $a->refresh()->payment_status);
        $this->assertEquals(300, (float) $b->refresh()->paid_amount);
        $this->assertEquals(200, $this->balance('ar', $customer->id));
        $this->assertBooksBalanced();
    }

    public function test_cheque_collected_moves_to_bank_and_bounced_cheque_reopens_invoice(): void
    {
        $bank = $this->bank();
        $customer = $this->customer();
        $invoice = $this->creditInvoice($customer->id, 1000);
        $voucher = app(VoucherService::class)->createAndPost(['type' => 'receipt', 'date' => now()->toDateString(), 'party_id' => $customer->id, 'amount' => 1000, 'method' => 'cheque',
            'cheque' => ['number' => '123', 'due_date' => now()->addDays(30)->toDateString()], 'allocations' => [['document_id' => $invoice->id, 'amount' => 1000]]]);
        $this->assertEquals(1000, $this->balance('notes_receivable'));
        $this->assertSame('paid', $invoice->refresh()->payment_status);

        $cheque = Cheque::query()->findOrFail($voucher->cheque_id);
        app(ChequeService::class)->act($cheque, 'deposit', ['cash_account_id' => $bank->id]);
        app(ChequeService::class)->act($cheque, 'bounce', ['note' => 'رصيد غير كاف']);
        $this->assertEquals(0, $this->balance('notes_receivable'));
        $this->assertEquals(1000, $this->balance('ar', $customer->id));
        $this->assertSame('unpaid', $invoice->refresh()->payment_status);

        // Re-presented and collected this time.
        app(ChequeService::class)->act($cheque->refresh(), 'deposit', ['cash_account_id' => $bank->id]);
        app(ChequeService::class)->act($cheque->refresh(), 'collect', []);
        $this->assertEquals(1000, app(\App\Modules\Finance\Services\JournalService::class)->balance($bank->account_id));
        $this->assertEquals(0, $this->balance('ar', $customer->id));
        $this->assertBooksBalanced();
    }

    public function test_issued_cheque_clears_from_bank(): void
    {
        $bank = $this->bank();
        $supplier = $this->supplier();
        $voucher = app(VoucherService::class)->createAndPost(['type' => 'payment', 'date' => now()->toDateString(), 'party_id' => $supplier->id, 'amount' => 700, 'method' => 'cheque', 'cash_account_id' => $bank->id,
            'cheque' => ['number' => '9001', 'due_date' => now()->addDays(10)->toDateString()]]);
        $this->assertEquals(-700, $this->balance('notes_payable'));
        app(ChequeService::class)->act(Cheque::query()->findOrFail($voucher->cheque_id), 'clear', []);
        $this->assertEquals(0, $this->balance('notes_payable'));
        $this->assertEquals(-700, app(\App\Modules\Finance\Services\JournalService::class)->balance($bank->account_id));
        $this->assertEquals(700, $this->balance('ap', $supplier->id));
    }

    public function test_expense_with_vat_and_cash_box_cannot_go_negative(): void
    {
        $vat = TaxRate::query()->where('is_default', true)->first();
        $rent = Account::query()->where('code', '6103')->first();
        $svc = app(VoucherService::class);
        try {
            $svc->createAndPost(['type' => 'payment', 'date' => now()->toDateString(), 'account_id' => $rent->id, 'amount' => 1140, 'cash_account_id' => $this->cash->id, 'tax_rate_id' => $vat->id]);
            $this->fail('Empty cash box should refuse');
        } catch (BusinessException $e) {
            $this->assertSame('insufficient_cash', $e->errorCode);
        }
        $svc->createAndPost(['type' => 'receipt', 'date' => now()->toDateString(), 'account_id' => Account::query()->where('system_key', 'capital')->value('id'), 'amount' => 5000, 'cash_account_id' => $this->cash->id]);
        $voucher = $svc->createAndPost(['type' => 'payment', 'date' => now()->toDateString(), 'account_id' => $rent->id, 'amount' => 1140, 'cash_account_id' => $this->cash->id, 'tax_rate_id' => $vat->id]);
        $this->assertEquals(140, (float) $voucher->tax_amount);
        $this->assertEquals(1000, app(\App\Modules\Finance\Services\JournalService::class)->balance($rent->id));
        $this->assertEquals(140, $this->balance('vat_input'));
        $this->assertBooksBalanced();
    }

    public function test_voiding_a_voucher_reopens_its_invoices(): void
    {
        $customer = $this->customer();
        $invoice = $this->creditInvoice($customer->id, 400);
        $voucher = app(VoucherService::class)->createAndPost(['type' => 'receipt', 'date' => now()->toDateString(), 'party_id' => $customer->id, 'amount' => 400, 'cash_account_id' => $this->cash->id, 'auto_allocate' => true]);
        $this->assertSame('paid', $invoice->refresh()->payment_status);
        app(VoucherService::class)->void($voucher, 'خطأ');
        $this->assertSame('unpaid', $invoice->refresh()->payment_status);
        $this->assertEquals(400, $this->balance('ar', $customer->id));
        $this->assertBooksBalanced();
    }
}
