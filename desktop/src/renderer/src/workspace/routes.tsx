import { lazy } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight, BadgePercent, BarChart3, BookOpen, Boxes, Calculator, CalendarCheck, ClipboardCheck, ClipboardList, FileBarChart, FileClock, FileInput, FileMinus,
  FileOutput, FileSpreadsheet, FileText, Gauge, HandCoins, Handshake, Landmark, LayoutDashboard, ListTree, NotebookPen, Package, PackageCheck, PackageOpen, PackagePlus,
  Percent, PieChart, Receipt, ReceiptText, Scale, Settings, ShoppingCart, Target, Timer, TrendingDown, Truck, UserPlus, Users, Wallet, WalletCards, Warehouse, Workflow,
} from 'lucide-react'
import { tr } from '@/store/prefs'
import { docLabel, STOCK_DOCS, VOUCHER_KINDS } from '@/lib/docTypes'

const ServiceWorkspace = lazy(() => import('@/features/service/ServiceWorkspace'))
const FormStudio = lazy(() => import('@/features/forms/FormStudio'))
const BusinessDashboard = lazy(() => import('@/features/dashboard/BusinessDashboard'))
const Dashboard = lazy(() => import('@/features/dashboard/Dashboard'))
const PartyList = lazy(() => import('@/features/parties/PartyList'))
const PartyView = lazy(() => import('@/features/parties/PartyView'))
const Leads = lazy(() => import('@/features/crm/Leads'))
const LeadView = lazy(() => import('@/features/crm/LeadView'))
const Pipeline = lazy(() => import('@/features/crm/Pipeline'))
const Agenda = lazy(() => import('@/features/crm/Agenda'))
const Activities = lazy(() => import('@/features/crm/Activities'))
const CrmReports = lazy(() => import('@/features/crm/CrmReports'))
const DocumentList = lazy(() => import('@/features/trading/DocumentList'))
const DocumentEditor = lazy(() => import('@/features/trading/DocumentEditor'))
const Products = lazy(() => import('@/features/inventory/Products'))
const ProductEditor = lazy(() => import('@/features/inventory/ProductEditor'))
const StockOnHand = lazy(() => import('@/features/inventory/StockOnHand'))
const StockDocList = lazy(() => import('@/features/inventory/StockDocList'))
const StockDocEditor = lazy(() => import('@/features/inventory/StockDocEditor'))
const InventoryReports = lazy(() => import('@/features/inventory/InventoryReports'))
const ItemCard = lazy(() => import('@/features/inventory/ItemCard'))
const Accounts = lazy(() => import('@/features/finance/Accounts'))
const AccountLedger = lazy(() => import('@/features/finance/AccountLedger'))
const Journals = lazy(() => import('@/features/finance/Journals'))
const JournalEditor = lazy(() => import('@/features/finance/JournalEditor'))
const CashAccounts = lazy(() => import('@/features/finance/CashAccounts'))
const CashStatement = lazy(() => import('@/features/finance/CashStatement'))
const Vouchers = lazy(() => import('@/features/finance/Vouchers'))
const VoucherEditor = lazy(() => import('@/features/finance/VoucherEditor'))
const Cheques = lazy(() => import('@/features/finance/Cheques'))
const ChequeView = lazy(() => import('@/features/finance/ChequeView'))
const FinanceReports = lazy(() => import('@/features/finance/FinanceReports'))
const Analysis = lazy(() => import('@/features/reports/Analysis'))
const Salespeople = lazy(() => import('@/features/reports/Salespeople'))
const SetupGuide = lazy(() => import('@/features/onboarding/SetupGuide'))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'))

export type Params = Record<string, string>

export interface RouteDef {
  pattern: string
  component: React.ComponentType<any>
  title: (p: Params) => string
  permission?: string | string[]
}

const financeReportTitles: Record<string, [string, string]> = {
  'trial-balance': ['ميزان المراجعة', 'Trial balance'],
  'income-statement': ['قائمة الدخل', 'Income statement'],
  'balance-sheet': ['الميزانية العمومية', 'Balance sheet'],
  'cash-flow': ['حركة النقدية', 'Cash movement'],
  vat: ['إقرار القيمة المضافة', 'VAT return'],
  'aging-receivable': ['أعمار ديون العملاء', 'Receivables aging'],
  'aging-payable': ['أعمار ديون الموردين', 'Payables aging'],
}
const inventoryReportTitles: Record<string, [string, string]> = {
  expiry: ['أصناف قاربت الصلاحية', 'Expiring batches'],
  reorder: ['حد الطلب', 'Reorder report'],
  slow: ['أصناف راكدة', 'Slow-moving items'],
  reconcile: ['مطابقة المخزون مع الحسابات', 'Stock vs. ledger'],
}

export const ROUTES: RouteDef[] = [
  { pattern: '/advanced', component: Dashboard, title: () => tr('اليوم', 'Today') },
  { pattern: '/reports/overview', component: BusinessDashboard, title: () => tr('ملخص الأعمال', 'Business overview'), permission: ['sales.reports', 'finance.reports'] },
  { pattern: '/advanced/overview', component: BusinessDashboard, title: () => tr('ملخص الأعمال', 'Business overview') },
  { pattern: '/service/:section', component: ServiceWorkspace, title: (p) => tr(...(({ due: ['مواعيد الشمعات', 'Replacement reminders'], visits: ['الزيارات', 'Visits'], units: ['أجهزة العملاء', 'Customer filters'], requests: ['طلبات الخدمة', 'Service requests'], followups: ['الاتصال بالعملاء', 'Customer follow-up'], profiles: ['برامج الصيانة', 'Replacement schedules'], reports: ['أداء الخدمة', 'Service performance'] } as Record<string, [string, string]>)[p.section] ?? ['خدمة الفلاتر', 'Filter service'])), permission: 'service.view' },
  { pattern: '/forms/studio', component: FormStudio, title: () => tr('مصمم النماذج', 'Form Studio'), permission: 'forms.manage' },
  { pattern: '/getting-started', component: SetupGuide, title: () => tr('دليل بدء العمل', 'Getting started'), permission: 'settings.manage' },
  { pattern: '/dashboard', component: Dashboard, title: () => tr('لوحة اليوم', 'Today') },
  { pattern: '/parties/customers', component: PartyList, title: () => tr('العملاء', 'Customers'), permission: 'customers.view' },
  { pattern: '/parties/suppliers', component: PartyList, title: () => tr('الموردون', 'Suppliers'), permission: 'suppliers.view' },
  { pattern: '/parties/view/:id', component: PartyView, title: () => tr('حساب', 'Account'), permission: ['customers.view', 'suppliers.view'] },
  { pattern: '/crm/agenda', component: Agenda, title: () => tr('أجندتي', 'My agenda'), permission: 'crm.view' },
  { pattern: '/crm/leads', component: Leads, title: () => tr('العملاء المحتملون', 'Leads'), permission: 'crm.view' },
  { pattern: '/crm/leads/:id', component: LeadView, title: () => tr('عميل محتمل', 'Lead'), permission: 'crm.view' },
  { pattern: '/crm/pipeline', component: Pipeline, title: () => tr('مسار الصفقات', 'Pipeline'), permission: 'crm.view' },
  { pattern: '/crm/activities', component: Activities, title: () => tr('الأنشطة', 'Activities'), permission: 'crm.view' },
  { pattern: '/crm/reports', component: CrmReports, title: () => tr('تقارير المبيعات الميدانية', 'CRM reports'), permission: 'crm.view' },
  { pattern: '/docs/:type', component: DocumentList, title: (p) => docLabel(p.type, true) },
  { pattern: '/docs/:type/new', component: DocumentEditor, title: (p) => `${docLabel(p.type)} ${tr('جديد', 'new')}` },
  { pattern: '/docs/:type/:id', component: DocumentEditor, title: (p) => docLabel(p.type) },
  { pattern: '/inventory/products', component: Products, title: () => tr('الأصناف', 'Items'), permission: ['products.view', 'stock.view'] },
  { pattern: '/inventory/products/new', component: ProductEditor, title: () => tr('صنف جديد', 'New item'), permission: 'products.manage' },
  { pattern: '/inventory/products/:id', component: ProductEditor, title: () => tr('صنف', 'Item'), permission: ['products.view', 'stock.view'] },
  { pattern: '/inventory/card/:id', component: ItemCard, title: () => tr('كارت صنف', 'Item card'), permission: 'stock.view' },
  { pattern: '/inventory/stock', component: StockOnHand, title: () => tr('أرصدة المخازن', 'Stock on hand'), permission: 'stock.view' },
  { pattern: '/inventory/docs/:type', component: StockDocList, title: (p) => tr(STOCK_DOCS[p.type as keyof typeof STOCK_DOCS]?.pluralAr ?? '', STOCK_DOCS[p.type as keyof typeof STOCK_DOCS]?.pluralEn ?? '') },
  { pattern: '/inventory/docs/:type/new', component: StockDocEditor, title: (p) => tr(STOCK_DOCS[p.type as keyof typeof STOCK_DOCS]?.ar ?? '', STOCK_DOCS[p.type as keyof typeof STOCK_DOCS]?.en ?? '') },
  { pattern: '/inventory/docs/:type/:id', component: StockDocEditor, title: (p) => tr(STOCK_DOCS[p.type as keyof typeof STOCK_DOCS]?.ar ?? '', STOCK_DOCS[p.type as keyof typeof STOCK_DOCS]?.en ?? '') },
  { pattern: '/inventory/reports/:report', component: InventoryReports, title: (p) => tr(...(inventoryReportTitles[p.report] ?? ['تقرير', 'Report'])), permission: 'stock.view' },
  { pattern: '/finance/accounts', component: Accounts, title: () => tr('دليل الحسابات', 'Chart of accounts'), permission: ['accounts.manage', 'finance.reports'] },
  { pattern: '/finance/ledger/:id', component: AccountLedger, title: () => tr('دفتر الأستاذ', 'General ledger'), permission: ['finance.reports', 'accounts.manage'] },
  { pattern: '/finance/journals', component: Journals, title: () => tr('القيود اليومية', 'Journal entries'), permission: ['journals.manage', 'finance.reports'] },
  { pattern: '/finance/journals/new', component: JournalEditor, title: () => tr('قيد جديد', 'New entry'), permission: 'journals.manage' },
  { pattern: '/finance/journals/:id', component: JournalEditor, title: () => tr('قيد يومية', 'Journal entry'), permission: ['journals.manage', 'finance.reports'] },
  { pattern: '/finance/treasury', component: CashAccounts, title: () => tr('الخزائن والبنوك', 'Cash & banks'), permission: ['treasury.view', 'vouchers.manage'] },
  { pattern: '/finance/treasury/:id', component: CashStatement, title: () => tr('حركة خزينة', 'Cash statement'), permission: 'treasury.view' },
  { pattern: '/finance/vouchers/:kind', component: Vouchers, title: (p) => tr(VOUCHER_KINDS[p.kind as keyof typeof VOUCHER_KINDS]?.pluralAr ?? 'السندات', VOUCHER_KINDS[p.kind as keyof typeof VOUCHER_KINDS]?.pluralEn ?? 'Vouchers') },
  { pattern: '/finance/vouchers/:kind/new', component: VoucherEditor, title: (p) => tr(VOUCHER_KINDS[p.kind as keyof typeof VOUCHER_KINDS]?.ar ?? 'سند', VOUCHER_KINDS[p.kind as keyof typeof VOUCHER_KINDS]?.en ?? 'Voucher') },
  { pattern: '/finance/vouchers/:kind/:id', component: VoucherEditor, title: (p) => tr(VOUCHER_KINDS[p.kind as keyof typeof VOUCHER_KINDS]?.ar ?? 'سند', VOUCHER_KINDS[p.kind as keyof typeof VOUCHER_KINDS]?.en ?? 'Voucher') },
  { pattern: '/finance/cheques', component: Cheques, title: () => tr('الشيكات', 'Cheques'), permission: ['cheques.manage', 'treasury.view'] },
  { pattern: '/finance/cheques/:id', component: ChequeView, title: () => tr('شيك', 'Cheque'), permission: ['cheques.manage', 'treasury.view'] },
  { pattern: '/finance/reports/:report', component: FinanceReports, title: (p) => tr(...(financeReportTitles[p.report] ?? ['تقرير', 'Report'])) },
  { pattern: '/reports/salespeople', component: Salespeople, title: () => tr('أداء المندوبين', 'Salespeople'), permission: 'sales.reports' },
  { pattern: '/reports/:side', component: Analysis, title: (p) => (p.side === 'sales' ? tr('تحليل المبيعات', 'Sales analysis') : tr('تحليل المشتريات', 'Purchase analysis')) },
  { pattern: '/settings/:section', component: SettingsPage, title: () => tr('الإعدادات', 'Settings') },
]

export function matchRoute(path: string): { route: RouteDef; params: Params; query: URLSearchParams } | null {
  const [pathname, search = ''] = path.split('?')
  const parts = pathname.split('/').filter(Boolean)
  // Static segments win over parameters (/docs/x/new before /docs/x/:id).
  const candidates = ROUTES.map((route) => ({ route, segs: route.pattern.split('/').filter(Boolean) }))
    .filter((c) => c.segs.length === parts.length)
    .sort((a, b) => b.segs.filter((s) => !s.startsWith(':')).length - a.segs.filter((s) => !s.startsWith(':')).length)
  for (const { route, segs } of candidates) {
    const params: Params = {}
    if (segs.every((s, i) => (s.startsWith(':') ? ((params[s.slice(1)] = decodeURIComponent(parts[i])), true) : s === parts[i]))) {
      return { route, params, query: new URLSearchParams(search) }
    }
  }
  return null
}

export interface MenuItem {
  path: string
  ar: string
  en: string
  icon: LucideIcon
  permission?: string | string[]
}

export interface MenuGroup {
  key: string
  ar: string
  en: string
  icon: LucideIcon
  items: MenuItem[]
}

const MODULE_MENU: MenuGroup[] = [
  { key: 'service', ar: 'خدمة الفلاتر', en: 'Filter service', icon: CalendarCheck, items: [
    { path: '/service/due', ar: 'الصيانة المستحقة', en: 'Maintenance due', icon: CalendarCheck, permission: 'service.view' },
    { path: '/service/units', ar: 'أجهزة العملاء', en: 'Customer filters', icon: Package, permission: 'service.view' },
    { path: '/service/profiles', ar: 'برامج تغيير الشمعات', en: 'Replacement schedules', icon: Timer, permission: 'service.settings' },
    { path: '/service/requests', ar: 'طلبات الخدمة', en: 'Service requests', icon: ClipboardList, permission: 'service.view' },
    { path: '/service/visits', ar: 'زيارات الفنيين', en: 'Technician visits', icon: Truck, permission: 'service.view' },
    { path: '/service/followups', ar: 'قائمة المتابعة', en: 'Follow-up queue', icon: NotebookPen, permission: 'service.manage' },
    { path: '/service/reports', ar: 'تقارير الصيانة', en: 'Service reports', icon: BarChart3, permission: 'service.reports' },
    { path: '/forms/studio', ar: 'مصمم النماذج', en: 'Form Studio', icon: Settings, permission: 'forms.manage' },
  ] },
  { key: 'home', ar: 'الرئيسية', en: 'Home', icon: LayoutDashboard, items: [{ path: '/dashboard', ar: 'لوحة اليوم', en: 'Today', icon: LayoutDashboard }] },
  {
    key: 'sales', ar: 'المبيعات', en: 'Sales', icon: ReceiptText, items: [
      { path: '/docs/sales_invoice', ar: 'فواتير المبيعات', en: 'Sales invoices', icon: ReceiptText, permission: ['sales.invoices', 'sales.reports'] },
      { path: '/docs/sales_return', ar: 'مرتجعات المبيعات', en: 'Sales returns', icon: FileMinus, permission: ['sales.returns', 'sales.reports'] },
      { path: '/docs/sales_quotation', ar: 'عروض الأسعار', en: 'Quotations', icon: FileText, permission: 'sales.quotations' },
      { path: '/docs/sales_order', ar: 'أوامر البيع', en: 'Sales orders', icon: ClipboardList, permission: 'sales.orders' },
      { path: '/reports/overview', ar: 'ملخص الأعمال', en: 'Business overview', icon: LayoutDashboard, permission: ['sales.reports', 'finance.reports'] },
      { path: '/reports/sales', ar: 'تحليل المبيعات', en: 'Sales analysis', icon: BarChart3, permission: 'sales.reports' },
      { path: '/reports/salespeople', ar: 'أداء المندوبين', en: 'Salespeople', icon: BadgePercent, permission: 'sales.reports' },
    ],
  },
  {
    key: 'crm', ar: 'متابعة العملاء', en: 'CRM', icon: Handshake, items: [
      { path: '/crm/agenda', ar: 'أجندتي', en: 'My agenda', icon: CalendarCheck, permission: 'crm.view' },
      { path: '/crm/leads', ar: 'العملاء المحتملون', en: 'Leads', icon: UserPlus, permission: 'crm.view' },
      { path: '/crm/pipeline', ar: 'مسار الصفقات', en: 'Pipeline', icon: Workflow, permission: 'crm.view' },
      { path: '/crm/activities', ar: 'الأنشطة', en: 'Activities', icon: NotebookPen, permission: 'crm.view' },
      { path: '/crm/reports', ar: 'تقارير المتابعة', en: 'CRM reports', icon: Target, permission: 'crm.view' },
    ],
  },
  {
    key: 'purchases', ar: 'المشتريات', en: 'Purchasing', icon: ShoppingCart, items: [
      { path: '/docs/purchase_invoice', ar: 'فواتير المشتريات', en: 'Purchase invoices', icon: FileInput, permission: ['purchases.invoices', 'purchases.reports'] },
      { path: '/docs/purchase_order', ar: 'أوامر الشراء', en: 'Purchase orders', icon: ShoppingCart, permission: 'purchases.orders' },
      { path: '/docs/purchase_receipt', ar: 'أذون الاستلام', en: 'Goods receipts', icon: PackageCheck, permission: 'purchases.receipts' },
      { path: '/docs/purchase_return', ar: 'مرتجعات المشتريات', en: 'Purchase returns', icon: FileOutput, permission: 'purchases.returns' },
      { path: '/parties/suppliers', ar: 'الموردون', en: 'Suppliers', icon: Truck, permission: 'suppliers.view' },
      { path: '/reports/purchases', ar: 'تحليل المشتريات', en: 'Purchase analysis', icon: PieChart, permission: 'purchases.reports' },
    ],
  },
  {
    key: 'inventory', ar: 'المخزون', en: 'Inventory', icon: Warehouse, items: [
      { path: '/inventory/products', ar: 'الأصناف', en: 'Items', icon: Package, permission: ['products.view', 'stock.view'] },
      { path: '/inventory/stock', ar: 'أرصدة المخازن', en: 'Stock on hand', icon: Boxes, permission: 'stock.view' },
      { path: '/inventory/docs/transfer', ar: 'التحويلات المخزنية', en: 'Transfers', icon: ArrowLeftRight, permission: 'stock.transfer' },
      { path: '/inventory/docs/adjustment', ar: 'التسويات', en: 'Adjustments', icon: Scale, permission: 'stock.adjust' },
      { path: '/inventory/docs/count', ar: 'الجرد', en: 'Stock counts', icon: ClipboardCheck, permission: 'stock.count' },
      { path: '/inventory/docs/opening', ar: 'بضاعة أول المدة', en: 'Opening stock', icon: PackagePlus, permission: 'stock.adjust' },
      { path: '/inventory/reports/expiry', ar: 'الصلاحية', en: 'Expiry', icon: Timer, permission: 'stock.view' },
      { path: '/inventory/reports/reorder', ar: 'حد الطلب', en: 'Reorder', icon: PackageOpen, permission: 'stock.view' },
      { path: '/inventory/reports/slow', ar: 'أصناف راكدة', en: 'Slow movers', icon: TrendingDown, permission: 'stock.view' },
    ],
  },
  {
    key: 'treasury', ar: 'الخزينة', en: 'Treasury', icon: Wallet, items: [
      { path: '/finance/treasury', ar: 'الخزائن والبنوك', en: 'Cash & banks', icon: Landmark, permission: ['treasury.view', 'vouchers.manage'] },
      { path: '/finance/vouchers/receipt', ar: 'سندات القبض', en: 'Receipts', icon: HandCoins, permission: ['vouchers.manage', 'treasury.view'] },
      { path: '/finance/vouchers/payment', ar: 'سندات الصرف', en: 'Payments', icon: Wallet, permission: ['vouchers.manage', 'treasury.view'] },
      { path: '/finance/vouchers/expense', ar: 'المصروفات', en: 'Expenses', icon: Receipt, permission: ['expenses.manage', 'treasury.view'] },
      { path: '/finance/vouchers/transfer', ar: 'تحويلات النقدية', en: 'Cash transfers', icon: ArrowLeftRight, permission: ['vouchers.manage', 'treasury.view'] },
      { path: '/finance/cheques', ar: 'الشيكات', en: 'Cheques', icon: WalletCards, permission: ['cheques.manage', 'treasury.view'] },
    ],
  },
  {
    key: 'finance', ar: 'الحسابات', en: 'Accounting', icon: Calculator, items: [
      { path: '/finance/accounts', ar: 'دليل الحسابات', en: 'Chart of accounts', icon: ListTree, permission: ['accounts.manage', 'finance.reports'] },
      { path: '/finance/journals', ar: 'القيود اليومية', en: 'Journal entries', icon: BookOpen, permission: ['journals.manage', 'finance.reports'] },
      { path: '/finance/reports/trial-balance', ar: 'ميزان المراجعة', en: 'Trial balance', icon: FileSpreadsheet, permission: 'finance.reports' },
      { path: '/finance/reports/income-statement', ar: 'قائمة الدخل', en: 'Income statement', icon: FileBarChart, permission: 'finance.reports' },
      { path: '/finance/reports/balance-sheet', ar: 'الميزانية', en: 'Balance sheet', icon: Scale, permission: 'finance.reports' },
      { path: '/finance/reports/cash-flow', ar: 'حركة النقدية', en: 'Cash movement', icon: Gauge, permission: 'finance.reports' },
      { path: '/finance/reports/vat', ar: 'القيمة المضافة', en: 'VAT return', icon: Percent, permission: 'finance.reports' },
      { path: '/finance/reports/aging-receivable', ar: 'أعمار الديون', en: 'Aging', icon: FileClock, permission: ['finance.reports', 'customers.view'] },
    ],
  },
  { key: 'system', ar: 'النظام', en: 'System', icon: Settings, items: [{ path: '/settings/company', ar: 'الإعدادات', en: 'Settings', icon: Settings }] },
]

/** All modules are normal, permission-filtered menu groups. */
export const MENU: MenuGroup[] = [
  MODULE_MENU.find((group) => group.key === 'home')!,
  { key: 'customers', ar: 'العملاء', en: 'Customers', icon: Users, items: [{ path: '/parties/customers', ar: 'العملاء', en: 'Customers', icon: Users, permission: 'customers.view' }] },
  ...['service', 'inventory', 'sales', 'purchases', 'crm', 'treasury', 'finance', 'system'].map((key) => MODULE_MENU.find((group) => group.key === key)!),
]

export function menuItemVisible(item: MenuItem, allowed: (permission: string | string[]) => boolean): boolean {
  return !item.permission || allowed(item.permission)
}

export const QUICK_ACTIONS: MenuItem[] = [
  { path: '/parties/customers?new=1', ar: 'عميل جديد', en: 'New customer', icon: UserPlus, permission: 'customers.manage' },
  { path: '/service/requests?new=1', ar: 'طلب خدمة جديد', en: 'New service request', icon: ClipboardList, permission: 'service.manage' },
  { path: '/docs/sales_invoice/new', ar: 'فاتورة جديدة', en: 'New invoice', icon: ReceiptText, permission: 'sales.invoices' },
  { path: '/docs/purchase_invoice/new', ar: 'شراء بضاعة', en: 'Buy stock', icon: FileInput, permission: 'purchases.invoices' },
  { path: '/finance/vouchers/receipt/new', ar: 'تحصيل من عميل', en: 'Receive payment', icon: HandCoins, permission: 'vouchers.manage' },
  { path: '/inventory/docs/transfer/new', ar: 'تموين سيارة', en: 'Refill van', icon: Warehouse, permission: 'stock.transfer' },
]
