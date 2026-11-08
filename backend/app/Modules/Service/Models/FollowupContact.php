<?php

namespace App\Modules\Service\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;

class FollowupContact extends Model
{
    use Auditable;

    protected $table = 'followup_contacts';

    protected $casts = [];
}
