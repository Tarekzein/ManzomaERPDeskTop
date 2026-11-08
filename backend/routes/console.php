<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('erp:maintenance-scan --all')->everyFifteenMinutes()->withoutOverlapping(30);

Schedule::command('erp:backup-all')->dailyAt('02:00')->timezone('Africa/Cairo')->withoutOverlapping(120);
Schedule::command('erp:control-backup')->dailyAt('03:00')->timezone('Africa/Cairo')->withoutOverlapping(120)
    ->when(fn () => config('licensing.control_enabled') && config('licensing.backup_enabled'));

Schedule::call(function () {
    if (config('licensing.control_enabled')) {
        DB::connection('control')->table('device_nonces')->where('expires_at', '<', now())->delete();
    }
})->name('control-prune-nonces')->everyTenMinutes()->withoutOverlapping();
