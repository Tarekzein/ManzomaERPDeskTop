<?php

namespace App\Modules\Inventory\Models;

use App\Models\User;
use App\Modules\Core\Models\Branch;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Warehouse extends Model
{
    use Auditable;

    protected $casts = ['is_transit' => 'boolean', 'is_active' => 'boolean'];

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function keeper(): BelongsTo
    {
        return $this->belongsTo(User::class, 'keeper_id');
    }
}
