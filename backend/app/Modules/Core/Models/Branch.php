<?php

namespace App\Modules\Core\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;

class Branch extends Model
{
    use Auditable;

    protected $casts = ['is_active' => 'boolean'];
}
