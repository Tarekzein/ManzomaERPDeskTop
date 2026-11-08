<?php

namespace Tests\Feature;

use App\Control\Http\EnforceLicense;
use App\Control\Models\ControlAdmin;
use App\Control\Models\License;
use App\Control\Models\LicensedCompany;
use App\Control\Models\LicensedDevice;
use App\Control\Models\LicenseEvent;
use App\Control\Resources\Pages\ManageLicenses;
use App\Control\Services\CompanyReconciliation;
use App\Control\Services\CompanyRegistrationService;
use App\Control\Services\ControlBackupService;
use App\Control\Services\LicenseService;
use App\Control\Services\LicenseSigner;
use App\Models\User;
use App\Modules\Core\Services\SettingsService;
use Filament\Actions\Testing\TestAction;
use Filament\Facades\Filament;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Livewire\Livewire;
use Spatie\Permission\PermissionRegistrar;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class LicensingTest extends TestCase
{
    private string $keydir;

    private static array $pairs = [];

    public function createApplication()
    {
        putenv('ERP_CONTROL_ENABLED=true');
        $_ENV['ERP_CONTROL_ENABLED'] = $_SERVER['ERP_CONTROL_ENABLED'] = 'true';

        return parent::createApplication();
    }

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.connections.control.database' => ':memory:', 'database.connections.control.driver' => 'sqlite', 'licensing.issuer' => 'https://erp.test', 'licensing.enforce' => false, 'session.driver' => 'array', 'erp.multi_company' => false]);
        if (getenv('CONTROL_TEST_MYSQL') === 'true') {
            $database = getenv('CONTROL_TEST_DATABASE');
            if (! str_starts_with((string) $database, 'erp_license_verification_')) {
                throw new \RuntimeException('Refusing an unsafe test control database name.');
            }
            config(['database.connections.control' => config('database.connections.mysql')]);
            config(['database.connections.control.database' => $database]);
        }
        DB::purge('control');
        Artisan::call('migrate:fresh', ['--database' => 'control', '--path' => 'database/control', '--force' => true]);
        $this->keydir = sys_get_temp_dir().'/manzoma-license-test-'.bin2hex(random_bytes(8));
        mkdir($this->keydir, 0700);
        $pair = $this->pair(0);
        file_put_contents($this->keydir.'/private.pem', $pair['private']);
        file_put_contents($this->keydir.'/public.pem', $pair['public']);
        config(['licensing.private_key' => $this->keydir.'/private.pem', 'licensing.public_key' => $this->keydir.'/public.pem']);
        Route::get('/api/licensed-probe', fn () => response()->json(['ok' => true]))->middleware(EnforceLicense::class);
    }

    protected function tearDown(): void
    {
        DB::purge('control');
        foreach (glob($this->keydir.'/*') as $file) {
            unlink($file);
        }
        if (is_file($this->keydir.'/.signing-key.lock')) {
            unlink($this->keydir.'/.signing-key.lock');
        }
        rmdir($this->keydir);
        putenv('ERP_CONTROL_ENABLED');
        unset($_ENV['ERP_CONTROL_ENABLED'],$_SERVER['ERP_CONTROL_ENABLED']);
        parent::tearDown();
    }

    private function pair(int $n): array
    {
        if (! isset(self::$pairs[$n])) {
            $key = openssl_pkey_new(['private_key_bits' => 2048]);
            openssl_pkey_export($key, $private);
            self::$pairs[$n] = ['private' => $private, 'public' => openssl_pkey_get_details($key)['key']];
        }

        return self::$pairs[$n];
    }

    private function device(int $n = 1, array $existing = []): array
    {
        $pair = $this->pair($n);
        $id = hash('sha256', $pair['public']);
        $machine = hash('sha256', 'machine-'.$n);
        openssl_sign(implode("\n", ['manzoma-device-v1', $id, $machine]), $sig, $pair['private'], OPENSSL_ALGO_SHA256);

        return ['device_id' => $id, 'public_key' => $pair['public'], 'machine_hash' => $machine, 'name' => 'Device '.$n, 'proof' => LicenseSigner::encode($sig), 'existing_companies' => $existing];
    }

    private function data(array $extra = []): array
    {
        return $extra + ['customer_name' => 'Filter company', 'mode' => 'hybrid', 'status' => 'active', 'max_companies' => 2, 'max_devices' => 2, 'expires_at' => now()->addYear()->toIso8601String()];
    }

    private function license(array $extra = []): License
    {
        return app(LicenseService::class)->save($this->data($extra));
    }

    private function headers(int $n, string $path = '/api/licensed-probe', string $company = '', ?int $timestamp = null, string $method = 'GET'): array
    {
        $id = $this->device($n)['device_id'];
        $time = (string) ($timestamp ?? now()->timestamp);
        $nonce = bin2hex(random_bytes(24));
        openssl_sign(implode("\n", ['manzoma-api-v1', $id, $time, $nonce, $method, $path, $company]), $sig, $this->pair($n)['private'], OPENSSL_ALGO_SHA256);

        return ['X-Device-Id' => $id, 'X-Device-Time' => $time, 'X-Device-Nonce' => $nonce, 'X-Device-Signature' => LicenseSigner::encode($sig), 'X-Company' => $company];
    }

    public function test_control_accounts_and_pages_are_separate_from_erp_administrators(): void
    {
        $this->get('/control/login')->assertOk();
        $this->actingAs($this->admin, 'web')->get('/control/licenses')->assertRedirect('/control/login');
        $operator = ControlAdmin::create(['name' => 'Operator', 'email' => 'operator@example.test', 'password' => 'test-only-long-password']);
        foreach (['/control', '/control/licenses', '/control/devices', '/control/companies', '/control/events'] as $url) {
            $this->actingAs($operator, 'control')->get($url)->assertOk();
        }
        $operator->update(['active' => false]);
        $this->actingAs($operator, 'control')->get('/control')->assertForbidden();
        $this->assertNotSame((new License)->getConnectionName(), $this->admin->getConnectionName());
    }

    public function test_local_setup_creates_exactly_one_operator_and_rejects_remote_or_production_access(): void
    {
        config(['app.env' => 'local', 'licensing.web_setup' => true]);
        $this->app['env'] = 'local';
        $this->get('/control')->assertRedirect('/control/login');
        $this->get('/control/login')->assertRedirect('/control/setup');
        $this->get('/control/setup')->assertOk()->assertSee('password_confirmation', false);
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.10'])->get('/control/setup')->assertNotFound();
        $this->withServerVariables(['REMOTE_ADDR' => '127.0.0.1']);
        config(['app.env' => 'production']);
        $this->app['env'] = 'production';
        $this->get('/control/setup')->assertNotFound();
        config(['app.env' => 'local']);
        $this->app['env'] = 'local';
        $this->withSession(['_token' => 'setup-token']);
        $this->post('/control/setup', ['_token' => 'setup-token', 'name' => 'License owner', 'email' => 'owner@example.test', 'password' => 'owner-password-123', 'password_confirmation' => 'owner-password-123'])->assertRedirect('/control');
        $this->assertSame(1, ControlAdmin::count());
        $this->assertAuthenticatedAs(ControlAdmin::first(), 'control');
        $this->withSession(['_token' => 'setup-token-2']);
        $this->post('/control/setup', ['_token' => 'setup-token-2', 'name' => 'Another', 'email' => 'other@example.test', 'password' => 'owner-password-123', 'password_confirmation' => 'owner-password-123'])->assertStatus(409);
        $this->assertSame(1, ControlAdmin::count());
        $this->get('/control/setup')->assertRedirect('/control/login');
    }

    public function test_filament_can_create_edit_and_copy_activation_keys_for_offline_use(): void
    {
        $operator = ControlAdmin::create(['name' => 'Operator', 'email' => 'operator@example.test', 'password' => 'test-only-long-password']);
        $this->actingAs($operator, 'control');
        Filament::setCurrentPanel(Filament::getPanel('control'));
        Livewire::test(ManageLicenses::class)->callAction('create', data: $this->data())->assertHasNoActionErrors();
        $license = License::firstOrFail();
        $this->assertSame(2, $license->max_companies);
        Livewire::test(ManageLicenses::class)->callAction(TestAction::make('edit')->table($license), data: $this->data(['max_devices' => 3]))->assertHasNoActionErrors();
        $this->assertSame(3, $license->fresh()->max_devices);
        $license = app(LicenseService::class)->save($this->data(['mode' => 'offline']), $license);
        $key = app(LicenseService::class)->activationKey($license);
        $page = Livewire::test(ManageLicenses::class)->mountAction(TestAction::make('activation')->table($license));
        $this->assertStringContainsString($key, $page->getMountedActionModalHtml());
        $this->assertTrue(LicenseEvent::where('event', 'activation.viewed')->exists());
        $this->assertStringNotContainsString($license->activation_secret, json_encode(LicenseEvent::latest('id')->first()->details));
        $details = json_decode(LicenseSigner::decode(substr($key, 4)), true);
        $this->assertSame('https://erp.test', $details['server']);
        $response = $this->postJson('/api/licensing/activate', ['activation_key' => $details['key'], 'request' => $this->device()])->assertOk();
        $this->assertCount(0, app(LicenseSigner::class)->verify($response->json('certificate'))['offline_companies']);
    }

    public function test_online_activation_is_idempotent_and_enforces_device_limit(): void
    {
        $license = $this->license(['mode' => 'online', 'max_devices' => 1]);
        $service = app(LicenseService::class);
        $key = $license->id.'.'.$license->activation_secret;
        $this->postJson('/api/licensing/activate', ['activation_key' => $key, 'request' => $this->device()])->assertOk();
        $this->postJson('/api/licensing/activate', ['activation_key' => $key, 'request' => $this->device()])->assertOk();
        $this->assertSame(1, LicensedDevice::count());
        $this->postJson('/api/licensing/activate', ['activation_key' => $key, 'request' => $this->device(2)])->assertUnprocessable();
        $this->postJson('/api/licensing/activate', ['activation_key' => $license->id.'.wrong', 'request' => $this->device()])->assertUnprocessable();
        $this->assertStringNotContainsString($license->activation_secret, DB::connection('control')->table('licenses')->value('activation_secret'));
    }

    public function test_key_activation_imports_one_existing_company_and_rejects_a_second_on_the_same_device(): void
    {
        $license = $this->license(['mode' => 'offline']);
        $existing = [['id' => 'f3ae472c-1063-4f7a-98e8-806006f51111', 'name' => 'Old company']];
        $payload = ['activation_key' => $license->id.'.'.$license->activation_secret, 'request' => $this->device(1, $existing)];
        $first = $this->postJson('/api/licensing/activate', $payload)->assertOk();
        $retry = $this->postJson('/api/licensing/activate', $payload)->assertOk();
        $signer = app(LicenseSigner::class);
        $this->assertSame($signer->verify($first->json('certificate'))['offline_companies'], $signer->verify($retry->json('certificate'))['offline_companies']);
        $this->postJson('/api/licensing/offline-companies/reserve', ['id' => 'f3ae472c-1063-4f7a-98e8-806006f59999'], $this->headers(1, '/api/licensing/offline-companies/reserve', method: 'POST'))->assertStatus(409);
        $this->assertSame(1, LicensedCompany::count());
        $this->assertTrue(LicensedDevice::first()->offline_reserved_until->equalTo($license->expires_at));
    }

    public function test_activation_consumes_only_a_device_then_assigns_its_single_online_company(): void
    {
        $license = $this->license(['max_companies' => 1]);
        $service = app(LicenseService::class);
        $service->bindOnline($license, 'default');
        $payload = ['activation_key' => $license->id.'.'.$license->activation_secret, 'request' => $this->device()];
        $claims = app(LicenseSigner::class)->verify($this->postJson('/api/licensing/activate', $payload)->assertOk()->json('certificate'));
        $this->assertNull($claims['company_assignment']);
        $this->assertSame([], $claims['offline_companies']);
        $this->assertSame([], $claims['online_companies']);
        $response = $this->postJson('/api/licensing/company-assignment', ['mode' => 'online', 'company' => 'default'], $this->headers(1, '/api/licensing/company-assignment', method: 'POST'))->assertOk();
        $this->assertSame(['default'], app(LicenseSigner::class)->verify($response->json('certificate'))['online_companies']);
        $this->assertSame(1, LicensedCompany::count());
    }

    public function test_activation_rejects_excess_existing_companies_without_partial_reservations(): void
    {
        $license = $this->license(['mode' => 'offline', 'max_companies' => 1, 'offline_company_slots' => 1]);
        $existing = [['id' => 'f3ae472c-1063-4f7a-98e8-806006f51111', 'name' => 'First'], ['id' => 'f3ae472c-1063-4f7a-98e8-806006f52222', 'name' => 'Second']];
        $this->postJson('/api/licensing/activate', ['activation_key' => $license->id.'.'.$license->activation_secret, 'request' => $this->device(1, $existing)])->assertStatus(409);
        $this->assertSame(0, LicensedDevice::count());
        $this->assertSame(0, LicensedCompany::count());
        $this->expectException(ValidationException::class);
        app(LicenseService::class)->save($this->data(['mode' => 'offline', 'offline_company_slots' => 0]));
    }

    public function test_lan_devices_share_one_company_and_cannot_create_a_second(): void
    {
        $license = $this->license(['mode' => 'offline', 'max_companies' => 1, 'max_devices' => 3]);
        $svc = app(LicenseService::class);
        $key = $license->id.'.'.$license->activation_secret;
        $svc->activate($key, $this->device(1), '127.0.0.1');
        $svc->activate($key, $this->device(2), '127.0.0.1');
        $this->assertSame(0, LicensedCompany::count());
        $slot = 'f3ae472c-1063-4f7a-98e8-806006f51111';
        $host = LicensedDevice::findOrFail($this->device(1)['device_id']);
        $peer = LicensedDevice::findOrFail($this->device(2)['device_id']);
        $svc->reserveOffline($host, $slot);
        $svc->confirmOffline($host, [['id' => $slot, 'name' => 'Shared company']]);
        foreach ([1, 2] as $retry) {
            $claims = app(LicenseSigner::class)->verify($svc->assignCompany($peer, 'offline', $slot));
            $this->assertSame($slot, $claims['company_assignment']['id']);
            $this->assertSame($host->id, $claims['company_assignment']['host_device_id']);
            $this->assertSame([], $claims['offline_companies']);
        }
        $this->assertSame(1, $license->registeredCompanies()->count());
        $this->assertSame(1, LicensedCompany::count());
        $this->postJson('/api/licensing/offline-companies/reserve', ['id' => 'f3ae472c-1063-4f7a-98e8-806006f58888'], $this->headers(2, '/api/licensing/offline-companies/reserve', method: 'POST'))->assertStatus(409);
        $this->assertSame(1, LicensedCompany::count());
    }

    public function test_offline_slots_and_online_companies_use_one_shared_limit(): void
    {
        $license = $this->license();
        $service = app(LicenseService::class);
        $service->bindOnline($license, 'default');
        $certificate = $service->allocate($license, $this->device(), 1, true);
        $claims = app(LicenseSigner::class)->verify($certificate);
        $this->assertSame([], $claims['online_companies']);
        $this->assertCount(1, $claims['offline_companies']);
        try {
            $service->allocate($license, $this->device(2), 1, true);
            $this->fail('Expected company cap');
        } catch (ValidationException) {
        }
        $this->assertSame(1, LicensedDevice::count());
        $this->assertSame(2, LicensedCompany::count());
        $this->assertSame($claims['offline_companies'], app(LicenseSigner::class)->verify($service->allocate($license, $this->device(), 0, true))['offline_companies']);
    }

    public function test_existing_offline_companies_are_bound_and_failures_roll_back_atomically(): void
    {
        $license = $this->license(['max_companies' => 1]);
        $existing = [['id' => 'f3ae472c-1063-4f7a-98e8-806006f51111', 'name' => 'Legacy company']];
        try {
            app(LicenseService::class)->allocate($license, $this->device(1, $existing), 1, true);
            $this->fail('Expected cap');
        } catch (ValidationException|\Symfony\Component\HttpKernel\Exception\HttpException) {
        }
        $this->assertSame(0, LicensedDevice::count());
        $this->assertSame(0, LicensedCompany::count());
        $claims = app(LicenseSigner::class)->verify(app(LicenseService::class)->allocate($license, $this->device(1, $existing), 0, true));
        $this->assertSame([array_replace($existing[0], ['registered' => true])], $claims['offline_companies']);
    }

    public function test_request_proof_cannot_be_forged_or_bound_to_another_machine(): void
    {
        $license = $this->license();
        $device = $this->device();
        $device['machine_hash'] = str_repeat('a', 64);
        $this->expectException(ValidationException::class);
        app(LicenseService::class)->allocate($license, $device, 0, true);
    }

    public function test_online_requests_require_proof_company_assignment_and_reject_replay(): void
    {
        $license = $this->license();
        $svc = app(LicenseService::class);
        $svc->activate($license->id.'.'.$license->activation_secret, $this->device(), '127.0.0.1');
        config(['licensing.enforce' => true]);
        $this->getJson('/api/licensed-probe')->assertForbidden();
        $this->getJson('/api/licensed-probe', $this->headers(1))->assertForbidden();
        $svc->bindOnline($license, 'default');
        $svc->assignCompany(LicensedDevice::findOrFail($this->device(1)['device_id']), 'online', 'default');
        $headers = $this->headers(1);
        $this->getJson('/api/licensed-probe', $headers)->assertOk();
        $this->getJson('/api/licensed-probe', $headers)->assertForbidden();
        $this->getJson('/api/licensed-probe', $this->headers(1, timestamp: now()->subMinutes(6)->timestamp))->assertForbidden();
        $tampered = $this->headers(1);
        $tampered['X-Company'] = 'someone_else';
        $this->getJson('/api/licensed-probe', $tampered)->assertForbidden();
        $this->assertNotNull(LicensedDevice::first()->last_seen_at);
    }

    public function test_online_revocation_is_immediate_but_offline_reservations_do_not_free_early(): void
    {
        $license = $this->license(['max_devices' => 1]);
        $svc = app(LicenseService::class);
        $svc->allocate($license, $this->device(), 1, true);
        $svc->bindOnline($license, 'default');
        $svc->revokeDevice(LicensedDevice::first());
        config(['licensing.enforce' => true]);
        $this->getJson('/api/licensed-probe', $this->headers(1))->assertForbidden();
        $this->expectException(ValidationException::class);
        $svc->activate($license->id.'.'.$license->activation_secret, $this->device(2), '127.0.0.1');
    }

    public function test_license_reduction_cannot_erase_issued_allocations(): void
    {
        $license = $this->license();
        $svc = app(LicenseService::class);
        $svc->allocate($license, $this->device(1), 1, true);
        $svc->allocate($license, $this->device(2), 1, true);
        $this->expectException(ValidationException::class);
        $svc->save($this->data(['max_companies' => 1]), $license);
    }

    public function test_offline_api_checks_expiry_signature_device_and_company_without_a_control_database(): void
    {
        $license = $this->license();
        $envelope = app(LicenseService::class)->allocate($license, $this->device(), 1, true);
        $claims = app(LicenseSigner::class)->verify($envelope);
        file_put_contents($this->keydir.'/certificate.json', json_encode($envelope));
        config(['licensing.enforce' => true, 'licensing.offline_certificate' => $this->keydir.'/certificate.json', 'licensing.device_id' => $claims['device_id'], 'licensing.machine_hash' => $claims['machine_hash'], 'licensing.company_id' => $claims['offline_companies'][0]['id']]);
        DB::connection('control')->disconnect();
        $this->getJson('/api/licensed-probe')->assertOk();
        config(['licensing.company_id' => 'other-company']);
        $this->getJson('/api/licensed-probe')->assertForbidden();
        config(['licensing.company_id' => $claims['offline_companies'][0]['id']]);
        $this->travel(367)->days();
        $this->getJson('/api/licensed-probe')->assertForbidden();
        $this->travelBack();
        $envelope['payload'] .= 'a';
        file_put_contents($this->keydir.'/certificate.json', json_encode($envelope));
        $this->getJson('/api/licensed-probe')->assertForbidden();
    }

    public function test_lan_peer_proof_checks_assignment_signature_expiry_and_replay_offline(): void
    {
        $svc = app(LicenseService::class);
        $license = $this->license(['max_companies' => 1]);
        $hostEnvelope = $svc->allocate($license, $this->device(1), 1, true);
        $host = app(LicenseSigner::class)->verify($hostEnvelope);
        $company = $host['offline_companies'][0]['id'];
        $svc->allocate($license, $this->device(2), 0, true);
        $peer = LicensedDevice::findOrFail($this->device(2)['device_id']);
        $peerEnvelope = $svc->assignCompany($peer, 'offline', $company);
        file_put_contents($this->keydir.'/certificate.json', json_encode($hostEnvelope));
        config(['licensing.enforce' => true, 'licensing.offline_certificate' => $this->keydir.'/certificate.json', 'licensing.device_id' => $host['device_id'], 'licensing.machine_hash' => $host['machine_hash'], 'licensing.company_id' => $company]);
        $headers = $this->headers(2, company: $company) + ['X-Manzoma-LAN' => '1', 'X-Offline-Certificate' => LicenseSigner::encode(json_encode($peerEnvelope))];
        // The host must not query the authority database while serving a LAN peer.
        DB::connection('control')->disconnect();
        $this->getJson('/api/licensed-probe', $headers)->assertOk();
        $this->getJson('/api/licensed-probe', $headers)->assertForbidden();
        $this->getJson('/api/licensed-probe', ['X-Manzoma-LAN' => '1'])->assertForbidden();
        $tampered = $peerEnvelope; $tampered['payload'] .= 'x';
        $bad = $this->headers(2, company: $company) + ['X-Manzoma-LAN' => '1', 'X-Offline-Certificate' => LicenseSigner::encode(json_encode($tampered))];
        $this->getJson('/api/licensed-probe', $bad)->assertForbidden();
        $claims = app(LicenseSigner::class)->verify($peerEnvelope);
        $claims['company_assignment']['id'] = 'another-company';
        $wrong = app(LicenseSigner::class)->sign($claims);
        $bad = $this->headers(2, company: $company) + ['X-Manzoma-LAN' => '1', 'X-Offline-Certificate' => LicenseSigner::encode(json_encode($wrong))];
        $this->getJson('/api/licensed-probe', $bad)->assertForbidden();
        $claims['expires_at'] = now()->subMinute()->timestamp;
        $expired = app(LicenseSigner::class)->sign($claims);
        $bad = $this->headers(2, company: $company) + ['X-Manzoma-LAN' => '1', 'X-Offline-Certificate' => LicenseSigner::encode(json_encode($expired))];
        $this->getJson('/api/licensed-probe', $bad)->assertForbidden();
    }

    public function test_online_devices_share_one_company_but_cannot_reassign_to_another(): void
    {
        $license = $this->license(['max_companies' => 2]);
        $svc = app(LicenseService::class);
        $svc->bindOnline($license, 'default');
        foreach ([1, 2] as $n) {
            $svc->allocate($license, $this->device($n), 0, false);
            $this->postJson('/api/licensing/company-assignment', ['mode' => 'online', 'company' => 'default'], $this->headers($n, '/api/licensing/company-assignment', method: 'POST'))->assertOk();
        }
        $this->assertSame(1, LicensedCompany::count());
        $this->assertSame(2, LicensedDevice::whereNotNull('company_id')->count());
        $this->postJson('/api/licensing/company-assignment', ['mode' => 'online', 'company' => 'different'], $this->headers(2, '/api/licensing/company-assignment', method: 'POST'))->assertStatus(409);
        $this->assertSame('default', LicensedDevice::findOrFail($this->device(2)['device_id'])->assignedCompany->company_key);
    }

    public function test_allocations_can_be_released_only_after_their_last_offline_expiry(): void
    {
        $license = $this->license();
        $svc = app(LicenseService::class);
        $svc->allocate($license, $this->device(), 1, true);
        $offline = LicensedCompany::first();
        try {
            $svc->releaseCompany($offline);
            $this->fail('Expected reserved slot rejection');
        } catch (ValidationException) {
        }
        $this->assertSame(1, LicensedCompany::count());
        $svc->bindOnline($license, 'default');
        $svc->releaseCompany(LicensedCompany::where('mode', 'online')->first());
        $this->assertSame(1, LicensedCompany::count());
        $this->travel(367)->days();
        $svc->releaseCompany($offline);
        $this->travelBack();
        $this->assertSame(0, LicensedCompany::count());
        $this->assertSame(2, LicenseEvent::where('event', 'company.released')->count());
    }

    public function test_revoked_online_devices_can_be_restored_only_within_capacity(): void
    {
        $license = $this->license(['max_devices' => 1]);
        $svc = app(LicenseService::class);
        $svc->allocate($license, $this->device(), 0, false);
        $device = LicensedDevice::first();
        $svc->revokeDevice($device);
        $svc->allocate($license, $this->device(2), 0, false);
        try {
            $svc->restoreDevice($device);
            $this->fail('Expected occupied device rejection');
        } catch (ValidationException) {
        }
        $svc->revokeDevice(LicensedDevice::whereKey($this->device(2)['device_id'])->first());
        $svc->restoreDevice($device);
        $this->assertSame('active', $device->fresh()->status);
    }

    public function test_shortening_a_license_does_not_release_an_already_issued_offline_reservation(): void
    {
        $license = $this->license();
        $svc = app(LicenseService::class);
        $svc->allocate($license, $this->device(), 1, true);
        $until = LicensedCompany::first()->reserved_until;
        $license = $svc->save($this->data(['expires_at' => now()->addMonth()->toIso8601String()]), $license);
        $svc->allocate($license, $this->device(), 0, true);
        $this->assertTrue($until->equalTo(LicensedCompany::first()->reserved_until));
        $this->assertTrue($until->equalTo(LicensedDevice::first()->offline_reserved_until));
    }

    public function test_concurrent_mysql_activation_cannot_oversubscribe_one_device_or_company(): void
    {
        if (getenv('CONTROL_TEST_MYSQL') !== 'true') {
            $this->markTestSkipped('Concurrency test requires the isolated MySQL control database.');
        }
        $license = $this->license(['max_devices' => 1, 'max_companies' => 1]);
        $code = 'require "vendor/autoload.php"; $app=require "bootstrap/app.php"; $app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap(); $d=json_decode(stream_get_contents(STDIN),true); try { app(\App\Control\Services\LicenseService::class)->activate($d["key"],$d["request"],"127.0.0.1"); echo "allocated"; } catch(\Illuminate\Validation\ValidationException $e) { echo "limit"; }';
        $connection = config('database.connections.control');
        $env = ['APP_ENV' => 'testing', 'ERP_CONTROL_ENABLED' => 'false', 'CONTROL_DB_CONNECTION' => 'mysql', 'CONTROL_DB_HOST' => $connection['host'], 'CONTROL_DB_PORT' => (string) $connection['port'], 'CONTROL_DB_DATABASE' => $connection['database'], 'CONTROL_DB_USERNAME' => $connection['username'], 'CONTROL_DB_PASSWORD' => $connection['password'], 'ERP_LICENSE_PRIVATE_KEY' => config('licensing.private_key')];
        $processes = [];
        foreach ([1, 2] as $n) {
            $process = new Process([PHP_BINARY, '-r', $code], base_path(), $env);
            $process->setInput(json_encode(['key' => $license->id.'.'.$license->activation_secret, 'request' => $this->device($n)]));
            $process->start();
            $processes[] = $process;
        }
        $results = [];
        foreach ($processes as $process) {
            $process->wait();
            $this->assertTrue($process->isSuccessful(), $process->getErrorOutput());
            $results[] = trim($process->getOutput());
        }
        sort($results);
        $this->assertSame(['allocated', 'limit'], $results);
        $this->assertSame(1, LicensedDevice::count());
        $this->assertSame(0, LicensedCompany::count());
    }

    private function withFreshOnlineCompany(callable $check): void
    {
        $previous = DB::getDefaultConnection();
        $registry = config('erp.companies_registry');
        $database = $this->keydir.'/company.sqlite';
        touch($database);
        config(['database.connections.onboarding' => array_replace(config('database.connections.sqlite'), ['database' => $database, 'url' => null]), 'erp.companies_registry' => $this->keydir.'/companies.json', 'licensing.enforce' => true]);
        DB::setDefaultConnection('onboarding');
        app(SettingsService::class)->flush();
        $this->app['auth']->forgetGuards();
        try {
            $check();
        } finally {
            DB::purge('onboarding');
            DB::purge('provisioning');
            DB::setDefaultConnection($previous);
            config(['erp.companies_registry' => $registry]);
            app(SettingsService::class)->flush();
            app(PermissionRegistrar::class)->forgetCachedPermissions();
            $this->app['auth']->forgetGuards();
        }
    }

    private function registrationInput(): array
    {
        return ['registration_id' => 'f3ae472c-1063-4f7a-98e8-806006f56666', 'name' => 'Fresh filters', 'nameEn' => 'Fresh filters', 'currency' => 'EGP', 'vatRate' => 14, 'adminName' => 'Company owner', 'adminUsername' => 'owner', 'adminPassword' => 'new-company-password', 'locale' => 'ar', 'demo' => false];
    }

    public function test_online_license_activation_registration_discovery_and_login_are_connected(): void
    {
        $this->withFreshOnlineCompany(function () {
            $license = $this->license(['mode' => 'online', 'max_companies' => 1]);
            $this->postJson('/api/licensing/activate', ['activation_key' => $license->id.'.'.$license->activation_secret, 'request' => $this->device()])->assertOk();
            $input = array_replace($this->registrationInput(), ['adminPassword' => '  new-company-password  ']);
            $response = $this->postJson('/api/licensing/companies', $input, $this->headers(1, '/api/licensing/companies', method: 'POST'))->assertOk();
            $this->assertSame('default', $response->json('company.slug'));
            $this->assertSame(['default'], app(LicenseSigner::class)->verify($response->json('certificate'))['online_companies']);
            $this->assertSame(1, User::count());
            foreach (['products', 'parties', 'trade_documents', 'journal_entries'] as $table) {
                $this->assertSame(0, DB::table($table)->count());
            }
            $this->postJson('/api/licensing/companies', $input, $this->headers(1, '/api/licensing/companies', method: 'POST'))->assertOk();
            $this->assertSame(1, LicensedCompany::count());
            $this->assertSame(1, User::count());
            $this->getJson('/api/system/companies', $this->headers(1, '/api/system/companies'))->assertOk()->assertJsonPath('data.0.slug', 'default');
            $login = $this->postJson('/api/auth/login', ['username' => $input['adminUsername'], 'password' => $input['adminPassword']], $this->headers(1, '/api/auth/login', method: 'POST'))->assertOk()->assertJsonPath('user.username', 'owner');
            $this->assertNotEmpty($login->json('token'));
            $this->postJson('/api/licensing/companies', array_replace($input, ['adminPassword' => 'changed-password']), $this->headers(1, '/api/licensing/companies', method: 'POST'))->assertStatus(409);
            $this->postJson('/api/licensing/companies', array_replace($input, ['registration_id' => 'f3ae472c-1063-4f7a-98e8-806006f57777']), $this->headers(1, '/api/licensing/companies', method: 'POST'))->assertStatus(409);
            $this->assertSame(1, DB::connection('control')->table('company_registrations')->count());
        });
    }

    public function test_server_registration_requires_active_online_device_proof_and_never_adopts_an_existing_company(): void
    {
        $this->postJson('/api/licensing/companies', $this->registrationInput())->assertForbidden();
        $license = $this->license(['mode' => 'offline']);
        app(LicenseService::class)->activate($license->id.'.'.$license->activation_secret, $this->device(), '127.0.0.1');
        $this->postJson('/api/licensing/companies', $this->registrationInput(), $this->headers(1, '/api/licensing/companies', method: 'POST'))->assertUnprocessable();
        $license = $this->license(['mode' => 'online']);
        app(LicenseService::class)->activate($license->id.'.'.$license->activation_secret, $this->device(2), '127.0.0.1');
        $this->postJson('/api/licensing/companies', $this->registrationInput(), $this->headers(2, '/api/licensing/companies', method: 'POST'))->assertStatus(409);
        $this->assertSame(0, DB::connection('control')->table('company_registrations')->count());
        $this->assertSame(1, User::count());
    }

    public function test_failed_registration_retries_its_reserved_company_without_duplicate_data(): void
    {
        $this->withFreshOnlineCompany(function () {
            $license = $this->license(['mode' => 'online', 'max_companies' => 1]);
            app(LicenseService::class)->activate($license->id.'.'.$license->activation_secret, $this->device(), '127.0.0.1');
            $service = new class extends CompanyRegistrationService
            {
                public bool $fail = true;

                protected function install(string $slug, array $data): void
                {
                    parent::install($slug, $data);
                    if ($this->fail) {
                        $this->fail = false;
                        throw new \RuntimeException('Simulated installation interruption');
                    }
                }
            };
            $this->app->instance(CompanyRegistrationService::class, $service);
            $input = $this->registrationInput();
            $this->postJson('/api/licensing/companies', $input, $this->headers(1, '/api/licensing/companies', method: 'POST'))->assertStatus(503);
            $this->assertSame('failed', DB::connection('control')->table('company_registrations')->value('status'));
            $this->assertSame(1, LicensedCompany::count());
            app(LicenseService::class)->releaseCompany(LicensedCompany::first());
            $this->postJson('/api/licensing/companies', $input, $this->headers(1, '/api/licensing/companies', method: 'POST'))->assertOk();
            $this->assertSame('ready', DB::connection('control')->table('company_registrations')->value('status'));
            $this->assertSame(1, User::count());
            $this->assertSame(1, LicensedCompany::count());
            $this->assertStringNotContainsString($input['adminPassword'], DB::connection('control')->table('company_registrations')->value('input_hash'));
        });
    }

    public function test_mysql_registration_creates_an_isolated_company_and_enforces_the_shared_limit(): void
    {
        if (getenv('CONTROL_TEST_MYSQL') !== 'true') {
            $this->markTestSkipped('Requires the isolated MySQL verification database.');
        }
        $registry = config('erp.companies_registry');
        $prefix = config('erp.company_db_prefix');
        $input = array_replace($this->registrationInput(), ['registration_id' => (string) Str::uuid()]);
        $slug = 'company_'.str_replace('-', '', $input['registration_id']);
        $database = 'erp_license_verify_'.$slug;
        config(['erp.multi_company' => true, 'erp.company_db_prefix' => 'erp_license_verify_', 'erp.companies_registry' => $this->keydir.'/companies.json']);
        try {
            $license = $this->license(['mode' => 'online', 'max_companies' => 1]);
            app(LicenseService::class)->activate($license->id.'.'.$license->activation_secret, $this->device(), '127.0.0.1');
            $this->postJson('/api/licensing/companies', $input, $this->headers(1, '/api/licensing/companies', method: 'POST'))->assertOk()->assertJsonPath('company.slug', $slug);
            $this->postJson('/api/licensing/companies', $input, $this->headers(1, '/api/licensing/companies', method: 'POST'))->assertOk();
            config(['database.connections.verify_company' => array_replace(config('database.connections.mysql'), ['database' => $database, 'url' => null])]);
            $tenant = DB::connection('verify_company');
            $this->assertSame(1, $tenant->table('users')->count());
            $this->assertTrue(Hash::check($input['adminPassword'], $tenant->table('users')->value('password')));
            $this->assertSame(0, $tenant->table('products')->count());
            $this->assertSame(1, LicensedCompany::count());
            $this->postJson('/api/licensing/companies', array_replace($input, ['registration_id' => (string) Str::uuid()]), $this->headers(1, '/api/licensing/companies', method: 'POST'))->assertUnprocessable();
            $this->assertSame(1, DB::connection('control')->table('company_registrations')->count());
        } finally {
            DB::purge('verify_company');
            config(['database.connections.verification_cleanup' => config('database.connections.mysql')]);
            DB::connection('verification_cleanup')->statement("DROP DATABASE IF EXISTS `{$database}`");
            DB::purge('verification_cleanup');
            config(['erp.multi_company' => false, 'erp.company_db_prefix' => $prefix, 'erp.companies_registry' => $registry]);
        }
    }

    public function test_optional_offline_refresh_extends_reservations_and_delivers_signed_revocation(): void
    {
        $license = $this->license(['mode' => 'offline']);
        $svc = app(LicenseService::class);
        $svc->allocate($license, $this->device(), 1, true);
        $license = $svc->save($this->data(['mode' => 'offline', 'expires_at' => now()->addYears(2)->toIso8601String()]), $license);
        $response = $this->postJson('/api/licensing/refresh', [], $this->headers(1, '/api/licensing/refresh', method: 'POST'))->assertOk();
        $active = app(LicenseSigner::class)->verify($response->json('certificate'));
        $this->assertSame('active', $active['status']);
        $this->assertTrue(LicensedCompany::first()->reserved_until->equalTo($license->expires_at));
        $this->assertTrue(LicensedDevice::first()->offline_reserved_until->equalTo($license->expires_at));
        $svc->revokeDevice(LicensedDevice::first());
        $denial = $this->postJson('/api/licensing/refresh', [], $this->headers(1, '/api/licensing/refresh', method: 'POST'))->assertOk()->json('certificate');
        $claims = json_decode(LicenseSigner::decode($denial['payload']), true);
        $this->assertSame('revoked', $claims['status']);
        $this->assertGreaterThan($active['revision'], $claims['revision']);
        $this->assertSame(1, openssl_verify($denial['payload'], LicenseSigner::decode($denial['signature']), file_get_contents(config('licensing.public_key')), OPENSSL_ALGO_SHA256));
        $svc->restoreDevice(LicensedDevice::first());
        $restored = $this->postJson('/api/licensing/refresh', [], $this->headers(1, '/api/licensing/refresh', method: 'POST'))->assertOk()->json('certificate');
        $this->assertSame('active', app(LicenseSigner::class)->verify($restored)['status']);
    }

    public function test_suspended_expired_and_cross_license_devices_are_rejected(): void
    {
        $license = $this->license(['mode' => 'offline']);
        $svc = app(LicenseService::class);
        $this->postJson('/api/licensing/activate', ['activation_key' => $license->id.'.'.$license->activation_secret, 'request' => $this->device()])->assertOk();
        $other = $this->license();
        $this->postJson('/api/licensing/activate', ['activation_key' => $other->id.'.'.$other->activation_secret, 'request' => $this->device()])->assertUnprocessable();
        $license->update(['status' => 'suspended']);
        try {
            $svc->allocate($license, $this->device(), 0, true);
            $this->fail('Expected suspended');
        } catch (ValidationException) {
        }
        $license->update(['status' => 'active', 'expires_at' => now()->subDay()]);
        $this->expectException(ValidationException::class);
        $svc->allocate($license, $this->device(), 0, true);
    }

    public function test_allocation_reconciliation_is_dry_run_by_default_and_never_frees_capacity(): void
    {
        $license = $this->license(['mode' => 'online']);
        app(LicenseService::class)->activate($license->id.'.'.$license->activation_secret, $this->device(), '127.0.0.1');
        $device = LicensedDevice::firstOrFail();
        $row = $license->companies()->create(['mode' => 'online', 'company_key' => 'default', 'name' => 'Wrong name', 'registered_at' => now()]);
        DB::connection('control')->table('company_registrations')->insert(['id' => (string) Str::uuid(), 'license_id' => $license->id, 'device_id' => $device->id, 'slug' => 'default', 'name' => 'Actual company', 'input_hash' => str_repeat('a', 64), 'status' => 'failed', 'created_at' => now(), 'updated_at' => now()]);
        $service = app(CompanyReconciliation::class);
        $this->assertCount(1, $service->run()['changes']);
        $this->assertNotNull($row->fresh()->registered_at);
        $this->assertSame(0, $service->run(true)['allocations_released']);
        $this->assertNull($row->fresh()->registered_at);
        $this->assertSame('Actual company', $row->fresh()->name);
        $this->assertSame(1, $license->companies()->count());
        $this->assertCount(0, $service->run(true)['changes']);
    }

    public function test_issuer_backup_restores_original_keys_and_rejects_wrong_password(): void
    {
        $service = app(ControlBackupService::class);
        $backupDirectory = $this->keydir.'/encrypted';
        $restoreDirectory = $this->keydir.'/restored';
        try {
            $file = $service->create($backupDirectory, 'test-recovery-password-123');
            $this->assertStringNotContainsString('PRIVATE KEY', file_get_contents($file));
            $manifest = $service->unpack($file, 'test-recovery-password-123', $restoreDirectory);
            $this->assertSame(DB::connection('control')->getDriverName(), $manifest['driver']);
            $this->assertSame(file_get_contents(config('licensing.private_key')), file_get_contents($restoreDirectory.'/signing-private.pem'));
            $this->assertSame(config('app.key'), file_get_contents($restoreDirectory.'/app-key.txt'));
            try {
                $service->unpack($file, 'wrong-password-123456', $this->keydir.'/wrong');
                $this->fail('Wrong password accepted');
            } catch (\RuntimeException $error) {
                $this->assertStringContainsString('integrity', $error->getMessage());
            }
            $this->assertDirectoryDoesNotExist($this->keydir.'/wrong');
        } finally {
            File::deleteDirectory($backupDirectory);
            File::deleteDirectory($restoreDirectory);
        }
    }

    public function test_prebundled_legacy_public_key_preserves_old_certificates_during_rollover(): void
    {
        $license = $this->license();
        $certificate = app(LicenseService::class)->activate($license->id.'.'.$license->activation_secret, $this->device(), '127.0.0.1');
        $old = file_get_contents(config('licensing.public_key'));
        file_put_contents($this->keydir.'/next-public.pem', $this->pair(8)['public']);
        file_put_contents($this->keydir.'/legacy.json', json_encode([$old]));
        config(['licensing.public_key' => $this->keydir.'/next-public.pem', 'licensing.legacy_public_keys' => $this->keydir.'/legacy.json']);
        $this->assertSame($license->id, app(LicenseSigner::class)->verify($certificate)['license_id']);
        config(['licensing.legacy_public_keys' => null]);
        $this->expectException(ValidationException::class);
        app(LicenseSigner::class)->verify($certificate);
    }

    public function test_control_locale_switch_is_preserved_without_using_company_preferences(): void
    {
        // The fixture changes file sessions to array after providers boot; rebind the test store.
        $this->app->forgetInstance('session.store');
        $this->app->make('session')->forgetDrivers();
        $this->get('/control/login?lang=en')->assertOk()->assertSessionHas('control.locale', 'en');
        $this->get('/control/login?lang=ar')->assertOk()->assertSessionHas('control.locale', 'ar');
        $this->get('/control/login?lang=invalid')->assertOk()->assertSessionHas('control.locale', 'ar');
    }

    public function test_health_checks_the_issuer_when_no_companies_are_registered(): void
    {
        file_put_contents($this->keydir.'/companies.json', '{}');
        config(['erp.multi_company' => true, 'erp.companies_registry' => $this->keydir.'/companies.json']);
        $this->assertSame(0, Artisan::call('erp:health', ['--all' => true, '--ready' => true, '--json' => true]));
        $this->assertStringContainsString('"scope":"issuer"', Artisan::output());
        Schema::connection('control')->drop('company_registrations');
        $this->assertSame(1, Artisan::call('erp:health', ['--all' => true, '--ready' => true, '--json' => true]));
        $this->assertStringContainsString('control_schema', Artisan::output());
        file_put_contents($this->keydir.'/companies.json', 'broken');
        $this->assertSame(1, Artisan::call('erp:queue-supervise', ['--once' => true]));
        $this->assertStringContainsString('registry is invalid', Artisan::output());
    }
}
