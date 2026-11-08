<?php

namespace App\Control\Models;

use Filament\Models\Contracts\FilamentUser;
use Filament\Panel;
use Illuminate\Foundation\Auth\User as Authenticatable;

class ControlAdmin extends Authenticatable implements FilamentUser
{
    protected $attributes = ['active' => true];

    protected $connection = 'control';

    protected $guarded = [];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return ['password' => 'hashed', 'active' => 'boolean'];
    }

    public function canAccessPanel(Panel $panel): bool
    {
        return $panel->getId() === 'control' && $this->active && config('licensing.control_enabled');
    }
}
