<?php

namespace App\Modules\Core\Http\Controllers;

use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Core\Services\NumberingService;
use App\Modules\Inventory\Models\Category;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\ProductUnit;
use App\Modules\Inventory\Models\StockMove;
use App\Modules\Inventory\Models\Unit;
use App\Modules\Parties\Models\Party;
use App\Support\ApiController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * Bulk import from CSV (UTF-8, Excel "CSV UTF-8"). Rows are matched by code:
 * existing records are updated, new ones created. Each row is validated on
 * its own so one bad row does not stop the rest.
 */
class ImportController extends ApiController
{
    private const COLUMNS = [
        'products' => ['code', 'name', 'name_en', 'type', 'category_code', 'unit', 'barcode', 'sale_price', 'min_sale_price', 'purchase_price', 'reorder_level', 'vat_rate', 'track_batches', 'track_serials'],
        'customers' => ['code', 'name', 'name_en', 'phone', 'mobile', 'email', 'city', 'address', 'tax_number', 'credit_limit', 'payment_terms_days', 'subject_to_wht'],
        'suppliers' => ['code', 'name', 'name_en', 'phone', 'mobile', 'email', 'city', 'address', 'tax_number', 'payment_terms_days', 'subject_to_wht'],
    ];

    public function template(string $entity)
    {
        $this->allow($entity === 'products' ? 'products.manage' : "{$entity}.manage");
        $fields = collect(app(DynamicFormService::class)->fields($entity))->filter(fn ($field) => app(DynamicFormService::class)->canField($field, 'read') && app(DynamicFormService::class)->canField($field, 'write'))->map(fn ($field) => 'custom.'.$field['key'])->all();
        $csv = "\xEF\xBB\xBF".implode(',', [...self::COLUMNS[$entity], ...$fields])."\n";

        return response($csv, 200, ['Content-Type' => 'text/csv; charset=UTF-8', 'Content-Disposition' => "attachment; filename={$entity}-template.csv"]);
    }

    public function import(Request $request, string $entity, NumberingService $numbers)
    {
        $this->allow($entity === 'products' ? 'products.manage' : "{$entity}.manage");
        $rows = $request->hasFile('file') ? $this->readCsv($request->file('file')->getRealPath()) : (array) $request->input('rows', []);
        abort_if(count($rows) > 5000, 422, __('erp.import_too_many_rows'));

        $created = 0;
        $updated = 0;
        $errors = [];
        $preview = [];
        $dryRun = $request->boolean('dry_run');
        $forms = app(DynamicFormService::class);
        $fields = collect($forms->fields($entity))->keyBy('key');
        foreach (array_values($rows) as $i => $row) {
            $row = array_map(fn ($v) => is_string($v) ? trim($v) : $v, (array) $row);
            try {
                DB::beginTransaction();
                $record = $entity === 'products' ? $this->importProduct($row, $numbers) : $this->importParty($entity, $row, $numbers);
                $custom = $row['custom_fields'] ?? [];
                foreach ($row as $column => $value) {
                    if (! str_starts_with($column, 'custom.')) {
                        continue;
                    }
                    $key = substr($column, 7);
                    $field = $fields[$key] ?? null;
                    if ($value === '') {
                        $value = null;
                    } elseif ($field && $field['type'] === 'multi_select') {
                        $value = array_map('trim', explode('|', (string) $value));
                    } elseif ($field && $field['type'] === 'checkbox') {
                        abort_unless(in_array(strtolower((string) $value), ['1', '0', 'true', 'false', 'yes', 'no'], true), 422, 'Invalid checkbox value.');
                        $value = in_array(strtolower((string) $value), ['1', 'true', 'yes'], true);
                    }
                    $custom[$key] = $value;
                }
                $forms->save($entity, $record->id, ['custom_fields' => $custom], $record->wasRecentlyCreated);
                $preview[] = ['row' => $i + 2, 'code' => $record->code, 'name' => $record->name, 'action' => $record->wasRecentlyCreated ? 'create' : 'update'];
                $record->wasRecentlyCreated ? $created++ : $updated++;
                $dryRun ? DB::rollBack() : DB::commit();
            } catch (ValidationException $e) {
                DB::rollBack();
                $errors[] = ['row' => $i + 2, 'message' => collect($e->errors())->flatten()->implode(' ')];
            } catch (\Throwable $e) {
                DB::rollBack();
                $errors[] = ['row' => $i + 2, 'message' => __($e->getMessage())];
            }
        }

        return response()->json(['created' => $created, 'updated' => $updated, 'errors' => $errors, 'dry_run' => $dryRun, 'preview' => $preview]);
    }

    private function importProduct(array $row, NumberingService $numbers): Product
    {
        // Match recipe configuration and stock posting lock order.
        Product::query()->orderBy('id')->lockForUpdate()->get(['id']);
        $data = Validator::make($row, [
            'code' => 'nullable|string|max:40',
            'name' => 'required|string|max:190',
            'name_en' => 'nullable|string|max:190',
            'type' => 'nullable|in:stock,service',
            'category_code' => 'nullable|string|max:30',
            'unit' => 'nullable|string|max:40',
            'barcode' => 'nullable|string|max:64',
            'sale_price' => 'nullable|numeric|min:0',
            'min_sale_price' => 'nullable|numeric|min:0',
            'purchase_price' => 'nullable|numeric|min:0',
            'reorder_level' => 'nullable|numeric|min:0',
            'vat_rate' => 'nullable|numeric|min:0|max:100',
            'track_batches' => 'nullable',
            'track_serials' => 'nullable',
        ])->validate();

        $unit = Unit::query()->where('name', $data['unit'] ?? 'قطعة')->orWhere('name_en', $data['unit'] ?? 'Piece')->first()
            ?? Unit::query()->create(['name' => $data['unit'] ?? 'قطعة']);
        $category = ! empty($data['category_code']) ? Category::query()->firstOrCreate(['code' => $data['category_code']], ['name' => $data['category_code']]) : null;
        $taxId = isset($data['vat_rate']) && $data['vat_rate'] !== '' ? DB::table('tax_rates')->where('type', 'vat')->where('rate', (float) $data['vat_rate'])->value('id') : DB::table('tax_rates')->where('type', 'vat')->where('is_default', true)->value('id');

        $product = ! empty($data['code']) ? Product::query()->withTrashed()->where('code', $data['code'])->first() : null;
        $isNew = ! $product;
        $attributes = array_filter([
            'name' => $data['name'],
            'name_en' => $data['name_en'] ?? null,
            'type' => $data['type'] ?? 'stock',
            'category_id' => $category?->id,
            'tax_rate_id' => $taxId,
            'sale_price' => (float) ($data['sale_price'] ?? 0),
            'min_sale_price' => (float) ($data['min_sale_price'] ?? 0),
            'purchase_price' => (float) ($data['purchase_price'] ?? 0),
            'reorder_level' => (float) ($data['reorder_level'] ?? 0),
            'track_batches' => in_array(strtolower((string) ($data['track_batches'] ?? '')), ['1', 'yes', 'true', 'نعم'], true),
        ], fn ($v) => $v !== null);

        $attributes['track_serials'] = in_array(strtolower((string) ($data['track_serials'] ?? '')), ['1', 'yes', 'true', 'نعم'], true);
        if (! $isNew) {
            foreach (['type', 'track_batches', 'track_serials', 'sale_price', 'min_sale_price', 'purchase_price', 'reorder_level'] as $column) {
                if (! array_key_exists($column, $row)) {
                    unset($attributes[$column]);
                }
            }
        }
        abort_if(($attributes['track_serials'] ?? $product?->track_serials) && ($attributes['track_batches'] ?? $product?->track_batches), 422, 'Choose serial or batch tracking.');
        if ($isNew) {
            $product = Product::query()->create($attributes + ['code' => $data['code'] ?? $numbers->code('product'), 'base_unit_id' => $unit->id]);
        } else {
            // Import must preserve the same historical locks as the item editor.
            if (StockMove::query()->where('product_id', $product->id)->exists()) {
                foreach (['type', 'track_batches', 'track_serials'] as $locked) {
                    if (! array_key_exists($locked, $data)) {
                        unset($attributes[$locked]);
                    } elseif ((string) $attributes[$locked] !== (string) $product->{$locked}) {
                        throw new \RuntimeException('Cannot change '.$locked.' after stock movements.');
                    }
                }
            }
            $product->restore();
            $product->update($attributes);
        }
        $base = ProductUnit::query()->firstOrCreate(['product_id' => $product->id, 'unit_id' => $product->base_unit_id], ['factor' => 1, 'is_default_sale' => true, 'is_default_purchase' => true]);
        if (! empty($data['barcode'])) {
            $taken = ProductUnit::query()->where('barcode', $data['barcode'])->where('id', '!=', $base->id)->exists();
            if ($taken) {
                throw new \RuntimeException(__('erp.barcode_duplicate', ['code' => $data['barcode']]));
            }
            $base->update(['barcode' => $data['barcode']]);
        }

        return $product;
    }

    private function importParty(string $entity, array $row, NumberingService $numbers): Party
    {
        $data = Validator::make($row, [
            'code' => 'nullable|string|max:30',
            'name' => 'required|string|max:190',
            'name_en' => 'nullable|string|max:190',
            'phone' => 'nullable|string|max:40',
            'mobile' => 'nullable|string|max:40',
            'email' => 'nullable|email|max:190',
            'city' => 'nullable|string|max:100',
            'address' => 'nullable|string|max:250',
            'tax_number' => 'nullable|string|max:40',
            'credit_limit' => 'nullable|numeric|min:0',
            'payment_terms_days' => 'nullable|integer|min:0|max:365',
            'subject_to_wht' => 'nullable',
        ])->validate();
        $flag = $entity === 'customers' ? 'is_customer' : 'is_supplier';
        $party = ! empty($data['code']) ? Party::query()->withTrashed()->where('code', $data['code'])->first() : null;
        $isNew = ! $party;
        $attributes = collect($data)->except(['code', 'subject_to_wht', 'credit_limit', 'payment_terms_days'])->filter(fn ($v) => $v !== null && $v !== '')->all() + [
            $flag => true,
            'payment_terms_days' => (int) ($data['payment_terms_days'] ?? 0),
            'subject_to_wht' => in_array(strtolower((string) ($data['subject_to_wht'] ?? '')), ['1', 'yes', 'true', 'نعم'], true),
        ];
        if (isset($data['credit_limit']) && $data['credit_limit'] !== '') {
            $attributes['credit_limit'] = (float) $data['credit_limit'];
        }
        if ($isNew) {
            $party = Party::query()->create($attributes + ['code' => $data['code'] ?? $numbers->code($entity === 'customers' ? 'customer' : 'supplier'), 'kind' => $entity === 'customers' ? 'individual' : 'company']);
        } else {
            $party->restore();
            $party->update($attributes);
        }

        return $party;
    }

    private function readCsv(string $path): array
    {
        $handle = fopen($path, 'r');
        $first = fgets($handle);
        $first = preg_replace('/^\xEF\xBB\xBF/', '', (string) $first);
        $delimiter = substr_count($first, ';') > substr_count($first, ',') ? ';' : ',';
        $headers = array_map(fn ($h) => strtolower(trim($h)), str_getcsv($first, $delimiter));
        $rows = [];
        while (($line = fgetcsv($handle, 0, $delimiter)) !== false) {
            if (count(array_filter($line, fn ($v) => trim((string) $v) !== '')) === 0) {
                continue;
            }
            $rows[] = array_combine($headers, array_pad(array_slice($line, 0, count($headers)), count($headers), null));
        }
        fclose($handle);

        return $rows;
    }
}
