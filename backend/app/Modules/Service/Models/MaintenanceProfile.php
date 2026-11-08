<?php

namespace App\Modules\Service\Models;

use App\Modules\Inventory\Models\Product;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MaintenanceProfile extends Model
{
    use Auditable;

    protected $table = 'maintenance_profiles';

    protected $casts = ['active' => 'boolean'];

    public function stages(): HasMany
    {
        return $this->hasMany(MaintenanceProfileStage::class, 'profile_id')->orderBy('sort_order')->orderBy('id');
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'product_id');
    }
}
