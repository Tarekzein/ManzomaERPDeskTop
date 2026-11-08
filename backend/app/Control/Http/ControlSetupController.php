<?php

namespace App\Control\Http;

use App\Control\Models\ControlAdmin;
use App\Control\Models\LicenseEvent;
use App\Control\Services\SigningKeys;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

class ControlSetupController
{
    public static function allowed(Request $request): bool
    {
        return config('licensing.control_enabled') && config('licensing.web_setup') && app()->environment('local')
            && in_array($request->server('REMOTE_ADDR'), ['127.0.0.1', '::1'], true)
            && in_array($request->getHost(), ['localhost', '127.0.0.1', '::1', '[::1]'], true);
    }

    public function show(Request $request)
    {
        abort_unless(self::allowed($request), 404);
        if (ControlAdmin::exists()) {
            return redirect('/control/login');
        }

        return view('control.setup');
    }

    public function store(Request $request, SigningKeys $keys)
    {
        abort_unless(self::allowed($request), 404);
        $data = $request->validate(['name' => 'required|string|max:120', 'email' => 'required|email|max:255', 'password' => 'required|string|min:12|max:200|confirmed']);
        $admin = DB::connection('control')->transaction(function () use ($data, $keys) {
            DB::connection('control')->table('control_bootstrap')->where('id', 1)->lockForUpdate()->firstOrFail();
            abort_if(ControlAdmin::exists(), 409, 'An operator already exists. Sign in instead.');
            $keys->ensure();
            $admin = ControlAdmin::create($data + ['active' => true]);
            LicenseEvent::create(['license_id' => null, 'actor_id' => $admin->id, 'event' => 'operator.initialized', 'details' => ['email' => $admin->email], 'created_at' => now()]);

            return $admin;
        }, 3);
        Auth::guard('control')->login($admin);
        $request->session()->regenerate();

        return redirect('/control');
    }
}
