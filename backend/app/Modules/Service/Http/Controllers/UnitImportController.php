<?php

namespace App\Modules\Service\Http\Controllers;

use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Inventory\Models\Product;
use App\Modules\Parties\Models\Party;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\MaintenanceProfile;
use App\Modules\Service\Models\PartyAddress;
use App\Modules\Service\Services\CustomerUnitService;
use App\Modules\Service\Services\MaintenanceService;
use App\Support\ApiController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

class UnitImportController extends ApiController
{
    public function import(Request $request)
    {
        $this->allow('service.manage');
        $this->allow('service.view_all');
        $this->allow('customers.view');
        $data = $request->validate(['rows' => 'required|array|min:1|max:2000', 'rows.*' => 'array', 'dry_run' => 'sometimes|boolean']);
        $result = ['created' => 0, 'updated' => 0, 'skipped' => 0, 'errors' => [], 'preview' => [], 'dry_run' => $request->boolean('dry_run')];
        DB::beginTransaction();
        try {
            foreach ($data['rows'] as $index => $raw) {
                try {
                    $row = collect($raw)->filter(fn ($value) => $value !== '' && $value !== null)->sortKeys()->all();
                    $hash = hash('sha256', json_encode($row, JSON_THROW_ON_ERROR));
                    $entry = DB::transaction(function () use ($row, $hash) {
                        $fields = Validator::make($row, ['unit_code' => 'required|string|max:50', 'customer_code' => 'required|string', 'product_code' => 'required|string', 'profile_name' => 'required|string', 'profile_version' => 'nullable|integer|min:1', 'serial_number' => 'nullable|string|max:100', 'address' => 'nullable|string|max:1000', 'purchased_on' => 'nullable|date_format:Y-m-d|before_or_equal:'.MaintenanceService::today(), 'installed_on' => 'nullable|date_format:Y-m-d|before_or_equal:'.MaintenanceService::today(), 'warranty_starts_on' => 'nullable|date_format:Y-m-d', 'warranty_ends_on' => 'nullable|date_format:Y-m-d', 'notes' => 'nullable|string|max:4000'])->validate();
                        $party = Party::where('code', $fields['customer_code'])->where('is_customer', true)->first();
                        $product = Product::where('code', $fields['product_code'])->lockForUpdate()->first();
                        abort_unless($party && $product, 422, __('Customer or product code was not found.'));
                        $existing = CustomerUnit::where('unit_code', $fields['unit_code'])->lockForUpdate()->first();
                        if ($existing) {
                            $receipt = DB::table('unit_import_receipts')->where('unit_id', $existing->id)->first();
                            abort_unless($receipt && hash_equals($receipt->input_hash, $hash), 422, __('This filter code exists with different history. Review it instead of overwriting it.'));

                            return ['unit_id' => $existing->id, 'unit_code' => $existing->unit_code, 'action' => 'skip'];
                        }
                        $profiles = MaintenanceProfile::where('product_id', $product->id)->where('name', $fields['profile_name'])->where('active', true);
                        if (! empty($fields['profile_version'])) {
                            $profiles->where('version', $fields['profile_version']);
                        }
                        $profile = $profiles->latest('version')->first();
                        abort_unless($profile, 422, __('A matching active maintenance profile is required.'));
                        $unitData = collect($fields)->only(['unit_code', 'serial_number', 'purchased_on', 'warranty_starts_on', 'warranty_ends_on', 'notes'])->all() + ['party_id' => $party->id, 'product_id' => $product->id, 'profile_id' => $profile->id];
                        if (! empty($fields['address'])) {
                            $unitData['address_id'] = PartyAddress::firstOrCreate(['party_id' => $party->id, 'street' => $fields['address']], ['label' => __('Home')])->id;
                        }
                        Validator::make($unitData, app(CustomerUnitService::class)->rules())->validate();
                        $unit = app(CustomerUnitService::class)->create($unitData);
                        $maintenance = app(MaintenanceService::class);
                        if (! empty($fields['installed_on'])) {
                            $maintenance->install($unit, $fields['installed_on']);
                        }
                        foreach ($row as $key => $value) {
                            if (! str_starts_with($key, 'stage.')) {
                                continue;
                            }
                            Validator::make(['date' => $value], ['date' => 'required|date_format:Y-m-d|before_or_equal:'.MaintenanceService::today()])->validate();
                            abort_unless(! empty($fields['installed_on']) && $value >= $fields['installed_on'], 422, __('Stage history needs a known installation date and cannot precede it.'));
                            $schedule = $unit->schedules()->where('stage_key', substr($key, 6))->first();
                            abort_unless($schedule, 422, __('Unknown stage key in imported history.'));
                            $maintenance->replace($schedule, $value, null, 'correction', __('Imported actual replacement history.'));
                        }
                        $custom = [];
                        $definitions = collect(app(DynamicFormService::class)->fields('customer-units'))->keyBy('key');
                        foreach ($row as $key => $value) {
                            if (! str_starts_with($key, 'custom.')) {
                                continue;
                            }
                            $name = substr($key, 7);
                            $type = $definitions[$name]['type'] ?? null;
                            if ($type === 'multi_select') {
                                $value = array_values(array_filter(array_map('trim', explode('|', (string) $value))));
                            }
                            if ($type === 'checkbox') {
                                $normalized = mb_strtolower((string) $value);
                                abort_unless(in_array($normalized, ['true', 'false', '1', '0', 'yes', 'no', 'نعم', 'لا'], true), 422, __('Invalid checkbox value.'));
                                $value = in_array($normalized, ['true', '1', 'yes', 'نعم'], true);
                            }
                            $custom[$name] = $value;
                        }
                        app(DynamicFormService::class)->save('customer-units', $unit->id, ['custom_fields' => $custom], true);
                        DB::table('unit_import_receipts')->insert(['unit_id' => $unit->id, 'input_hash' => $hash, 'source_data' => json_encode($row, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), 'created_at' => now(), 'updated_at' => now()]);

                        return ['unit_id' => $unit->id, 'unit_code' => $unit->unit_code, 'action' => 'create', 'needs_review' => empty($fields['installed_on'])];
                    });
                    $entry['row'] = $index + 2;
                    $result['preview'][] = $entry;
                    $result[$entry['action'] === 'skip' ? 'skipped' : 'created']++;
                } catch (\Throwable $error) {
                    if (! ($error instanceof ValidationException || $error instanceof HttpExceptionInterface)) {
                        report($error);
                    }
                    $message = $error instanceof ValidationException ? collect($error->errors())->flatten()->first() : ($error instanceof HttpExceptionInterface ? $error->getMessage() : __('Import failed for this row. Review its values.'));
                    $result['errors'][] = ['row' => $index + 2, 'message' => __($message)];
                }
            }
            $result['dry_run'] ? DB::rollBack() : DB::commit();
        } catch (\Throwable $error) {
            DB::rollBack();
            throw $error;
        }

        return response()->json($result);
    }
}
