<?php

namespace App\Modules\Core\Http\Controllers;

use App\Models\User;
use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\SettingsService;
use App\Modules\Inventory\Models\StockMove;
use App\Support\ApiController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class SettingsController extends ApiController
{
    /** Keys an administrator may change from the desktop. */
    private const EDITABLE = [
        'company.name', 'company.name_en', 'company.tax_number', 'company.commercial_register', 'company.address',
        'company.phone', 'company.email', 'company.logo', 'company.activity_code',
        'accounting.costing_method',
        'sales.price_includes_tax', 'sales.block_overdue_days', 'sales.default_payment_terms', 'sales.invoice_footer',
        'sales.require_salesperson', 'tax.wht_threshold', 'tax.default_vat_id', 'inventory.allow_negative',
        'inventory.expiry_alert_days', 'security.idle_lock_minutes', 'print.receipt_header', 'print.receipt_footer',
        'print.show_logo', 'print.show_qr',
        'maintenance.reminder_days', 'maintenance.overdue_days', 'maintenance.owner_id', 'inventory.alert_owner_id',
    ];

    public function index(SettingsService $settings)
    {
        $values = $settings->publicSettings();
        foreach (config('erp.numbering') as $type => $prefix) {
            $values["numbering.prefix.{$type}"] = $settings->get("numbering.prefix.{$type}", $prefix);
        }

        return response()->json(['data' => $values]);
    }

    public function update(Request $request, SettingsService $settings, AuditService $audit)
    {
        $this->allow('settings.manage');
        // Validate the container separately: dotted keys without individual rules
        // must survive validation alongside fields with specialized validation.
        $data = $request->validate(['values' => ['required', 'array']]);
        Validator::make($data['values'], [
            'company\.name' => ['sometimes', 'required', 'string', 'max:200'],
            'company\.name_en' => ['sometimes', 'nullable', 'string', 'max:200'],
            'company\.email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'company\.logo' => ['sometimes', 'nullable', 'string', 'max:700000'],
            'accounting\.costing_method' => ['sometimes', 'in:average,fifo'],
            'sales\.price_includes_tax' => ['sometimes', 'boolean'],
            'sales\.require_salesperson' => ['sometimes', 'boolean'],
            'sales\.default_payment_terms' => ['sometimes', 'integer', 'between:0,3650'],
            'sales\.block_overdue_days' => ['sometimes', 'integer', 'between:0,3650'],
            'tax\.wht_threshold' => ['sometimes', 'numeric', 'min:0'],
            'tax\.default_vat_id' => ['sometimes', 'nullable', Rule::exists('tax_rates', 'id')->where('type', 'vat')],
            'inventory\.allow_negative' => ['sometimes', 'boolean'],
            'inventory\.expiry_alert_days' => ['sometimes', 'integer', 'between:0,3650'],
            'security\.idle_lock_minutes' => ['sometimes', 'integer', 'between:0,1440'],
            'print\.show_logo' => ['sometimes', 'boolean'], 'print\.show_qr' => ['sometimes', 'boolean'],
            'maintenance\.reminder_days' => ['sometimes', 'integer', 'between:0,365'],
            'maintenance\.overdue_days' => ['sometimes', 'integer', 'between:1,365'],
            'maintenance\.owner_id' => ['sometimes', 'nullable', 'integer', Rule::exists('users', 'id')->where('is_active', true)],
            'inventory\.alert_owner_id' => ['sometimes', 'nullable', 'integer', Rule::exists('users', 'id')->where('is_active', true)],
        ])->validate();
        foreach (['maintenance.owner_id' => ['service.manage', 'service.view_all'], 'inventory.alert_owner_id' => ['stock.view']] as $key => $permissions) {
            if (! empty($data['values'][$key])) {
                $owner = User::findOrFail($data['values'][$key]);
                if (! collect($permissions)->every(fn ($permission) => $owner->can($permission))) {
                    throw ValidationException::withMessages([$key => __('Choose an owner with access to the assigned work.')]);
                }
            }
        }
        $values = [];
        foreach ($data['values'] as $key => $value) {
            if (in_array($key, self::EDITABLE, true) || (str_starts_with($key, 'numbering.prefix.') && array_key_exists(substr($key, 17), config('erp.numbering')) && preg_match('/^[A-Z0-9\-]{1,8}$/', (string) $value))) {
                $values[$key] = $value;
            }
        }
        if (isset($values['accounting.costing_method']) && $values['accounting.costing_method'] !== $settings->get('accounting.costing_method')
            && StockMove::query()->exists()) {
            return response()->json(['message' => __('erp.costing_method_locked'), 'code' => 'costing_locked'], 422);
        }
        $settings->setMany($values);
        $audit->record('settings', null, implode(', ', array_keys($values)));

        return $this->index($settings);
    }
}
