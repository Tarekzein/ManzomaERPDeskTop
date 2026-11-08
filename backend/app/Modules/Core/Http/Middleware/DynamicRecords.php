<?php

namespace App\Modules\Core\Http\Middleware;

use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Core\Services\FormRegistry;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/** Extends existing resource transactions; it never replaces domain validation. */
class DynamicRecords
{
    public static function resolve(Request $request): ?array
    {
        $path = trim($request->path(), '/');
        if ($path === 'api/maintenance/profiles') {
            return ['maintenance-profiles', null, null];
        }
        if ($path === 'api/maintenance/templates') {
            return ['message-templates', null, null];
        }
        if (preg_match('~^api/parties/\d+/addresses$~', $path)) {
            return ['party-addresses', null, null];
        }
        if ($path === 'api/settings') {
            return ['company-settings', 1, null];
        }
        if (preg_match('~^api/(products|parties|accounts|journals|cash-accounts|users|roles|fiscal-years|customer-units|service-requests|service-visits)(?:/(\d+))?(?:/(post|complete|install|invoice|transition|schedule-overrides))?$~', $path, $m)) {
            $key = $m[1];
            if ($key === 'parties') {
                $explicit = $request->input('form_key');
                if ($explicit !== null) {
                    abort_unless(in_array($explicit, ['customers', 'suppliers'], true), 422, 'Invalid party form.');
                }
                $party = ! empty($m[2]) ? DB::table('parties')->where('id', (int) $m[2])->first(['is_customer', 'is_supplier']) : null;
                $key = $explicit ?? ($request->query('role') === 'supplier' || ($party && $party->is_supplier && ! $party->is_customer) || (! $party && $request->boolean('is_supplier') && ! $request->boolean('is_customer')) ? 'suppliers' : 'customers');
            }

            return [$key, isset($m[2]) && $m[2] !== '' ? (int) $m[2] : null, $m[3] ?? null];
        }
        if (preg_match('~^api/(master|documents|stock-documents)/([a-z_-]+)(?:/(\d+))?(?:/(post|receive))?$~', $path, $m)) {
            return [$m[1] === 'stock-documents' ? 'stock_'.$m[2] : $m[2], isset($m[3]) ? (int) $m[3] : null, $m[4] ?? null];
        }
        if (preg_match('~^api/crm/(leads|opportunities|activities|tasks)(?:/(\d+))?$~', $path, $m)) {
            return [$m[1], isset($m[2]) ? (int) $m[2] : null, null];
        }
        if (preg_match('~^api/vouchers(?:/(\d+))?(?:/(post))?$~', $path, $m)) {
            $type = $request->boolean('expenses') ? 'expense' : $request->input('type', 'receipt');
            if (! empty($m[1])) {
                $v = DB::table('vouchers')->find($m[1]);
                $type = $v ? ($v->type === 'payment' && ! $v->party_id ? 'expense' : $v->type) : $type;
            }

            return ['voucher_'.$type, isset($m[1]) ? (int) $m[1] : null, $m[2] ?? null];
        }
        if (preg_match('~^api/maintenance/profiles(?:/(\d+))?$~', $path, $m)) {
            return ['maintenance-profiles', isset($m[1]) ? (int) $m[1] : null, null];
        }

        return null;
    }

    public function handle(Request $request, Closure $next): Response
    {
        app(DynamicFormService::class)->flush();
        $match = self::resolve($request);
        if (! $match) {
            return $next($request);
        }
        [$key, $id, $action] = $match;
        $request->attributes->set('dynamic_form', $key);
        $form = app(FormRegistry::class)->get($key);
        if ($request->filled('form_key') && in_array($key, ['customers', 'suppliers'], true) && ! $request->isMethod('get')) {
            app(FormRegistry::class)->authorize($key, 'manage');
        }
        $write = in_array($request->method(), ['POST', 'PUT', 'PATCH'], true);
        if ($write) {
            DB::beginTransaction();
        }
        try {
            $record = $write && $id ? $form['model']::query()->whereKey($id)->when($key !== 'accounts', fn ($query) => $query->lockForUpdate())->first() : null;
            $actionSaved = $write && $id && $action && $action !== 'invoice' && ! in_array($record?->status, ['posted', 'completed', 'reversed', 'cancelled', 'void'], true);
            if ($actionSaved) {
                app(DynamicFormService::class)->save($key, $id, $request->all());
            }
            $response = $next($request);
            if ($response->getStatusCode() >= 400) {
                if ($write) {
                    DB::rollBack();
                }

                return $response;
            }
            if ($response instanceof JsonResponse) {
                $data = $response->getData(true);
                $forms = app(DynamicFormService::class);
                $savedId = $data['data']['id'] ?? ($key === 'company-settings' ? 1 : null) ?? ($key === 'roles' ? ($id ?? DB::table('roles')->where('name', $request->input('name'))->value('id')) : null);
                if ($write && $savedId) {
                    $recordId = (int) $savedId;
                    if (! $actionSaved && ! $action) {
                        $forms->save($key, $recordId, $request->all(), ! $id);
                    }
                    if (in_array($data['data']['status'] ?? '', ['posted', 'completed', 'reversed'], true)) {
                        $forms->snapshot($key, $recordId);
                    }
                }
                $canRead = auth()->user() && collect($form['view'])->contains(fn ($permission) => auth()->user()->can($permission));
                if ($canRead && $key === 'company-settings') {
                    $data['custom_meta'] = ['id' => 1] + $forms->read($key, 1);
                }
                if ($canRead && isset($data['data']['id'])) {
                    // Visit invoice creation returns a trade document, not the visit.
                    $responseKey = $action === 'invoice' ? 'sales_invoice' : $key;
                    $data['data'] = array_replace($data['data'], $forms->read($responseKey, (int) $data['data']['id'], in_array($data['data']['status'] ?? '', ['posted', 'completed', 'reversed'], true)));
                } elseif ($canRead && isset($data['data']) && is_array($data['data'])) {
                    $forms->preload($key, array_values(array_filter(array_map(fn ($row) => is_array($row) ? ($row['id'] ?? null) : null, $data['data']))));
                    foreach ($data['data'] as &$row) {
                        if (is_array($row) && isset($row['id'])) {
                            $row = array_replace($row, $forms->read($key, (int) $row['id']));
                        }
                    }
                    unset($row);
                }
                $response->setData($data);
            }
            if ($write) {
                DB::commit();
            }

            return $response;
        } catch (\Throwable $e) {
            if ($write) {
                DB::rollBack();
            }
            throw $e;
        }
    }
}
