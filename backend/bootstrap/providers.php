<?php

use App\Providers\AppServiceProvider;
use App\Providers\ControlServiceProvider;
use App\Providers\Filament\ControlPanelProvider;

return [
    AppServiceProvider::class,
    ControlServiceProvider::class,
    ControlPanelProvider::class,
];
