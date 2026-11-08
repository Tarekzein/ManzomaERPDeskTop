<?php

namespace App\Modules\Core\Services;

use App\Modules\Core\Models\Setting;

/**
 * Company settings stored as JSON values, cached for the request.
 */
class SettingsService
{
    private ?array $cache = null;

    public function all(): array
    {
        if ($this->cache === null) {
            $this->cache = config('erp.settings', []);
            foreach (Setting::query()->get() as $row) {
                $this->cache[$row->key] = json_decode((string) $row->value, true);
            }
        }

        return $this->cache;
    }

    public function get(string $key, mixed $default = null): mixed
    {
        $all = $this->all();

        return array_key_exists($key, $all) && $all[$key] !== null ? $all[$key] : $default;
    }

    public function set(string $key, mixed $value): void
    {
        Setting::query()->updateOrCreate(['key' => $key], ['value' => json_encode($value, JSON_UNESCAPED_UNICODE)]);
        if ($this->cache !== null) {
            $this->cache[$key] = $value;
        }
    }

    public function setMany(array $values): void
    {
        foreach ($values as $key => $value) {
            $this->set($key, $value);
        }
    }

    public function flush(): void
    {
        $this->cache = null;
    }

    public function currency(): string
    {
        return (string) $this->get('company.currency', 'EGP');
    }

    /**
     * Settings safe to send to any signed-in user (no secrets are stored here,
     * but keep the shape explicit).
     */
    public function publicSettings(): array
    {
        return collect($this->all())
            ->filter(fn ($v, $k) => str_starts_with($k, 'company.') || str_starts_with($k, 'sales.') || str_starts_with($k, 'inventory.')
                || str_starts_with($k, 'maintenance.') || str_starts_with($k, 'accounting.') || str_starts_with($k, 'tax.') || str_starts_with($k, 'security.') || str_starts_with($k, 'numbering.') || str_starts_with($k, 'print.'))
            ->all();
    }
}
