<?php

namespace App\Modules\CRM\Models;

use App\Models\User;
use App\Modules\Parties\Models\Party;
use App\Support\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Task extends Model
{
    protected $table = 'crm_tasks';

    protected $casts = ['due_at' => 'datetime', 'remind_at' => 'datetime', 'completed_at' => 'datetime'];

    public function lead(): BelongsTo
    {
        return $this->belongsTo(Lead::class);
    }

    public function party(): BelongsTo
    {
        return $this->belongsTo(Party::class);
    }

    public function opportunity(): BelongsTo
    {
        return $this->belongsTo(Opportunity::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }
}
