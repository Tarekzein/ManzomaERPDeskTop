<?php

namespace App\Modules\Core\Http\Controllers;

use App\Modules\Core\Models\CustomField;
use App\Modules\Core\Models\FormDefinition;
use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\BuiltinFormRegistry;
use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Core\Services\FormRegistry;
use App\Support\ApiController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class FormController extends ApiController
{
    public function __construct(private readonly FormRegistry $registry, private readonly DynamicFormService $forms) {}

    public function index()
    {
        $this->allow('forms.manage');

        return ['data' => collect($this->registry->all())->map(fn ($v, $key) => ['label_ar' => $this->registry->labels($key)[0], 'label_en' => $this->registry->labels($key)[1], 'core_field_count' => count(app(BuiltinFormRegistry::class)->fields($key)), 'core_fields' => app(BuiltinFormRegistry::class)->fields($key), 'form_key' => $key, 'entity_type' => $v[0], 'version' => FormDefinition::query()->where('form_key', $key)->where('status', 'published')->max('version') ?? 0])->values()];
    }

    public function show(string $formKey)
    {
        return $this->forms->schema($formKey);
    }

    public function fields(string $entityType)
    {
        $this->allow('forms.manage');
        abort_unless(collect($this->registry->all())->pluck(0)->contains($entityType), 404);

        return ['data' => CustomField::query()->where('entity_type', $entityType)->orderBy('id')->get()];
    }

    public function saveField(Request $request, string $entityType, ?CustomField $field = null)
    {
        $this->allow('forms.manage');
        abort_unless(collect($this->registry->all())->pluck(0)->contains($entityType), 404);
        if ($field) {
            abort_unless($field->entity_type === $entityType, 404);
        }
        $data = $request->validate([
            'key' => ['required', 'regex:/^[a-z][a-z0-9_]{0,59}$/', Rule::unique('custom_field_definitions')->where('entity_type', $entityType)->ignore($field?->id)],
            'type' => ['required', Rule::in(DynamicFormService::TYPES)],
            'label_ar' => 'required|string|max:190', 'label_en' => 'required|string|max:190', 'required' => 'boolean', 'active' => 'boolean',
            'default_json' => 'nullable', 'validation_json' => 'nullable|array:max_length,min,max',
            'validation_json.max_length' => 'integer|min:1|max:50000', 'validation_json.min' => 'numeric', 'validation_json.max' => 'numeric',
            'options_json' => 'nullable|array|max:200', 'options_json.*.value' => 'required|string|max:80|distinct',
            'options_json.*.label_ar' => 'required|string|max:190', 'options_json.*.label_en' => 'required|string|max:190',
            'role_access_json' => 'nullable|array:read,write', 'role_access_json.read' => 'array', 'role_access_json.write' => 'array',
            'role_access_json.read.*' => 'string|exists:roles,name', 'role_access_json.write.*' => 'string|exists:roles,name',
            'usage_flags_json' => 'nullable|array:list,filter,search,report,print', 'usage_flags_json.*' => 'boolean',
            'applicable_forms_json' => 'nullable|array', 'applicable_forms_json.*' => [Rule::in(array_keys($this->registry->all()))],
            'condition_json' => 'nullable|array:field,operator,value', 'condition_json.field' => 'required_with:condition_json|string|max:60',
            'condition_json.operator' => ['required_with:condition_json', Rule::in(['equals', 'not_equals', 'in', 'not_empty'])], 'condition_json.value' => 'nullable',
        ]);
        if ($field) {
            abort_if($field->key !== $data['key'] || $field->type !== $data['type'], 422, 'Field keys and types are immutable. Create a new field instead.');
        }
        foreach ($data['applicable_forms_json'] ?? [] as $key) {
            abort_unless($this->registry->get($key)['entity_type'] === $entityType, 422);
        }
        if (in_array($data['type'], ['dropdown', 'multi_select'], true)) {
            abort_if(empty($data['options_json']), 422, 'Options are required.');
        }
        if (($data['condition_json']['operator'] ?? '') === 'in') {
            abort_unless(is_array($data['condition_json']['value'] ?? null), 422);
        }
        $field ??= new CustomField(['entity_type' => $entityType]);
        $field->fill($data)->save();

        return response()->json(['data' => $field], 200);
    }

    public function draft(Request $request, string $formKey)
    {
        $this->allow('forms.manage');
        $form = $this->registry->get($formKey);

        return DB::transaction(function () use ($request, $form) {
            $draft = FormDefinition::query()->where('form_key', $form['key'])->where('status', 'draft')->lockForUpdate()->first();
            if (! $draft) {
                $latest = FormDefinition::query()->where('form_key', $form['key'])->latest('version')->first();
                $fields = CustomField::query()->where('entity_type', $form['entity_type'])->where('active', true)->get()->filter(fn ($f) => ! $f->applicable_forms_json || in_array($form['key'], $f->applicable_forms_json, true));
                $draft = FormDefinition::query()->create(['form_key' => $form['key'], 'entity_type' => $form['entity_type'], 'version' => ($latest?->version ?? 0) + 1,
                    'layout_json' => app(BuiltinFormRegistry::class)->layout($form['key'], $latest?->layout_json, $fields->pluck('key')->values()->all())]);
            }
            if ($request->isMethod('put')) {
                $data = $request->validate(['layout' => 'required|array:sections,engine_version,core_version', 'layout.engine_version' => 'sometimes|integer|in:2', 'layout.core_version' => 'sometimes|integer|between:0,1', 'layout.sections' => 'required|array|max:40',
                    'layout.sections.*.key' => 'required|string|max:60|distinct', 'layout.sections.*.label_ar' => 'required|string|max:190', 'layout.sections.*.label_en' => 'required|string|max:190',
                    'layout.sections.*.tab' => 'nullable|string|max:100', 'layout.sections.*.columns' => 'required|integer|between:1,4',
                    'layout.sections.*.fields' => 'present|array|max:200', 'layout.sections.*.fields.*' => 'string|max:60']);
                $draft->update(['layout_json' => app(BuiltinFormRegistry::class)->layout($form['key'], $data['layout'], [])]);
            }

            $draft->layout_json = app(BuiltinFormRegistry::class)->layout($form['key'], $draft->layout_json, []);

            return ['core_fields' => app(BuiltinFormRegistry::class)->fields($form['key']), 'data' => $draft, 'fields' => CustomField::query()->where('entity_type', $form['entity_type'])->where('active', true)->get()];
        });
    }

    public function publish(string $formKey, AuditService $audit)
    {
        $this->allow('forms.manage');
        $form = $this->registry->get($formKey);

        return DB::transaction(function () use ($form, $audit) {
            $draft = FormDefinition::query()->where('form_key', $form['key'])->where('status', 'draft')->lockForUpdate()->firstOrFail();
            $fields = CustomField::query()->where('entity_type', $form['entity_type'])->where('active', true)->get()->filter(fn ($f) => ! $f->applicable_forms_json || in_array($form['key'], $f->applicable_forms_json, true))->keyBy('key');
            $builtins = collect(app(BuiltinFormRegistry::class)->fields($form['key']))->keyBy('key');
            $layout = app(BuiltinFormRegistry::class)->layout($form['key'], $draft->layout_json, $fields->keys()->all());
            $layoutKeys = collect($layout['sections'])->flatMap(fn ($s) => $s['fields']);
            foreach ($builtins as $field) {
                abort_if($field['protected'] && ! $layoutKeys->contains($field['key']), 422, 'Protected domain controls must remain in the layout.');
            }
            abort_if($layoutKeys->duplicates()->isNotEmpty() || $layoutKeys->diff($fields->keys()->merge($builtins->keys()))->isNotEmpty(), 422, 'Unknown or duplicated layout fields.');
            foreach ($fields as $key => $field) {
                if ($field->required && ! $layoutKeys->contains($key)) {
                    throw ValidationException::withMessages(['layout' => 'Required fields must appear in the layout.']);
                }
                $visited = [$key];
                $node = $field;
                while ($node?->condition_json) {
                    $dependency = $node->condition_json['field'];
                    abort_if(in_array($dependency, $visited, true) || (! $fields->has($dependency) && ! $builtins->has($dependency)), 422, 'Unknown or cyclic condition.');
                    if ($builtins->has($dependency)) {
                        abort_unless($builtins[$dependency]['conditionable'] ?? false, 422, 'This domain control cannot be a condition dependency.');
                        break;
                    }
                    // Equal visibility prevents conditional layouts leaking hidden data.
                    abort_if(($fields[$dependency]->role_access_json['read'] ?? []) !== ($field->role_access_json['read'] ?? []), 422, 'Conditional fields must have the same read roles.');
                    $visited[] = $dependency;
                    $node = $fields[$dependency];
                }
                if ($field->required && $field->default_json === null) {
                    abort_if(($field->role_access_json['read'] ?? []) !== ($field->role_access_json['write'] ?? []), 422, 'Required fields must be writable wherever visible.');
                }
            }
            $draft->update(['layout_json' => $layout, 'status' => 'published', 'fields_json' => $fields->values()->toArray(), 'published_by' => $this->user()->id, 'published_at' => now()]);
            DB::table('entity_custom_data')->where('entity_type', $form['entity_type'])->orderBy('id')->chunkById(200, function ($rows) use ($fields) {
                foreach ($rows as $row) {
                    $this->forms->project($fields->values()->toArray(), $row->entity_id, json_decode($row->values_json, true));
                }
            });
            $audit->record('form_published', $draft, $form['key'].' v'.$draft->version);

            return ['data' => $draft];
        });
    }
}
