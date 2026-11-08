<?php

use App\Control\Http\ControlSetupController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => config('licensing.control_enabled') ? redirect('/control') : response('ManzomaERP API'));

Route::get('/control/setup', [ControlSetupController::class, 'show'])->name('control.setup');
Route::post('/control/setup', [ControlSetupController::class, 'store'])->middleware('throttle:5,1')->name('control.setup.store');
