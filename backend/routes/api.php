<?php

use App\Control\Http\LicenseController;
use App\Modules\Core\Http\Controllers\AttachmentController;
use App\Modules\Core\Http\Controllers\AuthController;
use App\Modules\Core\Http\Controllers\CrudController;
use App\Modules\Core\Http\Controllers\CustomReportController;
use App\Modules\Core\Http\Controllers\FormController;
use App\Modules\Core\Http\Controllers\ImportController;
use App\Modules\Core\Http\Controllers\LookupController;
use App\Modules\Core\Http\Controllers\SettingsController;
use App\Modules\Core\Http\Controllers\SystemController;
use App\Modules\Core\Http\Controllers\SetupGuideController;
use App\Modules\Core\Http\Controllers\UserController;
use App\Modules\CRM\Http\Controllers\ActivityController;
use App\Modules\CRM\Http\Controllers\LeadController;
use App\Modules\CRM\Http\Controllers\OpportunityController;
use App\Modules\CRM\Http\Controllers\TaskController;
use App\Modules\Finance\Http\Controllers\AccountController;
use App\Modules\Finance\Http\Controllers\FiscalController;
use App\Modules\Finance\Http\Controllers\JournalController;
use App\Modules\Finance\Http\Controllers\TreasuryController;
use App\Modules\Inventory\Http\Controllers\ProductController;
use App\Modules\Inventory\Http\Controllers\StockController;
use App\Modules\Inventory\Http\Controllers\StockDocumentController;
use App\Modules\Parties\Http\Controllers\PartyController;
use App\Modules\Reports\Http\Controllers\ReportController;
use App\Modules\Service\Http\Controllers\OperationsController;
use App\Modules\Service\Http\Controllers\ServiceController;
use App\Modules\Service\Http\Controllers\UnitImportController;
use App\Modules\Trading\Http\Controllers\TradeDocumentController;
use Illuminate\Support\Facades\Route;

Route::post('licensing/activate', [LicenseController::class, 'activate'])->middleware('throttle:10,1');
Route::post('licensing/refresh', [LicenseController::class, 'refresh'])->middleware('throttle:60,1');
Route::post('licensing/offline-companies/reserve', [LicenseController::class, 'reserveOffline'])->middleware('throttle:30,1');
Route::post('licensing/offline-companies/confirm', [LicenseController::class, 'confirmOffline'])->middleware('throttle:60,1');
Route::post('licensing/companies', [LicenseController::class, 'registerCompany'])->middleware('throttle:10,1');
Route::post('licensing/company-assignment', [LicenseController::class, 'assignCompany'])->middleware('throttle:30,1');

// ── Public ─────────────────────────────────────────────────────────────
Route::get('system/ping', [SystemController::class, 'ping']);
Route::get('system/info', [SystemController::class, 'info']);
Route::get('system/companies', [SystemController::class, 'companies']);
Route::post('auth/login', [AuthController::class, 'login']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('maintenance/profiles', [ServiceController::class, 'profiles']);
    Route::post('maintenance/profiles', [ServiceController::class, 'saveProfile']);
    Route::get('parties/{party}/addresses', [ServiceController::class, 'addresses']);
    Route::post('parties/{party}/addresses', [ServiceController::class, 'addresses']);
    Route::get('operations/today', [OperationsController::class, 'today']);
    Route::get('customer-units', [ServiceController::class, 'units']);
    Route::get('customer-units/invoice-registrations', [ServiceController::class, 'invoiceRegistrations']);
    Route::post('customer-units', [ServiceController::class, 'saveUnit']);
    Route::get('customer-units/{unit}', [ServiceController::class, 'unit']);
    Route::put('customer-units/{unit}', [ServiceController::class, 'updateUnit']);
    Route::post('customer-units/{unit}/install', [ServiceController::class, 'install']);
    Route::post('customer-units/{unit}/schedule-overrides', [ServiceController::class, 'overrideSchedule']);
    Route::get('maintenance/due', [ServiceController::class, 'due']);
    Route::get('maintenance/followups', [ServiceController::class, 'followups']);
    Route::put('maintenance/followups/{followup}/owner', [ServiceController::class, 'assignFollowup']);
    Route::post('maintenance/followups/{followup}/contact', [ServiceController::class, 'contact']);
    Route::get('maintenance/templates', [ServiceController::class, 'templates']);
    Route::post('maintenance/templates', [ServiceController::class, 'templates']);
    Route::get('service-requests', [ServiceController::class, 'requests']);
    Route::post('service-requests', [ServiceController::class, 'saveRequest']);
    Route::get('service-visits', [ServiceController::class, 'visits']);
    Route::post('service-visits', [ServiceController::class, 'saveVisit']);
    Route::get('service-visits/{visit}', [ServiceController::class, 'visit']);
    Route::put('service-visits/{visit}', [ServiceController::class, 'saveVisit']);
    Route::post('service-visits/{visit}/transition', [ServiceController::class, 'transition']);
    Route::post('service-visits/{visit}/corrections', [ServiceController::class, 'correctVisit']);
    Route::post('service-visits/{visit}/complete', [ServiceController::class, 'complete']);
    Route::post('service-visits/{visit}/invoice', [ServiceController::class, 'invoice']);
    Route::get('reports/maintenance', [ServiceController::class, 'reports']);
    Route::get('reports/technicians', [ServiceController::class, 'reports']);

    Route::get('forms/{formKey}', [FormController::class, 'show']);
    Route::get('reports/custom-fields/{formKey}', CustomReportController::class);
    Route::get('admin/forms', [FormController::class, 'index']);
    Route::post('admin/forms/{formKey}/draft', [FormController::class, 'draft']);
    Route::put('admin/forms/{formKey}/draft', [FormController::class, 'draft']);
    Route::post('admin/forms/{formKey}/publish', [FormController::class, 'publish']);
    Route::get('admin/custom-fields/{entityType}', [FormController::class, 'fields']);
    Route::post('admin/custom-fields/{entityType}', [FormController::class, 'saveField']);
    Route::put('admin/custom-fields/{entityType}/{field}', [FormController::class, 'saveField']);
    Route::post('attachments', [AttachmentController::class, 'store']);
    Route::get('attachments/{attachment}', [AttachmentController::class, 'show']);
    Route::delete('attachments/{attachment}', [AttachmentController::class, 'destroy']);

    // ── Session ────────────────────────────────────────────────────────
    Route::get('auth/me', [AuthController::class, 'me']);
    Route::post('auth/logout', [AuthController::class, 'logout']);
    Route::post('auth/verify-password', [AuthController::class, 'verifyPassword']);
    Route::put('auth/profile', [AuthController::class, 'updateProfile']);
    Route::put('auth/password', [AuthController::class, 'changePassword']);
    Route::get('lookups', LookupController::class);

    Route::get('setup-guide', [SetupGuideController::class, 'show']);
    Route::post('setup-guide', [SetupGuideController::class, 'update']);

    // ── Administration ────────────────────────────────────────────────
    Route::get('settings', [SettingsController::class, 'index']);
    Route::put('settings', [SettingsController::class, 'update']);
    Route::get('users', [UserController::class, 'index']);
    Route::post('users', [UserController::class, 'store']);
    Route::get('users/{user}', [UserController::class, 'show']);
    Route::put('users/{user}', [UserController::class, 'update']);
    Route::get('roles', [UserController::class, 'roles']);
    Route::post('roles', [UserController::class, 'saveRole']);
    Route::put('roles/{role}', [UserController::class, 'saveRole']);
    Route::get('audit-logs', [SystemController::class, 'audit']);
    Route::get('backups', [SystemController::class, 'backups']);
    Route::post('backups', [SystemController::class, 'createBackup']);
    Route::get('backups/{file}', [SystemController::class, 'downloadBackup']);
    Route::post('import/customer-units', [UnitImportController::class, 'import']);
    Route::post('import/{entity}', [ImportController::class, 'import'])->whereIn('entity', ['products', 'customers', 'suppliers']);
    Route::get('import/{entity}/template', [ImportController::class, 'template'])->whereIn('entity', ['products', 'customers', 'suppliers']);

    // Small master tables share one controller.
    $resources = implode('|', array_keys(CrudController::resources()));
    Route::get('master/{resource}', [CrudController::class, 'index'])->where('resource', $resources);
    Route::post('master/{resource}', [CrudController::class, 'store'])->where('resource', $resources);
    Route::put('master/{resource}/{id}', [CrudController::class, 'update'])->where('resource', $resources);
    Route::delete('master/{resource}/{id}', [CrudController::class, 'destroy'])->where('resource', $resources);

    // ── Customers & suppliers ─────────────────────────────────────────
    Route::get('parties', [PartyController::class, 'index']);
    Route::post('parties', [PartyController::class, 'store']);
    Route::get('parties/{party}', [PartyController::class, 'show']);
    Route::put('parties/{party}', [PartyController::class, 'update']);
    Route::delete('parties/{party}', [PartyController::class, 'destroy']);
    Route::get('parties/{party}/statement', [PartyController::class, 'statement']);
    Route::get('parties/{party}/open-invoices', [PartyController::class, 'openInvoices']);
    Route::get('parties/{party}/overview', [PartyController::class, 'overview']);
    Route::post('parties/{party}/opening-balance', [PartyController::class, 'opening']);

    // ── Inventory ─────────────────────────────────────────────────────
    Route::get('products', [ProductController::class, 'index']);
    Route::post('products', [ProductController::class, 'store']);
    Route::get('products/scan/{code}', [ProductController::class, 'scan'])->where('code', '.*');
    Route::get('products/{product}/serials', [ProductController::class, 'serials']);
    Route::get('products/{product}', [ProductController::class, 'show']);
    Route::put('products/{product}', [ProductController::class, 'update']);
    Route::delete('products/{product}', [ProductController::class, 'destroy']);
    Route::get('products/{product}/price', [ProductController::class, 'price']);
    Route::get('products/{product}/batches', [StockController::class, 'batches']);
    Route::get('products/{product}/card', [StockController::class, 'itemCard']);
    Route::get('stock/on-hand', [StockController::class, 'onHand']);
    Route::get('stock/expiring', [StockController::class, 'expiring']);
    Route::get('stock/reorder', [StockController::class, 'reorder']);
    Route::get('stock/slow-moving', [StockController::class, 'slowMoving']);
    Route::get('stock/reconcile', [StockController::class, 'reconcile']);
    $stockTypes = 'adjustment|transfer|count|opening';
    Route::get('stock-documents/{type}', [StockDocumentController::class, 'index'])->where('type', $stockTypes);
    Route::post('stock-documents/{type}', [StockDocumentController::class, 'store'])->where('type', $stockTypes);
    Route::get('stock-documents/{type}/{document}', [StockDocumentController::class, 'show'])->where('type', $stockTypes);
    Route::put('stock-documents/{type}/{document}', [StockDocumentController::class, 'update'])->where('type', $stockTypes);
    Route::delete('stock-documents/{type}/{document}', [StockDocumentController::class, 'destroy'])->where('type', $stockTypes);
    Route::post('stock-documents/{type}/{document}/{action}', [StockDocumentController::class, 'action'])->where('type', $stockTypes)->whereIn('action', ['post', 'start', 'receive', 'cancel', 'void']);

    // ── Sales & purchasing documents ──────────────────────────────────
    $docTypes = 'sales_quotation|sales_order|sales_invoice|sales_return|purchase_order|purchase_receipt|purchase_invoice|purchase_return';
    Route::get('documents/{type}', [TradeDocumentController::class, 'index'])->where('type', $docTypes);
    Route::post('documents/{type}', [TradeDocumentController::class, 'store'])->where('type', $docTypes);
    Route::get('documents/{type}/{document}', [TradeDocumentController::class, 'show'])->where('type', $docTypes);
    Route::put('documents/{type}/{document}', [TradeDocumentController::class, 'update'])->where('type', $docTypes);
    Route::delete('documents/{type}/{document}', [TradeDocumentController::class, 'destroy'])->where('type', $docTypes);
    Route::post('documents/{type}/{document}/post', [TradeDocumentController::class, 'post'])->where('type', $docTypes);
    Route::post('documents/{type}/{document}/void', [TradeDocumentController::class, 'void'])->where('type', $docTypes);
    Route::post('documents/{type}/{document}/convert', [TradeDocumentController::class, 'convert'])->where('type', $docTypes);
    Route::post('documents/{type}/{document}/{action}', [TradeDocumentController::class, 'transition'])->where('type', $docTypes)->whereIn('action', ['send', 'accept', 'reject', 'reopen', 'confirm', 'cancel', 'close']);

    // ── Finance ───────────────────────────────────────────────────────
    Route::get('accounts', [AccountController::class, 'index']);
    Route::post('accounts', [AccountController::class, 'store']);
    Route::put('accounts/{account}', [AccountController::class, 'update']);
    Route::delete('accounts/{account}', [AccountController::class, 'destroy']);
    Route::get('accounts/{account}/ledger', [AccountController::class, 'ledger']);
    Route::get('journals', [JournalController::class, 'index']);
    Route::post('journals', [JournalController::class, 'store']);
    Route::get('journals/{journal}', [JournalController::class, 'show']);
    Route::put('journals/{journal}', [JournalController::class, 'update']);
    Route::delete('journals/{journal}', [JournalController::class, 'destroy']);
    Route::post('journals/{journal}/post', [JournalController::class, 'post']);
    Route::post('journals/{journal}/reverse', [JournalController::class, 'reverse']);
    Route::get('fiscal-years', [FiscalController::class, 'index']);
    Route::post('fiscal-years', [FiscalController::class, 'store']);
    Route::post('fiscal-years/{year}/close', [FiscalController::class, 'close']);
    Route::put('fiscal/lock-date', [FiscalController::class, 'lock']);
    Route::post('fiscal/opening-balances', [FiscalController::class, 'accountsOpening']);

    // ── Treasury ──────────────────────────────────────────────────────
    Route::get('cash-accounts', [TreasuryController::class, 'cashAccounts']);
    Route::post('cash-accounts', [TreasuryController::class, 'storeCashAccount']);
    Route::put('cash-accounts/{cashAccount}', [TreasuryController::class, 'updateCashAccount']);
    Route::get('cash-accounts/{cashAccount}/statement', [TreasuryController::class, 'cashStatement']);
    Route::get('vouchers', [TreasuryController::class, 'vouchers']);
    Route::post('vouchers', [TreasuryController::class, 'storeVoucher']);
    Route::get('vouchers/{voucher}', [TreasuryController::class, 'showVoucher']);
    Route::put('vouchers/{voucher}', [TreasuryController::class, 'updateVoucher']);
    Route::delete('vouchers/{voucher}', [TreasuryController::class, 'destroyVoucher']);
    Route::post('vouchers/{voucher}/post', [TreasuryController::class, 'postVoucher']);
    Route::post('vouchers/{voucher}/void', [TreasuryController::class, 'voidVoucher']);
    Route::get('cheques', [TreasuryController::class, 'cheques']);
    Route::get('cheques/{cheque}', [TreasuryController::class, 'showCheque']);
    Route::post('cheques/{cheque}/{action}', [TreasuryController::class, 'chequeAction'])->whereIn('action', ['deposit', 'collect', 'bounce', 'return', 'endorse', 'clear', 'cancel']);

    // ── CRM ───────────────────────────────────────────────────────────
    Route::get('crm/leads', [LeadController::class, 'index']);
    Route::post('crm/leads', [LeadController::class, 'store']);
    Route::get('crm/leads/{lead}', [LeadController::class, 'show']);
    Route::put('crm/leads/{lead}', [LeadController::class, 'update']);
    Route::delete('crm/leads/{lead}', [LeadController::class, 'destroy']);
    Route::post('crm/leads/{lead}/convert', [LeadController::class, 'convert']);
    Route::get('crm/opportunities', [OpportunityController::class, 'index']);
    Route::get('crm/board', [OpportunityController::class, 'board']);
    Route::post('crm/opportunities', [OpportunityController::class, 'store']);
    Route::get('crm/opportunities/{opportunity}', [OpportunityController::class, 'show']);
    Route::put('crm/opportunities/{opportunity}', [OpportunityController::class, 'update']);
    Route::delete('crm/opportunities/{opportunity}', [OpportunityController::class, 'destroy']);
    Route::post('crm/opportunities/{opportunity}/move', [OpportunityController::class, 'move']);
    Route::post('crm/opportunities/{opportunity}/quotation', [OpportunityController::class, 'quotation']);
    Route::get('crm/activities', [ActivityController::class, 'index']);
    Route::post('crm/activities', [ActivityController::class, 'store']);
    Route::delete('crm/activities/{activity}', [ActivityController::class, 'destroy']);
    Route::get('crm/tasks', [TaskController::class, 'index']);
    Route::get('crm/agenda', [TaskController::class, 'agenda']);
    Route::post('crm/tasks', [TaskController::class, 'store']);
    Route::put('crm/tasks/{task}', [TaskController::class, 'update']);
    Route::delete('crm/tasks/{task}', [TaskController::class, 'destroy']);
    Route::post('crm/tasks/{task}/complete', [TaskController::class, 'complete']);
    Route::post('crm/tasks/{task}/snooze', [TaskController::class, 'snooze']);

    // ── Reports ───────────────────────────────────────────────────────
    Route::get('reports/dashboard', [ReportController::class, 'dashboard']);
    Route::get('reports/finance/{report}', [ReportController::class, 'finance']);
    Route::get('reports/aging/{kind}', [ReportController::class, 'aging']);
    Route::get('reports/analysis/{side}', [ReportController::class, 'analysis']);
    Route::get('reports/salespeople', [ReportController::class, 'salespeople']);
    Route::get('reports/crm', [ReportController::class, 'crm']);
});
