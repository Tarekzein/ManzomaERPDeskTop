<?php

namespace App\Modules\Core\Http\Controllers;

use App\Models\User;
use App\Modules\Core\Models\Branch;
use App\Modules\Core\Models\Tag;
use App\Modules\Core\Services\SettingsService;
use App\Modules\CRM\Models\LostReason;
use App\Modules\CRM\Models\Source;
use App\Modules\CRM\Models\Stage;
use App\Modules\Finance\Models\CashAccount;
use App\Modules\Finance\Models\CostCenter;
use App\Modules\Finance\Models\TaxRate;
use App\Modules\Inventory\Models\Brand;
use App\Modules\Inventory\Models\Category;
use App\Modules\Inventory\Models\PriceList;
use App\Modules\Inventory\Models\Unit;
use App\Modules\Inventory\Models\Warehouse;
use App\Support\ApiController;

/**
 * Everything the desktop caches at sign-in for pickers and labels, in one call.
 */
class LookupController extends ApiController
{
    public function __invoke(SettingsService $settings)
    {
        $user = $this->user();
        $cash = CashAccount::query()->where('is_active', true)->orderBy('type')->orderBy('code');
        if (! $user->can('treasury.all_accounts') && ! $user->isAdmin()) {
            $cash->where(fn ($q) => $q->whereNull('custodian_id')->orWhere('custodian_id', $user->id)->orWhere('id', $user->default_cash_account_id));
        }

        return response()->json([
            'settings' => $settings->publicSettings(),
            'branches' => Branch::query()->where('is_active', true)->orderBy('code')->get(['id', 'code', 'name', 'name_en']),
            'warehouses' => Warehouse::query()->where('is_active', true)->where('is_transit', false)->when($user->hasRole('technician') && ! $user->can('service.view_all'), fn ($q) => $q->where('technician_id', $user->id))->orderBy('code')->get(['id', 'code', 'name', 'name_en', 'branch_id', 'kind', 'technician_id']),
            'cash_accounts' => $cash->get(['id', 'type', 'code', 'name', 'name_en', 'branch_id', 'currency', 'bank_name']),
            'tax_rates' => TaxRate::query()->where('is_active', true)->orderBy('type')->orderBy('id')->get(['id', 'name', 'name_en', 'type', 'rate', 'is_default']),
            'units' => Unit::query()->orderBy('id')->get(['id', 'name', 'name_en', 'allow_fraction']),
            'categories' => Category::query()->orderBy('code')->get(['id', 'code', 'name', 'name_en', 'parent_id']),
            'brands' => Brand::query()->orderBy('name')->get(['id', 'name']),
            'price_lists' => PriceList::query()->where('is_active', true)->get(['id', 'name', 'name_en']),
            'cost_centers' => CostCenter::query()->where('is_active', true)->orderBy('code')->get(['id', 'code', 'name', 'name_en']),
            'users' => User::query()->where('is_active', true)->orderBy('name')->get(['id', 'name', 'username', 'is_salesperson', 'branch_id']),
            'technicians' => User::query()->where('is_active', true)->whereHas('roles', fn ($q) => $q->where('name', 'technician'))->orderBy('name')->get(['id', 'name']),
            'crm_stages' => Stage::query()->orderBy('sort_order')->get(),
            'crm_sources' => Source::query()->orderBy('id')->get(['id', 'name', 'name_en']),
            'crm_lost_reasons' => LostReason::query()->orderBy('id')->get(['id', 'name', 'name_en']),
            'tags' => Tag::query()->orderBy('name')->get(['id', 'name', 'color']),
        ]);
    }
}
