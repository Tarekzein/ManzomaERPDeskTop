<?php

namespace App\Modules\Core\Services;

use App\Modules\Finance\Models\FiscalYear;
use App\Support\BusinessException;

/**
 * Nothing may be posted, voided or changed on or before the lock date, or
 * inside a closed fiscal year.
 */
class PeriodGuard
{
    public function __construct(private readonly SettingsService $settings) {}

    public function assertOpen(string $date): void
    {
        $date = substr($date, 0, 10);
        $lock = $this->settings->get('accounting.lock_date');
        if ($lock && $date <= $lock) {
            throw BusinessException::make(__('erp.period_locked', ['date' => $lock]), 'period_locked', ['lock_date' => $lock]);
        }

        $closed = FiscalYear::query()
            ->where('status', 'closed')
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->first();
        if ($closed) {
            throw BusinessException::make(__('erp.fiscal_year_closed', ['year' => $closed->name]), 'fiscal_year_closed');
        }
    }
}
