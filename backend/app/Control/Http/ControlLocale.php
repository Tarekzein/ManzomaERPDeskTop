<?php

namespace App\Control\Http;

use Closure;
use Illuminate\Http\Request;

class ControlLocale
{
    public function handle(Request $request, Closure $next)
    {
        if ($request->is('control*') || $request->is('livewire/*')) {
            $selected = $request->query('lang');
            if (in_array($selected, ['ar', 'en'], true)) {
                $request->session()->put('control.locale', $selected);
            }
            $locale = $request->session()->get('control.locale', config('app.locale', 'ar'));
            app()->setLocale(in_array($locale, ['ar', 'en'], true) ? $locale : 'ar');
        }

        return $next($request);
    }
}
