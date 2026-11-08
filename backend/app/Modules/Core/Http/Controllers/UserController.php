<?php

namespace App\Modules\Core\Http\Controllers;

use App\Models\User;
use App\Support\ApiController;
use App\Support\BusinessException;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

class UserController extends ApiController
{
    public function index(Request $request)
    {
        $query = User::query()->with('roles:id,name', 'branch:id,name,name_en');
        if (! $this->can('users.manage')) {
            // Pickers (salesperson, owner) need names only.
            $query->select('id', 'name', 'username', 'is_salesperson', 'is_active', 'branch_id');
        }
        if ($request->boolean('salespeople')) {
            $query->where('is_salesperson', true);
        }
        if ($request->filled('active')) {
            $query->where('is_active', $request->boolean('active'));
        }
        $this->search($query, $request->query('search'), ['name', 'username', 'email', 'phone']);

        return $this->paginate($query, $request, ['id', 'name', 'username'], 'name');
    }

    public function store(Request $request)
    {
        $this->allow('users.manage');
        $data = $this->validated($request);
        $user = User::query()->create(collect($data)->except('roles')->all());
        $user->syncRoles($data['roles'] ?? []);

        return response()->json(['data' => $user->load('roles:id,name', 'branch:id,name')], 201);
    }

    public function show(User $user)
    {
        $this->allow('users.manage');

        return response()->json(['data' => $user->load('roles:id,name', 'branch:id,name')]);
    }

    public function update(Request $request, User $user)
    {
        $this->allow('users.manage');
        $data = $this->validated($request, $user);
        if (empty($data['password'])) {
            unset($data['password']);
        }
        if ($user->id === $this->user()->id && (($data['is_active'] ?? true) === false || (isset($data['roles']) && ! in_array('admin', $data['roles'], true) && $user->isAdmin()))) {
            throw BusinessException::make(__('erp.cannot_lock_yourself'), 'self_lockout');
        }
        $user->update(collect($data)->except('roles')->all());
        if (array_key_exists('roles', $data)) {
            $user->syncRoles($data['roles']);
        }
        if (($data['is_active'] ?? true) === false) {
            $user->tokens()->delete();
        }

        return response()->json(['data' => $user->refresh()->load('roles:id,name', 'branch:id,name')]);
    }

    public function roles()
    {
        return response()->json([
            'data' => Role::query()->with('permissions:id,name')->orderBy('id')->get()->map(fn (Role $r) => [
                'id' => $r->id,
                'name' => $r->name,
                'label' => config("erp.roles.{$r->name}.label", $r->name),
                'label_en' => config("erp.roles.{$r->name}.label_en", $r->name),
                'permissions' => $r->name === 'admin' ? ['*'] : $r->permissions->pluck('name')->values(),
                'users_count' => $r->users()->count(),
            ]),
            'catalog' => config('erp.permissions'),
        ]);
    }

    public function saveRole(Request $request, ?Role $role = null)
    {
        $this->allow('users.manage');
        $all = collect(config('erp.permissions'))->flatten()->all();
        $data = $request->validate([
            'name' => ['required', 'string', 'max:40', 'regex:/^[a-z0-9_]+$/', Rule::unique('roles', 'name')->ignore($role?->id)],
            'permissions' => ['array'],
            'permissions.*' => [Rule::in($all)],
        ]);
        if ($role && $role->name === 'admin') {
            throw BusinessException::make(__('erp.admin_role_fixed'), 'admin_role');
        }
        $role ??= Role::query()->create(['name' => $data['name'], 'guard_name' => 'web']);
        $role->update(['name' => $data['name']]);
        $role->syncPermissions($data['permissions'] ?? []);
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        return $this->roles();
    }

    private function validated(Request $request, ?User $user = null): array
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'username' => ['required', 'string', 'max:60', 'regex:/^[A-Za-z0-9_.\-]+$/', Rule::unique('users', 'username')->ignore($user?->id)],
            'email' => ['nullable', 'email', 'max:190', Rule::unique('users', 'email')->ignore($user?->id)],
            'phone' => ['nullable', 'string', 'max:40'],
            'password' => [$user ? 'nullable' : 'required', 'string', 'min:6', 'max:200'],
            'locale' => ['nullable', 'in:ar,en'],
            'branch_id' => ['nullable', 'exists:branches,id'],
            'default_warehouse_id' => ['nullable', 'exists:warehouses,id'],
            'default_cash_account_id' => ['nullable', 'exists:cash_accounts,id'],
            'max_discount_percent' => ['nullable', 'numeric', 'between:0,100'],
            'is_salesperson' => ['boolean'],
            'commission_rate' => ['nullable', 'numeric', 'between:0,100'],
            'is_active' => ['boolean'],
            'roles' => ['array'],
            'roles.*' => ['exists:roles,name'],
        ]);
        if (array_key_exists('commission_rate', $data)) {
            $data['commission_rate'] ??= 0;
        }

        return $data;
    }
}
