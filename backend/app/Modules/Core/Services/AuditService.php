<?php

namespace App\Modules\Core\Services;

use App\Modules\Core\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;

class AuditService
{
    private bool $enabled = true;

    public function record(string $action, ?Model $model = null, ?string $description = null, ?array $changes = null): void
    {
        if (! $this->enabled) {
            return;
        }

        AuditLog::query()->create([
            'user_id' => auth()->id(),
            'action' => $action,
            'auditable_type' => $model ? class_basename($model) : null,
            'auditable_id' => $model?->getKey(),
            'description' => $description ?? ($model && method_exists($model, 'auditLabel') ? $model->auditLabel() : null),
            'changes' => $changes,
            'ip_address' => request()?->ip(),
            'created_at' => now(),
        ]);
    }

    /**
     * Run a block without audit rows (installer, demo data).
     */
    public function quietly(callable $callback): mixed
    {
        $previous = $this->enabled;
        $this->enabled = false;
        try {
            return $callback();
        } finally {
            $this->enabled = $previous;
        }
    }
}
