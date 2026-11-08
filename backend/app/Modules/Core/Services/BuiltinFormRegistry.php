<?php

namespace App\Modules\Core\Services;

use App\Modules\Trading\Services\TradingService;

/** Trusted domain controls. Administrator layouts may arrange them, never redefine their rules. */
class BuiltinFormRegistry
{
    private function field(string $property, string $ar, string $en, string $type = 'text', array $settings = []): array
    {
        return $settings + ['key' => 'core.'.$property, 'property' => $property, 'source' => 'core', 'type' => $type,
            'label_ar' => $ar, 'label_en' => $en, 'conditionable' => ! in_array($type, ['widget', 'datetime'], true) && ! ($settings['create_only'] ?? false), 'protected' => (bool) ($settings['required'] ?? false)];
    }

    private function options(array $rows): array
    {
        return array_map(fn ($row) => ['value' => $row[0], 'label_ar' => $row[1], 'label_en' => $row[2]], $rows);
    }

    private function widget(string $property, string $ar, string $en, string $widget, array $settings = []): array
    {
        return $this->field($property, $ar, $en, 'widget', ['widget' => $widget] + $settings);
    }

    public function groups(string $key): array
    {
        $f = fn (...$args) => $this->field(...$args);
        $w = fn (...$args) => $this->widget(...$args);
        $name = [$f('name', 'الاسم', 'Name', 'text', ['required' => true]), $f('name_en', 'الاسم بالإنجليزية', 'English name', 'text', ['direction' => 'ltr'])];
        $code = $f('code', 'الكود', 'Code', 'text', ['required' => true, 'direction' => 'ltr']);
        $active = $f('is_active', 'نشط', 'Active', 'checkbox');
        $address = $f('address', 'العنوان', 'Address');
        $masters = [
            'branches' => [$code, ...$name, $f('phone', 'الهاتف', 'Phone', 'phone'), $address, $f('eta_branch_code', 'كود الفرع لدى المصلحة', 'Tax authority branch code'), $active],
            'warehouses' => [$code, ...$name, $w('branch_id', 'الفرع', 'Branch', 'branch'), $w('keeper_id', 'أمين المخزن', 'Storekeeper', 'user'),
                $f('kind', 'النوع', 'Kind', 'dropdown', ['required' => true, 'options_json' => $this->options([['store', 'مخزن', 'Store'], ['van', 'سيارة فني', 'Technician van']])]),
                $w('technician_id', 'الفني', 'Technician', 'technician'), $address, $active],
            'units' => [...$name, $f('allow_fraction', 'تقبل الكسور', 'Allows fractions', 'checkbox')],
            'categories' => [$code, ...$name, $w('parent_id', 'المجموعة الرئيسية', 'Parent category', 'category')],
            'brands' => [$name[0]],
            'price-lists' => [...$name, $active],
            'cost-centers' => [$code, ...$name, $active],
            'tax-rates' => [...$name, $f('type', 'النوع', 'Type', 'dropdown', ['required' => true, 'options_json' => $this->options([['vat', 'قيمة مضافة', 'VAT'], ['wht', 'خصم وإضافة', 'WHT']])]),
                $f('rate', 'النسبة %', 'Rate %', 'decimal', ['required' => true]), $f('eta_type', 'نوع الضريبة (المصلحة)', 'ETA tax type'), $f('eta_subtype', 'النوع الفرعي (المصلحة)', 'ETA subtype'), $f('is_default', 'افتراضي', 'Default', 'checkbox'), $active],
            'crm-stages' => [...$name, $f('probability', 'احتمال الفوز %', 'Win probability %', 'number', ['required' => true]), $f('sort_order', 'الترتيب', 'Order', 'number'), $f('color', 'اللون', 'Colour', 'color'), $f('is_won', 'مرحلة فوز', 'Won stage', 'checkbox'), $f('is_lost', 'مرحلة خسارة', 'Lost stage', 'checkbox')],
            'crm-sources' => $name, 'crm-lost-reasons' => $name,
            'tags' => [$name[0], $f('color', 'اللون', 'Colour', 'color')],
        ];
        if (isset($masters[$key])) {
            return [['key' => 'core.details', 'label_ar' => 'البيانات', 'label_en' => 'Details', 'columns' => 2, 'fields' => $masters[$key]]];
        }
        if (in_array($key, ['customers', 'suppliers'], true)) {
            $customer = ['field' => 'core.is_customer', 'operator' => 'equals', 'value' => true];

            return [
                ['key' => 'core.identity', 'label_ar' => 'بيانات الحساب', 'label_en' => 'Account identity', 'columns' => 2, 'fields' => [
                    ...$name, $f('code', 'الكود (تلقائي إذا تُرك فارغاً)', 'Code (generated if blank)', 'text', ['direction' => 'ltr']),
                    $f('kind', 'النوع', 'Type', 'dropdown', ['options_json' => $this->options([['individual', 'فرد', 'Individual'], ['company', 'شركة', 'Company']])]),
                    $f('is_customer', 'عميل', 'Customer', 'checkbox', ['protected' => true]), $f('is_supplier', 'مورد', 'Supplier', 'checkbox', ['protected' => true]), $active,
                    $f('mobile', 'الموبايل', 'Mobile', 'phone'), $f('phone', 'الهاتف', 'Phone', 'phone'), $f('email', 'البريد الإلكتروني', 'Email', 'email'), $f('city', 'المدينة', 'City'), $address,
                    $f('tax_number', 'رقم التسجيل الضريبي', 'Tax registration no.'), $f('commercial_register', 'السجل التجاري', 'Commercial register'), $f('national_id', 'الرقم القومي', 'National ID')]],
                ['key' => 'core.terms', 'label_ar' => 'الشروط المالية', 'label_en' => 'Financial terms', 'columns' => 2, 'fields' => [
                    $f('payment_terms_days', 'مدة السداد (يوم)', 'Payment terms (days)', 'number'), $w('credit_limit', 'حد الائتمان', 'Credit limit', 'credit_limit'),
                    $w('price_list_id', 'قائمة الأسعار', 'Price list', 'price_list', ['condition_json' => $customer]), $w('salesperson_id', 'المندوب المسؤول', 'Salesperson', 'salesperson', ['condition_json' => $customer]),
                    $f('subject_to_wht', 'خاضع للخصم والإضافة', 'Subject to withholding tax', 'checkbox'), $f('wht_rate', 'نسبة الخصم والإضافة %', 'Withholding rate %', 'decimal', ['condition_json' => ['field' => 'core.subject_to_wht', 'operator' => 'equals', 'value' => true]]),
                    $f('opening_balance', 'رصيد افتتاحي: موجب مستحق لنا؛ سالب مستحق له', 'Opening balance: positive owed to us; negative owed to them', 'decimal', ['create_only' => true, 'protected' => true]),
                    $f('opening_date', 'تاريخ الرصيد الافتتاحي', 'Opening balance date', 'date', ['create_only' => true, 'protected' => true])]],
                ['key' => 'core.contacts', 'label_ar' => 'الاتصال والملاحظات', 'label_en' => 'Contacts and notes', 'columns' => 1, 'fields' => [
                    $w('tags', 'الوسوم', 'Tags', 'tags'), $f('notes', 'ملاحظات', 'Notes', 'long_text'), $w('contacts', 'جهات الاتصال', 'Contact people', 'contacts')]],
            ];
        }
        if ($key === 'users') {
            return [['key' => 'core.identity', 'label_ar' => 'بيانات المستخدم', 'label_en' => 'User details', 'columns' => 3, 'fields' => [
                $name[0], $f('username', 'اسم الدخول', 'Username', 'text', ['required' => true, 'direction' => 'ltr']),
                $f('email', 'البريد', 'Email', 'email'), $f('phone', 'الهاتف', 'Phone', 'phone'),
                $f('locale', 'اللغة', 'Language', 'dropdown', ['protected' => true, 'options_json' => $this->options([['ar', 'العربية', 'Arabic'], ['en', 'الإنجليزية', 'English']])]),
                $w('branch_id', 'الفرع', 'Branch', 'branch'), $w('default_warehouse_id', 'المخزن الافتراضي', 'Default warehouse', 'default_warehouse'),
                $w('default_cash_account_id', 'الخزينة الافتراضية', 'Default cash box', 'cash_account'),
                $f('max_discount_percent', 'أقصى خصم مسموح %', 'Max discount %', 'decimal', ['protected' => true]),
                $f('is_salesperson', 'مندوب مبيعات', 'Salesperson', 'checkbox', ['protected' => true]),
                $f('commission_rate', 'نسبة العمولة %', 'Commission %', 'decimal', ['condition_json' => ['field' => 'core.is_salesperson', 'operator' => 'equals', 'value' => true]]),
            ]]];
        }
        if ($key === 'roles') {
            return [['key' => 'core.identity', 'label_ar' => 'الدور', 'label_en' => 'Role', 'columns' => 1, 'fields' => [
                $f('name', 'مفتاح الدور (حروف إنجليزية صغيرة)', 'Role key (lowercase letters)', 'text', ['required' => true, 'direction' => 'ltr']),
            ]]];
        }
        if ($key === 'fiscal-years') {
            return [['key' => 'core.period', 'label_ar' => 'الفترة المالية', 'label_en' => 'Financial period', 'columns' => 3, 'fields' => [
                $name[0], $f('start_date', 'من', 'From', 'date', ['required' => true]), $f('end_date', 'إلى', 'To', 'date', ['required' => true]),
            ]]];
        }
        if ($key === 'party-addresses') {
            return [['key' => 'core.address', 'label_ar' => 'موقع الخدمة', 'label_en' => 'Service location', 'columns' => 2, 'fields' => [
                $f('label', 'اسم الموقع', 'Location label', 'text', ['required' => true]), $f('governorate', 'المحافظة', 'Governorate'), $f('city', 'المدينة', 'City'),
                $f('street', 'الشارع', 'Street'), $f('building', 'المبنى', 'Building'), $f('floor', 'الدور', 'Floor'), $f('apartment', 'الشقة', 'Apartment'), $f('landmark', 'علامة مميزة', 'Landmark'),
                $f('latitude', 'خط العرض', 'Latitude', 'decimal'), $f('longitude', 'خط الطول', 'Longitude', 'decimal'), $f('is_default', 'الموقع الافتراضي', 'Default location', 'checkbox'),
            ]]];
        }
        if ($key === 'message-templates') {
            return [['key' => 'core.template', 'label_ar' => 'القالب', 'label_en' => 'Template', 'columns' => 2, 'fields' => [
                $f('key', 'مفتاح القالب', 'Template key', 'text', ['required' => true, 'direction' => 'ltr']),
                $f('locale', 'اللغة', 'Language', 'dropdown', ['required' => true, 'options_json' => $this->options([['ar', 'العربية', 'Arabic'], ['en', 'الإنجليزية', 'English']])]),
                $f('body', 'نص الرسالة', 'Message body', 'long_text', ['required' => true]),
            ]]];
        }
        if ($key === 'company-settings') {
            return [['key' => 'core.company', 'label_ar' => 'بيانات الشركة', 'label_en' => 'Company details', 'columns' => 2, 'fields' => [
                $f('company.name', 'اسم الشركة', 'Company name', 'text', ['protected' => true]), $f('company.name_en', 'الاسم بالإنجليزية', 'English name', 'text', ['direction' => 'ltr']),
                $f('company.tax_number', 'رقم التسجيل الضريبي', 'Tax registration no.', 'text', ['direction' => 'ltr']),
                $f('company.commercial_register', 'السجل التجاري', 'Commercial register', 'text', ['direction' => 'ltr']), $f('company.activity_code', 'كود النشاط', 'Activity code'),
                $f('company.phone', 'الهاتف', 'Phone', 'phone'), $f('company.email', 'البريد', 'Email', 'email'), $f('company.address', 'العنوان', 'Address', 'long_text'),
            ]]];
        }
        if (in_array($key, TradingService::TYPES, true)) {
            $sales = str_starts_with($key, 'sales_');
            $invoice = in_array($key, ['sales_invoice', 'purchase_invoice'], true);
            $fields = [$w('party_id', $sales ? 'العميل' : 'المورد', $sales ? 'Customer' : 'Supplier', 'trade_party', ['required' => true, 'party_role' => $sales ? 'customer' : 'supplier']),
                $f('date', 'التاريخ', 'Date', 'date', ['required' => true])];
            if ($invoice) {
                $fields[] = $f('due_date', 'تاريخ الاستحقاق', 'Due date', 'date');
            }
            if ($key === 'sales_quotation') {
                $fields[] = $f('valid_until', 'صالح حتى', 'Valid until', 'date');
            } else {
                $fields[] = $w('warehouse_id', 'المخزن', 'Warehouse', 'warehouse', ['protected' => true]);
            }
            if ($sales) {
                $fields[] = $w('salesperson_id', 'المندوب', 'Salesperson', 'salesperson');
                $fields[] = $w('price_list_id', 'قائمة الأسعار', 'Price list', 'price_list');
            }
            $fields[] = $f('reference', $sales ? 'مرجع العميل' : 'رقم فاتورة المورد', $sales ? 'Customer reference' : 'Supplier invoice number');

            return [['key' => 'core.header', 'label_ar' => 'بيانات المستند', 'label_en' => 'Document details', 'columns' => 3, 'fields' => $fields]];
        }
        if (str_starts_with($key, 'voucher_')) {
            return [['key' => 'core.header', 'label_ar' => 'بيانات السند', 'label_en' => 'Voucher details', 'columns' => 2, 'fields' => [
                $f('date', 'التاريخ', 'Date', 'date', ['required' => true]), $f('amount', 'المبلغ', 'Amount', 'decimal', ['required' => true]),
                $f('description', 'البيان', 'Description'), $f('reference', 'المرجع', 'Reference'),
            ]]];
        }
        if ($key === 'journals') {
            return [['key' => 'core.header', 'label_ar' => 'بيانات القيد', 'label_en' => 'Journal details', 'columns' => 3, 'fields' => [
                $f('date', 'التاريخ', 'Date', 'date', ['required' => true]), $f('description', 'البيان', 'Description'), $f('reference', 'المرجع', 'Reference'),
            ]]];
        }
        if (str_starts_with($key, 'stock_')) {
            $type = substr($key, 6);
            $fields = [$f('date', 'التاريخ', 'Date', 'date', ['required' => true]), $w('warehouse_id', $type === 'transfer' ? 'من مخزن' : 'المخزن', $type === 'transfer' ? 'From warehouse' : 'Warehouse', 'stock_warehouse', ['required' => true])];
            if ($type === 'transfer') {
                $fields[] = $w('to_warehouse_id', 'إلى مخزن', 'To warehouse', 'stock_to', ['required' => true]);
            }
            if ($type === 'count') {
                $fields[] = $w('category_id', 'مجموعة الجرد — اختيارية', 'Count category — optional', 'stock_category');
            }
            if ($type === 'adjustment') {
                $fields[] = $f('reason', 'السبب', 'Reason', 'dropdown', ['required' => true, 'options_json' => $this->options([
                    ['damage', 'تالف', 'Damaged'], ['expiry', 'منتهي الصلاحية', 'Expired'], ['loss', 'فقد', 'Lost'], ['theft', 'سرقة', 'Theft'], ['gift', 'هدايا', 'Gifts'], ['sample', 'عينات', 'Samples'], ['internal_use', 'استخدام داخلي', 'Internal use'], ['correction', 'تصحيح', 'Correction'], ['found', 'زيادة', 'Surplus found'], ['other', 'أخرى', 'Other'],
                ])]);
            }
            $fields[] = $f('notes', 'ملاحظات', 'Notes', 'long_text');

            return [['key' => 'core.header', 'label_ar' => 'بيانات حركة المخزون', 'label_en' => 'Stock document details', 'columns' => 3, 'fields' => $fields]];
        }
        if ($key === 'products') {
            return [['key' => 'core.identity', 'label_ar' => 'بيانات الصنف', 'label_en' => 'Item details', 'columns' => 2, 'fields' => [
                $f('name', 'اسم الصنف', 'Item name', 'text', ['required' => true]), $f('name_en', 'الاسم بالإنجليزية', 'English name', 'text', ['direction' => 'ltr']),
                $f('type', 'النوع', 'Type', 'dropdown', ['required' => true, 'options_json' => $this->options([['stock', 'صنف مخزني', 'Stock item'], ['service', 'خدمة', 'Service']])]),
                $f('code', 'الكود — تلقائي إذا تُرك فارغاً', 'Code — generated if empty', 'text', ['direction' => 'ltr']),
                $w('category_id', 'المجموعة', 'Category', 'product_category'), $w('brand_id', 'العلامة التجارية', 'Brand', 'brand'),
            ]]];
        }
        if (in_array($key, ['customer-units', 'maintenance-profiles', 'service-requests', 'service-visits'], true)) {
            $fields = match ($key) {
                'customer-units' => [$f('unit_code', 'كود الفلتر', 'Filter code', 'text', ['required' => true, 'lock_on_edit' => true]),
                    $f('serial_number', 'الرقم المسلسل', 'Serial number', 'text', ['lock_on_edit' => true]),
                    $f('purchased_on', 'تاريخ الشراء', 'Purchase date', 'date', ['lock_on_edit' => true]),
                    $f('warranty_starts_on', 'بداية الضمان', 'Warranty starts', 'date', ['lock_on_edit' => true]),
                    $f('warranty_ends_on', 'نهاية الضمان', 'Warranty ends', 'date', ['lock_on_edit' => true]), $f('notes', 'ملاحظات', 'Notes', 'long_text')],
                'maintenance-profiles' => [$f('name', 'اسم برنامج الصيانة', 'Maintenance profile name', 'text', ['required' => true])],
                'service-requests' => [$f('description', 'وصف الطلب', 'Request description', 'long_text', ['required' => true])],
                default => [$f('report', 'تقرير العمل الفعلي', 'Actual work report', 'long_text')],
            };

            return [['key' => 'core.details', 'label_ar' => 'البيانات', 'label_en' => 'Details', 'columns' => 2, 'fields' => $fields]];
        }
        if ($key === 'leads') {
            return [['key' => 'core.details', 'label_ar' => 'بيانات العميل المحتمل', 'label_en' => 'Lead details', 'columns' => 3, 'fields' => [
                $f('name', 'اسم الشخص', 'Contact name', 'text', ['required' => true]), $f('company_name', 'الشركة / المحل', 'Company / shop'),
                $f('mobile', 'الموبايل', 'Mobile', 'phone'), $f('phone', 'الهاتف', 'Phone', 'phone'), $f('email', 'البريد', 'Email', 'email'), $f('city', 'المدينة', 'City'), $address,
                $w('source_id', 'المصدر', 'Source', 'crm_source'), $w('owner_id', 'المسؤول', 'Owner', 'user'),
                $f('status', 'الحالة', 'Status', 'dropdown', ['required' => true, 'options_json' => $this->options([['new', 'جديد', 'New'], ['contacted', 'تم التواصل', 'Contacted'], ['qualified', 'مؤهل', 'Qualified'], ['unqualified', 'غير مؤهل', 'Unqualified']])]),
                $f('expected_value', 'القيمة المتوقعة', 'Expected value', 'decimal'), $f('notes', 'ملاحظات', 'Notes', 'long_text')]]];
        }
        if ($key === 'tasks') {
            return [['key' => 'core.details', 'label_ar' => 'بيانات المتابعة', 'label_en' => 'Follow-up details', 'columns' => 2, 'fields' => [
                $f('title', 'المطلوب', 'What needs doing', 'text', ['required' => true]), $f('due_at', 'الموعد', 'Due', 'datetime', ['required' => true]),
                $f('reminder', 'التذكير', 'Reminder', 'dropdown', ['conditionable' => false, 'value_type' => 'number', 'options_json' => $this->options([[0, 'بدون', 'None'], [15, 'قبل 15 دقيقة', '15 minutes before'], [30, 'قبل 30 دقيقة', '30 minutes before'], [60, 'قبل ساعة', '1 hour before'], [1440, 'قبل يوم', '1 day before']])]),
                $f('priority', 'الأولوية', 'Priority', 'dropdown', ['options_json' => $this->options([['low', 'منخفضة', 'Low'], ['normal', 'عادية', 'Normal'], ['high', 'عالية', 'High']])]),
                $w('assigned_to', 'المسؤول', 'Assigned to', 'user', ['protected' => true]), $f('notes', 'ملاحظات', 'Notes', 'long_text')]]];
        }
        if ($key === 'activities') {
            return [['key' => 'core.details', 'label_ar' => 'تفاصيل النشاط', 'label_en' => 'Activity details', 'columns' => 2, 'fields' => [
                $f('type', 'النوع', 'Type', 'dropdown', ['required' => true, 'options_json' => $this->options([['call', 'مكالمة', 'Call'], ['whatsapp', 'واتساب', 'WhatsApp'], ['visit', 'زيارة', 'Visit'], ['meeting', 'اجتماع', 'Meeting'], ['email', 'بريد', 'Email'], ['note', 'ملاحظة', 'Note']])]),
                $f('subject', 'الموضوع', 'Subject'), $f('body', 'التفاصيل', 'Details', 'long_text'), $f('occurred_at', 'الوقت', 'When', 'datetime', ['required' => true]), $f('duration_minutes', 'المدة (دقيقة)', 'Minutes', 'number'),
                $f('outcome', 'النتيجة', 'Outcome', 'dropdown', ['options_json' => $this->options([['interested', 'مهتم', 'Interested'], ['positive', 'إيجابي', 'Positive'], ['negotiating', 'تفاوض', 'Negotiating'], ['callback', 'يعاود الاتصال', 'Call back'], ['no_answer', 'لم يرد', 'No answer'], ['not_interested', 'غير مهتم', 'Not interested']])]),
                $w('follow_up', 'حجز متابعة تالية', 'Book a follow-up', 'follow_up', ['create_only' => true])]]];
        }
        if ($key === 'opportunities') {
            return [['key' => 'core.details', 'label_ar' => 'بيانات الصفقة', 'label_en' => 'Opportunity details', 'columns' => 2, 'fields' => [
                $f('title', 'العنوان', 'Title', 'text', ['required' => true]), $w('party_id', 'العميل', 'Customer', 'party_customer', ['protected' => true]),
                $f('value', 'القيمة', 'Value', 'decimal'), $w('stage_id', 'المرحلة', 'Stage', 'crm_stage', ['protected' => true]),
                $f('expected_close_date', 'تاريخ الإغلاق المتوقع', 'Expected close', 'date'), $w('owner_id', 'المسؤول', 'Owner', 'user'), $f('notes', 'ملاحظات', 'Notes', 'long_text')]]];
        }
        if ($key === 'accounts') {
            return [['key' => 'core.details', 'label_ar' => 'بيانات الحساب', 'label_en' => 'Account details', 'columns' => 2, 'fields' => [
                $w('parent_id', 'الحساب الرئيسي', 'Parent account', 'account_parent', ['protected' => true, 'lock_if' => 'system_key']),
                $f('code', 'الكود (تلقائي إذا تُرك فارغاً)', 'Code (generated if blank)', 'text', ['direction' => 'ltr', 'lock_on_edit' => true]),
                $f('type', 'النوع', 'Type', 'dropdown', ['protected' => true, 'lock_if' => 'system_key', 'disable_when' => ['field' => 'core.parent_id', 'operator' => 'not_empty'], 'options_json' => $this->options([['asset', 'أصول', 'Assets'], ['liability', 'خصوم', 'Liabilities'], ['equity', 'حقوق ملكية', 'Equity'], ['revenue', 'إيرادات', 'Revenue'], ['expense', 'مصروفات', 'Expenses']])]),
                ...$name, $f('description', 'وصف', 'Description'), $f('is_group', 'حساب تجميعي', 'Group account', 'checkbox', ['protected' => true, 'lock_if' => 'system_key']), $f('allow_manual', 'يسمح بالقيود اليدوية', 'Allow manual entries', 'checkbox', ['protected' => true]), $active]]];
        }
        if ($key === 'cash-accounts') {
            return [['key' => 'core.details', 'label_ar' => 'بيانات الخزينة أو البنك', 'label_en' => 'Cash or bank details', 'columns' => 2, 'fields' => [
                $f('type', 'النوع', 'Type', 'dropdown', ['required' => true, 'lock_on_edit' => true, 'options_json' => $this->options([['cash', 'خزينة نقدية', 'Cash box'], ['bank', 'حساب بنكي', 'Bank account']])]),
                $code, ...$name, $f('bank_name', 'البنك', 'Bank', 'text', ['condition_json' => ['field' => 'core.type', 'operator' => 'equals', 'value' => 'bank']]),
                $f('account_number', 'رقم الحساب', 'Account number', 'text', ['direction' => 'ltr', 'condition_json' => ['field' => 'core.type', 'operator' => 'equals', 'value' => 'bank']]),
                $f('iban', 'IBAN', 'IBAN', 'text', ['direction' => 'ltr', 'condition_json' => ['field' => 'core.type', 'operator' => 'equals', 'value' => 'bank']]),
                $w('branch_id', 'الفرع', 'Branch', 'branch'), $f('currency', 'العملة', 'Currency', 'text', ['direction' => 'ltr']),
                $w('custodian_id', 'أمين العهدة', 'Custodian', 'user', ['protected' => true, 'condition_json' => ['field' => 'core.type', 'operator' => 'equals', 'value' => 'cash']]),
                $f('allow_negative', 'يسمح بالرصيد السالب (سحب على المكشوف)', 'Allow negative balance (overdraft)', 'checkbox', ['protected' => true]), $active]]];
        }

        return [];
    }

    public function fields(string $key): array
    {
        return array_merge([], ...array_column($this->groups($key), 'fields'));
    }

    /** Upgrade custom-only layouts lazily, preserving every existing section and field reference. */
    public function layout(string $key, ?array $layout, array $customKeys): array
    {
        $groups = array_map(fn ($group) => array_replace($group, ['fields' => array_column($group['fields'], 'key')]), $this->groups($key));
        $sections = $layout['sections'] ?? [['key' => 'custom', 'label_ar' => 'بيانات إضافية', 'label_en' => 'Additional details', 'columns' => 2, 'fields' => $customKeys]];
        $coreVersion = $groups ? 1 : 0;
        if (($layout['engine_version'] ?? 1) < 2 || ($layout['core_version'] ?? 0) < $coreVersion) {
            $present = array_merge([], ...array_column($sections, 'fields'));
            $groups = array_values(array_filter(array_map(fn ($group) => array_replace($group, ['fields' => array_values(array_diff($group['fields'], $present))]), $groups), fn ($group) => $group['fields']));
            $used = array_column($sections, 'key');
            foreach ($groups as &$group) {
                $base = $group['key'];
                $suffix = 1;
                while (in_array($group['key'], $used, true)) {
                    $group['key'] = $base.'.'.(++$suffix);
                }
                $used[] = $group['key'];
            }
            unset($group);
            $sections = [...$groups, ...$sections];
        }

        return ['engine_version' => 2, 'core_version' => $coreVersion, 'sections' => $sections];
    }
}
