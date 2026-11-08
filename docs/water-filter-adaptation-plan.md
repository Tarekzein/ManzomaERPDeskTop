# ManzomaERP: current adaptation status and remaining plan

Updated **3 November 2026**, including Windows/macOS test installers and packaged online/offline acceptance.
Earlier operating, licensing and company-setup evidence is retained below. This is the single implementation plan.
Setup, licensing, recovery and release procedures are in [operations-guide.md](operations-guide.md).
Source implementation and automated verification do not certify a production deployment.
A separate user-requested local fresh-start reset was completed on 3 November; vendor operator
credentials and issuer identity were preserved. See README for the reset record and new setup steps.

The old general plan, separate licensing plan and historical fresh-start verification were
merged into these two documents. Originals were preserved outside the workspace at
`../manzoma-erp-document-history/20261027-before-consolidation`; historical resets are not current
instructions.

## 1. Product decisions to preserve

- Focus daily work on household customers, filters, inventory, maintenance, visits, invoices
  and collections. Keep existing accounting, purchasing, CRM, reports and administration
  **visible in their normal menu groups**, subject to permissions. Do not restore an Advanced
  directory or remove the accounting/stock engines.
- Keep forms simple: common information first, optional details collapsed, useful defaults,
  connected records and clear next actions. Customer creation optionally records an existing
  filter or creates a linked new-sale invoice draft.
- Arabic uses locally bundled **Cairo**, RTL and white text on filled sapphire actions. Maintain
  English, keyboard access, responsive dialogs and printable Arabic documents.
- Shared-server companies are authoritative server databases. Local SQLite companies remain
  independent standalone companies; they are not synchronized server replicas.
- Office staff record technician work, actual parts, photos and returned signatures. Staff
  follow-up tasks are automatic; customer calls/prepared messages remain manual. No messaging
  provider is required.
- Maintenance starts at actual confirmed installation and restarts for each actually replaced
  stage. Unknown history requires review. Consume visit parts once at completion; linked
  invoicing must not issue stock or cost again.
- Verify the application license **before** company selection, company creation/import or ERP
  login. The vendor issues a copy/paste activation key through the separate Filament panel.
- Initial activation requires internet for both online and offline use. A device-bound signed
  offline certificate remains usable until expiry without mandatory periodic check-in.
- One shared company ceiling applies across the license. One shared online company counts
  once across devices; separate offline databases count separately. **One company per device**
  is enforced by a device-to-company assignment. Activation reserves no company; create or join
  one afterward. LAN clients share the main computer database through pinned TLS, signed grants
  and replay-checked proofs, without consuming another company. An unused signed slot
  consumes capacity but must not appear as an actual registered company.
- No invented company balances, customer histories or manufacturer intervals. No additional
  data deletion is part of this inspection or the roadmap.

Implementation references: `desktop/src/renderer/src/workspace/routes.tsx`,
`desktop/src/renderer/src/features/parties/CustomerProductEntry.tsx`,
`backend/app/Modules/Parties/Services/CustomerIntakeService.php`,
`backend/app/Modules/Service/Services/{MaintenanceService,VisitService}.php`,
`desktop/src/main/{licensing,ipc}.ts`, `backend/app/Control/Services/LicenseService.php`.

### UI refresh — ink navy and sapphire

The desktop now uses ink-navy navigation, muted sapphire actions and warm pearl surfaces in
light mode, with a coordinated dark palette. Cairo/RTL and English/LTR are retained. Success,
warning and error colours remain semantic rather than becoming the brand colour.

Today has a clearer action hierarchy, appointments, next steps and stock reminders. Optional-only form sections collapse into a single named row and reveal fields with validation errors. Shared
controls, tables, tabs, dialogs, primary form layouts, login/activation, print documents and
the Filament license dashboard use the updated visual language. No business workflow or
permission was changed. Evidence: `desktop/src/renderer/src/styles/app.css`,
`features/dashboard/Dashboard.tsx`, `workspace/Shell.tsx`, `components/ui.tsx`,
`features/boot/{Login,LicenseGate}.tsx`, `features/print/printService.tsx`,
`backend/app/Providers/Filament/ControlPanelProvider.php`.

This refresh uses scoped verification: translation checks, renderer type/build checks,
27 existing UI accessibility/contrast checks and visual review of Arabic/English and dark mode in both the fixture and an isolated desktop workspace.
Business-data regression suites are not repeated for a theme-only change.

## 2. Current-state audit

Status: **Exists** means implemented in source with some regression coverage; **Partial**
means a capability exists but the stated extension or operational acceptance remains;
**Missing** means no implementation was found in the inspected paths. Proposed enhancements
below are not all release blockers.

### Repository and operations

| Area | Current state and evidence |
|---|---|
| Runtime | Laravel 13, React 19, Vite 8, Electron 45; Filament control panel. These supersede the original Laravel 11/React 18 assumption. `backend/composer.json`, `desktop/package.json`, `backend/app/Providers/Filament/ControlPanelProvider.php`. |
| Modules | Eight company modules: Core, Parties, CRM, Inventory, Trading, Finance, Reports and Service. Vendor licensing is separate under Control. `backend/app/Modules/`, `backend/app/Control/`, `backend/routes/api.php`. |
| Frontend | One React renderer with a tabbed workspace, common controls, React Query and Zustand. Electron main/preload own local PHP, profiles, licensing, drafts, printing and backup IPC. `desktop/src/renderer/src/`, `desktop/src/{main,preload,shared}/`. |
| Database/tenancy | Thirteen company migrations and five separate control migrations. Company-per-database isolation; registered MySQL company selection on servers and SQLite per local company. `backend/database/{migrations,control}/`, `backend/app/Modules/Core/Http/Middleware/SelectCompany.php`, `desktop/src/main/backend.ts`. |
| Access | Sanctum, Spatie permissions, service/technician permissions, assigned-visit and van restrictions, separate control operators. Targeted ownership/cost-leak tests exist. `backend/config/erp.php`, `backend/app/Modules/Core/Services/FormRegistry.php`, `backend/app/Control/Models/ControlAdmin.php`, `backend/tests/Feature/HardeningTest.php`. |
| Automation | Jobs tables, tenant-pinned queue command, every-15-minute maintenance/stock scan and daily company backups exist. Docker runs the scheduler and a worker supervisor discovering each registered tenant. Local Electron scans on opening and every 15 minutes while the company is open, catches up after sleep and exposes last success/failure. `backend/database/migrations/2026_10_25_000600_create_water_filter_service_tables.php`, `backend/routes/console.php`, `backend/app/Modules/Core/Console/{MaintenanceScanCommand,TenantQueueCommand,TenantQueueSupervisorCommand}.php`, `deploy/docker-compose.yml`, `desktop/src/main/backend.ts`. |
| Deployment safety | Startup now fails when company upgrades fail; image includes a dump client. `erp:health` checks schema/issuer readiness plus scan, queue and backup freshness; Docker checks FPM and readiness. `deploy/entrypoint.sh`, `backend/app/Modules/Core/Console/UpgradeCommand.php`, `deploy/Dockerfile`, `deploy/docker-compose.yml`. |
| Provenance | No `.git` metadata exists in this supplied workspace. A verification workflow already existed and has been extended; a manual signed-installer workflow was added. Connect the source to its actual repository before relying on remote runs. `.github/workflows/{verify,release}.yml`, `backend/phpunit.xml`, `desktop/package.json`. The previous audit’s claim that CI was absent was incorrect. |

### Business capabilities A–F

| Area | Status | What exists; remaining boundary | Evidence |
|---|---|---|---|
| A — Custom fields | Exists | Twelve field types, canonical JSON, typed projections, role access, defaults, validation, conditions, list/filter/search/report/print flags, attachments and posted snapshots. | `backend/app/Modules/Core/Services/DynamicFormService.php`, `backend/app/Modules/Core/Http/Controllers/{FormController,CustomReportController,AttachmentController}.php`. |
| A — Form layout and migration | Partial | Form Studio supports sections, tabs, columns, drag ordering and keyboard movement. All 48 registered record-form keys now expose primary domain metadata through the shared renderer. Complex child grids, security actions and specialized settings remain application-owned widgets/controls. Arbitrary row-level custom fields are not implemented. | `backend/app/Modules/Core/Services/{FormRegistry,BuiltinFormRegistry}.php`, `desktop/src/renderer/src/features/forms/{FormStudio,DynamicForm}.tsx`, `backend/tests/Feature/UniversalFormsTest.php`. |
| B — Stock/purchasing | Exists | Products/UOM/barcodes/prices, warehouses, transfers/counts/adjustments, purchasing/receipts, batches/expiry/FEFO, average/FIFO, serials, van custody and reorder tasks. Real operating pilot remains. | `backend/app/Modules/Inventory/Services/{StockService,StockDocumentService,SerialService,StockAlertService}.php`, `backend/app/Modules/Trading/Services/TradingPoster.php`, `backend/tests/Feature/{Inventory,WaterFilterService}Test.php`. |
| B — Variants/kits | Missing | Separate variant families and virtual kit/BOM workflows remain optional. Packaging/UOM conversion is not variant support. | `backend/database/migrations/2026_10_01_000300_create_party_and_inventory_tables.php`, `backend/database/migrations/2026_10_25_000600_create_water_filter_service_tables.php`. |
| C — Customer/filter lifecycle | Exists | Household locations/coordinates, installed units, invoice/serial links, versioned profiles, per-stage dates, unknown-history review, pause/return handling and replacement corrections. | `backend/app/Modules/Service/Services/{CustomerUnitService,MaintenanceService}.php`, `desktop/src/renderer/src/features/parties/{PartyForm,PartyView,CustomerProductEntry}.tsx`. |
| C — Reminders and CRM | Partial | Staff tasks, escalation, contact outcomes and manual bilingual templates exist, alongside existing leads/pipeline/activities. Local scan execution, configurable offsets/default owners and follow-up reassignment are implemented. Automatic customer delivery is intentionally outside scope. | `backend/app/Modules/Service/Services/MaintenanceService.php`, `backend/app/Modules/Service/Http/Controllers/ServiceController.php`, `backend/app/Modules/CRM/`, `desktop/src/renderer/src/features/service/ServiceTools.tsx`. |
| C — Requests/visits | Partial | Assignment, scheduling/overlap checks, reports, actual parts, stage actions, uploads, completion and linked billing exist. Append-only addenda and explicitly confirmed unbilled consumption/history reversals are connected. Billed work uses the existing invoice return/credit flow; its visit consumption cannot be reversed a second time. | `backend/app/Modules/Service/Services/{VisitService,VisitCorrectionService}.php`, `backend/app/Modules/Service/Http/Controllers/ServiceController.php`, `desktop/src/renderer/src/features/service/{ServiceWorkspace,VisitCorrections}.tsx`, `backend/routes/api.php`. |
| C — Warranty/AMC/complaints | Partial | Warranty dates and permission-controlled free/warranty parts exist. Automated entitlements, contracts/renewals and a dedicated complaints workflow do not. | `backend/app/Modules/Service/Models/CustomerUnit.php`, `backend/app/Modules/Service/Services/VisitService.php`, `backend/database/migrations/2026_10_25_000600_create_water_filter_service_tables.php`. |
| D — Sales and service billing | Exists | Quotes/orders/invoices/returns, mixed stock/service lines, payment allocation and consumed-visit billing links. Sold filters can be registered from invoice lines without duplicate unit stock issues. | `backend/app/Modules/Trading/Services/{TradingService,TradingPoster}.php`, `backend/app/Modules/Service/Services/VisitService.php`, `desktop/src/renderer/src/features/service/RegisterSoldFilters.tsx`. |
| D — Commercial extensions | Partial | Partial payments exist; scheduled installments, dedicated quick-sale workspace, independent delivery workflow, target/commission settlement and live ETA submission remain optional. Fiscal fields alone are not ETA certification. | `backend/app/Modules/Trading/Services/AllocationService.php`, `backend/app/Modules/Reports/Services/BusinessReports.php`, `backend/routes/api.php`. |
| E — Finance/treasury | Exists | AR/AP, receipts/payments, expenses, cash/bank accounts, journals, fiscal locks/close and financial statements reuse existing engines. Visit consumption posts cost once. | `backend/app/Modules/Finance/Services/`, `backend/app/Modules/Reports/Services/FinancialReports.php`, `backend/app/Modules/Service/Services/VisitService.php`. |
| E — Service profitability/collections | Partial | Technician/warehouse/date-filtered contribution includes consumed parts, billed parts/services, credits and dated corrections. Full labor/travel allocation and technician cash handover remain optional later work. | `backend/app/Modules/Service/Services/ServiceReports.php`, `backend/app/Modules/Service/Http/Controllers/ServiceController.php`, `backend/app/Modules/Finance/Http/Controllers/TreasuryController.php`. |
| F — UI/printing | Partial | Cairo, RTL, white primary text, responsive common forms, focus-managed dialogs, payment review, A4/thermal/PDF, service reports and unit QR labels exist. Physical printer and packaged-platform acceptance remain. | `desktop/src/renderer/src/styles/app.css`, `desktop/src/renderer/src/components/{ui,Dialogs,SearchSelect}.tsx`, `desktop/src/renderer/src/features/{print,trading/PostDialog.tsx}`, `desktop/src/main/printing.ts`. |
| F — Imports/exports | Partial | CSV customer/product/supplier import supports dry-run, custom fields and tracking-change guards. Generic lists and service queues export all matching pages, with progress/cancellation and explicit failure on incomplete reads; 1,105-record pagination is covered. Installed-unit/history CSV mapping, validation preview, repeat-import protection, skipped counts and error downloads are implemented. Native XLSX remains optional. | `backend/app/Modules/Core/Http/Controllers/ImportController.php`, `backend/app/Modules/Service/Http/Controllers/UnitImportController.php`, `desktop/src/renderer/src/features/settings/ImportDialog.tsx`, `desktop/src/renderer/src/lib/importMapping.ts`, `desktop/src/renderer/src/components/ListPage.tsx`. |
| F — Recovery/offline | Partial | Tenant-scoped database/evidence bundles, restore/import, audit events and encrypted recoverable drafts exist. Offline server sync and automatic updates do not. Encrypted issuer recovery/scheduled archives are separate from company backups. Off-host storage and production recovery operations need configuration. | `backend/app/Modules/Core/Services/{BackupService,RestoreService,CompanyImportService}.php`, `desktop/src/main/{backup,drafts,licensing}.ts`, `desktop/electron-builder.yml`. |
| Licensing and control | Partial | Separate `/control`, key issuance, device proof, shared caps, signed offline access, online provisioning/import gates, idempotent reservations and actual-versus-reserved counts exist. Dry-run/audited reconciliation, registration states, capacity summaries, confirmation history and persisted AR/EN operator language are implemented. Public deployment and supported-device acceptance remain below. | `backend/app/Control/`, `backend/app/Providers/Filament/ControlPanelProvider.php`, `desktop/src/main/{licensing,ipc}.ts`, `backend/tests/Feature/LicensingTest.php`. |

### Form coverage and protected controls

The registry contains **48 form keys**, all with primary metadata. This count excludes protected
authentication, activation, password, connection and posting-confirmation workflows. It supersedes
the original inventory of 55 logical record/operational/authentication flows; those were counted
differently. `FormRegistry.php`, `BuiltinFormRegistry.php`, `UniversalFormsTest.php`.

| Family | Keys | Shared layout coverage | Specialized controls retained |
|---|---:|---|---|
| Master data | 12 | Built-in and custom fields | Application-owned relation pickers |
| Customers/suppliers | 2 | Identity, contacts, terms and custom fields | Connected filter/new-sale intake and opening-balance rules |
| Products | 1 | Identity, category/brand and custom fields | UOM, prices, tracking and stock rules |
| CRM | 4 | Primary fields and custom fields | Pipeline transitions and contact/follow-up actions |
| Accounts/cash accounts | 2 | Primary fields and custom fields | System-account locks and account hierarchy |
| Sales/purchases | 8 | Document headers and custom fields | Calculated line grid, allocations, posting and source links |
| Stock documents | 4 | Headers and custom fields | Stock/count lines, receipt and serial workflow |
| Journals/vouchers | 5 | Headers and custom fields | Balanced journal lines, payment/cheque/allocation controls |
| Installed units/profiles/requests/visits | 4 | Primary details and custom fields | Customer/unit selectors, stage intervals, parts, scheduling and completion |
| Users/roles | 2 | Identity and custom fields | Password, active-account and permission controls |
| Company/fiscal settings | 2 | Company identity/fiscal period and custom fields | Other settings pages, logo, costing, numbering and fiscal-close actions |
| Service locations/message templates | 2 | Primary and custom fields | Template version publication and trusted placeholders |

Primary controls and custom fields can be interleaved. Common inputs appear first; optional
inputs collapse where appropriate. Required/protected controls cannot be removed by layout edits.
Existing published custom-only layouts gain primary controls without losing custom-field order.

Output coverage is deliberately explicit: the standard `ListPage` integrates custom columns,
filters and paged CSV for parties, products, trading, stock, journal/voucher, master and CRM lists; posted trading,
voucher/stock documents and service reports have custom print blocks. Dedicated tree, security,
settings and derived maintenance queues do not automatically gain every list/export/print feature
from registration alone. Customer-unit, profile, request and visit queues now expose authorized
custom list columns, filters, searchable projections and CSV values; derived due/follow-up queues
export their operational columns. Service print layouts retain their existing explicit adapters. Additional output adapters and
arbitrary child-row custom data are extension work, not a claim of universal output completion. `components/ListPage.tsx`,
`features/print/templates.tsx`, `features/service/ServicePrint.tsx`, `CustomReportController.php`.

Trade-line identities remain stable. Row-level custom data is added only when there is an actual
business input requiring it; financial quantities/totals remain typed and validated by services.

## 3. Existing architecture to retain

### Connected records and APIs

The implemented operating chain is:

`license → device → company → staff login → customer/location → purchased or existing filter
→ installation/stage schedule → staff follow-up/contact → request → technician/van visit
→ actual part movements + journal + replacement event → linked invoice → payment allocation`.

```mermaid
flowchart LR
  License[License and device] --> Company[Company and staff login]
  Company --> Customer[Customer and service location]
  Customer --> Unit[Installed filter and stage schedules]
  Unit --> Followup[Staff follow-up]
  Followup --> Visit[Request and technician visit]
  Inventory[Warehouse or van stock] --> Visit
  Visit --> Fulfillment[Actual parts and replacement history]
  Fulfillment --> Invoice[Linked invoice and payment]
  Fulfillment --> Journal[Stock cost journal]
  Invoice --> Journal
```

Existing external ownership registration does not issue stock. A new customer sale creates a
reviewable invoice draft. Inventory and journals change through posting services. Sales units
and consumed visit parts must not be deducted a second time during installation/invoicing.

| Boundary | Current interface and source |
|---|---|
| Customer intake | `POST /api/parties`, optional `product_entry` (`existing` or `new_sale`); `CustomerIntakeService.php` performs connected writes transactionally. |
| Units and schedules | `/api/customer-units`, unit `install` and `schedule-overrides`, `/api/maintenance/profiles`, `/api/maintenance/due`, follow-up `contact` and `owner`; `backend/routes/api.php`, `ServiceController.php`. |
| Service fulfillment | `/api/service-requests`, `/api/service-visits`, visit `transition`, `complete`, `invoice`, `corrections`; visit locks, completion key and fulfillment links in `VisitService.php`. |
| Custom forms | `/api/forms/{formKey}`, `/api/admin/forms`, draft/publish, custom fields, custom-field reports and attachments; `FormController.php`, `DynamicFormService.php`, `backend/routes/api.php`. |
| Licensing | Activation/refresh, online company registration, offline reservation/confirmation endpoints; `backend/app/Control/Http/LicenseController.php`, `backend/app/Control/Services/{LicenseService,CompanyRegistrationService}.php`. |

### Data model and invariants

| New delivery data | Columns/relations and purpose | Evidence |
|---|---|---|
| Visit completion | `completed_on` Cairo work date; `completed_at` actual UTC action; `completion_time_known` distinguishes legacy synthetic timestamps | `2026_10_27_000800_record_actual_service_completion.php`, `VisitService.php` |
| `service_visit_corrections` | Visit, kind, effective date, reason, actor, details, request key/hash; unique `(visit_id,request_key)` | `2026_10_27_000900_add_service_corrections_and_imports.php`, `VisitCorrectionService.php` |
| `unit_import_receipts` | Unique unit, canonical input hash and source snapshot; identical retry skips; conflicting history rejects | Same migration; `UnitImportController.php` |
| Company settings | Pre-due/overdue days, maintenance owner and stock-alert owner under typed validated setting keys | `SettingsController.php`, `MaintenanceService.php`, `StockAlertService.php` |


- Preserve typed money, quantities, fiscal identifiers, lifecycle dates and domain validation.
  Custom data belongs in `entity_custom_data.values_json`; searchable/filterable values use
  `custom_field_index` and `custom_field_option_values`. Definitions/layouts use
  `custom_field_definitions` and versioned `form_definitions`; historical printable values use
  `document_form_snapshots`. `2026_10_25_000500_create_dynamic_forms_tables.php` and
  `DynamicFormService.php` implement this hybrid JSON/projection design.
- Preserve `party_addresses`, versioned `maintenance_profiles`/stages, `customer_units`,
  `unit_stage_schedules`, `maintenance_events`, `maintenance_followups`, `followup_contacts`,
  `service_requests`, visits/parts/stage actions and stock/billing links. See
  `2026_10_25_000600_create_water_filter_service_tables.php`. Monthly intervals clamp at month
  end; business dates use Cairo. Actual replacement advances only its own stage; scans recover
  eligible unresolved work after downtime. `MaintenanceService.php`.
- Keep vendor operators/licenses/devices/company allocations/registration attempts/nonces in
  the separate control connection. `registered_at` distinguishes an actual company from a
  signed unused allocation. Online requests are signed and replay-checked; offline rights
  remain valid through their issued expiry. `backend/database/control/`,
  `backend/app/Control/Services/{DeviceProof,LicenseSigner,LicenseService}.php`.
- Offline capacity cannot safely be returned to another disconnected device merely because an
  operator deletes a row. General release remains blocked before the last signed expiry.
  Device transfer/recovery needs an explicit safe design. `LicenseService::releaseCompany()`.

## 4. Delivery ledger

**Implemented** means source and focused checks exist. **Partial** names the remaining boundary;
it does not silently turn an operational dependency into completed work.

| ID | Status | Delivered behavior and evidence | Remaining boundary |
|---|---|---|---|
| R1 Local automation | Implemented | Open/startup scan, 15-minute scans, no overlap, sleep/resume catch-up and visible health. `desktop/src/main/companyAutomation.ts`, `backend.ts`, `features/service/AutomationStatus.tsx`, `company-automation.test.tsx`. | A closed desktop cannot generate tasks; continuous operation uses the server scheduler. |
| R2 Capacity visibility | Implemented | Registered/reserved/free counts, device and pending state; durable local confirmation status/manual refresh. `Control/Resources/{CompanyResource,LicenseResource}.php`, `desktop/src/main/licensing.ts`, `LicenseDialog.tsx`. | Offline registration reaches the authority after reconnection; an unused signed grant still occupies capacity. |
| R3 Company names | Implemented | Entered online name preserved and verified registration names reconciled. `LicenseService.php`, `CompanyRegistrationService.php`, `CompanyReconciliation.php`, `LicensingTest.php`. | No company IDs/grants are changed during metadata repair. |
| R4 Historical allocation audit | Implemented | Dry-run by default, audited `--apply`, only proven registration failures/names repaired. `ControlReconcileCommand.php`, `CompanyReconciliation.php`. | Operators review before applying to a live issuer; no automatic grant release. |
| R5 Issuer recovery | Partial: deployment | Authenticated encrypted control DB/APP_KEY/signing pair/registry archive; scheduled retention; bounded restore to a new staging directory; wrong-password/integrity tests. `ControlBackupService.php`, `Control{Backup,Restore}Command.php`, `routes/console.php`. | Configure a protected password/off-host destination and rehearse actual issuer restoration. Never reissue rights from an older recovery point without reconciliation. |
| R6 Server operations | Partial: deployment | Tenant worker discovery/restart, schema/issuer readiness and stale scan/queue/backup diagnostics. Invalid registry fails closed, including no-company issuer checks. `TenantQueueSupervisorCommand.php`, `HealthCommand.php`, `deploy/docker-compose.yml`, `LicensingTest.php`. | Public HTTPS, production issuer URL, monitoring and server restart acceptance require deployment inputs. |
| R7 Repeatable verification | Implemented locally; remote pending | Existing CI extended with guarded MySQL concurrency/provisioning. Real native UI/IPC/API onboarding harness with disposable issuer/profile and process restart. `.github/workflows/verify.yml`, `scripts/verify-onboarding{.mjs,-electron.cjs}`, `LicensingTest.php`. | This snapshot has no `.git` metadata; remote workflow runs require the actual repository. |
| R8 Installers | Partial: release acceptance | Public trust validation, empty runtime storage (no source sessions, attachments, backups or registry), checksums and manual signed/notarized matrix. `scripts/{prepare-backend,prepare-release,verify-distribution}.mjs`, `.github/workflows/release.yml`, `.dockerignore`. | Signing credentials, clean supported OS installs/upgrades and printer hardware have not been supplied/exercised. Auto-update remains optional. |
| R9 Correct completed work | Implemented | Addenda; explicit unbilled physical-consumption reversal at original cost; audited stage restoration and linked journal reversal; retry/later-history/fiscal-lock guards. Billed work links to credit/return flow. `VisitCorrectionService.php`, `VisitCorrections.tsx`, `ReleaseImprovementsTest.php`. | Partial physical reversals and automatic billed-history corrections remain controlled manual decisions. |
| R10 Team settings | Implemented | Configurable offsets/default owners, task-linked reassignment and unassigned-work warning. `SettingsController.php`, `MaintenanceService.php`, `StockAlertService.php`, `SettingsPage.tsx`. | Only eligible active owners can be selected; revoked access falls back safely. Populate real staff responsibility. |
| R11 History import | Implemented for CSV | Column mapping including explicit unmapped fields, custom/stage columns, preview, idempotency, unknown-history review and downloadable errors. `UnitImportController.php`, `ImportDialog.tsx`, `lib/importMapping.ts`, `ReleaseImprovementsTest.php`. | Real legacy files/catalogue still needed. XLSX remains optional. |
| R12 Shared forms | Primary migration implemented; output extensions partial | 48 primary form metadata keys with protected domain controls and bilingual names; layout/default/error handling and safe settings conditions. `BuiltinFormRegistry.php`, `DynamicForm.tsx`, `DomainFormWidgets.tsx`, `UniversalFormsTest.php`. | See coverage matrix: specialized outputs and child-row custom data are not universally implemented. |
| R13 Reporting | Period filters implemented; scale acceptance pending | Date/technician/warehouse contribution and dated reversals; clear parts-versus-service labels. `ServiceReports.php`, `ServiceWorkspace.tsx`, `ReleaseImprovementsTest.php`. | Labor/travel remain excluded. Production-volume benchmarking remains. Service request/unit selection now uses server search and paged options; 1,105-record read/export tests pass. Legacy `per_page=0` APIs remain capped and are not used by these flows. |
| R14 UI/UX | Implemented improvements; pilot pending | Primary-first forms, linked customer defaults, inline errors/focus, completion review, busy-close guards, accessible dialogs, Cairo/RTL and white filled actions. `DynamicForm.tsx`, `TradeFormWidgets.tsx`, `StockFormWidgets.tsx`, `ServiceWorkspace.tsx`, `components/{ui,Dialogs}.tsx`, `scripts/verify-ui.mjs`. | Real staff/printer acceptance remains necessary; no claim of a measured productivity improvement yet. |
| R15 Secrets/support lifecycle | Implemented | Async OS encryption preserving existing company keys, safe legacy public trust, sanitized diagnostics and key/device recovery procedure. `main/{licensing,store,drafts,licenseCrypto}.ts`, `resources/license-legacy-public-keys.json`, `LicenseSigner.php`, `operations-guide.md`. | OS keychain availability and platform-specific release checks remain; no silent insecure persistence fallback. |
| R16 Language consistency | Implemented controls and guard | Shared AR error/status catalogue; Arabic validation/permission labels; named form registry; persisted Filament AR/EN locale and RTL. `backend/lang/`, `desktop/src/shared/{messages.ar.json,localizeMessage.ts}`, `ControlLocale.php`, `scripts/verify-translations.mjs`. | User-entered names/codes are preserved. Automated guards do not prove every rare operational error is translated; include it in pilot review. |
| R17 Completion dates | Implemented | Actual UTC completion timestamp separated from Cairo work date; legacy time flagged unknown. Date-only frontend defaults/arithmetic respect Cairo/DST. Completion and boundary tests. `000800` migration, `VisitService.php`, `lib/format.ts`, `ReleaseImprovementsTest.php`, `dynamic-form.test.tsx`. | Legacy approximate timestamps cannot yield trustworthy historical visit durations. |

The final UI check also fixed the shared picker’s autofocus geometry: a focus event can precede
attachment of its parent ref. Positioning now uses the focused input and preserves a search
started while closed. Native invoice selection and dedicated UI regressions verify this.
`components/SearchSelect.tsx`, `scripts/verify-ui-electron.cjs`.

Grouped custom reports now use the company singleton correctly and separate receipt, supplier
payment and expense voucher kinds. Standard stock/journal/voucher lists expose their applicable
custom columns, filters and exports. `FormRegistry.php`, `DynamicRecords.php`, `ListPage.tsx`,
`UniversalFormsTest.php`.

Regression also caught and corrected a settings-save defect: validating only selected dotted
keys could discard other settings. The container and typed fields now validate separately, and
failed conditional custom fields roll back the settings write. `SettingsController.php`,
`UniversalFormsTest::test_company_setting_conditions_read_actual_settings_and_rollback_invalid_changes`.

### New-company guided setup — implemented

New local and online installations seed company-owned setup progress. After the first owner
sign-in, the desktop opens a six-step guide: company details → locations/team → finance/tax →
products/stock → maintenance → customers/filters, followed by review and start. It reuses the
normal forms and import workflows, includes an inline company editor, shows live readiness
checks, and preserves progress when switching tabs, pausing or reopening. Maintenance and
customers can be explicitly deferred; mandatory steps cannot. Completion validates current
records and never creates financial/stock transactions or sample records.

Existing companies are not forced into setup; **Settings → Getting started** is available to
an authorized owner. Imported company backups preserve their progress. New installations use
the same `InstallService` for local and server registration; license/login gates are unchanged.
Progress is private company state, not device preferences. AR/EN, Cairo/RTL and the sapphire
light/dark theme apply throughout.

Sources: `backend/app/Modules/Core/Services/{InstallService,SetupGuideService}.php`,
`Core/Http/Controllers/SetupGuideController.php`, `backend/routes/api.php`,
`desktop/src/renderer/src/features/onboarding/`, `features/settings/{SettingsPage,CompanySettings}.tsx`,
`workspace/{Shell,routes}.tsx`, `features/boot/SetupWizard.tsx`.
Acceptance: `backend/tests/Feature/SetupGuideTest.php` covers new/existing behavior, pause/resume,
review order, data readiness, deferred steps, completion, authorization and private state.

### Service queues, scalable pickers and complete exports — 28 October

Implemented the actionable source gaps in roadmap items 6–7:

- Service queues search household names/contact numbers, unit codes, serials and model names;
  request/visit numbers and descriptions are searchable too. Status filters and follow-up
  owner filters combine with customer scope, technician visibility and due periods.
- Unit/profile/request/visit queues include authorized custom list columns, filters, search
  projections and CSV fields. Profiles support paged queue/export reads while their existing
  no-page catalogue API remains compatible with editors.
- Visit-request and household-unit selection no longer load only the first 500 records.
  Server pickers show result counts, offer more pages and support keyboard paging. A failed
  next page retains earlier choices and can be retried. Selecting a household unit links its
  service address; changing a visit request clears stale stage actions. Sold-filter registration
  now uses authorized server aggregates and serialized-unit links, so invoice ownership totals
  are not limited by the old 500-row list cap. Returned units retain the existing counting rules.
- Generic lists and operational service queues export every matching page using the filters
  captured when export starts. Progress, cancellation and translated errors are visible.
  Changed totals, repeated/missing records and later-page failures reject the export before
  a file is saved. Reads are not a transactional database snapshot. Exports above 100,000
  rows require narrower filters and show an error rather than silently truncating.
- No inventory/financial posting rules, migrations, company data or license limits changed.

Sources: `backend/app/Modules/Service/{Services/ServiceSearch.php,Http/Controllers/ServiceController.php}`,
`desktop/src/renderer/src/features/service/{ServiceWorkspace,ServicePickers}.tsx`, `queueCsv.ts`,
`features/service/RegisterSoldFilters.tsx`, `components/{SearchSelect,ListPage}.tsx`,
`lib/{pagedExport,useCsvExport}.ts`.
Evidence: `ServiceQueueTest.php` (six tests / 108 assertions), nine affected existing service
tests passing, six focused export tests, type/translation/build checks and 35 UI checks. The
1,105-row fixtures prove pagination/completeness, not a production performance target.

## 5. Remaining release work, ordered by dependency

Effort: **S = 1–2**, **M = 3–5**, **L = 6–10 developer days** including relevant acceptance.
These ranges depend on actual data/platforms and are not a committed release date.

| Order / priority | Remaining task | Effort | Completion evidence |
|---|---|---|---|
| 1 / P0 | Connect the supplied source to the actual repository, configure and run regression CI. | S | SQLite/MySQL/frontend/UI jobs pass remotely; no private keys/data in artifacts. |
| 2 / P0 | Configure public HTTPS/issuer identity, protected issuer-backup password and off-host mounted destination; choose retention/recovery objectives. | M | `erp:health --all --json` healthy after real scans/backups; issuer and company restored on isolated targets. |
| 3 / P0 | Configure release signing/notarization and production public trust. Test supported clean OS install/activation/offline expiry/reopen/import/upgrade. | L across platforms | Signed artifacts, correct PHP runtime/keychain behavior, no private/control data, existing company keys remain usable. |
| 4 / P1 | Load real catalogue/stages/staff and dry-run legacy files; reconcile serials, balances and due queues with staff/accountant. | M | One complete real customer → installation → reminder → visit → parts → invoice → payment acceptance case. |
| 5 / P1 | Test actual Arabic/English A4/thermal/label printers and narrow/dark workspaces with staff. | M | Approved documents/QR scan and correction/retry/focus behavior on supported hardware. |
| 6 / P1 | Benchmark expected production volumes and remaining master/account lookup payloads. Service paging and 1,105-row export completeness are implemented. | M | Measure realistic latency/memory and add background exports or further paged lookups only where needed. |
| 7 / P2 | Service queue custom columns/filters/exports are implemented. Extend remaining specialized print/report adapters and child-row fields where a named business input needs them. | M–L per family | Coverage matrix expanded with permission/snapshot/output checks; no posting invariant becomes editable metadata. |

Do not restart an open desktop over unsaved work. Local schema/permission upgrades run when a
company is next opened; server upgrades use a verified backup first. Follow the operating guide.

## 6. Optional backlog, requiring a business reason

Do not expand the focused release with these automatically:

- Installment schedules, technician cash handover and labor/travel costing if collections and
  profitability operations require them.
- Variant families, virtual kits/BOM, AMC entitlement/renewal rules, dedicated complaints,
  commission settlement, targets, separate quick sale and independent delivery tracking.
- Native XLSX mapping when CSV does not cover actual migration needs.
- Technician mobile access/offline field sync, automated customer WhatsApp/SMS/email and signed
  automatic desktop updates as separately designed releases.
- Live ETA electronic submission only after fiscal requirements, enrollment and sandbox
  acceptance are established. Existing fiscal fields must not be presented as compliance.
- HR/payroll has no place in the current focused product scope.

These gaps are visible in `backend/routes/api.php`, company migrations, current
`backend/app/Modules/Service/` models/services, `backend/config/{mail,services}.php`,
`desktop/src/renderer/src/features/settings/ImportDialog.tsx` and `desktop/electron-builder.yml`.
Existing CRM/accounting screens stay normally accessible regardless of this backlog.

## Single-company devices and LAN hosting — 3 November 2026

The current requirement supersedes the older multi-company-on-one-device evidence below.
Each device has one `licensed_devices.company_id` foreign-key assignment to a licensed company.
Activation consumes a device seat but no company slot. Creating a local company reserves its
single ID; registering an online company binds that device atomically; joining a company reuses
its allocation. Distinct companies still share the license’s global company ceiling.

- **Local/main:** one company database and PHP server on the main computer. Sharing is opt-in,
  administrator controlled, and resumes when that company opens. PHP stays on loopback; a TLS
  gateway listens on the selected private-network port (default 9443). SQLite uses WAL and a
  busy timeout. The main computer must stay on, with the company open.
- **LAN clients:** activate the same license, paste an issuer/device-signed `MZLAN1` pairing code
  and receive a device-specific assignment from `/api/licensing/company-assignment`. The code
  pins the host TLS certificate and private address. Cached signed grants and replay-checked
  request proofs allow offline LAN read/write through the main database. No client ERP database
  or background financial mutation queue is created. Re-pairing the same company’s changed
  address can use the existing unexpired grant offline.
- **Online clients:** every device binds one shared online company and uses the hosted API.
  Requests must match that device’s assignment, not merely any company on its license.
- **UI:** company setup/join choices disappear once assigned; Settings → This computer exposes
  host sharing, address and copyable pairing code. Errors and controls are Arabic/English.
- **Reset:** user-requested active local data reset retained the vendor operator and issuer keys.
  Private recovery copy: `../manzoma-erp-reset-backups/20261103-140038-fresh-start/`. The development
  authority and company schema have no licenses/devices/companies/business users after reset.

Implementation: `backend/database/control/2026_11_03_000006_assign_one_company_per_device.php`,
`backend/app/Control/Services/{LicenseService,DeviceProof,OfflinePeerProof,CompanyRegistrationService}.php`,
`desktop/src/main/{licensing,lanHost,lanInvitation,ipc,index,store}.ts`,
`desktop/src/renderer/src/features/{boot/LanConnectDialog,settings/LanSharing}.tsx`.

Focused evidence: 30 backend licensing tests passed / 195 assertions; two MySQL-only checks
skipped in this run. 28 affected desktop tests, typecheck and 280-message translation guard
passed. Packaged Intel acceptance used three separate device profiles on one machine and
verified online registration, main-company setup, second-company denial, TLS-pinned LAN
pairing, shared reads/writes with the authority disconnected, offline restart and unchanged
company counts. Physical Windows/Apple Silicon/multiple-computer/firewall acceptance remains
part of the release pilot; no volume or public-signing certification is implied.

## 7. Inputs needed before configuration and pilot

Architecture decisions above are settled. Collect these inputs without reopening them:

1. Real filter/stage catalogue, replacement SKUs, intervals and service prices.
2. Warranty duration and free-work approvers; who owns follow-ups and stock alerts.
3. Initial warehouses/vans, staff, supported operating systems and physical printer models.
4. Legacy customer/product files and available installation/last-replacement history.
5. Accountant-approved opening quantities/balances, costing method, tax and account mappings.
6. Expected companies/devices/customers/units/concurrent users; server operator, production
   domain/HTTPS issuer, off-host backup destination, retention and recovery objectives.
7. License duration, expiry support, renewal/device-replacement policy and who may issue keys.
8. Approved manual AR/EN message wording/contact preferences and escalation responsibility.

## 8. Verification and release limits

Keep ongoing checks moderate and firm: verify changed behavior and the affected domain tests;
use a broader regression for shared posting, licensing or schema changes. Re-run a passed check
only after a relevant change or failure. Clean installer and physical printing acceptance are
release tasks, not a reason to repeat unrelated tests during every edit.

Verification on **27 October 2026** uses disposable databases, signing keys and desktop profiles;
it does not reset business data.

| Check | Current evidence |
|---|---|
| Full MySQL backend suite | **136 tests passed, 1,066 assertions, no skips**, using isolated MySQL databases including control/provisioning/concurrency checks. |
| Backend SQLite | **136 discovered: 134 passed, 2 MySQL-only tests skipped, 1,052 assertions**, successful exit. |
| Desktop | Latest full desktop run: 44 tests across five files. Current typecheck, production build and translation guard passed; 251 shared Arabic messages checked (28 October). |
| UI fixture | 35 checks passed (28 October), adding remote paging/retry/keyboard selection and filtered service/custom-field export to: Arabic Cairo/RTL, English LTR, light/dark white action contrast, dialogs/focus, autofocus picker options and typing, inline errors, narrow layout, payment review, license gates and embedded-font PDF generation. |
| Historical compiled Electron — before single-company policy | Issue key → activate → online registration/login → disconnected local creation/login → local backup import/login → process restart offline. Authority confirmed three actual companies, zero unused slots and one device. Product editor, customer payment-term propagation and company-settings save were exercised; AR/EN invoice screenshots inspected. |
| Focused regressions | Service/ownership and grouped custom-report fixes passed focused checks, then the final full suites above. |
| New-company setup guide | Five focused backend tests passed (66 assertions). Compiled Electron exercised automatic AR opening, inline company save, pause/reopen/resume, linked-form return, EN steps, customer/filter controls, deferred review and completion/reopen. The full-suite figures above predate this additive guide change; they were not repeated. |
| Service queue/export completion — 28 October | Six focused backend tests / 108 assertions (including 1,105 sold-unit registration totals); nine affected existing service tests passed; six focused export tests passed. Current typecheck, production build and 251-message translation guard passed. Earlier full MySQL/SQLite counts were not rerun for this read/UI change. |
| Packaging preflight | Production dependency staging succeeds with clean runtime directories. The staging guard rejects keys, company/control data, sessions, attachments and backup archives. Signed installer builds are separate. |
| Test installers — 3 November | Windows x64 EXE plus Intel/Apple Silicon DMGs built in `desktop/dist/`, with SHA-256 checksums. Target-specific PHP packaging, required PHP extensions/SQLite PDO, transient download retries and Mac signing-workspace isolation were fixed. Both DMGs passed integrity/mounted signature/payload checks. Mac builds are ad-hoc signed; Windows is unsigned. Native Windows/Apple Silicon execution and public signing/notarization remain pending. |
| Historical packaged Intel acceptance — before single-company policy | Isolated issuer/profile: activation gate and pasted key, online registration/login/setup guide, disconnected local creation/product save/automation, offline process restart and reconnection passed. Authority counted exactly **2 actual companies / 1 device**. Typecheck, 252-message translation guard and 20 focused licensing/server-policy tests passed. Existing keys/company data were preserved. See [README build and test steps](../README.md#build-windows-exe-and-macos-dmgs). |
| Error handling / environment defaults — earlier 3 November baseline | Rebuild generated company caches when the backend/dependencies change, fixing stale development-only Pail providers. Native/API/UI errors use AR/EN recovery messages; raw PHP/SQL/HTML/debug details remain out of the interface. Development/production URL defaults have separate example files and release-workflow variables. Saved companies and signed issuer addresses are preserved. Focused desktop checks: **27 passed**; backend debug-error localization: **1 test / 6 assertions**; typecheck and 265-message translation guard passed. Packaged Intel app verified AR/EN switching on a real connection error and offline recovery after deliberately injecting stale Pail caches; saved product and 2-company/1-device counts remained intact. Vite config loading verified dev/build defaults plus a production URL override. |
| Operations | Isolated MySQL schema readiness and tenant worker `--once`; encrypted issuer backup staging/wrong-password/restore checks; tenant/company evidence recovery and concurrency covered by Feature tests. |

Evidence scripts: `backend/tests/Feature/`, `desktop/tests/`,
`desktop/scripts/verify-{ui,onboarding}.mjs`. Generated screenshots/PDFs and native fixtures live
outside the project; native fixtures contain test secrets and must be kept private.

Not certified by these checks: a public production deployment, a GitHub-hosted workflow run,
signed/notarized clean installers on every OS, physical printers, off-host recovery, supplied
business records or staff/accountant acceptance. No performance claim is made without a volume
benchmark. Optional commercial/integration items in section 6 remain optional.
