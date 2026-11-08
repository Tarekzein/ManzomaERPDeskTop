# Operations and recovery guide

Current guide, 3 November 2026. The implementation backlog lives only in
[water-filter-adaptation-plan.md](water-filter-adaptation-plan.md).

## License authority and desktop onboarding

1. Configure the shared backend with its original APP_KEY, `ERP_CONTROL_ENABLED=true`,
   `ERP_LICENSE_ENFORCE=true`, separate `CONTROL_DB_*` and a reachable HTTPS `APP_URL` /
   `ERP_LICENSE_ISSUER`. Set secure session cookies behind HTTPS. Installed apps also accept
   HTTP for same-computer loopback testing (`localhost`, `127.0.0.1`, `::1`); remote URLs require HTTPS.
2. Run `php artisan erp:control-install --email=owner@example.com`. The command prompts for a
   password; unattended setup reads `ERP_CONTROL_PASSWORD`. Remove provisioning secrets after
   setup. Keep the existing signing keys; installing/migrating must not replace them.
3. Copy only the issuer public key to `desktop/resources/license-public-key.pem` before
   packaging. Never distribute private signing keys, APP_KEY, company/control databases or
   environment files. `desktop/scripts/prepare-backend.mjs` excludes them.
4. Open `/control` on the authority and use the vendor operator account. ERP company users
   are separate. Issue an online/offline/hybrid license with shared company/device ceilings
   and expiry; copy its activation key.
5. Paste the key in the desktop while connected, then register an online company, create a
   local company or import a compatible local company backup. Sign into the company using
   its ERP credentials. A local backup import preserves its existing ERP users/passwords.

Activation precedes company/login access. Offline operation remains valid through the signed
expiry without mandatory check-in. Activation assigns no company slot. Each device creates or
joins one company; several devices assigned to that company use one shared company allocation.
For local/LAN hosting the main computer owns the database; staff computers use its pinned TLS
gateway and device proofs while offline. Initial pairing needs issuer access. Online devices
connect directly to the shared backend. See the README for both setup sequences.
Do not release unexpired offline grants to another device: disconnected certificates still exist.

For development, `/control` requires control to be enabled and migrated on the server you are
actually visiting. `php artisan route:list --path=control` verifies the routes. The bundled
local-company backend intentionally disables the vendor dashboard. The single SQLite server
can host one online company; multi-company production needs MySQL/MariaDB and safe provisioning
privileges. `ERP_LICENSE_BYPASS=development` is development-only and ignored by packaged builds.

## New-company setup guide

After creating a local or online company, sign in with its ERP administrator account. The
**Getting started / دليل بدء العمل** guide opens automatically for a new company. License
activation and authentication still happen first. It walks through six steps:

1. **Company details:** review the name and enter contact/address information for documents.
2. **Locations and team:** review the seeded branch/warehouse; add staff, technicians and van
   warehouses when needed.
3. **Finance and tax:** review the current open fiscal year, company-currency cash/bank account,
   VAT and stock costing. Use the existing opening-balance screens for approved balances only.
4. **Products and stock:** create an active stock item with units, or import the real catalogue.
   Enter actual opening stock only if applicable; starting with zero stock is supported.
5. **Maintenance schedules:** configure real filter stages and replacement intervals. This may
   be explicitly deferred; reminders require profiles, customer filters and confirmed installation.
6. **Customers and filters:** add/import customers; their form can record a related filter.
   Import known installation/replacement history separately. This may be deferred for a new
   business without existing customers. Unknown dates must remain unfilled for review.

The first four steps require a review and usable data. Green checks reflect current records;
seeded defaults are not treated as the owner's review. The final screen identifies deferred
steps and links to backups, the first invoice and service requests. Finishing the guide creates
no stock movements, accounting entries, payments or sample customers.

**Finish later / أكمل لاحقاً** pauses the guide. Resume through **Settings → Getting started**;
while an active guide is open, a return banner follows you to linked forms. Progress is stored
in that company's database, so connected devices share it; independent local databases do not.
Completion stops the automatic prompt. Revisit from Settings to finish deferred setup.
Existing companies without guide progress are not prompted automatically. Backup imports retain
saved progress and existing ERP users. Access requires company-settings permission.

## Company data and accounting

Server companies use a registry and separate databases selected by `X-Company`; local SQLite
companies are independent databases, not offline copies of server companies. Never replace a
shared server database with a local file to simulate synchronization.

Posting is atomic across domain records, stock and journals. Sales issue stock at invoice
posting; visit parts issue at completion and later linked invoices record revenue without
issuing those parts again. Posted documents and evidence remain immutable. Refunds, physical
returns and replacement-history corrections are distinct actions. Respect fiscal locks.

| Transaction | Accounting effect |
|---|---|
| Sales invoice | Receivable/revenue/VAT, plus inventory to cost of sales |
| Sales return | Reverse revenue/tax/receivable; explicit physical stock return at original cost |
| Goods receipt | Inventory against goods received not invoiced |
| Purchase invoice from receipt | Clear receipt accrual; tax/payable and price variance |
| Visit completion | Actual parts inventory to cost of sales; linked later invoice does not repeat cost |
| Receipt/payment | Cash/bank against party allocation or approved account |

## Finding service records and exporting queues

Use the search bar in customer filters, requests, visits and maintenance queues. Search accepts
household names/phones, unit codes, serials and models; requests/visits also accept their number
or description. Status, due-period, customer and follow-up owner filters combine. The owner
filter can show your assignments or unassigned follow-ups. Clear filters to restore the queue.
Technicians continue to see only assigned work. Company administrators can enable custom list,
filter and search fields through Form Studio; service queues honor field read permissions.

Request and installed-filter pickers search the server and show result counts. **Load more**
fetches another page. Arrow Down at the last option also loads the next page; Enter selects it.
If a later page fails, retry without losing the visible choices. Choosing an installed filter
in a service request selects that filter's address. Check it before saving. Sold-filter registration
on a posted sales invoice uses server totals across all linked units; its count is not limited
to a displayed page. Serialized filters keep a direct link to their existing customer unit.

**Export results** saves all matching pages, not just the displayed page. Exports use the
filters selected when started; progress and Cancel export appear during preparation. A failed
or inconsistent read produces an error and no partial file. If data changes while paging,
refresh and retry. These are live reads, not a locked database snapshot. For more than 100,000
rows, narrow the date/customer/status filters. Operational exports include no stock costs;
visit appointment timestamps are explicitly labeled UTC. CSV uses UTF-8/BOM for Arabic Excel
and escapes formula-like text. Printed service reports remain separate from queue CSV export.

## Automation and health

The shared server runs `schedule:work`. Its schedule scans maintenance and stock alerts every
15 minutes, performs company backups at 02:00 Cairo and prunes expired device nonces. Select
a company before polling its database jobs. Do not deserialize one tenant's jobs under another
connection. Monitor last scan, failed/pending jobs, backup age and provisioning failures.
Local automation can operate only while the desktop/company is open; after downtime it must
catch up instead of generating duplicate follow-ups. Desktop sleep/resume and network loss
must not queue financial postings silently.

## Backup and restore

- Company bundle: `php artisan erp:backup --bundle --company=SLUG`. Omit company selection for
  a single local database. `erp:backup-all` covers registered server companies, not the issuer.
- Restore: stop HTTP, workers and scheduler for the target; run
  `php artisan erp:restore /protected/company.zip --company=SLUG --confirm`. Verify balances,
  serial locations and attachments before reopening service. Keep the safety backup.
- Protect the issuer control database, original APP_KEY, signing keys and company registry
  separately as one recovery set. Use consistent snapshots, encryption and off-host copies.
  Restore the original issuer identity so existing certificates still verify.
- Keep backups outside active app data and installer folders. Document retention, responsible
  operator and recovery objectives; rehearse on an isolated target.

No automatic company reset belongs in installation, activation or migration. A prior reset on
26 October 2026 is historical, not the current data state. Its recovery copy remains outside
active directories at `../manzoma-erp-reset-backups/20261026-153116`. The later coordinated
slot repair preserved the actual company; ordinary release rules still apply. A new explicit
local fresh-start reset was completed on 3 November 2026, preserving the vendor operator and
issuer identity. Its private recovery copy is at
`../manzoma-erp-reset-backups/20261103-140038-fresh-start/`. Active local company/license/device
records were cleared; see the [README fresh-start steps](../README.md#fresh-start-test-reset--3-november-2026).

## Issuer recovery and capacity repair

- `erp:control-reconcile` reports proven company-name/registration-state mismatches. Review the
  JSON before `erp:control-reconcile --apply`. Neither mode releases allocations or deletes
  company databases. Successful offline company creation reaches the authority on reconnection;
  the desktop license screen shows pending confirmations and its last successful confirmation.
- `erp:health --all --json` checks company schema, stale scans/queues/backups and issuer backup
  configuration. `--ready` omits freshness alerts for startup checks. Docker now supervises
  workers through `erp:queue-supervise`; it discovers new registered tenants every ten seconds
  and starts a separate process for each. `--once` is available for an isolated operational check.
- `erp:control-backup --to=/protected/issuer-backups --keep=14` encrypts the control DB, APP_KEY,
  original signing pair, optional legacy public keys and registry as a recovery set. Configure
  `ERP_CONTROL_BACKUP_PASSWORD` with at least 16 characters through the server's protected
  environment. Keep that password separately from the archives. No password is passed on the
  command line or printed. Enable the 03:00 Cairo schedule with `ERP_CONTROL_BACKUP_ENABLED=true`.
- `erp:control-restore /protected/issuer.mzb --to=/protected/new-recovery-directory` decrypts,
  verifies hashes and the signing pair, then stages files in a new protected directory. It
  refuses an existing destination and does not overwrite a running issuer. Wrong passwords,
  tampered archives and unsafe ZIP entries fail before installation.
- To complete issuer recovery, stop authority HTTP/queues/scheduler, preserve the current
  recovery set, restore the staged control DB (SQLite file or MySQL SQL dump), registry, key
  pair and original APP_KEY to their configured locations, then run control migrations and
  health checks before reopening. Reconcile grants issued after the backup's recovery point
  against outstanding signed certificates before issuing capacity again. An older database
  snapshot does not revoke certificates that disconnected devices still hold.
- Company-data recovery is separate: restore its database/evidence ZIP under the selected
  company using `erp:restore --confirm`. A physical return, credit and schedule correction
  remain separate business decisions.

Configure off-host copying, protected mounts, recovery objectives and retention with the server
operator. A local encrypted archive alone does not constitute an off-host disaster recovery plan.
Never put recovery passwords in a shared plan, source control, an installer or a support report.

## Service corrections and history migration

Completed visits retain their original report, parts and completion information. The **Corrections
and review history** section permits an authorized report addendum. An unbilled visit may reverse
all consumption only when staff explicitly confirm physical return and stage-history restoration.
A later replacement or closed fiscal period blocks that reversal. Retried correction keys are
idempotent. Billed visits direct staff to the invoice's return/credit workflow to prevent a second
restocking. Original evidence and the correcting actor/reason/date remain visible.

**Settings → Import data → Customer filters and history** accepts UTF-8 CSV. Map existing
customer/product codes and profile name/version; supply a stable unit code. Optional `stage.KEY`
columns contain actual last replacement dates. Unknown installation dates remain pending review;
known stage dates without a known installation date require manual review rather than inventing
an installation date. Validate first, then import. Identical rows skip on retry; different history
for an existing code is rejected. This flow never creates warehouse movements or opening balances.
Basic party/product CSV imports also support column mapping. XLSX is not required for this release.

Maintenance settings control the pre-due and overdue offsets and default owners. Existing follow-ups
can be reassigned with their linked task. Reports filter contribution by business period, technician
and warehouse; contribution after parts excludes labor/travel. Completion stores the actual UTC
action time separately from the Cairo work date; old synthetic noon timestamps remain flagged as
historical approximations, not invented real times.

## Signing-key and device lifecycle

1. Preserve the current issuer identity. Prepare a new signed desktop release with the next
   primary public key and the previous public key(s) in `desktop/resources/license-legacy-public-keys.json`.
   This is a bounded JSON array of PUBLIC keys, never private keys or keys downloaded from a certificate.
2. Verify an old, unexpired device certificate still opens offline in the new build. Roll out
   compatible online clients before changing the issuer's active signing pair. Keep APP_KEY unchanged.
3. Back up and pause issuance; install the matching new signing pair through protected operations.
   Set `ERP_LICENSE_LEGACY_PUBLIC_KEYS` for backends that must verify older grants. Resume issuance
   after signature, renewal and expiry checks. Keep old public trust through the last valid expiry.
4. An old desktop trusting only the old key needs an upgrade before it can accept certificates
   signed by the new key. Automatic desktop updates remain a separate feature.
5. For a lost/replaced computer, revoke its online access. Its existing offline reservation remains
   occupied through its signed expiry. Activate a replacement only within the shared device/company
   capacity or an explicitly changed license; do not delete reservations to bypass limits.

Device identity, remembered tokens, company keys and drafts use asynchronous OS encryption. Old
company keys are re-encrypted with the same plaintext key; an unreadable existing key is an error,
never a reason to generate a replacement. Passwords/tokens are excluded from recoverable form drafts.
**Settings → About → Save sanitized support report** exports versions, license capacity status and
scan health only, excluding keys, credentials, customer records and raw logs.

## Reproducible verification and release configuration

- Desktop URL defaults are selected by Vite mode: `desktop/.env.development` for development,
  `desktop/.env.production` for builds, using `ERP_SERVER_URL` and optional
  `ERP_LICENSE_SERVER_URL`. Example files and deployment steps are in the
  [README](../README.md#development-and-production-server-urls). The uploaded backend separately
  needs its own `APP_URL` / `ERP_LICENSE_ISSUER`, production environment and debug disabled.
  Changing defaults does not migrate saved profiles or signed issuer claims.
- Technical failures now become readable Arabic/English messages at desktop/API boundaries.
  Keep logs private for support. Company bootstrap cache fingerprints invalidate stale
  development providers on a backend change; never delete company databases to fix a cache issue.

- `npm run verify:translations` checks the shared Arabic catalogue, renderer labels and permission
  labels. All new controls use Arabic/English text; technical codes and user-entered record names
  are not translated automatically. The control panel supports `?lang=ar|en` and a persisted
  language choice in its operator menu.
- `npm run verify:onboarding` delegates to packaged acceptance after building installers. It
  reads the existing issuer key only on an isolated test server and uses separate
  online/main/LAN device profiles to exercise activation,
  single-company binding, shared TLS reads/writes and offline restart through the UI/IPC/API chain. A native OS keychain is required. Its
  temporary evidence contains fixture secrets: retain privately or remove after review.
- `.github/workflows/verify.yml` runs SQLite and isolated MySQL tests, including licensing concurrency
  and provisioning. The test database prefix guard remains enforced. The UI fixture runs under Xvfb.
- `.github/workflows/release.yml` is a manual installer build matrix. Configure the production
  `ERP_ISSUER_PUBLIC_KEY` repository variable, Windows/macOS signing secrets and Apple notarization
  credentials before running it. Private signing identities stay in CI secrets. It refuses missing
  trust/signing configuration and checks staged content and installer SHA-256 sums. Nothing is
  automatically published or installed.
- Windows/Linux clean installs, macOS signing/notarization and actual A4/thermal/label printers
  still require their supported hardware/credentials. Run the operating pilot with real catalogue,
  staff and accountant-approved balances before rollout.
- Historical builds earlier on 3 November passed the previous multi-company-per-device flow.
  The current single-company policy supersedes those counts: packaged acceptance now uses
  separate online/main/LAN profiles and verifies offline TLS sharing against the same database. Native Windows and
  Apple Silicon execution remain pending. Test Mac apps are ad-hoc signed; Windows is unsigned.
  See [README](../README.md#build-windows-exe-and-macos-dmgs) for build commands, timeout recovery,
  checksums, isolated packaged verification and the manual install checklist. Production URL
  selection and release signing remain outstanding; no normal company data was reset.

## Applying this update

The default development backend received the two additive 27 October migrations after a
verified company/evidence backup; it contained no installed ERP company. No install/reset,
issuer-grant repair or business-data deletion was run. Existing desktop company files retain
their original keys and upgrade when next opened. Restart the desktop after saving current
work to load the new renderer; the running app was not forcibly closed.

The pre-upgrade backup is
`backend/storage/backups/backup-20261027-101604-090374-f67ec7.sqlite.zip`.
It is a private recovery artifact, not a distributable file. Issuer backup scheduling remains
opt-in until its protected password and off-host destination are configured.

Packaging now creates clean cache directories before dependency discovery and excludes all
source `storage` contents, including sessions, attachments, company/issuer backups and registry.
The development desktop public-key file was populated from the existing configured issuer's
public key; neither the signing pair nor existing company keys were regenerated. Production
release trust/signing credentials still require explicit configuration.

A packaging preflight is available after `npm run prepare:backend` with
`node scripts/verify-distribution.mjs --staged-only`; the default command still requires actual
installer artifacts and generates their checksums. Keep routine testing scoped to changed
behavior; broaden it for shared accounting, licensing or migration changes.
