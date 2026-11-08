<?php

namespace App\Modules\Core\Models;

use App\Support\Model;

class FormDefinition extends Model
{
    protected $casts = ['layout_json' => 'array', 'fields_json' => 'array', 'published_at' => 'datetime'];
}
