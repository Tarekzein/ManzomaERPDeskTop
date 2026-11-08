<?php

namespace App\Modules\Core\Services;

use App\Models\User;
use App\Modules\Core\Http\Controllers\CrudController;
use App\Modules\Core\Models\Setting;
use App\Modules\CRM\Models\Activity;
use App\Modules\CRM\Models\Lead;
use App\Modules\CRM\Models\Opportunity;
use App\Modules\CRM\Models\Task;
use App\Modules\Finance\Models\Account;
use App\Modules\Finance\Models\CashAccount;
use App\Modules\Finance\Models\FiscalYear;
use App\Modules\Finance\Models\JournalEntry;
use App\Modules\Finance\Models\Voucher;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Parties\Models\Party;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\MaintenanceProfile;
use App\Modules\Service\Models\MessageTemplate;
use App\Modules\Service\Models\PartyAddress;
use App\Modules\Service\Models\ServiceRequest;
use App\Modules\Service\Models\ServiceVisit;
use App\Modules\Trading\Models\TradeDocument;
use App\Modules\Trading\Services\TradingService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Role;

/** Trusted names only. Never instantiate a model supplied by an API client. */
class FormRegistry
{
    public function all(): array
    {
        $forms = [
            'company-settings' => ['settings', Setting::class, ['settings.manage'], ['settings.manage']],
            'fiscal-years' => ['fiscal_years', FiscalYear::class, ['fiscal.manage', 'finance.reports'], ['fiscal.manage']],
            'customers' => ['parties', Party::class, ['customers.view'], ['customers.manage']],
            'suppliers' => ['parties', Party::class, ['suppliers.view'], ['suppliers.manage']],
            'products' => ['products', Product::class, ['products.view', 'stock.view'], ['products.manage']],
            'leads' => ['crm_leads', Lead::class, ['crm.view'], ['crm.manage']],
            'opportunities' => ['crm_opportunities', Opportunity::class, ['crm.view'], ['crm.manage']],
            'activities' => ['crm_activities', Activity::class, ['crm.view'], ['crm.manage']],
            'tasks' => ['crm_tasks', Task::class, ['crm.view'], ['crm.manage']],
            'accounts' => ['accounts', Account::class, ['accounts.manage', 'finance.reports'], ['accounts.manage']],
            'journals' => ['journal_entries', JournalEntry::class, ['journals.manage', 'finance.reports'], ['journals.manage']],
            'cash-accounts' => ['cash_accounts', CashAccount::class, ['treasury.view', 'vouchers.manage'], ['accounts.manage']],
            'users' => ['users', User::class, ['users.manage'], ['users.manage']],
            'roles' => ['roles', Role::class, ['users.manage'], ['users.manage']],
            'party-addresses' => ['party_addresses', PartyAddress::class, ['service.view_all'], ['service.manage']],
            'message-templates' => ['message_templates', MessageTemplate::class, ['service.view'], ['service.settings']],
            'customer-units' => ['customer_units', CustomerUnit::class, ['service.view'], ['service.manage']],
            'maintenance-profiles' => ['maintenance_profiles', MaintenanceProfile::class, ['service.view'], ['service.settings']],
            'service-requests' => ['service_requests', ServiceRequest::class, ['service.view'], ['service.manage']],
            'service-visits' => ['service_visits', ServiceVisit::class, ['service.view'], ['service.manage']],
        ];
        foreach (CrudController::resources() as $key => $resource) {
            $forms[$key] = [(new $resource['model'])->getTable(), $resource['model'], [$resource['view'] ?? $resource['manage']], [$resource['manage']]];
        }
        foreach (TradingService::TYPES as $type) {
            $permission = match ($type) {
                'sales_quotation' => 'sales.quotations', 'sales_order' => 'sales.orders', 'sales_invoice' => 'sales.invoices', 'sales_return' => 'sales.returns',
                'purchase_order' => 'purchases.orders', 'purchase_receipt' => 'purchases.receipts', 'purchase_invoice' => 'purchases.invoices', 'purchase_return' => 'purchases.returns',
            };
            $forms[$type] = ['trade_documents', TradeDocument::class, [$permission, str_starts_with($type, 'sales_') ? 'sales.reports' : 'purchases.reports'], [$permission]];
        }
        foreach (['adjustment' => 'stock.adjust', 'opening' => 'stock.adjust', 'transfer' => 'stock.transfer', 'count' => 'stock.count'] as $type => $permission) {
            $forms['stock_'.$type] = ['stock_documents', StockDocument::class, ['stock.view'], [$permission]];
        }
        foreach (['receipt', 'payment', 'transfer', 'expense'] as $type) {
            $forms['voucher_'.$type] = ['vouchers', Voucher::class, ['treasury.view', 'vouchers.manage'], [$type === 'expense' ? 'expenses.manage' : 'vouchers.manage']];
        }

        return $forms;
    }

    public function labels(string $key): array
    {
        return [
            'customers' => ['العملاء', 'Customers'], 'suppliers' => ['الموردون', 'Suppliers'], 'products' => ['الأصناف', 'Items'],
            'leads' => ['العملاء المحتملون', 'Leads'], 'opportunities' => ['الصفقات', 'Opportunities'], 'activities' => ['الأنشطة', 'Activities'], 'tasks' => ['المتابعات', 'Follow-ups'],
            'accounts' => ['دليل الحسابات', 'Chart of accounts'], 'cash-accounts' => ['الخزائن والبنوك', 'Cash and bank accounts'], 'journals' => ['قيود اليومية', 'Journal entries'],
            'users' => ['المستخدمون', 'Users'], 'roles' => ['الأدوار والصلاحيات', 'Roles and permissions'], 'company-settings' => ['إعدادات الشركة', 'Company settings'], 'fiscal-years' => ['السنوات المالية', 'Fiscal years'],
            'party-addresses' => ['مواقع الخدمة', 'Service locations'], 'customer-units' => ['فلاتر العملاء', 'Customer filters'], 'maintenance-profiles' => ['برامج تغيير الشمعات', 'Replacement schedules'],
            'service-requests' => ['طلبات الخدمة', 'Service requests'], 'service-visits' => ['زيارات الفنيين', 'Technician visits'], 'message-templates' => ['قوالب الرسائل', 'Message templates'],
            'branches' => ['الفروع', 'Branches'], 'warehouses' => ['المخازن والسيارات', 'Warehouses and vans'], 'units' => ['وحدات القياس', 'Units'], 'categories' => ['مجموعات الأصناف', 'Item categories'],
            'brands' => ['العلامات التجارية', 'Brands'], 'price-lists' => ['قوائم الأسعار', 'Price lists'], 'cost-centers' => ['مراكز التكلفة', 'Cost centres'], 'tax-rates' => ['الضرائب', 'Taxes'],
            'crm-stages' => ['مراحل الصفقات', 'Pipeline stages'], 'crm-sources' => ['مصادر العملاء', 'Lead sources'], 'crm-lost-reasons' => ['أسباب خسارة الصفقة', 'Lost reasons'], 'tags' => ['الوسوم', 'Tags'],
            'sales_quotation' => ['عروض الأسعار', 'Quotations'], 'sales_order' => ['أوامر البيع', 'Sales orders'], 'sales_invoice' => ['فواتير المبيعات', 'Sales invoices'], 'sales_return' => ['مرتجعات المبيعات', 'Sales returns'],
            'purchase_order' => ['أوامر الشراء', 'Purchase orders'], 'purchase_receipt' => ['استلام المشتريات', 'Goods receipts'], 'purchase_invoice' => ['فواتير المشتريات', 'Purchase invoices'], 'purchase_return' => ['مرتجعات المشتريات', 'Purchase returns'],
            'stock_adjustment' => ['تسويات المخزون', 'Stock adjustments'], 'stock_opening' => ['بضاعة أول المدة', 'Opening stock'], 'stock_transfer' => ['التحويلات المخزنية', 'Stock transfers'], 'stock_count' => ['الجرد', 'Stock counts'],
            'voucher_receipt' => ['سندات القبض', 'Receipts'], 'voucher_payment' => ['سندات الصرف', 'Payments'], 'voucher_transfer' => ['التحويلات النقدية', 'Cash transfers'], 'voucher_expense' => ['المصروفات', 'Expenses'],
        ][$key] ?? [$key, $key];
    }

    public function get(string $key): array
    {
        $key = preg_replace('/\.(create|edit)$/', '', $key);
        $entry = $this->all()[$key] ?? null;
        abort_unless($entry, 404, 'Unknown form.');

        return ['key' => $key, 'entity_type' => $entry[0], 'model' => $entry[1], 'view' => $entry[2], 'manage' => $entry[3]];
    }

    public function forModel(Model $model): ?string
    {
        foreach ($this->all() as $key => $entry) {
            if ($entry[1] === $model::class) {
                if ($entry[0] === 'trade_documents') {
                    return $model->type;
                }
                if ($entry[0] === 'stock_documents') {
                    return 'stock_'.$model->type;
                }
                if ($entry[0] === 'vouchers') {
                    return 'voucher_'.($model->type === 'payment' && ! $model->party_id ? 'expense' : $model->type);
                }
                if ($entry[0] === 'parties') {
                    return $model->is_customer ? 'customers' : 'suppliers';
                }

                return $key;
            }
        }

        return null;
    }

    public function authorize(string $key, string $action = 'view', ?Model $record = null): array
    {
        $form = $this->get($key);
        $user = auth()->user();
        abort_unless($user && collect($form[$action])->contains(fn ($p) => $user->can($p)), 403);
        if ($record) {
            abort_unless($record->getTable() === $form['entity_type'], 404);
            if ($record->getTable() === 'trade_documents') {
                abort_unless($record->type === $form['key'], 404);
            }
            if ($record->getTable() === 'crm_leads' || $record->getTable() === 'crm_opportunities') {
                abort_unless(! $record->owner_id || $record->owner_id === $user->id || $user->can('crm.view_all'), 403);
            }
            if ($record->getTable() === 'crm_tasks') {
                abort_unless($record->assigned_to === $user->id || $user->can('crm.view_all'), 403);
            }
            if ($record->getTable() === 'service_visits' && ! $user->can('service.view_all')) {
                abort_unless($record->technician_id === $user->id, 403);
            }
        }

        return $form;
    }

    public function query(string $key): Builder
    {
        $form = $this->authorize($key);
        $query = $form['model']::query();
        if ($form['entity_type'] === 'settings') {
            // Settings custom data belongs to one company singleton, not a setting row/key.
            $query->fromSub(DB::query()->selectRaw('1 AS id'), 'settings');
        }
        if ($form['entity_type'] === 'vouchers') {
            $kind = substr($form['key'], 8);
            $query->where('type', $kind === 'expense' ? 'payment' : $kind);
            if ($kind === 'expense') {
                $query->whereNull('party_id');
            } elseif ($kind === 'payment') {
                $query->whereNotNull('party_id');
            }
        }
        if ($form['entity_type'] === 'parties') {
            $query->where($form['key'] === 'suppliers' ? 'is_supplier' : 'is_customer', true);
        }
        if ($form['entity_type'] === 'trade_documents') {
            $query->where('type', $form['key']);
        }
        if ($form['entity_type'] === 'stock_documents') {
            $query->where('type', substr($form['key'], 6));
        }
        if (in_array($form['entity_type'], ['crm_leads', 'crm_opportunities'], true) && ! auth()->user()->can('crm.view_all')) {
            $query->where(fn ($q) => $q->where('owner_id', auth()->id())->orWhereNull('owner_id'));
        }
        if ($form['entity_type'] === 'crm_tasks' && ! auth()->user()->can('crm.view_all')) {
            $query->where('assigned_to', auth()->id());
        }
        if (str_starts_with($form['entity_type'], 'service_') && ! auth()->user()->can('service.view_all')) {
            if ($form['entity_type'] === 'service_visits') {
                $query->where('technician_id', auth()->id());
            } elseif ($form['entity_type'] === 'service_requests') {
                $query->whereHas('visits', fn ($q) => $q->where('technician_id', auth()->id()));
            }
        }
        if ($form['entity_type'] === 'customer_units' && ! auth()->user()->can('service.view_all')) {
            $query->whereIn('id', ServiceRequest::query()->whereHas('visits', fn ($q) => $q->where('technician_id', auth()->id()))->select('unit_id'));
        }
        if ($form['entity_type'] === 'cash_accounts' && ! auth()->user()->can('treasury.all_accounts')) {
            $query->where(fn ($q) => $q->whereNull('custodian_id')->orWhere('custodian_id', auth()->id())->orWhere('id', auth()->user()->default_cash_account_id));
        }

        return $query;
    }
}
