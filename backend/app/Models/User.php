<?php

namespace App\Models;

use App\Modules\Core\Models\Branch;
use App\Support\Concerns\Auditable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

class User extends Authenticatable
{
    use Auditable, HasApiTokens, HasRoles;

    protected $guarded = ['id'];

    protected $hidden = ['password', 'remember_token'];

    protected string $guard_name = 'web';

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'is_active' => 'boolean',
            'is_salesperson' => 'boolean',
            'max_discount_percent' => 'decimal:2',
            'commission_rate' => 'decimal:2',
            'last_login_at' => 'datetime',
        ];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function isAdmin(): bool
    {
        return $this->hasRole('admin');
    }

    /**
     * Profile sent to the desktop after login and on refresh.
     */
    public function profile(): array
    {
        $permissions = $this->isAdmin()
            ? collect(config('erp.permissions'))->flatten()->values()->all()
            : $this->getAllPermissions()->pluck('name')->values()->all();

        return [
            'id' => $this->id,
            'name' => $this->name,
            'username' => $this->username,
            'email' => $this->email,
            'locale' => $this->locale,
            'branch_id' => $this->branch_id,
            'branch' => $this->branch?->only(['id', 'code', 'name', 'name_en']),
            'default_warehouse_id' => $this->default_warehouse_id,
            'default_cash_account_id' => $this->default_cash_account_id,
            'max_discount_percent' => $this->max_discount_percent,
            'is_salesperson' => $this->is_salesperson,
            'roles' => $this->getRoleNames()->values()->all(),
            'is_admin' => $this->isAdmin(),
            'permissions' => $permissions,
        ];
    }
}
