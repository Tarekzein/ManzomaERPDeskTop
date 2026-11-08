<?php

namespace App\Modules\Finance\Services;

use App\Modules\Finance\Models\Account;
use App\Support\BusinessException;

/**
 * Resolves the system accounts the posting engine needs by their stable key,
 * so a company can rename or renumber its chart without breaking posting.
 */
class AccountResolver
{
    private array $cache = [];

    public function key(string $key): Account
    {
        if (! isset($this->cache[$key])) {
            $account = Account::query()->where('system_key', $key)->where('is_active', true)->first();
            if (! $account) {
                throw BusinessException::make(__('erp.system_account_missing', ['key' => $key]), 'system_account_missing', ['key' => $key]);
            }
            $this->cache[$key] = $account;
        }

        return $this->cache[$key];
    }

    public function id(string $key): int
    {
        return (int) $this->key($key)->id;
    }

    public function flush(): void
    {
        $this->cache = [];
    }
}
