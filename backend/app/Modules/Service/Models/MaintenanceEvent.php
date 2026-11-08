<?php

namespace App\Modules\Service\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;

class MaintenanceEvent extends Model
{
    use Auditable;

    protected $table = 'maintenance_events';

    protected $casts = ['event_on' => 'date:Y-m-d', 'changes' => 'array'];
}
