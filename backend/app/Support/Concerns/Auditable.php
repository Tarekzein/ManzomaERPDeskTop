<?php

namespace App\Support\Concerns;

use App\Modules\Core\Services\AuditService;

/**
 * Records create, update and delete of the model in the audit log.
 */
trait Auditable
{
    public static function bootAuditable(): void
    {
        static::created(fn ($model) => app(AuditService::class)->record('created', $model));
        static::updated(function ($model) {
            $changes = collect($model->getChanges())->except(['updated_at', 'created_at', 'password', 'remember_token'])->all();
            if ($changes === []) {
                return;
            }
            $original = collect($model->getOriginal())->only(array_keys($changes))->all();
            app(AuditService::class)->record('updated', $model, null, ['old' => $original, 'new' => $changes]);
        });
        static::deleted(fn ($model) => app(AuditService::class)->record('deleted', $model));
    }

    public function auditLabel(): string
    {
        return (string) ($this->number ?? $this->code ?? $this->name ?? $this->title ?? $this->getKey());
    }
}
