<?php

namespace App\Modules\Core\Services;

use App\Models\User;
use App\Modules\Core\Models\Branch;
use App\Modules\CRM\Models\Activity;
use App\Modules\CRM\Models\Lead;
use App\Modules\CRM\Models\LostReason;
use App\Modules\CRM\Models\Opportunity;
use App\Modules\CRM\Models\Source;
use App\Modules\CRM\Models\Stage;
use App\Modules\CRM\Models\Task;
use App\Modules\CRM\Services\CrmService;
use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Models\CashAccount;
use App\Modules\Finance\Models\Cheque;
use App\Modules\Finance\Models\CostCenter;
use App\Modules\Finance\Models\TaxRate;
use App\Modules\Finance\Services\ChequeService;
use App\Modules\Finance\Services\FiscalService;
use App\Modules\Finance\Services\VoucherService;
use App\Modules\Inventory\Models\Brand;
use App\Modules\Inventory\Models\Category;
use App\Modules\Inventory\Models\PriceList;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\ProductUnit;
use App\Modules\Inventory\Models\Unit;
use App\Modules\Inventory\Models\Warehouse;
use App\Modules\Inventory\Services\StockDocumentService;
use App\Modules\Parties\Models\Party;
use App\Modules\Trading\Services\TradingPoster;
use App\Modules\Trading\Services\TradingService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Realistic sample company (a food & household goods distributor in Cairo)
 * created through the same services the desktop uses.
 */
class DemoDataService
{
    private array $products = [];

    private array $customers = [];

    private array $suppliers = [];

    public function __construct(
        private readonly NumberingService $numbers,
        private readonly TradingService $trading,
        private readonly TradingPoster $poster,
        private readonly VoucherService $vouchers,
        private readonly ChequeService $cheques,
        private readonly StockDocumentService $stockDocs,
        private readonly FiscalService $fiscal,
        private readonly CrmService $crm,
        private readonly AuditService $audit,
    ) {}

    public function seed(): void
    {
        $this->audit->quietly(fn () => DB::transaction(function () {
            $start = now()->subDays(75)->startOfDay();
            if ($start->year !== now()->year) {
                $start = now()->startOfYear();
            }
            $day = fn (int $offset) => $start->copy()->addDays(min($offset, $start->diffInDays(now())))->toDateString();

            [$hq, $alex, $wh1, $wh2, $cash, $cash2, $bank] = $this->structure();
            $users = $this->users($hq, $alex, $wh1, $wh2, $cash, $cash2);
            $this->catalogue();
            $this->parties($users['sales']);

            // Go-live balances.
            $this->fiscal->accountsOpening([
                ['account_id' => $cash->account_id, 'debit' => 150000],
                ['account_id' => $bank->account_id, 'debit' => 850000],
                ['account_id' => Account::query()->where('code', '1101')->value('id'), 'debit' => 120000],
                ['account_id' => Account::query()->where('code', '1103')->value('id'), 'debit' => 480000],
                ['account_id' => Account::query()->where('system_key', 'capital')->value('id'), 'credit' => 1500000],
            ], $day(0));
            $this->fiscal->partyOpening($this->customers['nour'], 18500, $day(0));
            $this->fiscal->partyOpening($this->customers['amal'], 7200, $day(0));
            $this->fiscal->partyOpening($this->suppliers['nile'], -42000, $day(0));

            // Opening stock in the main warehouse.
            $opening = $this->stockDocs->save('opening', ['date' => $day(0), 'warehouse_id' => $wh1->id, 'lines' => collect($this->products)->filter(fn ($p) => $p['product']->type === 'stock')->map(fn ($p) => [
                'product_id' => $p['product']->id,
                'quantity' => $p['opening'],
                'unit_cost' => $p['cost'],
                'batch_no' => $p['product']->track_batches ? 'OB-'.$p['product']->code : null,
                'expiry_date' => $p['product']->track_batches ? now()->addDays($p['expiry_days'])->toDateString() : null,
            ])->values()->all()]);
            $this->stockDocs->post($opening);

            // Purchasing: order → receipt → bill, and a direct bill with batches.
            $po = $this->trading->save('purchase_order', ['party_id' => $this->suppliers['nile']->id, 'date' => $day(5), 'warehouse_id' => $wh1->id, 'lines' => [
                $this->line('rice', 500, 'purchase'), $this->line('sugar', 600, 'purchase'), $this->line('oil', 300, 'purchase'), $this->line('tea', 200, 'purchase'),
            ]]);
            $this->trading->transition($po, 'confirm');
            $receipt = $this->trading->convert($po->refresh(), 'purchase_receipt', ['date' => $day(7)]);
            $this->poster->post($receipt);
            $bill = $this->trading->convert($receipt->refresh(), 'purchase_invoice', ['date' => $day(8), 'reference' => 'NF-88231']);
            $this->poster->post($bill);

            $direct = $this->trading->save('purchase_invoice', ['party_id' => $this->suppliers['delta']->id, 'date' => $day(10), 'warehouse_id' => $wh1->id, 'reference' => 'DD-4410', 'lines' => [
                $this->line('cheese', 120, 'purchase', ['batch_no' => 'CH-2611', 'expiry_date' => now()->addDays(40)->toDateString()]),
                $this->line('milk', 240, 'purchase', ['batch_no' => 'ML-1022', 'expiry_date' => now()->addDays(20)->toDateString()]),
                $this->line('juice', 200, 'purchase'), $this->line('biscuit', 720, 'purchase'), $this->line('coffee', 80, 'purchase'),
            ]]);
            $this->poster->post($direct, ['payment' => ['amount' => 10000, 'cash_account_id' => $bank->id, 'method' => 'bank_transfer']]);

            $this->vouchers->createAndPost(['type' => 'payment', 'date' => $day(20), 'party_id' => $this->suppliers['nile']->id, 'amount' => 45000, 'method' => 'cheque',
                'cash_account_id' => $bank->id, 'description' => 'دفعة تحت الحساب',
                'cheque' => ['number' => '700125', 'bank_name' => 'البنك الأهلي المصري', 'due_date' => now()->addDays(5)->toDateString(), 'cash_account_id' => $bank->id], 'auto_allocate' => true]);

            // Sales: quotation → order → partial invoice.
            $quote = $this->trading->save('sales_quotation', ['party_id' => $this->customers['hayat']->id, 'date' => $day(12), 'salesperson_id' => $users['sales']->id, 'lines' => [
                $this->line('rice', 120), $this->line('oil', 60), $this->line('detergent', 40),
            ]]);
            $this->trading->transition($quote, 'send');
            $order = $this->trading->convert($quote->refresh(), 'sales_order', ['date' => $day(14)]);
            $this->trading->transition($order, 'confirm');
            $orderLines = $order->refresh()->lines;
            $partial = $this->trading->convert($order->refresh(), 'sales_invoice', ['date' => $day(16), 'lines' => $orderLines->map(fn ($l) => [
                'product_id' => $l->product_id, 'product_unit_id' => $l->product_unit_id, 'quantity' => round((float) $l->quantity * 0.6), 'unit_price' => $l->unit_price,
                'discount_percent' => $l->discount_percent, 'tax_rate_id' => $l->tax_rate_id, 'source_line_id' => $l->id,
            ])->all()]);
            $this->poster->post($partial);

            // Everyday invoices across the period.
            $plan = [
                [18, 'nour', [['rice', 80], ['sugar', 120], ['tea', 60]], 0, 'cash'],
                [22, 'amal', [['oil', 100], ['detergent', 80]], 0.5, 'cash'],
                [25, 'walkin', [['juice', 48], ['biscuit', 96], ['tea', 24]], 1, 'cash'],
                [28, 'fathalla', [['rice', 200], ['sugar', 240], ['oil', 120], ['delivery', 1]], 0, null],
                [33, 'nour', [['cheese', 60], ['milk', 120]], 0, null],
                [38, 'saad', [['detergent', 160], ['softener', 120], ['bleach', 120]], 1, 'cash'],
                [42, 'hayat', [['tea', 80], ['coffee', 40]], 0, null],
                [47, 'walkin', [['biscuit', 144], ['juice', 96]], 1, 'cash'],
                [52, 'fathalla', [['rice', 160], ['oil', 80], ['sugar', 160]], 0.3, 'cash'],
                [57, 'amal', [['softener', 60], ['bleach', 60]], 0, null],
                [62, 'saad', [['coffee', 48], ['tea', 48], ['milk', 96]], 1, 'cash'],
                [66, 'walkin', [['juice', 40], ['biscuit', 80]], 1, 'cash'],
                [70, 'nour', [['rice', 100], ['oil', 60]], 0, null],
                [74, 'walkin', [['tea', 16], ['sugar', 20], ['biscuit', 48]], 1, 'cash'],
            ];
            $invoices = [];
            foreach ($plan as [$offset, $customer, $lines, $paidShare, $method]) {
                $doc = $this->trading->save('sales_invoice', [
                    'party_id' => $this->customers[$customer]->id,
                    'date' => $day($offset),
                    'warehouse_id' => $wh1->id,
                    'salesperson_id' => $customer === 'walkin' ? null : $users['sales']->id,
                    'invoice_discount_percent' => $customer === 'fathalla' ? 2 : 0,
                    'lines' => array_map(fn ($l) => $this->line($l[0], $l[1]), $lines),
                ]);
                $options = [];
                if ($paidShare > 0) {
                    $options['payment'] = ['amount' => round((float) $doc->balance_due * $paidShare, 2), 'cash_account_id' => $cash->id, 'method' => $method];
                }
                $invoices[] = $this->poster->post($doc, $options + ['override_credit' => true]);
            }

            // A return against an invoice.
            $source = $invoices[3]->refresh()->load('lines');
            $return = $this->trading->convert($source, 'sales_return', ['date' => $day(31), 'lines' => [[
                'product_id' => $source->lines[0]->product_id, 'quantity' => 5, 'source_line_id' => $source->lines[0]->id,
            ]], 'notes' => 'تلف أثناء النقل']);
            $this->poster->post($return);

            // Collections: cash, a cheque that clears and one that bounces.
            $this->vouchers->createAndPost(['type' => 'receipt', 'date' => $day(35), 'party_id' => $this->customers['nour']->id, 'amount' => 15000, 'cash_account_id' => $cash->id, 'method' => 'cash', 'auto_allocate' => true, 'description' => 'تحصيل من العميل']);
            $good = $this->vouchers->createAndPost(['type' => 'receipt', 'date' => $day(40), 'party_id' => $this->customers['fathalla']->id, 'amount' => 20000, 'method' => 'cheque', 'auto_allocate' => true,
                'cheque' => ['number' => '334901', 'bank_name' => 'بنك مصر', 'due_date' => $day(55)]]);
            $this->cheques->act(Cheque::query()->findOrFail($good->cheque_id), 'deposit', ['date' => $day(55), 'cash_account_id' => $bank->id]);
            $this->cheques->act(Cheque::query()->findOrFail($good->cheque_id), 'collect', ['date' => $day(58)]);
            $bad = $this->vouchers->createAndPost(['type' => 'receipt', 'date' => $day(44), 'party_id' => $this->customers['amal']->id, 'amount' => 5000, 'method' => 'cheque', 'auto_allocate' => true,
                'cheque' => ['number' => '118274', 'bank_name' => 'بنك القاهرة', 'due_date' => $day(60)]]);
            $this->cheques->act(Cheque::query()->findOrFail($bad->cheque_id), 'bounce', ['date' => $day(61), 'note' => 'رصيد غير كاف']);
            $this->vouchers->createAndPost(['type' => 'receipt', 'date' => $day(64), 'party_id' => $this->customers['hayat']->id, 'amount' => 12000, 'method' => 'cheque', 'auto_allocate' => true,
                'cheque' => ['number' => '550613', 'bank_name' => 'البنك التجاري الدولي', 'due_date' => now()->addDays(4)->toDateString()]]);

            // Expenses and a transfer to the bank.
            $vat = TaxRate::query()->where('type', 'vat')->where('is_default', true)->first();
            $admin = CostCenter::query()->where('code', 'ADM')->first();
            $sales = CostCenter::query()->where('code', 'SAL')->first();
            foreach ([
                [3, '6102', 9000, null, 'إيجار المخزن الرئيسي', $admin],
                [30, '6101', 22000, null, 'مرتبات الشهر', $admin],
                [32, '6103', 2280, $vat?->id, 'فاتورة الكهرباء', $admin],
                [45, '6203', 1710, $vat?->id, 'نقل بضاعة لعملاء', $sales],
                [60, '6104', 912, $vat?->id, 'إنترنت وتليفونات', $admin],
                [63, '6102', 9000, null, 'إيجار المخزن الرئيسي', $admin],
            ] as [$offset, $code, $amount, $tax, $description, $center]) {
                $this->vouchers->createAndPost(['type' => 'payment', 'date' => $day($offset), 'cash_account_id' => $amount > 20000 ? $bank->id : $cash->id,
                    'account_id' => Account::query()->where('code', $code)->value('id'), 'amount' => $amount, 'tax_rate_id' => $tax,
                    'method' => $amount > 20000 ? 'bank_transfer' : 'cash', 'description' => $description, 'cost_center_id' => $center?->id]);
            }
            $this->vouchers->createAndPost(['type' => 'transfer', 'date' => $day(50), 'cash_account_id' => $cash->id, 'to_cash_account_id' => $bank->id, 'amount' => 40000, 'description' => 'إيداع نقدية بالبنك']);

            // Branch transfer: sent, then received with a small shortage.
            $transfer = $this->stockDocs->save('transfer', ['date' => $day(48), 'warehouse_id' => $wh1->id, 'to_warehouse_id' => $wh2->id, 'lines' => [
                ['product_id' => $this->products['rice']['product']->id, 'quantity' => 40], ['product_id' => $this->products['detergent']['product']->id, 'quantity' => 30],
            ]]);
            $transfer = $this->stockDocs->post($transfer);
            $this->stockDocs->receiveTransfer($transfer, [$transfer->lines[0]->id => 40, $transfer->lines[1]->id => 29], $day(49));
            $pending = $this->stockDocs->save('transfer', ['date' => $day(73), 'warehouse_id' => $wh1->id, 'to_warehouse_id' => $wh2->id, 'lines' => [
                ['product_id' => $this->products['oil']['product']->id, 'quantity' => 20],
            ]]);
            $this->stockDocs->post($pending);

            $damage = $this->stockDocs->save('adjustment', ['date' => $day(54), 'warehouse_id' => $wh1->id, 'reason' => 'damage', 'notes' => 'كراتين تالفة بسبب الرطوبة', 'lines' => [
                ['product_id' => $this->products['biscuit']['product']->id, 'quantity' => 6, 'direction' => 'out'],
            ]]);
            $this->stockDocs->post($damage);

            $this->crmData($users, $day);
        }));
    }

    private function structure(): array
    {
        $hq = Branch::query()->where('code', 'HQ')->firstOrFail();
        $alex = Branch::query()->firstOrCreate(['code' => 'ALX'], ['name' => 'فرع الإسكندرية', 'name_en' => 'Alexandria branch', 'eta_branch_code' => '1', 'address' => 'سموحة، الإسكندرية']);
        $hq->update(['address' => 'مدينة نصر، القاهرة', 'phone' => '0222746500']);
        $wh1 = Warehouse::query()->where('code', 'WH1')->firstOrFail();
        $wh2 = Warehouse::query()->firstOrCreate(['code' => 'WH2'], ['name' => 'مخزن الإسكندرية', 'name_en' => 'Alexandria warehouse', 'branch_id' => $alex->id]);
        $cash = CashAccount::query()->where('code', 'CASH1')->firstOrFail();

        $cashGroup = Account::query()->where('system_key', 'cash_group')->first();
        $gl2 = Account::query()->firstOrCreate(['code' => '12102'], ['parent_id' => $cashGroup->id, 'name' => 'خزينة فرع الإسكندرية', 'name_en' => 'Alexandria cash box', 'type' => 'asset']);
        $cash2 = CashAccount::query()->firstOrCreate(['code' => 'CASH2'], ['type' => 'cash', 'name' => 'خزينة فرع الإسكندرية', 'name_en' => 'Alexandria cash box', 'branch_id' => $alex->id, 'account_id' => $gl2->id]);
        $bankGroup = Account::query()->where('system_key', 'bank_group')->first();
        $glBank = Account::query()->firstOrCreate(['code' => '12201'], ['parent_id' => $bankGroup->id, 'name' => 'البنك الأهلي المصري - جاري', 'name_en' => 'National Bank of Egypt - current', 'type' => 'asset']);
        $bank = CashAccount::query()->firstOrCreate(['code' => 'NBE1'], ['type' => 'bank', 'name' => 'البنك الأهلي المصري - جاري', 'name_en' => 'National Bank of Egypt - current', 'branch_id' => $hq->id, 'account_id' => $glBank->id, 'bank_name' => 'البنك الأهلي المصري', 'account_number' => '1903 0712 0004 5521']);

        CostCenter::query()->firstOrCreate(['code' => 'ADM'], ['name' => 'الإدارة العامة', 'name_en' => 'Administration']);
        CostCenter::query()->firstOrCreate(['code' => 'SAL'], ['name' => 'المبيعات', 'name_en' => 'Sales']);
        CostCenter::query()->firstOrCreate(['code' => 'ALX'], ['name' => 'فرع الإسكندرية', 'name_en' => 'Alexandria branch']);

        app(SettingsService::class)->setMany([
            'company.name' => app(SettingsService::class)->get('company.name') === 'شركتي' ? 'النخبة للتجارة والتوزيع' : app(SettingsService::class)->get('company.name'),
            'company.name_en' => app(SettingsService::class)->get('company.name_en') === 'My Company' ? 'Elite Trading & Distribution' : app(SettingsService::class)->get('company.name_en'),
            'company.address' => app(SettingsService::class)->get('company.address') ?? '15 شارع عباس العقاد، مدينة نصر، القاهرة',
            'company.phone' => app(SettingsService::class)->get('company.phone') ?? '0222746500',
            'company.tax_number' => app(SettingsService::class)->get('company.tax_number') ?? '527-418-903',
            'company.commercial_register' => '184522 القاهرة',
        ]);

        return [$hq, $alex, $wh1, $wh2, $cash, $cash2, $bank];
    }

    private function users(Branch $hq, Branch $alex, Warehouse $wh1, Warehouse $wh2, CashAccount $cash, CashAccount $cash2): array
    {
        $make = fn ($username, $name, $role, $extra = []) => tap(User::query()->firstOrCreate(['username' => $username], $extra + [
            'name' => $name, 'password' => 'password', 'branch_id' => $hq->id, 'default_warehouse_id' => $wh1->id, 'default_cash_account_id' => $cash->id,
        ]), fn ($u) => $u->syncRoles([$role]));

        return [
            'sales' => $make('ahmed', 'أحمد علي', 'salesperson', ['is_salesperson' => true, 'commission_rate' => 1.5, 'max_discount_percent' => 10]),
            'sales2' => $make('karim', 'كريم مصطفى', 'salesperson', ['is_salesperson' => true, 'commission_rate' => 1.5, 'max_discount_percent' => 10, 'branch_id' => $alex->id, 'default_warehouse_id' => $wh2->id, 'default_cash_account_id' => $cash2->id]),
            'manager' => $make('hany', 'هاني فؤاد', 'sales_manager', ['is_salesperson' => true, 'max_discount_percent' => 20]),
            'accountant' => $make('mona', 'منى سمير', 'accountant'),
            'storekeeper' => $make('mahmoud', 'محمود حسن', 'storekeeper'),
            'cashier' => $make('sara', 'سارة إبراهيم', 'cashier', ['max_discount_percent' => 5]),
        ];
    }

    private function catalogue(): void
    {
        $unit = fn ($name) => Unit::query()->where('name', $name)->value('id');
        $vat = TaxRate::query()->where('type', 'vat')->where('is_default', true)->value('id');
        $exempt = TaxRate::query()->where('name', 'معفى')->value('id');
        $cats = [];
        foreach ([['FOOD', 'مواد غذائية', 'Food'], ['DAIRY', 'ألبان وأجبان', 'Dairy'], ['BEV', 'مشروبات', 'Beverages'], ['CLEAN', 'منظفات', 'Cleaning'], ['SRV', 'خدمات', 'Services']] as [$code, $name, $en]) {
            $cats[$code] = Category::query()->firstOrCreate(['code' => $code], ['name' => $name, 'name_en' => $en])->id;
        }
        $brands = [];
        foreach (['الضحى', 'كريستال', 'جهينة', 'العروسة', 'أريال', 'داوني', 'كلوركس', 'بيتي'] as $b) {
            $brands[$b] = Brand::query()->firstOrCreate(['name' => $b])->id;
        }
        $wholesale = PriceList::query()->where('name', 'جملة')->value('id');

        // key, name, en, category, brand, base unit, [box unit, factor], sale, min, cost, opening, vat, batches?, expiry days
        $items = [
            ['rice', 'أرز مصري فاخر 1 كجم', 'Egyptian rice 1kg', 'FOOD', 'الضحى', 'قطعة', ['كرتونة', 10], 42, 34, 30, 600, $exempt, false, 0],
            ['sugar', 'سكر أبيض 1 كجم', 'White sugar 1kg', 'FOOD', 'الضحى', 'قطعة', ['كرتونة', 10], 39, 32, 28.5, 800, $exempt, false, 0],
            ['oil', 'زيت عباد الشمس 1 لتر', 'Sunflower oil 1L', 'FOOD', 'كريستال', 'قطعة', ['كرتونة', 12], 105, 88, 78, 420, $vat, false, 0],
            ['tea', 'شاي العروسة 250 جم', 'El Arosa tea 250g', 'BEV', 'العروسة', 'علبة', ['كرتونة', 24], 68, 54, 48, 300, $vat, false, 0],
            ['coffee', 'بن محوج 250 جم', 'Ground coffee 250g', 'BEV', null, 'علبة', ['كرتونة', 20], 160, 125, 112, 120, $vat, false, 0],
            ['juice', 'عصير برتقال 1 لتر', 'Orange juice 1L', 'BEV', 'جهينة', 'قطعة', ['كرتونة', 12], 45, 36, 32, 240, $vat, false, 0],
            ['biscuit', 'بسكويت شاي', 'Tea biscuits', 'FOOD', 'بيتي', 'قطعة', ['كرتونة', 36], 12.5, 9.75, 8.75, 720, $vat, false, 0],
            ['milk', 'لبن كامل الدسم 1 لتر', 'Full cream milk 1L', 'DAIRY', 'جهينة', 'قطعة', ['كرتونة', 12], 52, 43, 39, 180, $exempt, true, 18],
            ['cheese', 'جبنة بيضاء 500 جم', 'White cheese 500g', 'DAIRY', 'جهينة', 'قطعة', ['كرتونة', 24], 92, 74, 66, 160, $exempt, true, 45],
            ['detergent', 'مسحوق غسيل 3 كجم', 'Laundry powder 3kg', 'CLEAN', 'أريال', 'قطعة', ['كرتونة', 6], 340, 280, 252, 420, $vat, false, 0],
            ['softener', 'منعم أقمشة 2 لتر', 'Fabric softener 2L', 'CLEAN', 'داوني', 'قطعة', ['كرتونة', 6], 175, 142, 128, 260, $vat, false, 0],
            ['bleach', 'كلور 1 لتر', 'Bleach 1L', 'CLEAN', 'كلوركس', 'قطعة', ['كرتونة', 12], 27, 22, 19.5, 300, $vat, false, 0],
            ['delivery', 'خدمة توصيل', 'Delivery service', 'SRV', null, 'خدمة', null, 250, 0, 0, 0, $vat, false, 0],
        ];
        foreach ($items as $i => [$key, $name, $en, $cat, $brand, $base, $box, $sale, $min, $cost, $opening, $tax, $batches, $expiry]) {
            $product = Product::query()->create([
                'code' => $this->numbers->code('product'),
                'name' => $name, 'name_en' => $en, 'type' => $key === 'delivery' ? 'service' : 'stock',
                'category_id' => $cats[$cat], 'brand_id' => $brand ? $brands[$brand] : null, 'base_unit_id' => $unit($base),
                'tax_rate_id' => $tax, 'sale_price' => $sale, 'min_sale_price' => $min, 'purchase_price' => $cost,
                'reorder_level' => $opening > 0 ? round($opening * 0.25) : 0, 'reorder_qty' => $opening > 0 ? round($opening * 0.75) : 0,
                'track_batches' => $batches,
            ]);
            ProductUnit::query()->create(['product_id' => $product->id, 'unit_id' => $unit($base), 'factor' => 1, 'barcode' => '62210000'.str_pad((string) ($i + 1), 5, '0', STR_PAD_LEFT), 'is_default_sale' => true, 'is_default_purchase' => ! $box]);
            if ($box) {
                $carton = ProductUnit::query()->create(['product_id' => $product->id, 'unit_id' => $unit($box[0]), 'factor' => $box[1], 'barcode' => '62219000'.str_pad((string) ($i + 1), 5, '0', STR_PAD_LEFT),
                    'sale_price' => round($sale * $box[1] * 0.97, 2), 'is_default_purchase' => true]);
                DB::table('price_list_items')->insert(['price_list_id' => $wholesale, 'product_id' => $product->id, 'product_unit_id' => $carton->id, 'price' => round($sale * $box[1] * 0.93, 2), 'created_at' => now(), 'updated_at' => now()]);
            }
            $this->products[$key] = ['product' => $product, 'cost' => $cost, 'opening' => $opening, 'expiry_days' => $expiry ?: 0];
        }
    }

    private function parties(User $salesperson): void
    {
        $wholesale = PriceList::query()->where('name', 'جملة')->value('id');
        $make = function (array $data) {
            $kind = ($data['is_customer'] ?? false) ? 'customer' : 'supplier';

            return Party::query()->create($data + ['code' => $this->numbers->code($kind)]);
        };
        $this->customers = [
            'walkin' => $make(['is_customer' => true, 'kind' => 'individual', 'name' => 'عميل نقدي', 'name_en' => 'Cash customer', 'credit_limit' => 0]),
            'nour' => $make(['is_customer' => true, 'name' => 'سوبر ماركت النور', 'name_en' => 'El Nour Supermarket', 'phone' => '0224015566', 'mobile' => '01001234567', 'city' => 'القاهرة', 'address' => 'شارع مكرم عبيد، مدينة نصر', 'payment_terms_days' => 30, 'credit_limit' => 80000, 'salesperson_id' => $salesperson->id, 'price_list_id' => $wholesale, 'tax_number' => '312-554-118']),
            'amal' => $make(['is_customer' => true, 'name' => 'ماركت الأمل', 'name_en' => 'El Amal Market', 'mobile' => '01114567890', 'city' => 'الجيزة', 'address' => 'فيصل، الجيزة', 'payment_terms_days' => 15, 'credit_limit' => 30000, 'salesperson_id' => $salesperson->id]),
            'hayat' => $make(['is_customer' => true, 'name' => 'شركة الحياة للمطاعم', 'name_en' => 'El Hayat Restaurants Co.', 'phone' => '0233456789', 'city' => 'القاهرة', 'payment_terms_days' => 45, 'credit_limit' => 150000, 'salesperson_id' => $salesperson->id, 'subject_to_wht' => true, 'wht_rate' => 1, 'tax_number' => '405-221-907']),
            'fathalla' => $make(['is_customer' => true, 'name' => 'أسواق فتح الله', 'name_en' => 'Fathalla Markets', 'phone' => '034250000', 'city' => 'الإسكندرية', 'payment_terms_days' => 30, 'credit_limit' => 200000, 'salesperson_id' => $salesperson->id, 'price_list_id' => $wholesale, 'subject_to_wht' => true, 'wht_rate' => 1, 'tax_number' => '200-118-553']),
            'saad' => $make(['is_customer' => true, 'kind' => 'individual', 'name' => 'محل سعد للبقالة', 'name_en' => 'Saad Grocery', 'mobile' => '01229876543', 'city' => 'القاهرة', 'credit_limit' => 10000]),
        ];
        $this->suppliers = [
            'nile' => $make(['is_supplier' => true, 'name' => 'شركة النيل للمواد الغذائية', 'name_en' => 'Nile Foods Co.', 'phone' => '0225789000', 'city' => 'القاهرة', 'payment_terms_days' => 30, 'tax_number' => '100-447-882']),
            'delta' => $make(['is_supplier' => true, 'name' => 'ألبان الدلتا', 'name_en' => 'Delta Dairy', 'phone' => '0402334455', 'city' => 'طنطا', 'payment_terms_days' => 14, 'tax_number' => '233-670-114']),
            'clean' => $make(['is_supplier' => true, 'name' => 'الشركة المصرية للمنظفات', 'name_en' => 'Egyptian Detergents Co.', 'phone' => '0238881200', 'city' => 'السادس من أكتوبر', 'payment_terms_days' => 30, 'subject_to_wht' => true, 'wht_rate' => 1]),
        ];
    }

    private function crmData(array $users, callable $day): void
    {
        $sources = Source::query()->pluck('id', 'name_en');
        $stages = Stage::query()->orderBy('sort_order')->get()->keyBy('name_en');
        $reason = LostReason::query()->where('name_en', 'Price too high')->value('id');
        $sales = $users['sales'];

        $leads = [];
        foreach ([
            ['محمد عبد الرحمن', 'هايبر ماركت الريان', '01001112233', 'Field visit', 'qualified', 90000, 'القاهرة'],
            ['ياسمين فاروق', 'مطاعم بيت الكرم', '01224445566', 'Referral', 'contacted', 45000, 'الجيزة'],
            ['عمرو شوقي', 'كافيه الزمالك', '01117778899', 'Facebook', 'new', 12000, 'القاهرة'],
            ['إيمان صلاح', 'فندق النيل الذهبي', '01556667788', 'Exhibition', 'qualified', 160000, 'الأقصر'],
            ['خالد منصور', 'سلسلة صيدليات الشفاء', '01009990011', 'Website', 'unqualified', 0, 'المنصورة'],
            ['رنا جمال', 'ماركت السعادة', '01203334455', 'WhatsApp', 'new', 18000, 'الإسكندرية'],
        ] as $i => [$name, $company, $mobile, $source, $status, $value, $city]) {
            $lead = Lead::query()->create(['name' => $name, 'company_name' => $company, 'mobile' => $mobile, 'source_id' => $sources[$source] ?? null, 'status' => $status,
                'expected_value' => $value, 'city' => $city, 'owner_id' => $i % 3 === 2 ? $users['sales2']->id : $sales->id, 'created_at' => Carbon::parse($day(10 + $i * 9))]);
            $leads[] = $lead;
        }

        $deal = fn ($title, $lead, $party, $stage, $value, $close, $owner) => Opportunity::query()->create([
            'title' => $title, 'lead_id' => $lead?->id, 'party_id' => $party?->id, 'stage_id' => $stages[$stage]->id, 'probability' => $stages[$stage]->probability,
            'value' => $value, 'expected_close_date' => $close, 'owner_id' => $owner->id, 'status' => 'open',
        ]);
        $deal('توريد شهري للهايبر', $leads[0], null, 'Proposal sent', 90000, now()->addDays(10)->toDateString(), $sales);
        $deal('توريد مطاعم بيت الكرم', $leads[1], null, 'Needs analysis', 45000, now()->addDays(25)->toDateString(), $sales);
        $deal('عقد توريد فندق النيل الذهبي', $leads[3], null, 'Negotiation', 160000, now()->addDays(7)->toDateString(), $users['manager']);
        $deal('طلبية كافيه الزمالك', $leads[2], null, 'New', 12000, now()->addDays(30)->toDateString(), $sales);
        $deal('زيادة حجم توريد النور', null, $this->customers['nour'], 'Contacted', 60000, now()->addDays(20)->toDateString(), $sales);
        $won = $deal('توريد منظفات لمطاعم الحياة', null, $this->customers['hayat'], 'Proposal sent', 35000, now()->subDays(5)->toDateString(), $sales);
        $this->crm->moveOpportunity($won, $stages['Won']->id);
        $lost = $deal('توريد أجبان لسلسلة الشفاء', $leads[4], null, 'Proposal sent', 28000, now()->subDays(12)->toDateString(), $sales);
        $this->crm->moveOpportunity($lost, $stages['Lost']->id, ['lost_reason_id' => $reason, 'lost_note' => 'عرض منافس أقل بـ 8%']);

        foreach ([
            ['call', 'مكالمة تعريفية بالشركة والمنتجات', $leads[0], 'interested', 30],
            ['visit', 'زيارة الفرع الرئيسي وعرض العينات', $leads[0], 'positive', 25],
            ['whatsapp', 'إرسال قائمة الأسعار على واتساب', $leads[1], null, 20],
            ['meeting', 'اجتماع مع مدير المشتريات بالفندق', $leads[3], 'negotiating', 12],
            ['call', 'متابعة عرض السعر', $leads[3], 'callback', 4],
        ] as [$type, $subject, $lead, $outcome, $ago]) {
            Activity::query()->create(['type' => $type, 'subject' => $subject, 'lead_id' => $lead->id, 'outcome' => $outcome, 'user_id' => $lead->owner_id, 'occurred_at' => now()->subDays($ago)->setTime(11, 30)]);
        }
        foreach ($leads as $lead) {
            $this->crm->scoreLead($lead);
        }

        foreach ([
            ['الاتصال بمدير مشتريات الهايبر لتأكيد العرض', $leads[0], null, now()->setTime(12, 0), 'high'],
            ['إرسال عرض سعر محدث لفندق النيل', $leads[3], null, now()->setTime(15, 30), 'high'],
            ['تحصيل شيك ماركت الأمل المرتد', null, $this->customers['amal'], now()->subDays(2)->setTime(10, 0), 'high'],
            ['زيارة كافيه الزمالك', $leads[2], null, now()->addDays(2)->setTime(13, 0), 'normal'],
            ['مراجعة حد الائتمان لسوبر ماركت النور', null, $this->customers['nour'], now()->addDays(4)->setTime(11, 0), 'low'],
        ] as [$title, $lead, $party, $due, $priority]) {
            Task::query()->create(['title' => $title, 'lead_id' => $lead?->id, 'party_id' => $party?->id, 'due_at' => $due, 'remind_at' => $due->copy()->subMinutes(30),
                'priority' => $priority, 'assigned_to' => $sales->id, 'created_by' => $sales->id]);
        }
    }

    private function line(string $key, float $quantity, string $kind = 'sale', array $extra = []): array
    {
        $p = $this->products[$key];
        $product = $p['product'];
        $unit = ProductUnit::query()->where('product_id', $product->id)->where('factor', 1)->first();

        return [
            'product_id' => $product->id,
            'product_unit_id' => $unit->id,
            'quantity' => $quantity,
            // Purchase prices drift up a little so the moving average moves.
            'unit_price' => $kind === 'purchase' ? round($p['cost'] * 1.06, 2) : (float) $product->sale_price,
        ] + $extra;
    }
}
