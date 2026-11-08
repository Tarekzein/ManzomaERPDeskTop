<?php

namespace App\Modules\Service\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;

class MessageTemplate extends Model
{
    use Auditable;

    protected $table = 'message_templates';

    protected $casts = ['active' => 'boolean'];
}
