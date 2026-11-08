<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class FriendlyErrorsTest extends TestCase
{
    public function test_unexpected_api_errors_are_localized_without_debug_details(): void
    {
        config(['app.debug' => true]);
        Route::get('/api/test-unexpected-error', fn () => throw new \RuntimeException('Class "Laravel\\Pail\\PailServiceProvider" not found'));
        foreach (['ar', 'en'] as $locale) {
            $response = $this->withHeader('X-Locale', $locale)->getJson('/api/test-unexpected-error');
            $response->assertStatus(500)->assertExactJson([
                'message' => trans('The server could not complete the request. Try again shortly or contact your administrator.', [], $locale),
                'code' => 'server_error',
            ]);
            $this->assertStringNotContainsString('Pail', $response->getContent());
        }
    }
}
