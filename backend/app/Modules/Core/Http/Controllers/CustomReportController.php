<?php

namespace App\Modules\Core\Http\Controllers;

use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Core\Services\FormRegistry;
use App\Support\ApiController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CustomReportController extends ApiController
{
    public function __invoke(Request $request, string $formKey, FormRegistry $registry, DynamicFormService $forms)
    {
        $form = $registry->authorize($formKey);
        $field = collect($forms->fields($formKey))->firstWhere('key', $request->query('field'));
        abort_unless($field && $forms->canField($field, 'read') && ($field['usage_flags_json']['report'] ?? false), 422, 'Field is not reportable.');
        $query = $registry->query($formKey);
        if ($request->has('custom')) {
            $forms->filter($query, $formKey, (array) $request->query('custom'));
        }
        $table = $field['type'] === 'multi_select' ? 'custom_field_option_values' : 'custom_field_index';
        $column = match ($field['type']) {
            'number', 'decimal' => 'number_value', 'date' => 'date_value', 'checkbox' => 'bool_value', 'multi_select' => 'option_key', default => 'text_value'
        };
        $data = DB::table($table)->where('field_id', $field['id'])->whereIn('entity_id', $query->select($form['entity_type'].'.id'));
        $total = (clone $data)->count();
        $rows = $data->selectRaw($column.' AS value, COUNT(*) AS records')->groupBy($column)->orderBy($column)->paginate(100);

        return ['field' => ['key' => $field['key'], 'label_ar' => $field['label_ar'], 'label_en' => $field['label_en']], 'total_values' => $total, 'rows' => $rows];
    }
}
