<?php

namespace App\Modules\Core\Services;

use App\Models\User;
use App\Modules\Core\Models\Branch;
use App\Modules\Core\Models\Setting;
use App\Modules\Finance\Models\CashAccount;
use App\Modules\Finance\Models\FiscalYear;
use App\Modules\Finance\Models\TaxRate;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\StockMove;
use App\Modules\Inventory\Models\Warehouse;
use App\Modules\Parties\Models\Party;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\MaintenanceProfile;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** Company-owned setup progress; never posts transactions or creates sample business records. */
class SetupGuideService
{
    public const KEY = 'system.setup_guide';

    public const STEPS = ['company', 'locations', 'finance', 'products', 'maintenance', 'customers'];

    public static function initialState(): array
    {
        return ['version' => 1, 'status' => 'active', 'reviews' => [], 'started_at' => now()->toIso8601String(), 'completed_at' => null];
    }

    public function __construct(private readonly SettingsService $settings, private readonly AuditService $audit) {}

    public function status(): array
    {
        $raw = Setting::query()->whereKey(self::KEY)->value('value');
        $state = $raw ? json_decode($raw, true, 512, JSON_THROW_ON_ERROR) : ['version' => 1, 'status' => 'not_started', 'reviews' => []];

        return $this->describe($state);
    }

    public function transition(string $action, ?string $step = null, bool $defer = false): array
    {
        return DB::transaction(function () use ($action, $step, $defer) {
            Setting::query()->firstOrCreate(['key' => self::KEY], ['value' => json_encode(['version' => 1, 'status' => 'not_started', 'reviews' => []])]);
            $record = Setting::query()->whereKey(self::KEY)->lockForUpdate()->firstOrFail();
            $state = json_decode($record->value, true, 512, JSON_THROW_ON_ERROR);
            $before = $this->describe($state);
            if ($action === 'start') {
                if ($state['status'] === 'not_started') {
                    $state = self::initialState();
                } elseif ($state['status'] === 'paused') {
                    $state['status'] = 'active';
                } elseif ($state['status'] === 'completed') {
                    $state['status'] = 'active';
                    $state['last_completed_at'] = $state['completed_at'] ?? null;
                    $state['completed_at'] = null;
                    $state['reviews'] = array_filter($state['reviews'], fn ($review) => ! ($review['deferred'] ?? false));
                }
            } elseif ($action === 'pause') {
                if ($state['status'] === 'active') {
                    $state['status'] = 'paused';
                }
            } elseif ($action === 'review') {
                $this->ensure($state['status'] === 'active', 'Start or resume the company guide first.');
                $index = array_search($step, self::STEPS, true);
                $this->ensure($index !== false, 'Unknown setup step.');
                foreach (array_slice($before['steps'], 0, $index) as $previous) {
                    $this->ensure($previous['done'], 'Complete the earlier setup steps first.');
                }
                $current = $before['steps'][$index];
                $this->ensure(! $defer || ! $current['required'], 'This setup step cannot be deferred.');
                $this->ensure($defer || $current['ready'], 'Finish the required data for this step before continuing.');
                $state['reviews'][$step] = ['by' => auth()->id(), 'at' => now()->toIso8601String(), 'deferred' => $defer];
            } elseif ($action === 'complete') {
                if ($state['status'] === 'completed') {
                    return $before;
                }
                $this->ensure($state['status'] === 'active', 'Start or resume the company guide first.');
                $this->ensure($before['can_finish'], 'Complete the setup checklist before finishing.');
                $state['status'] = 'completed';
                $state['completed_at'] = now()->toIso8601String();
                $state['completed_by'] = auth()->id();
            }
            $this->settings->set(self::KEY, $state);
            $this->audit->record('setup_guide_'.$action, null, $step, ['status' => $state['status'], 'step' => $step, 'deferred' => $defer]);

            return $this->describe($state);
        });
    }

    private function ensure(bool $condition, string $message): void
    {
        if (! $condition) {
            throw ValidationException::withMessages(['setup' => __($message)]);
        }
    }

    private function describe(array $state): array
    {
        $warehouses = Warehouse::query()->where('is_active', true)->where('is_transit', false)->whereHas('branch', fn ($q) => $q->where('is_active', true))->count();
        $stock = Product::query()->where('is_active', true)->where('type', 'stock')->whereNotNull('base_unit_id')->whereHas('units')->count();
        $profiles = MaintenanceProfile::query()->where('active', true)->whereHas('product', fn ($q) => $q->where('is_active', true))->whereHas('stages')->count();
        $day = now('Africa/Cairo')->toDateString();
        $checks = [
            'company' => [
                ['key' => 'company_name', 'passed' => filled($this->settings->get('company.name')), 'required' => true],
                ['key' => 'company_phone', 'passed' => filled($this->settings->get('company.phone')), 'required' => false],
                ['key' => 'company_address', 'passed' => filled($this->settings->get('company.address')), 'required' => false],
            ],
            'locations' => [
                ['key' => 'branch', 'passed' => Branch::query()->where('is_active', true)->exists(), 'required' => true],
                ['key' => 'warehouse', 'passed' => $warehouses > 0, 'required' => true],
                ['key' => 'staff', 'passed' => User::query()->where('is_active', true)->count() > 1, 'required' => false],
            ],
            'finance' => [
                ['key' => 'fiscal_year', 'passed' => FiscalYear::query()->where('status', 'open')->whereDate('start_date', '<=', $day)->whereDate('end_date', '>=', $day)->exists(), 'required' => true],
                ['key' => 'cash_account', 'passed' => CashAccount::query()->where('is_active', true)->where('currency', $this->settings->currency())->whereHas('account', fn ($q) => $q->where('is_active', true)->where('is_group', false))->exists(), 'required' => true],
                ['key' => 'tax', 'passed' => TaxRate::query()->whereKey($this->settings->get('tax.default_vat_id'))->where('is_active', true)->where('type', 'vat')->exists(), 'required' => true],
                ['key' => 'costing', 'passed' => in_array($this->settings->get('accounting.costing_method'), ['average', 'fifo'], true), 'required' => true],
            ],
            'products' => [
                ['key' => 'stock_products', 'passed' => $stock > 0, 'required' => true],
                ['key' => 'service_products', 'passed' => Product::query()->where('is_active', true)->where('type', 'service')->exists(), 'required' => false],
                ['key' => 'stock_received', 'passed' => StockMove::query()->exists(), 'required' => false],
            ],
            'maintenance' => [
                ['key' => 'maintenance_profile', 'passed' => $profiles > 0, 'required' => true],
            ],
            'customers' => [
                ['key' => 'customers', 'passed' => Party::query()->where('is_customer', true)->where('is_active', true)->exists(), 'required' => true],
                ['key' => 'customer_filters', 'passed' => CustomerUnit::query()->exists(), 'required' => false],
            ],
        ];
        $steps = [];
        foreach (self::STEPS as $key) {
            $required = ! in_array($key, ['maintenance', 'customers'], true);
            $review = $state['reviews'][$key] ?? null;
            $ready = collect($checks[$key])->where('required', true)->every(fn ($check) => $check['passed']);
            $deferred = ! $required && ($review['deferred'] ?? false);
            $steps[] = ['key' => $key, 'required' => $required, 'checks' => $checks[$key], 'ready' => $ready, 'reviewed' => (bool) $review, 'deferred' => $deferred, 'done' => (bool) $review && ($ready || $deferred)];
        }
        $done = collect($steps)->where('done', true)->count();

        return ['status' => $state['status'], 'auto_start' => $state['status'] === 'active', 'completed_at' => $state['completed_at'] ?? null,
            'steps' => $steps, 'done' => $done, 'total' => count($steps), 'can_finish' => $done === count($steps),
            'current_step' => collect($steps)->first(fn ($step) => ! $step['done'])['key'] ?? 'review'];
    }
}
