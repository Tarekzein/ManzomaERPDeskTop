<?php

namespace App\Modules\Parties\Services;

use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Parties\Models\Party;
use App\Modules\Service\Models\PartyAddress;
use App\Modules\Service\Services\CustomerUnitService;
use App\Modules\Service\Services\MaintenanceService;
use App\Modules\Trading\Services\TradingService;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/** Runs inside the customer transaction: a bad child record rolls back the whole intake. */
class CustomerIntakeService
{
    public function record(Party $party, array $entry): array
    {
        abort_unless($party->is_customer, 422, 'Products can only be attached to a customer.');
        if (($entry['mode'] ?? null) === 'existing') {
            abort_unless(auth()->user()->can('service.manage') && auth()->user()->can('service.view_all'), 403);
        } elseif (($entry['mode'] ?? null) === 'new_sale') {
            abort_unless(auth()->user()->can('sales.invoices'), 403);
        }
        Validator::make(['product_entry' => $entry], [
            'product_entry' => 'array:mode,product_id,profile_id,unit_code,serial_number,purchased_on,installed_on,warranty_starts_on,warranty_ends_on,notes,quantity,unit_price,warehouse_id,custom_fields,form_version,lock_version,address_form',
            'product_entry.mode' => 'required|in:existing,new_sale',
            'product_entry.product_id' => 'required|integer|exists:products,id',
            'product_entry.purchased_on' => 'nullable|date_format:Y-m-d|before_or_equal:'.MaintenanceService::today(),
            'product_entry.installed_on' => 'nullable|date_format:Y-m-d|before_or_equal:'.MaintenanceService::today(),
            'product_entry.custom_fields' => 'sometimes|array',
            'product_entry.form_version' => 'sometimes|integer|min:0',
            'product_entry.lock_version' => 'sometimes|integer|min:0',
            'product_entry.address_form' => 'sometimes|array:custom_fields,form_version,lock_version',
            'product_entry.address_form.custom_fields' => 'sometimes|array',
            'product_entry.address_form.form_version' => 'sometimes|integer|min:0',
            'product_entry.address_form.lock_version' => 'sometimes|integer|min:0',
        ])->validate();
        $forms = app(DynamicFormService::class);
        if ($entry['mode'] === 'new_sale') {
            abort_unless(auth()->user()->can('sales.invoices'), 403);
            Validator::make(['product_entry' => $entry], [
                'product_entry.quantity' => 'required|numeric|gt:0|max:10000',
                'product_entry.unit_price' => 'required|numeric|min:0',
                'product_entry.warehouse_id' => 'required|integer|exists:warehouses,id',
                // Installation and serial assignment happen against the posted sale.
                'product_entry.profile_id' => 'prohibited', 'product_entry.installed_on' => 'prohibited',
                'product_entry.serial_number' => 'prohibited', 'product_entry.address_form' => 'prohibited',
            ])->validate();
            $invoice = app(TradingService::class)->save('sales_invoice', [
                'party_id' => $party->id, 'warehouse_id' => $entry['warehouse_id'], 'date' => $entry['purchased_on'] ?? MaintenanceService::today(),
                'lines' => [['product_id' => $entry['product_id'], 'quantity' => $entry['quantity'], 'unit_price' => $entry['unit_price']]],
            ]);
            $this->saveFields($forms, 'sales_invoice', $invoice->id, $entry, 'product_entry');

            return ['invoice_id' => $invoice->id, 'status' => 'draft'];
        }

        abort_unless(auth()->user()->can('service.manage') && auth()->user()->can('service.view_all'), 403);
        $service = app(CustomerUnitService::class);
        $attributes = collect($entry)->only(['product_id', 'profile_id', 'unit_code', 'serial_number', 'purchased_on', 'warranty_starts_on', 'warranty_ends_on', 'notes'])->all();
        $attributes['party_id'] = $party->id;
        $attributes['unit_code'] = $attributes['unit_code'] ?? 'WF-'.Str::upper(Str::random(10));
        try {
            Validator::make($attributes, $service->rules())->validate();
            if ($party->address || $party->city) {
                $address = PartyAddress::query()->create(['party_id' => $party->id, 'label' => 'المنزل / Home', 'city' => $party->city, 'street' => $party->address, 'is_default' => true]);
                $this->saveFields($forms, 'party-addresses', $address->id, $entry['address_form'] ?? [], 'address_form');
                $attributes['address_id'] = $address->id;
            }
            $unit = $service->create($attributes);
            $forms->save('customer-units', $unit->id, $entry, true);
            if (! empty($entry['installed_on'])) {
                app(MaintenanceService::class)->install($unit, $entry['installed_on']);
            }
        } catch (ValidationException $error) {
            throw ValidationException::withMessages(collect($error->errors())->mapWithKeys(fn ($messages, $key) => ['product_entry.'.$key => $messages])->all());
        }

        return ['unit_id' => $unit->id, 'address_id' => $unit->address_id, 'status' => $unit->refresh()->status];
    }

    private function saveFields(DynamicFormService $forms, string $key, int $id, array $entry, string $prefix): void
    {
        try {
            $forms->save($key, $id, $entry, true);
        } catch (ValidationException $error) {
            throw ValidationException::withMessages(collect($error->errors())->mapWithKeys(fn ($messages, $key) => [$prefix.'.'.$key => $messages])->all());
        }
    }
}
