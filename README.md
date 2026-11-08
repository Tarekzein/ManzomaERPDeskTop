# ManzomaERP Desktop

Arabic/English ERP focused on household water-filter sales, installation and maintenance in Egypt.
It uses Laravel 13, React 19, Vite 8 and Electron 45, with a separate Filament license-control panel.

The daily workflow connects customers and service locations, filter units/stage schedules, staff
follow-ups, technician/van visits, actual stock consumption, invoices and customer collections.
Existing inventory, purchasing, accounting, treasury, CRM and reporting remain in their normal
permission-controlled menus. The interface uses ink navy, muted sapphire and warm pearl, with coordinated dark mode.
Arabic uses bundled Cairo and RTL; invoices, thermal receipts,
service reports and unit QR labels print without online font dependencies.

- [Current plan and delivery status](docs/water-filter-adaptation-plan.md)
- [Setup, licensing, operations and recovery](docs/operations-guide.md)
- [Optional spare parts and initial stock — English / العربية](docs/spare-parts.md)

## Structure

```
backend/   Laravel API: Core, Parties, CRM, Inventory, Trading, Finance, Reports, Service
           Separate vendor Control models, migrations and Filament dashboard
desktop/   Electron main/preload, React renderer, printing, local PHP/SQLite and OS keychain
deploy/    MySQL/Docker shared server, scheduler and tenant worker supervisor
docs/      Plans, operating guide and bilingual feature instructions
.github/   Regression and manually triggered installer workflows
```

Shared-server companies use separate databases; standalone local companies are independent SQLite
companies. Server disconnection preserves drafts but does not silently queue financial postings or
synchronize a local database with the server.

## Fresh development setup

Requirements: PHP 8.3+ with PDO SQLite/MySQL, mbstring, bcmath, intl and ZIP; Composer; Node 22+.
Use MySQL/MariaDB for a server hosting multiple companies. The desktop needs a supported OS keychain.

For a fresh checkout, install backend dependencies, create `.env` from `.env.example`, generate
APP_KEY once and ensure `database/database.sqlite` exists. Existing installations retain their
original APP_KEY, signing pair and company data.

Configure `ERP_CONTROL_ENABLED=true`, `ERP_LICENSE_ENFORCE=true`, matching `APP_URL` and
`ERP_LICENSE_ISSUER`, then:

```bash
cd backend
composer install
php artisan erp:control-install --email=owner@example.com
php artisan serve
```

Open `/control` on that server, sign in with the vendor operator account and issue a license key.
Copy only its PUBLIC signing key to `desktop/resources/license-public-key.pem` before starting or
packaging a fresh desktop build. See the operating guide for production HTTPS, backup configuration
and planned key rollover; do not replace existing trust anchors casually.

```bash
cd desktop
npm ci
npm run dev
```

Paste the activation key while connected, then register an online company or create/import a
local company and sign in with that company's ERP credentials. The vendor account and ERP users
are separate. Activation registers the device without reserving company capacity. Each device then creates or
joins **one company**. Several devices sharing that company consume one company allocation.
Local/LAN devices work through their signed expiry without mandatory check-in. Development bypass is explicit:
`ERP_LICENSE_BYPASS=development`; packaged builds always enforce licensing.

Local company upgrades run automatically when opened. For shared servers, back up first and run
control migrations and company upgrades as described in the operating guide. Never reset data as
part of activation, an upgrade or verification.

## Fresh-start test reset — 3 November 2026

The active **local development** data was reset at your request. Old licenses, device/company
allocations, desktop activation/configuration, five leftover local company databases, drafts,
attachments, sessions and business data were cleared. The server company schema is empty and
ready for desktop registration. The **Filament operator login**, backend APP_KEY, environment,
issuer signing pair and installer public trust were preserved. Sign in to `/control` with your
existing operator credentials; previous activation keys no longer correspond to a license in
this reset authority.

A private pre-reset recovery copy is outside active data at
`../manzoma-erp-reset-backups/20261103-140038-fresh-start/`. It contains sensitive records/keys;
do not upload or distribute it. This was an explicit local reset, not installation behavior
and not a reset of another computer or any deployed production server.

To test from the beginning:

1. Start `cd backend && php artisan serve --host=127.0.0.1 --port=8000` if it is not running.
2. Open `/control`, sign in and issue a **new** license with a future expiry. For the local/LAN
   scenario use **1 company** and the number of actual devices you need.
3. Launch the latest desktop build and paste the key. Verify that no company is accessible
   before activation, and activation alone creates no company allocation.
4. On the main device create/import the company and follow Getting started. Pair staff devices
   with that same company as described below. Confirm they show one shared company allocation.
5. For a separate online test, use another unassigned device/profile and a separate test company
   license, or perform a coordinated test reset again. A device already assigned to a local
   company cannot also create an online company. Never delete only a desktop folder to free
   license seats: offline grants and server allocations must be handled together.

Automated acceptance uses isolated issuers/profiles, leaving this fresh state untouched. Do not
restore the recovery copy or import old data unless that is the specific flow you want to test.

## Checks and builds

```bash
cd backend
vendor/bin/phpunit

cd ../desktop
npm run verify:translations
npm run typecheck
npm test
npm run build
npm run verify:ui
```

After building a matching installer, `npm run verify:onboarding` runs the same packaged flow
as `verify:installed` (an explicit app path is optional).

The UI fixture verifies Arabic/English, Cairo PDFs, button contrast, responsive forms, focus,
payment review and license gates. Native onboarding uses an isolated issuer and separate single-company device profiles;
it requires a real OS keychain and does not modify the normal application's companies. MySQL
concurrency/provisioning tests require explicitly named disposable databases.

## Build Windows EXE and macOS DMGs

**One installer supports both online and offline companies.** There are no separate online/offline
binaries. The issued license controls the permitted modes, companies, devices and expiry.

### Development and production server URLs

Copy `desktop/.env.development.example` to `desktop/.env.development` and
`desktop/.env.production.example` to `desktop/.env.production`. These local files are ignored
by source control. Set the public URLs in each file:

```dotenv
ERP_SERVER_URL=https://erp.your-domain.com
# Optional; defaults to ERP_SERVER_URL when empty.
ERP_LICENSE_SERVER_URL=https://erp.your-domain.com
```

| Command | Defaults loaded |
|---|---|
| `npm run dev` / `npm run renderer:dev` | `.env.development`; defaults to `http://127.0.0.1:8000` |
| `npm run build` / `npm run dist:win` / `npm run dist:mac` | `.env.production`; no localhost default |

Leave production URLs blank until the domain is ready: activation keys still carry their own
issuer address. `--test` changes signing only; it still uses production URL settings. Restart
development or rebuild installers after changing these files. Shell/CI environment values take
precedence; configure optional `ERP_SERVER_URL` and `ERP_LICENSE_SERVER_URL` repository variables
for the release workflow. Only these public defaults are embedded, never backend credentials.
Online-company APIs currently share the license issuer's base URL; a distinct license URL is
useful for offline-only installations, not for splitting those online APIs across servers.

For the uploaded backend, set its own `.env` to `APP_ENV=production`, `APP_DEBUG=false`,
`APP_URL=https://erp.your-domain.com` and `ERP_LICENSE_ISSUER=https://erp.your-domain.com`.
After editing, run `php artisan config:clear` and restart long-running workers. Local backend
development uses the loopback URL instead. Serve Laravel's **public/** directory, preserve its
APP_KEY/issuer signing keys/control database, and follow the operating guide for database,
permissions and `/control` setup. The desktop `.env` files do not configure the uploaded server.

Existing server profiles and signed license issuer addresses are retained when build defaults
change. Edit an existing profile or issue/reactivate with a key for the new issuer URL after a
server move; URL defaults never redirect a verified license silently. Local company databases
continue using their isolated automatically selected loopback ports.

### Create installers

Build requirements are Node 22+, Composer and PHP 8.3+ with the extensions listed above. Install
Xcode Command Line Tools on a Mac (`xcode-select --install`). Build macOS DMGs on macOS. Windows
x64 NSIS can also be built from this Mac; native Windows builds are supported through the same
script and the release workflow. Clients do **not** install PHP, Node or Composer: the installer
includes the production Laravel backend, target-specific PHP, renderer and fonts.

First configure the issuer as described in Fresh development setup. Ensure
`desktop/resources/license-public-key.pem` contains that issuer's **public** key. Never put its
private key, `.env`, control database or company backups in application resources.

From a Mac, build all three test installers:

```bash
cd desktop
npm ci
npm run typecheck
npm run dist:all -- --test
```

Or build one platform:

```bash
npm run dist:win -- --test
npm run dist:mac -- --test
```

On Windows, open PowerShell in `desktop`, run `npm ci`, then `npm run dist:win -- --test`.
The macOS command builds both CPU architectures. Choose the matching file in `desktop/dist/`:

| File | Target |
|---|---|
| `ManzomaERP-Setup-1.0.0.exe` | Windows x64 NSIS installer |
| `ManzomaERP-1.0.0-x64.dmg` | Intel Mac |
| `ManzomaERP-1.0.0-arm64.dmg` | Apple Silicon Mac |
| `SHA256SUMS` | SHA-256 checksums for the installers |

Names follow the version in `desktop/package.json`. The directories `win-unpacked`, `mac` and
`mac-arm64` expose unpacked build outputs (Mac paths link to a temporary signing workspace); distribute the EXE/DMG files instead. A `.blockmap` file
is build metadata, not another installer. Verify checksums with `shasum -a 256` on macOS or
`Get-FileHash .\ManzomaERP-Setup-1.0.0.exe -Algorithm SHA256` in PowerShell.

`--test` disables distribution identity discovery; Mac apps use ad-hoc signing without
notarization. Windows test installers are unsigned. They are for your own testing and can
trigger Gatekeeper/SmartScreen prompts. Do not label them as signed public releases. Production
release builds omit `--test` and require Windows signing or Apple Developer ID/notarization
credentials. `.github/workflows/release.yml` validates these prerequisites before building.
Test DMGs use macOS `hdiutil`, avoiding another DMG-tool download; signed release builds retain
the standard electron-builder DMG/notarization pipeline.

The packaging script stages production dependencies, validates runtime CPU/format and native
PHP requirements, checks SQLite PDO operation, and refuses a bundle missing PHP, backend or
public trust. macOS/Linux use the upstream `bulk` PHP build: the smaller `common` build lacks
`intl`. SQLite is checked through a real PDO database, including builds that register it through
Swoole. See [StaticPHP's build variants](https://github.com/crazywhalecc/static-php-cli#direct-download).

### Readable errors and startup cache recovery

Application errors display Arabic or English according to the selected language. PHP class/file
errors, SQL diagnostics, stack traces and proxy HTML are replaced with a recovery message;
technical desktop details remain in private logs. Normal validation messages remain attached to
their fields. Shared API failures are sanitized even if a development server enables debug mode.

When a company was previously opened from development or an older installation, the app checks
the backend/dependency fingerprint and rebuilds its generated bootstrap caches. This prevents a
stale `Laravel\\Pail\\PailServiceProvider` reference from blocking a production app. It removes
only generated Laravel caches, preserving company records, activation, keys and backups.

### Recover from NSIS `ETIMEDOUT`

Rerun the same command. The wrapper retries transient network failures up to three times and
retains valid Electron/NSIS/PHP caches. No company or license data is removed. The first build
needs access to GitHub release downloads and `dl.static-php.dev`; an interrupted dependency
download does not mean the application source failed to compile.

Do not delete every cache or disable TLS/checksums. Check your connection, proxy or firewall if
all retries fail. PHP downloads are installed atomically, so a failed replacement retains a
working runtime. `FORCE=1` can deliberately refresh a PHP download; `PHP_VERSION` / `ERP_PHP_URL`
are explicit overrides for a compatible runtime. Cross-target runtime resources use the target
OS, not the host `${platform}` macro, which previously omitted PHP from Windows-on-Mac builds.

A macOS `resource fork, Finder information ... not allowed` signing error is handled by removing
extended attributes only from the generated app bundle and signing outside File Provider-backed
Documents folders before copying the final DMGs into `dist`, following
[Apple QA1940](https://developer.apple.com/library/archive/qa/qa1940/_index.html). User company
folders and original source assets are not cleaned by this hook.

## Try the installed online and offline modes

### 1. Start the issuer/server and issue a test key

For testing on the **same computer**, start the configured backend:

```bash
cd backend
php artisan serve --host=127.0.0.1 --port=8000
```

Use matching `APP_URL=http://127.0.0.1:8000` and `ERP_LICENSE_ISSUER=http://127.0.0.1:8000` in
that test server's `.env`, with `ERP_CONTROL_ENABLED=true` and `ERP_LICENSE_ENFORCE=true`.
Open `http://127.0.0.1:8000/control` and sign in with the vendor operator account. On a fresh
issuer, provision it first with `php artisan erp:control-install --email=owner@example.com`.
Preserve the existing signing pair and APP_KEY on an established issuer.

Issue a **hybrid** license with a future expiry and copy its full `MZ1...` activation key.
For **one company shared by a main computer and two staff computers**, allow **1 company and
3 devices**. Choose either online hosting or local/LAN hosting for that company. Each device
can use only one company, and joining the existing company never consumes another company slot.
Activation alone creates no company reservation.

Installed builds accept HTTP only for `127.0.0.1`, `localhost` or `::1`; remote servers require
HTTPS. **127.0.0.1 always means the computer running the app.** A Windows PC cannot reach the
Mac's server using the Mac's localhost address. For activating different computers, use a reachable
HTTPS issuer; the production domain can be decided later. Encrypted local-network sharing uses
the main computer pairing code and does not require a public domain after initial activation.

The server URL is carried in the activation key. Choosing a new URL later does not require a
new installer if the issuer's public key stays the same. Issue a new activation key using the
correct URL and preserve the issuer database/key pair when moving that server.

### 2. Install and activate

- Mac: open the DMG, drag **ManzomaERP Desktop** to Applications, eject the DMG and launch the app.
- Windows: run the EXE and complete the NSIS installer. Launch it from the shortcut.
- Paste the copied activation key while the issuer is reachable. Company/login access remains
  locked until the signed device activation succeeds. No packaged development bypass is used.

### 3. Try an online company

Choose **Register an online company**, enter company/administrator details, sign in and follow
the setup guide. On the second device, connect to the same server and select the existing
company rather than registering it again. Data lives on the shared server. Both devices need
connectivity to that server; losing it must not silently queue financial postings.

### 4. Try a local/offline company

Use a device that is not already assigned to an online company. While connected to the issuer,
choose **New company on this PC** (or import one backup), enter its administrator, sign in and
complete the setup guide. This is the company’s main computer.
Enter a real test item/customer and save. Close the app, disconnect the issuer/internet and
reopen the local company. The saved data and license should remain usable until signed expiry.
The bundled PHP/SQLite runs locally; the server does not need to be running for existing local
companies. Initial activation and company creation/joining need the issuer; another company
cannot be created on an already assigned device.

### 5. Connect staff computers over the LAN without internet

1. On the main computer, open the local company as its administrator. Go to **Settings → This
   computer → Share this company on the local network**.
2. Enable sharing (default HTTPS port **9443**), select its private-network address and generate
   a pairing code. Reserve that address in the router; allow the port for the private network
   in the host firewall. Do not expose it through public port forwarding.
3. On each staff computer, activate the **same license** while the issuer is reachable. Choose
   **Connect to the main computer**, paste its code and sign in using a user created in that
   company. Do not create/import another local company on staff computers.
4. After pairing, disconnect internet/issuer access while retaining Wi-Fi/Ethernet. Staff can
   read and save into the **main computer’s same database**, using their ERP roles. No database
   is copied or synchronized to their devices. Keep the main computer on, with its company open.
5. Reopen a paired client while disconnected: it uses its cached signed grant until expiry.
   Closing the main company, switching off the host or losing the LAN stops client access;
   drafts remain recoverable and transactions are not silently queued.

The gateway uses TLS with a per-host certificate pinned by a signed pairing invitation. Each
request also proves the client’s issuer-signed, single-company device grant and is replay checked;
ERP login/permissions still apply. Initial pairing requires the issuer. A new pairing code can
update the **same company’s** address while already paired and offline. Revocations are learned
when a device refreshes its license; disconnected grants remain valid until expiry. New devices do not consume new
company capacity. A failed creation can retry the same reserved company; it cannot allocate
another company on that device. Online companies similarly accept multiple separately activated
devices bound to that one shared server company.

Local companies are independent databases, **not synchronized copies** of the online company.
Backup import preserves company records and ERP users; it is not an online/offline sync operation.
For upgrades, close the app and install the new application over the old one and keep the existing app-data folder;
never delete company folders to fix an installer/network error.

### Isolated automated acceptance of the actual packaged app

A GUI session and a working OS keychain are required. The checkout's configured issuer private
key must match the app's public key; it is read only by an isolated test issuer, never copied
into the client or installer. The helper uses temporary server databases and an explicit
`--user-data-dir`, so it does not open or reset normal company data.

```bash
cd desktop
npm run verify:installed -- "dist/mac/ManzomaERP Desktop.app"
```

On Apple Silicon use `dist/mac-arm64/ManzomaERP Desktop.app`. On Windows run the helper on that
Windows machine, passing the installed EXE or `dist/win-unpacked/ManzomaERP Desktop.exe` (not the
NSIS installer). The helper requires host PHP only to run its isolated issuer; the client uses
its bundled PHP/backend. It exercises packaged activation, online registration/login, local
creation/product save, local automation, an offline process restart and reconnection confirmation.
It uses separate online/main/LAN device profiles, checks shared TLS read/write and second-company
denial, then verifies company/device counts. It also verifies Arabic/English connection-error rendering
and offline restart after deliberately introducing stale development provider caches.
Evidence remains in a private temporary directory. The helper opens a temporary loopback
DevTools port for automation and closes the test app when finished; ordinary launches do not.

For an extra manual clean profile, launch with an **absolute** path:

```bash
open -na "/Applications/ManzomaERP Desktop.app" --args --user-data-dir="/tmp/manzoma-manual-test"
```

In PowerShell: `& "C:\path\to\ManzomaERP Desktop.exe" --user-data-dir="C:\Manzoma-Manual-Test"`.
Omit the switch for normal use; the default company-data location remains unchanged. A separate
profile has separate activation state and may consume another device seat with your real issuer.
The automated helper uses an isolated issuer, so its test allocations do not consume real seats.

### Build/acceptance record — 3 November 2026

| Artifact/check | Result |
|---|---|
| Windows x64 EXE | NSIS installer built successfully; bundled Windows PHP and production resources checked. Native Windows installation/runtime acceptance remains pending. |
| Intel Mac DMG | Built; disk-image integrity, mounted app signature and payload hashes checked. Packaged Intel app passed the workflow below. |
| Apple Silicon DMG | Built; ARM64 binaries, disk-image integrity, mounted app signature and payload hashes checked. Native Apple Silicon runtime acceptance remains pending. |
| Packaged Intel workflow | Separate online/main/LAN profiles: activation, online registration/login, AR/EN errors, main-company setup and saved product, offline restart/cache recovery, second-company denial, pinned TLS pairing and shared database read/write while the issuer was disconnected. Exactly **2 companies across 3 isolated device profiles**: the LAN client consumed no extra company. These simulate clients on one Intel Mac; physical multi-computer acceptance remains pending. |
| Focused source checks | Typecheck, translation guard (280 shared Arabic messages), 28 focused desktop tests and the updated backend licensing suite (**30 passed, 2 MySQL-only checks skipped; 195 assertions**) passed. Earlier backend friendly-error localization check passed (6 assertions). Vite configuration loading confirmed matching main/renderer dev/build defaults and an explicit production URL override. |

All three installers and `SHA256SUMS` are in `desktop/dist/`. Both DMGs are ad-hoc signed test
builds; the Windows EXE is unsigned. The automated workflow launched the packaged Intel app;
it did not exercise a manual drag-install or the Windows installer wizard. Signed/notarized
public releases, native Windows/Apple Silicon execution and physical-printer acceptance remain
separate release checks. The production server URL is deferred; same-computer loopback testing
works now. Build checks used isolated data. Issuer keys remain unchanged; the separately requested
local data reset is recorded above.
