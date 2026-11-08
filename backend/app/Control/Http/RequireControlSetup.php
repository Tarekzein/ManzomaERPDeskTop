<?php

namespace App\Control\Http;

use App\Control\Models\ControlAdmin;
use Closure;
use Illuminate\Http\Request;

class RequireControlSetup
{
    public function handle(Request $request, Closure $next)
    {
        if (ControlSetupController::allowed($request) && ! ControlAdmin::exists()) {
            return redirect('/control/setup');
        }

        return $next($request);
    }
}
