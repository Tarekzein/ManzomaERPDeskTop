<?php

namespace App\Modules\Core\Http\Controllers;

use App\Models\User;
use App\Modules\Core\Services\AuditService;
use App\Support\ApiController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\Rules\Password;

class AuthController extends ApiController
{
    public function login(Request $request, AuditService $audit)
    {
        $data = $request->validate([
            'username' => ['required', 'string', 'max:120'],
            'password' => ['required', 'string', 'max:200'],
            'device_name' => ['nullable', 'string', 'max:120'],
        ]);
        $key = 'login:'.strtolower($data['username']).'|'.$request->ip();
        if (RateLimiter::tooManyAttempts($key, 8)) {
            return response()->json(['message' => __('erp.too_many_attempts', ['seconds' => RateLimiter::availableIn($key)]), 'code' => 'throttled'], 429);
        }

        $user = User::query()->where('username', $data['username'])->orWhere('email', $data['username'])->first();
        if (! $user || ! Hash::check($data['password'], $user->password)) {
            RateLimiter::hit($key, 300);

            return response()->json(['message' => __('erp.invalid_credentials'), 'code' => 'invalid_credentials'], 422);
        }
        if (! $user->is_active) {
            return response()->json(['message' => __('erp.user_inactive'), 'code' => 'user_inactive'], 403);
        }
        RateLimiter::clear($key);

        $token = $user->createToken($data['device_name'] ?? 'desktop')->plainTextToken;
        $user->forceFill(['last_login_at' => now()])->saveQuietly();
        auth()->setUser($user);
        $audit->record('login', $user, $data['device_name'] ?? 'desktop');

        return response()->json(['token' => $token, 'user' => $user->profile()]);
    }

    public function me()
    {
        return response()->json(['user' => $this->user()->profile()]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()?->delete();

        return response()->json(['ok' => true]);
    }

    /**
     * Unlock after idle: re-check the password without issuing a new token.
     */
    public function verifyPassword(Request $request)
    {
        $data = $request->validate(['password' => ['required', 'string']]);
        if (! Hash::check($data['password'], $this->user()->password)) {
            return response()->json(['message' => __('erp.invalid_credentials'), 'code' => 'invalid_credentials'], 422);
        }

        return response()->json(['ok' => true]);
    }

    public function updateProfile(Request $request)
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'email' => ['sometimes', 'nullable', 'email', 'max:190', 'unique:users,email,'.$this->user()->id],
            'phone' => ['sometimes', 'nullable', 'string', 'max:40'],
            'locale' => ['sometimes', 'in:ar,en'],
        ]);
        $this->user()->update($data);

        return response()->json(['user' => $this->user()->refresh()->profile()]);
    }

    public function changePassword(Request $request)
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'confirmed', Password::min(6)],
        ]);
        $user = $this->user();
        if (! Hash::check($data['current_password'], $user->password)) {
            return response()->json(['message' => __('erp.current_password_wrong'), 'code' => 'invalid_password', 'errors' => ['current_password' => [__('erp.current_password_wrong')]]], 422);
        }
        $user->update(['password' => $data['password']]);
        // Sign out other devices.
        $user->tokens()->where('id', '!=', $user->currentAccessToken()?->id)->delete();

        return response()->json(['ok' => true]);
    }
}
