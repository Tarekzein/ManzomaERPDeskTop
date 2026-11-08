<?php

namespace App\Modules\Service\Models;

use App\Modules\Inventory\Models\Product;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ServiceVisitPart extends Model
{
    use Auditable;

    protected $table = 'service_visit_parts';

    protected $casts = ['serial_numbers' => 'array'];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'product_id');
    }

    public function visit(): BelongsTo
    {
        return $this->belongsTo(ServiceVisit::class, 'visit_id');
    }
}
