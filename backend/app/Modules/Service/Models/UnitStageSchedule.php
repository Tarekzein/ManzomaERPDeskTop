<?php

namespace App\Modules\Service\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UnitStageSchedule extends Model
{
    use Auditable;

    protected $table = 'unit_stage_schedules';

    protected $casts = ['last_replaced_on' => 'date:Y-m-d', 'next_due_on' => 'date:Y-m-d', 'paused' => 'boolean'];

    public function unit(): BelongsTo
    {
        return $this->belongsTo(CustomerUnit::class, 'unit_id');
    }
}
