<?php

namespace App\Modules\Core\Services;

use App\Models\User;
use App\Modules\Core\Models\Branch;
use App\Modules\CRM\Models\LostReason;
use App\Modules\CRM\Models\Source;
use App\Modules\CRM\Models\Stage;
use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Models\CashAccount;
use App\Modules\Finance\Models\FiscalYear;
use App\Modules\Finance\Models\TaxRate;
use App\Modules\Inventory\Models\PriceList;
use App\Modules\Inventory\Models\Unit;
use App\Modules\Inventory\Models\Warehouse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * First-run setup of a company file: everything a new company needs to
 * start selling on day one.
 */
class InstallService
{
    public function __construct(
        private readonly SettingsService $settings,
        private readonly AuditService $audit,
    ) {}

    public function isInstalled(): bool
    {
        try {
            return User::query()->exists();
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * @param  array  $options  company_name, company_name_en, currency, vat_rate, admin_name, admin_username,
     *                          admin_password, admin_email, locale, tax_number, fiscal_start (Y-m-d)
     */
    public function install(array $options): User
    {
        return $this->audit->quietly(fn () => DB::transaction(function () use ($options) {
            $this->syncPermissions();
            $this->settings->setMany([
                'company.name' => $options['company_name'] ?? config('erp.settings.company.name'),
                'company.name_en' => $options['company_name_en'] ?? ($options['company_name'] ?? config('erp.settings.company.name_en')),
                'company.currency' => strtoupper($options['currency'] ?? 'EGP'),
                'company.tax_number' => $options['tax_number'] ?? null,
                'company.phone' => $options['phone'] ?? null,
                'company.address' => $options['address'] ?? null,
            ]);

            $this->seedChartOfAccounts();
            $vat = $this->seedTaxes((float) ($options['vat_rate'] ?? 14));

            $branch = Branch::query()->firstOrCreate(['code' => 'HQ'], ['name' => 'الفرع الرئيسي', 'name_en' => 'Head office', 'eta_branch_code' => '0']);
            $warehouse = Warehouse::query()->firstOrCreate(['code' => 'WH1'], ['name' => 'المخزن الرئيسي', 'name_en' => 'Main warehouse', 'branch_id' => $branch->id]);
            Warehouse::query()->firstOrCreate(['code' => 'TRANSIT'], ['name' => 'بضاعة بالطريق', 'name_en' => 'Goods in transit', 'is_transit' => true, 'kind' => 'transit']);

            $cashGroup = Account::query()->where('system_key', 'cash_group')->first();
            $cashGl = Account::query()->firstOrCreate(['code' => '12101'], [
                'parent_id' => $cashGroup->id, 'name' => 'الخزينة الرئيسية', 'name_en' => 'Main cash box', 'type' => 'asset',
            ]);
            $cash = CashAccount::query()->firstOrCreate(['code' => 'CASH1'], [
                'type' => 'cash', 'name' => 'الخزينة الرئيسية', 'name_en' => 'Main cash box', 'branch_id' => $branch->id,
                'account_id' => $cashGl->id, 'currency' => $this->settings->currency(),
            ]);

            foreach ([['قطعة', 'Piece'], ['علبة', 'Box'], ['كرتونة', 'Carton'], ['دستة', 'Dozen'], ['كيلوجرام', 'Kilogram', true], ['لتر', 'Litre', true], ['متر', 'Metre', true], ['خدمة', 'Service']] as $unit) {
                Unit::query()->firstOrCreate(['name' => $unit[0]], ['name_en' => $unit[1], 'allow_fraction' => $unit[2] ?? false]);
            }
            foreach ([['قطاعي', 'Retail'], ['جملة', 'Wholesale'], ['موزعين', 'Distributors']] as $list) {
                PriceList::query()->firstOrCreate(['name' => $list[0]], ['name_en' => $list[1]]);
            }

            $this->seedCrm();

            $start = $options['fiscal_start'] ?? now()->startOfYear()->toDateString();
            FiscalYear::query()->firstOrCreate(['name' => substr($start, 0, 4)], [
                'start_date' => $start,
                'end_date' => Carbon::parse($start)->addYear()->subDay()->toDateString(),
            ]);

            $admin = User::query()->create([
                'name' => $options['admin_name'] ?? 'مدير النظام',
                'username' => $options['admin_username'] ?? 'admin',
                'email' => $options['admin_email'] ?? null,
                'password' => $options['admin_password'],
                'locale' => $options['locale'] ?? 'ar',
                'branch_id' => $branch->id,
                'default_warehouse_id' => $warehouse->id,
                'default_cash_account_id' => $cash->id,
                'is_salesperson' => true,
            ]);
            $admin->assignRole('admin');
            $this->settings->set('tax.default_vat_id', $vat->id);
            $this->settings->set('system.installed_at', now()->toDateTimeString());
            $this->settings->set(SetupGuideService::KEY, SetupGuideService::initialState());

            return $admin;
        }));
    }

    /**
     * Create every permission and the standard roles. Safe to re-run after
     * an upgrade adds permissions.
     */
    public function syncPermissions(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();
        $all = collect(config('erp.permissions'))->flatten()->values();
        foreach ($all as $name) {
            Permission::query()->firstOrCreate(['name' => $name, 'guard_name' => 'web']);
        }
        foreach (config('erp.roles') as $name => $role) {
            $model = Role::query()->firstOrCreate(['name' => $name, 'guard_name' => 'web']);
            $patterns = $role['permissions'];
            $optIn = config('erp.opt_in_permissions', []);
            $granted = $all->filter(function ($permission) use ($patterns, $optIn) {
                foreach ($patterns as $pattern) {
                    // Wildcards never include opt-in permissions; those are granted by name.
                    if (in_array($permission, $optIn, true) && $pattern !== $permission) {
                        continue;
                    }
                    if ($pattern === '*' || $pattern === $permission || (str_ends_with($pattern, '.*') && str_starts_with($permission, substr($pattern, 0, -1)))) {
                        return true;
                    }
                }

                return false;
            })->values()->all();
            if (! $model->wasRecentlyCreated && $name !== 'admin') {
                // Existing custom edits are kept; only add new permissions.
                $model->givePermissionTo($granted);
            } else {
                $model->syncPermissions($granted);
            }
        }
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    private function seedChartOfAccounts(): void
    {
        $rows = require database_path('data/chart_of_accounts.php');
        $ids = [];
        foreach ($rows as $row) {
            [$code, $parent, $name, $nameEn, $type] = $row;
            $account = Account::query()->firstOrCreate(['code' => $code], [
                'parent_id' => $parent ? $ids[$parent] : null,
                'name' => $name,
                'name_en' => $nameEn,
                'type' => $type,
                'is_group' => (bool) ($row[5] ?? false),
                'system_key' => $row[6] ?? null,
                'allow_manual' => $row[7] ?? true,
            ]);
            $ids[$code] = $account->id;
        }
    }

    private function seedTaxes(float $vatRate): TaxRate
    {
        $vat = TaxRate::query()->firstOrCreate(['name' => 'ضريبة القيمة المضافة '.rtrim(rtrim(number_format($vatRate, 2), '0'), '.').'%'], [
            'name_en' => 'VAT '.rtrim(rtrim(number_format($vatRate, 2), '0'), '.').'%', 'type' => 'vat', 'rate' => $vatRate,
            'eta_type' => 'T1', 'eta_subtype' => 'V009', 'is_default' => true,
        ]);
        TaxRate::query()->firstOrCreate(['name' => 'معفى'], ['name_en' => 'Exempt', 'type' => 'vat', 'rate' => 0, 'eta_type' => 'T1', 'eta_subtype' => 'V003']);
        TaxRate::query()->firstOrCreate(['name' => 'خصم وإضافة 1%'], ['name_en' => 'Withholding 1%', 'type' => 'wht', 'rate' => 1, 'eta_type' => 'T4', 'eta_subtype' => 'W010']);
        TaxRate::query()->firstOrCreate(['name' => 'خصم وإضافة 3%'], ['name_en' => 'Withholding 3%', 'type' => 'wht', 'rate' => 3, 'eta_type' => 'T4', 'eta_subtype' => 'W002']);

        return $vat;
    }

    private function seedCrm(): void
    {
        $stages = [
            ['عميل محتمل جديد', 'New', 10, false, false, '#64748b'],
            ['تم التواصل', 'Contacted', 20, false, false, '#3b82f6'],
            ['تحديد الاحتياج', 'Needs analysis', 40, false, false, '#8b5cf6'],
            ['تم إرسال عرض سعر', 'Proposal sent', 60, false, false, '#f59e0b'],
            ['تفاوض', 'Negotiation', 80, false, false, '#f97316'],
            ['تم الفوز', 'Won', 100, true, false, '#16a34a'],
            ['خسارة', 'Lost', 0, false, true, '#dc2626'],
        ];
        foreach ($stages as $i => $s) {
            Stage::query()->firstOrCreate(['name' => $s[0]], ['name_en' => $s[1], 'probability' => $s[2], 'is_won' => $s[3], 'is_lost' => $s[4], 'color' => $s[5], 'sort_order' => $i + 1]);
        }
        foreach ([['فيسبوك', 'Facebook'], ['واتساب', 'WhatsApp'], ['ترشيح من عميل', 'Referral'], ['زيارة ميدانية', 'Field visit'], ['معرض', 'Exhibition'], ['موقع إلكتروني', 'Website'], ['اتصال وارد', 'Inbound call']] as $s) {
            Source::query()->firstOrCreate(['name' => $s[0]], ['name_en' => $s[1]]);
        }
        foreach ([['السعر مرتفع', 'Price too high'], ['اختار منافس', 'Chose a competitor'], ['لا توجد ميزانية', 'No budget'], ['توقيت غير مناسب', 'Bad timing'], ['لا يوجد رد', 'No response'], ['المنتج غير مناسب', 'Product not a fit']] as $r) {
            LostReason::query()->firstOrCreate(['name' => $r[0]], ['name_en' => $r[1]]);
        }
    }
}
