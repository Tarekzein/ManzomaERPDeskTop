<?php

namespace App\Modules\Service\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;

class ServiceVisitStageAction extends Model
{
    use Auditable;

    protected $table = 'service_visit_stage_actions';

    protected $casts = ['replaced_on' => 'date:Y-m-d'];
}
