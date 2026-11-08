<?php

namespace App\Modules\Finance\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;

class FiscalYear extends Model
{
    use Auditable;

    protected $casts = ['start_date' => 'date:Y-m-d', 'end_date' => 'date:Y-m-d', 'closed_at' => 'datetime'];
}
