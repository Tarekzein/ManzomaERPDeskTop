<?php

namespace App\Modules\Service\Models;

use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\ProductSerial;
use App\Modules\Parties\Models\Party;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CustomerUnit extends Model
{
    use Auditable;

    protected $table = 'customer_units';

    protected $casts = ['purchased_on' => 'date:Y-m-d', 'installed_on' => 'date:Y-m-d', 'warranty_starts_on' => 'date:Y-m-d', 'warranty_ends_on' => 'date:Y-m-d'];

    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class, 'party_id');
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'product_id');
    }

    public function serial(): BelongsTo
    {
        return $this->belongsTo(ProductSerial::class, 'serial_id');
    }

    public function address(): BelongsTo
    {
        return $this->belongsTo(PartyAddress::class, 'address_id');
    }

    public function profile(): BelongsTo
    {
        return $this->belongsTo(MaintenanceProfile::class, 'profile_id');
    }

    public function schedules(): HasMany
    {
        return $this->hasMany(UnitStageSchedule::class, 'unit_id')->orderBy('id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(MaintenanceEvent::class, 'unit_id');
    }
}
