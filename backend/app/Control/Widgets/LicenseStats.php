<?php

namespace App\Control\Widgets;

use App\Control\Models\License;
use App\Control\Models\LicensedCompany;
use App\Control\Models\LicensedDevice;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

class LicenseStats extends StatsOverviewWidget
{
    protected function getStats(): array
    {
        return [
            Stat::make(__('control.active_licenses'), License::where('status', 'active')->where('expires_at', '>', now())->count()),
            Stat::make(__('control.recent_devices'), LicensedDevice::where('status', 'active')->where('last_seen_at', '>', now()->subMinutes(5))->count())->description(__('control.recent_help')),
            Stat::make(__('control.allocated_companies'), LicensedCompany::whereNotNull('registered_at')->count()),
            Stat::make(__('control.unused_reservations'), LicensedCompany::whereNull('registered_at')->count())->description(__('control.reservations_help')),
            Stat::make(__('control.expiring'), License::whereBetween('expires_at', [now(), now()->addDays(30)])->count()),
        ];
    }
}
