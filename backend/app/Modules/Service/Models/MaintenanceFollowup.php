<?php

namespace App\Modules\Service\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MaintenanceFollowup extends Model
{
    use Auditable;

    protected $table = 'maintenance_followups';

    protected $casts = ['due_on' => 'date:Y-m-d', 'next_contact_on' => 'date:Y-m-d'];

    public function schedule(): BelongsTo
    {
        return $this->belongsTo(UnitStageSchedule::class, 'schedule_id');
    }

    public function contacts(): HasMany
    {
        return $this->hasMany(FollowupContact::class, 'followup_id');
    }
}
