<?php

namespace App\Modules\Core\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;

class Attachment extends Model
{
    use Auditable;

    protected $hidden = ['storage_key'];
}
