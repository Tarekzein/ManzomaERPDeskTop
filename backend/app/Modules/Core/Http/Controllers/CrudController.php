<?php

namespace App\Modules\Core\Http\Controllers;

use App\Modules\Core\Models\Branch;
use App\Modules\Core\Models\Tag;
use App\Modules\CRM\Models\LostReason;
use App\Modules\CRM\Models\Source;
use App\Modules\CRM\Models\Stage;
use App\Modules\Finance\Models\CostCenter;
use App\Modules\Finance\Models\TaxRate;
use App\Modules\Inventory\Models\Brand;
use App\Modules\Inventory\Models\Category;
use App\Modules\Inventory\Models\PriceList;
use App\Modules\Inventory\Models\Unit;
use App\Modules\Inventory\Models\Warehouse;
use App\Support\ApiController;
use App\Support\BusinessException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;

/**
 * Generic list/create/update/delete for small master tables
 * (branches, units, categories, warehouses, cost centers…).
 */
class CrudController extends ApiController
{
    /**
     * Resource map: model, view and manage permissions, validation rules,
     * searchable columns, default sort, eager relations.
     */
    public static function resources(): array
    {
        $unique = fn (string $table, string $column = 'code') => fn (?Model $m) => 'unique:'.$table.','.$column.($m ? ','.$m->getKey() : '');

        return [
            'branches' => [
                'model' => Branch::class, 'view' => null, 'manage' => 'settings.manage',
                'rules' => fn ($m) => ['code' => ['required', 'string', 'max:20', $unique('branches')($m)], 'name' => 'required|string|max:120', 'name_en' => 'nullable|string|max:120', 'phone' => 'nullable|string|max:40', 'address' => 'nullable|string|max:250', 'eta_branch_code' => 'nullable|string|max:20', 'is_active' => 'boolean'],
                'search' => ['code', 'name', 'name_en'], 'sort' => 'code',
            ],
            'units' => [
                'model' => Unit::class, 'view' => null, 'manage' => 'products.manage',
                'rules' => fn ($m) => ['name' => 'required|string|max:40', 'name_en' => 'nullable|string|max:40', 'allow_fraction' => 'boolean'],
                'search' => ['name', 'name_en'], 'sort' => 'id',
            ],
            'categories' => [
                'model' => Category::class, 'view' => null, 'manage' => 'products.manage',
                'rules' => fn ($m) => ['code' => ['required', 'string', 'max:30', $unique('categories')($m)], 'name' => 'required|string|max:120', 'name_en' => 'nullable|string|max:120', 'parent_id' => 'nullable|exists:categories,id'],
                'search' => ['code', 'name', 'name_en'], 'sort' => 'code', 'with' => ['parent:id,name,name_en'],
            ],
            'brands' => [
                'model' => Brand::class, 'view' => null, 'manage' => 'products.manage',
                'rules' => fn ($m) => ['name' => ['required', 'string', 'max:120', $unique('brands', 'name')($m)]],
                'search' => ['name'], 'sort' => 'name',
            ],
            'warehouses' => [
                'model' => Warehouse::class, 'view' => null, 'manage' => 'settings.manage',
                'rules' => fn ($m) => ['code' => ['required', 'string', 'max:20', $unique('warehouses')($m)], 'name' => 'required|string|max:120', 'name_en' => 'nullable|string|max:120', 'branch_id' => 'nullable|exists:branches,id', 'keeper_id' => 'nullable|exists:users,id', 'kind' => 'sometimes|in:store,van', 'technician_id' => 'nullable|exists:users,id', 'address' => 'nullable|string|max:250', 'is_active' => 'boolean'],
                'search' => ['code', 'name', 'name_en'], 'sort' => 'code', 'with' => ['branch:id,name,name_en', 'keeper:id,name'],
                'scope' => fn ($q) => $q->where('is_transit', false),
            ],
            'price-lists' => [
                'model' => PriceList::class, 'view' => null, 'manage' => 'pricing.manage',
                'rules' => fn ($m) => ['name' => 'required|string|max:120', 'name_en' => 'nullable|string|max:120', 'is_active' => 'boolean'],
                'search' => ['name', 'name_en'], 'sort' => 'id',
            ],
            'cost-centers' => [
                'model' => CostCenter::class, 'view' => null, 'manage' => 'accounts.manage',
                'rules' => fn ($m) => ['code' => ['required', 'string', 'max:30', $unique('cost_centers')($m)], 'name' => 'required|string|max:120', 'name_en' => 'nullable|string|max:120', 'is_active' => 'boolean'],
                'search' => ['code', 'name', 'name_en'], 'sort' => 'code',
            ],
            'tax-rates' => [
                'model' => TaxRate::class, 'view' => null, 'manage' => 'taxes.manage',
                'rules' => fn ($m) => ['name' => 'required|string|max:120', 'name_en' => 'nullable|string|max:120', 'type' => 'required|in:vat,wht', 'rate' => 'required|numeric|between:0,100', 'eta_type' => 'nullable|string|max:10', 'eta_subtype' => 'nullable|string|max:10', 'is_default' => 'boolean', 'is_active' => 'boolean'],
                'search' => ['name', 'name_en'], 'sort' => 'id',
            ],
            'crm-stages' => [
                'model' => Stage::class, 'view' => null, 'manage' => 'crm.settings',
                'rules' => fn ($m) => ['name' => 'required|string|max:120', 'name_en' => 'nullable|string|max:120', 'probability' => 'required|integer|between:0,100', 'sort_order' => 'integer|min:0', 'is_won' => 'boolean', 'is_lost' => 'boolean', 'color' => 'nullable|string|max:20'],
                'search' => ['name', 'name_en'], 'sort' => 'sort_order',
            ],
            'crm-sources' => [
                'model' => Source::class, 'view' => null, 'manage' => 'crm.settings',
                'rules' => fn ($m) => ['name' => 'required|string|max:120', 'name_en' => 'nullable|string|max:120'],
                'search' => ['name', 'name_en'], 'sort' => 'id',
            ],
            'crm-lost-reasons' => [
                'model' => LostReason::class, 'view' => null, 'manage' => 'crm.settings',
                'rules' => fn ($m) => ['name' => 'required|string|max:120', 'name_en' => 'nullable|string|max:120'],
                'search' => ['name', 'name_en'], 'sort' => 'id',
            ],
            'tags' => [
                'model' => Tag::class, 'view' => null, 'manage' => 'customers.manage',
                'rules' => fn ($m) => ['name' => ['required', 'string', 'max:60', $unique('tags', 'name')($m)], 'color' => 'nullable|string|max:20'],
                'search' => ['name'], 'sort' => 'name',
            ],
        ];
    }

    private function config(string $resource): array
    {
        $config = self::resources()[$resource] ?? null;
        abort_unless($config, 404);

        return $config;
    }

    public function index(Request $request, string $resource)
    {
        $config = $this->config($resource);
        if ($config['view']) {
            $this->allow($config['view']);
        }
        $query = $config['model']::query()->with($config['with'] ?? []);
        if (isset($config['scope'])) {
            $config['scope']($query);
        }
        $this->search($query, $request->query('search'), $config['search']);
        if ($request->has('per_page') === false) {
            $request->query->set('per_page', 0);
        }

        return $this->paginate($query, $request, array_merge(['id'], $config['search'], [$config['sort']]), $config['sort']);
    }

    public function store(Request $request, string $resource)
    {
        $config = $this->config($resource);
        $this->allow($config['manage']);
        $data = $request->validate($config['rules'](null));
        $model = $config['model']::query()->create($data);
        $this->afterSave($resource, $model);

        return response()->json(['data' => $model->load($config['with'] ?? [])], 201);
    }

    public function update(Request $request, string $resource, int $id)
    {
        $config = $this->config($resource);
        $this->allow($config['manage']);
        $model = $config['model']::query()->findOrFail($id);
        $data = $request->validate($config['rules']($model));
        $model->update($data);
        $this->afterSave($resource, $model);

        return response()->json(['data' => $model->refresh()->load($config['with'] ?? [])]);
    }

    public function destroy(string $resource, int $id)
    {
        $config = $this->config($resource);
        $this->allow($config['manage']);
        $model = $config['model']::query()->findOrFail($id);
        try {
            $model->delete();
        } catch (QueryException) {
            throw BusinessException::make(__('erp.record_in_use'), 'in_use');
        }

        return response()->json(['ok' => true]);
    }

    private function afterSave(string $resource, Model $model): void
    {
        // Only one default VAT rate.
        if ($resource === 'tax-rates' && $model->is_default) {
            $model->newQuery()->where('id', '!=', $model->id)->where('type', $model->type)->update(['is_default' => false]);
        }
    }
}
