<?php

/*
| ManzomaERP Desktop configuration.
|
| Runtime values (database path, storage path) come from the environment the
| Electron shell or the server provides. Business settings live in the
| `settings` table so each company file carries its own.
*/

return [
    'version' => '1.0.0',

    // Server mode: one database per company, selected with the X-Company header.
    'multi_company' => (bool) env('ERP_MULTI_COMPANY', false),
    'company_db_prefix' => env('ERP_COMPANY_DB_PREFIX', 'erp_'),
    'companies_registry' => env('ERP_COMPANIES_REGISTRY', storage_path('app/companies.json')),

    'backup_path' => env('ERP_BACKUP_PATH', storage_path('backups')),

    /*
    | Document numbering. Codes for master data have no period; documents are
    | numbered per year: SI-2026-000001.
    */
    'numbering' => [
        'sales_quotation' => 'QT',
        'sales_order' => 'SO',
        'sales_invoice' => 'SI',
        'sales_return' => 'SR',
        'purchase_order' => 'PO',
        'purchase_receipt' => 'GR',
        'purchase_invoice' => 'PI',
        'purchase_return' => 'PR',
        'receipt' => 'RV',
        'payment' => 'PV',
        'transfer' => 'TV',
        'journal' => 'JE',
        'adjustment' => 'ADJ',
        'stock_transfer' => 'TRF',
        'count' => 'CNT',
        'opening' => 'OPN',
    ],
    'codes' => [
        'customer' => 'C',
        'supplier' => 'S',
        'party' => 'A',
        'product' => 'P',
    ],

    /*
    | Permission catalogue, grouped for the role editor.
    */
    'permissions' => [
        'forms' => ['forms.manage'],
        'service' => ['service.view', 'service.view_all', 'service.manage', 'service.complete', 'service.correct', 'service.settings', 'service.free', 'service.reports'],
        'settings' => ['settings.manage', 'users.manage', 'audit.view', 'backup.manage'],
        'customers' => ['customers.view', 'customers.manage'],
        'suppliers' => ['suppliers.view', 'suppliers.manage'],
        'crm' => ['crm.view', 'crm.manage', 'crm.view_all', 'crm.settings'],
        'inventory' => ['products.view', 'products.manage', 'stock.view', 'stock.adjust', 'stock.transfer', 'stock.count', 'stock.allow_negative', 'inventory.view_cost'],
        'sales' => ['sales.quotations', 'sales.orders', 'sales.invoices', 'sales.invoices.post', 'sales.invoices.void', 'sales.returns', 'sales.view_cost', 'sales.override_credit', 'sales.override_price', 'sales.override_discount', 'sales.reports', 'pricing.manage'],
        'purchases' => ['purchases.orders', 'purchases.receipts', 'purchases.invoices', 'purchases.invoices.post', 'purchases.invoices.void', 'purchases.returns', 'purchases.reports'],
        'finance' => ['accounts.manage', 'journals.manage', 'journals.post', 'finance.reports', 'fiscal.manage', 'taxes.manage'],
        'treasury' => ['treasury.view', 'vouchers.manage', 'vouchers.post', 'vouchers.void', 'expenses.manage', 'cheques.manage', 'treasury.all_accounts'],
    ],

    /*
    | Permissions a wildcard ('*', 'stock.*') never grants: they change how the
    | books behave, so a role must name them explicitly.
    */
    'opt_in_permissions' => ['stock.allow_negative'],

    'roles' => [
        'admin' => ['label' => 'مدير النظام', 'label_en' => 'Administrator', 'permissions' => ['*']],
        'technician' => ['label' => 'فني', 'label_en' => 'Technician', 'permissions' => ['service.view', 'products.view']],
        'service_coordinator' => ['label' => 'منسق الصيانة', 'label_en' => 'Service coordinator', 'permissions' => ['service.*', 'customers.*', 'products.view', 'stock.view', 'crm.*', 'sales.invoices']],
        'accountant' => ['label' => 'محاسب', 'label_en' => 'Accountant', 'permissions' => [
            'customers.*', 'suppliers.*', 'finance.*', 'accounts.manage', 'journals.*', 'fiscal.manage', 'taxes.manage',
            'treasury.*', 'vouchers.*', 'expenses.manage', 'cheques.manage', 'products.view', 'stock.view',
            'inventory.view_cost', 'sales.invoices', 'sales.invoices.post', 'sales.invoices.void', 'sales.returns',
            'sales.view_cost', 'sales.reports', 'purchases.invoices', 'purchases.invoices.post', 'purchases.invoices.void',
            'purchases.returns', 'purchases.reports', 'audit.view',
        ]],
        'sales_manager' => ['label' => 'مدير مبيعات', 'label_en' => 'Sales manager', 'permissions' => [
            'customers.*', 'crm.*', 'sales.*', 'pricing.manage', 'products.view', 'stock.view', 'treasury.view',
            'vouchers.manage', 'vouchers.post',
        ]],
        'salesperson' => ['label' => 'مندوب مبيعات', 'label_en' => 'Salesperson', 'permissions' => [
            'customers.view', 'customers.manage', 'crm.view', 'crm.manage', 'sales.quotations', 'sales.orders',
            'sales.invoices', 'products.view', 'stock.view',
        ]],
        'cashier' => ['label' => 'كاشير', 'label_en' => 'Cashier', 'permissions' => [
            'customers.view', 'sales.invoices', 'sales.invoices.post', 'sales.returns', 'products.view', 'stock.view',
            'treasury.view', 'vouchers.manage', 'vouchers.post',
        ]],
        'storekeeper' => ['label' => 'أمين مخزن', 'label_en' => 'Storekeeper', 'permissions' => [
            'products.view', 'products.manage', 'stock.view', 'stock.adjust', 'stock.transfer', 'stock.count',
            'purchases.receipts', 'suppliers.view',
        ]],
        'purchaser' => ['label' => 'مسؤول مشتريات', 'label_en' => 'Purchaser', 'permissions' => [
            'suppliers.*', 'purchases.*', 'products.view', 'products.manage', 'stock.view', 'inventory.view_cost',
        ]],
    ],

    /*
    | Default settings written by the installer.
    */
    'settings' => [
        'company.name' => 'شركتي',
        'company.name_en' => 'My Company',
        'company.tax_number' => null,
        'company.commercial_register' => null,
        'company.address' => null,
        'company.phone' => null,
        'company.email' => null,
        'company.logo' => null,
        'company.currency' => 'EGP',
        'company.country' => 'EG',
        'company.timezone' => 'Africa/Cairo',
        'maintenance.reminder_days' => 7,
        'maintenance.overdue_days' => 7,
        'maintenance.owner_id' => null,
        'inventory.alert_owner_id' => null,
        'accounting.lock_date' => null,
        'accounting.costing_method' => 'average',
        'sales.price_includes_tax' => false,
        'sales.block_overdue_days' => 0,
        'sales.default_payment_terms' => 0,
        'sales.invoice_footer' => 'البضاعة المباعة لا ترد ولا تستبدل إلا خلال 14 يوماً بحالتها الأصلية.',
        'sales.require_salesperson' => false,
        'tax.wht_threshold' => 300,
        'inventory.allow_negative' => false,
        'inventory.expiry_alert_days' => 60,
        'security.idle_lock_minutes' => 15,
    ],
];
