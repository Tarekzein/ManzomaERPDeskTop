<?php

namespace App\Modules\Core\Models;

use App\Support\Concerns\Auditable;
use App\Support\Model;

class CustomField extends Model
{
    use Auditable;

    protected $table = 'custom_field_definitions';

    protected $casts = ['required' => 'boolean', 'active' => 'boolean', 'default_json' => 'json', 'validation_json' => 'array', 'options_json' => 'array', 'role_access_json' => 'array', 'usage_flags_json' => 'array', 'applicable_forms_json' => 'array', 'condition_json' => 'array'];
}
