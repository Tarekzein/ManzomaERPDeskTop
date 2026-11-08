<?php

use App\Control\Http\ControlLocale;
use App\Control\Http\EnforceLicense;
use App\Modules\Core\Http\Middleware\DynamicRecords;
use App\Modules\Core\Http\Middleware\SelectCompany;
use App\Modules\Core\Http\Middleware\SetLocale;
use App\Support\BusinessException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/*
| The desktop shell runs this app from a read-only install folder, so all
| writable paths come from the environment:
|   ERP_STORAGE_PATH  logs, cache, backups (per company file)
|   APP_*_CACHE       bootstrap cache files (set by the shell)
*/
$storage = getenv('ERP_STORAGE_PATH') ?: null;
if ($storage) {
    foreach (['app', 'app/control', 'framework/cache/data', 'framework/views', 'framework/sessions', 'logs', 'backups', 'bootstrap'] as $dir) {
        if (! is_dir($storage.'/'.$dir)) {
            @mkdir($storage.'/'.$dir, 0775, true);
        }
    }
}

$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withCommands([__DIR__.'/../app/Modules/Core/Console'])
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->trimStrings(except: ['adminPassword']);
        $middleware->web(append: [ControlLocale::class]);
        $middleware->api(prepend: [SetLocale::class, EnforceLicense::class, SelectCompany::class]);
        $middleware->api(append: [DynamicRecords::class]);
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->respond(function ($response, $error, Request $request) {
            if (! $request->is('api/*') || ! $response instanceof JsonResponse) {
                return $response;
            }
            $data = $response->getData(true);
            // API clients never receive exception text/stack traces, even on a debug server.
            $locale = $request->header('X-Locale', app()->getLocale());
            $locale = in_array($locale, ['ar', 'en'], true) ? $locale : 'ar';
            if ($response->getStatusCode() >= 500) {
                return response()->json([
                    'message' => trans('The server could not complete the request. Try again shortly or contact your administrator.', [], $locale),
                    'code' => 'server_error',
                ], $response->getStatusCode(), $response->headers->all());
            }
            unset($data['exception'], $data['file'], $data['line'], $data['trace'], $data['debug']);
            if (isset($data['message']) && is_string($data['message'])) {
                $data['message'] = __($data['message']);
            }
            foreach ($data['errors'] ?? [] as $key => $messages) {
                $data['errors'][$key] = array_map(fn ($message) => __($message), $messages);
            }
            $response->setData($data);

            return $response;
        });

        $exceptions->shouldRenderJsonWhen(fn (Request $request) => $request->is('api/*') || $request->expectsJson());

        $exceptions->render(fn (BusinessException $e) => response()->json([
            'message' => $e->getMessage(),
            'code' => $e->errorCode,
            'context' => $e->context,
        ], $e->status));

        $exceptions->render(fn (AuthenticationException $e, Request $request) => ($request->is('api/*') || $request->expectsJson()) ? response()->json([
            'message' => __('erp.unauthenticated'),
            'code' => 'unauthenticated',
        ], 401) : null);

        $exceptions->render(function (NotFoundHttpException $e, Request $request) {
            if ($e->getPrevious() instanceof ModelNotFoundException) {
                return response()->json(['message' => __('erp.not_found'), 'code' => 'not_found'], 404);
            }

            return null;
        });

        $exceptions->render(function (QueryException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }
            // Foreign key violations surface as a friendly "in use" message.
            $message = str_contains(strtolower($e->getMessage()), 'foreign key') ? __('erp.record_in_use') : __('erp.database_error');

            return response()->json(['message' => $message, 'code' => 'database_error'], 422);
        });
    })->create();

if ($storage) {
    $app->useStoragePath($storage);
}

return $app;
