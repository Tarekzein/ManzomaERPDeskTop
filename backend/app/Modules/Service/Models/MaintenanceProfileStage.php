<?php

namespace App\Modules\Service\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;

class MaintenanceProfileStage extends Model
{
    use Auditable;

    protected $table = 'maintenance_profile_stages';

    protected $casts = [];
}
