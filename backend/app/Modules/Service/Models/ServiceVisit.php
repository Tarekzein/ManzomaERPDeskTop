<?php

namespace App\Modules\Service\Models;

use App\Models\User;
use App\Modules\Inventory\Models\Warehouse;
use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ServiceVisit extends Model
{
    use Auditable;

    protected $table = 'service_visits';

    protected $casts = ['scheduled_start' => 'datetime', 'scheduled_end' => 'datetime', 'started_at' => 'datetime', 'completed_at' => 'datetime', 'completed_on' => 'date:Y-m-d', 'completion_time_known' => 'boolean', 'cost_total' => 'decimal:2'];

    public function request(): BelongsTo
    {
        return $this->belongsTo(ServiceRequest::class, 'request_id');
    }

    public function technician(): BelongsTo
    {
        return $this->belongsTo(User::class, 'technician_id');
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class, 'warehouse_id');
    }

    public function parts(): HasMany
    {
        return $this->hasMany(ServiceVisitPart::class, 'visit_id');
    }

    public function stageActions(): HasMany
    {
        return $this->hasMany(ServiceVisitStageAction::class, 'visit_id');
    }
}
