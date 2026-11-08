<?php

namespace App\Modules\Core\Services;

use App\Modules\Core\Models\Attachment;
use App\Modules\Core\Models\CustomField;
use App\Modules\Core\Models\FormDefinition;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class DynamicFormService
{
    public const TYPES = ['text', 'long_text', 'number', 'decimal', 'date', 'dropdown', 'multi_select', 'checkbox', 'file', 'image', 'phone', 'email'];

    private array $fieldCache = [];

    private array $currentFields = [];

    private array $valueCache = [];

    public function __construct(private readonly FormRegistry $registry) {}

    public function flush(): void
    {
        $this->fieldCache = [];
        $this->currentFields = [];
        $this->valueCache = [];
    }

    public function canField(array $field, string $action): bool
    {
        $user = auth()->user();
        if (! $user) {
            return false;
        }
        if ($user->can('forms.manage')) {
            return true;
        }
        $roles = $field['role_access_json'][$action] ?? [];

        return ! $roles || $user->hasAnyRole($roles);
    }

    public function fields(string $formKey): array
    {
        $form = $this->registry->get($formKey);
        $cacheKey = DB::connection()->getDatabaseName().':'.$form['key'];
        if (isset($this->fieldCache[$cacheKey])) {
            return $this->fieldCache[$cacheKey];
        }
        $published = FormDefinition::query()->where('form_key', $form['key'])->where('status', 'published')->latest('version')->first();
        $current = CustomField::query()->where('entity_type', $form['entity_type'])->get()->keyBy('id');
        foreach ($current as $field) {
            $this->currentFields[$field->id] = $field;
        }
        $fields = $published && $published->fields_json !== null ? collect($published->fields_json) : $current->filter(fn ($f) => $f->active && (! $f->applicable_forms_json || in_array($form['key'], $f->applicable_forms_json, true)))->values()->map->toArray();

        return $this->fieldCache[$cacheKey] = $fields->filter(fn ($field) => isset($current[$field['id']]) && $current[$field['id']]->active)->map(function ($field) use ($current) {
            $field['role_access_json'] = $current[$field['id']]->role_access_json;

            return $field;
        })->values()->all();
    }

    public function schema(string $formKey): array
    {
        $form = $this->registry->authorize($formKey);
        $published = FormDefinition::query()->where('form_key', $form['key'])->where('status', 'published')->latest('version')->first();
        $fields = collect($this->fields($form['key']))->filter(fn ($f) => $this->canField($f, 'read'))->map(fn ($f) => $f + ['writable' => $this->canField($f, 'write')])->values();

        $builtins = app(BuiltinFormRegistry::class);

        return ['core_fields' => $builtins->fields($form['key']), 'form_key' => $form['key'], 'entity_type' => $form['entity_type'], 'version' => $published?->version ?? 0,
            'fields' => $fields, 'layout' => $builtins->layout($form['key'], $published?->layout_json, $fields->pluck('key')->all())];
    }

    public function preload(string $formKey, array $ids): void
    {
        $type = $this->registry->get($formKey)['entity_type'];
        foreach ($ids as $id) {
            $this->valueCache[$type.':'.$id] = null;
        }
        foreach (DB::table('entity_custom_data')->where('entity_type', $type)->whereIn('entity_id', $ids)->get() as $row) {
            $this->valueCache[$type.':'.$row->entity_id] = $row;
        }
    }

    public function read(string $formKey, int $id, bool $printing = false): array
    {
        $form = $this->registry->get($formKey);
        $cacheKey = $form['entity_type'].':'.$id;
        $row = array_key_exists($cacheKey, $this->valueCache) ? $this->valueCache[$cacheKey] : DB::table('entity_custom_data')->where('entity_type', $form['entity_type'])->where('entity_id', $id)->first();
        $values = $row ? json_decode($row->values_json, true) : [];
        $fields = $this->fields($formKey);
        if ($printing) {
            $snapshot = DB::table('document_form_snapshots')->where('entity_type', $form['entity_type'])->where('entity_id', $id)->first();
            if ($snapshot) {
                $data = json_decode($snapshot->snapshot_json, true);
                $fields = $data['fields'];
                $values = $data['values'];
            }
        }
        $out = [];
        $print = [];
        foreach ($fields as $field) {
            // Current permissions still apply to historical snapshots.
            $current = $this->currentFields[$field['id']] ?? CustomField::query()->find($field['id']);
            if (! $current || ! $this->canField($current->toArray(), 'read')) {
                continue;
            }
            if (array_key_exists($field['key'], $values)) {
                $out[$field['key']] = $values[$field['key']];
                if ($field['usage_flags_json']['print'] ?? false) {
                    $print[] = ['key' => $field['key'], 'label_ar' => $field['label_ar'], 'label_en' => $field['label_en'], 'value' => $values[$field['key']]];
                }
            }
        }

        return ['custom_fields' => (object) $out, 'form_version' => $row?->form_version ?? 0, 'lock_version' => $row?->lock_version ?? 0, 'custom_print_fields' => $print];
    }

    public static function visible(?array $condition, array $values): bool
    {
        if (! $condition) {
            return true;
        }
        $value = $values[$condition['field']] ?? null;

        $equals = static function ($left, $right): bool {
            if ((is_int($right) || is_float($right)) && is_numeric($left)) {
                return (float) $left === (float) $right;
            }

            return $left === $right;
        };

        return match ($condition['operator']) {
            'equals' => $equals($value, $condition['value'] ?? null),
            'not_equals' => ! $equals($value, $condition['value'] ?? null),
            'in' => collect($condition['value'] ?? [])->contains(fn ($option) => $equals($value, $option)),
            'not_empty' => $value !== null && $value !== '' && $value !== [],
            default => false,
        };
    }

    public function save(string $formKey, int $id, array $payload, bool $isNew = false): array
    {
        $form = $this->registry->get($formKey);
        $schemaVersion = FormDefinition::query()->where('form_key', $form['key'])->where('status', 'published')->max('version') ?? 0;
        if (isset($payload['form_version']) && (int) $payload['form_version'] !== (int) $schemaVersion) {
            abort(409, 'The form changed. Reload its definition before saving.');
        }

        return DB::transaction(function () use ($formKey, $id, $payload, $isNew, $form, $schemaVersion) {
            $where = ['entity_type' => $form['entity_type'], 'entity_id' => $id];
            DB::table('entity_custom_data')->insertOrIgnore($where + ['values_json' => '{}', 'form_version' => 0, 'lock_version' => 0, 'created_at' => now(), 'updated_at' => now()]);
            $row = DB::table('entity_custom_data')->where($where)->lockForUpdate()->first();
            if (isset($payload['lock_version']) && (int) $payload['lock_version'] !== (int) $row->lock_version) {
                abort(409, 'This record was changed by another user.');
            }
            $old = json_decode($row->values_json, true);
            $submitted = $payload['custom_fields'] ?? [];
            Validator::make(['custom_fields' => $submitted], ['custom_fields' => 'array'])->validate();
            $fields = collect($this->fields($formKey))->keyBy('key');
            foreach ($submitted as $key => $value) {
                if (! $fields->has($key)) {
                    throw ValidationException::withMessages(['custom_fields.'.$key => 'Unknown or archived field.']);
                }
                abort_unless($this->canField($fields[$key], 'read') && $this->canField($fields[$key], 'write'), 403);
            }
            $values = array_replace($old, $submitted);
            $coreValues = [];
            $coreFields = app(BuiltinFormRegistry::class)->fields($form['key']);
            $record = $coreFields && $form['key'] !== 'company-settings' ? $form['model']::query()->findOrFail($id) : null;
            foreach ($coreFields as $field) {
                if (! ($field['conditionable'] ?? false)) {
                    continue;
                }
                $value = $form['key'] === 'company-settings' ? app(SettingsService::class)->get($field['property']) : $record->getAttribute($field['property']);
                if ($value !== null) {
                    $value = match ($field['type']) {
                        'checkbox' => (bool) $value, 'number' => (int) $value, 'decimal' => (float) $value, 'date' => $value instanceof \DateTimeInterface ? $value->format('Y-m-d') : substr((string) $value, 0, 10), default => $value
                    };
                }
                $coreValues[$field['key']] = $value;
            }
            foreach ($fields as $key => $field) {
                if ($isNew && ! array_key_exists($key, $values) && $field['default_json'] !== null) {
                    $values[$key] = $field['default_json'];
                }
            }
            $validation = [];
            $attachmentFields = [];
            foreach ($fields as $key => $field) {
                if (! $this->canField($field, 'write') || ! $this->canField($field, 'read')) {
                    continue;
                }
                if (! self::visible($field['condition_json'] ?? null, $values + $coreValues)) {
                    continue;
                }
                $rules = [($field['required'] ?? false) ? 'required' : 'nullable'];
                $type = $field['type'];
                $settings = $field['validation_json'] ?? [];
                $rules = array_merge($rules, match ($type) {
                    'number' => ['integer'], 'decimal' => ['numeric'], 'date' => ['date_format:Y-m-d'],
                    'checkbox' => ['boolean'], 'email' => ['email', 'max:190'],
                    'phone' => ['string', 'max:40', 'regex:/^[+0-9٠-٩() .\-]+$/u'],
                    'dropdown' => [Rule::in(array_column($field['options_json'] ?? [], 'value'))],
                    'multi_select' => ['array', 'max:100'], 'file', 'image' => ['integer', 'exists:attachments,id'],
                    default => ['string', 'max:'.min((int) ($settings['max_length'] ?? 4000), 50000)],
                });
                foreach (['min', 'max'] as $limit) {
                    if (isset($settings[$limit]) && in_array($type, ['number', 'decimal'], true)) {
                        $rules[] = $limit.':'.$settings[$limit];
                    }
                }
                $validation['custom_fields.'.$key] = $rules;
                if ($type === 'multi_select') {
                    $validation['custom_fields.'.$key.'.*'] = [Rule::in(array_column($field['options_json'] ?? [], 'value')), 'distinct'];
                }
                if (in_array($type, ['file', 'image'], true) && ! empty($values[$key])) {
                    $attachmentFields[] = $field;
                }
            }
            $labels = [];
            foreach ($fields as $key => $field) {
                $labels['custom_fields.'.$key] = $field[app()->getLocale() === 'ar' ? 'label_ar' : 'label_en'];
                $labels['custom_fields.'.$key.'.*'] = $labels['custom_fields.'.$key];
            }
            Validator::make(['custom_fields' => $values], $validation, [], $labels)->validate();
            foreach ($attachmentFields as $field) {
                $attachment = Attachment::query()->findOrFail($values[$field['key']]);
                abort_unless($attachment->entity_type === $form['entity_type'] && (! $attachment->field_id || $attachment->field_id === $field['id']) && ((! $attachment->entity_id && $attachment->uploaded_by === auth()->id()) || $attachment->entity_id === $id), 403);
                if ($field['type'] === 'image') {
                    abort_unless(str_starts_with($attachment->mime, 'image/'), 422, 'An image is required.');
                }
                $attachment->update(['entity_id' => $id, 'field_id' => $field['id']]);
            }
            DB::table('entity_custom_data')->where($where)->update(['values_json' => json_encode((object) $values, JSON_UNESCAPED_UNICODE), 'form_version' => $schemaVersion, 'lock_version' => $row->lock_version + 1, 'updated_at' => now()]);
            unset($this->valueCache[$form['entity_type'].':'.$id]);
            $this->project($fields->values()->all(), $id, $values);
            if ($values !== $old) {
                app(AuditService::class)->record('custom_fields', null, $form['entity_type'].'#'.$id, ['old' => $old, 'new' => $values]);
            }

            return $this->read($formKey, $id);
        });
    }

    public function project(array $fields, int $id, array $values): void
    {
        foreach ($fields as $field) {
            $where = ['field_id' => $field['id'], 'entity_id' => $id];
            DB::table('custom_field_index')->where($where)->delete();
            DB::table('custom_field_option_values')->where($where)->delete();
            $flags = $field['usage_flags_json'] ?? [];
            if (! array_filter(array_intersect_key($flags, array_flip(['filter', 'search', 'report', 'list']))) || ! isset($values[$field['key']])) {
                continue;
            }
            $value = $values[$field['key']];
            if ($field['type'] === 'multi_select') {
                foreach ($value as $option) {
                    DB::table('custom_field_option_values')->insert($where + ['option_key' => $option]);
                }
            } else {
                $column = match ($field['type']) {
                    'number', 'decimal' => 'number_value', 'date' => 'date_value', 'checkbox' => 'bool_value', default => 'text_value'
                };
                DB::table('custom_field_index')->insert($where + [$column => $column === 'text_value' ? mb_substr((string) $value, 0, 190) : $value, 'full_text_value' => $column === 'text_value' ? (string) $value : null]);
            }
        }
    }

    public function snapshot(string $formKey, int $id): void
    {
        $form = $this->registry->get($formKey);
        $row = DB::table('entity_custom_data')->where('entity_type', $form['entity_type'])->where('entity_id', $id)->first();
        DB::table('document_form_snapshots')->insertOrIgnore(['entity_type' => $form['entity_type'], 'entity_id' => $id, 'snapshot_json' => json_encode(['fields' => $this->fields($formKey), 'values' => $row ? json_decode($row->values_json, true) : []], JSON_UNESCAPED_UNICODE), 'created_at' => now(), 'updated_at' => now()]);
    }

    public function filter(Builder $query, string $formKey, array $filters): void
    {
        $fields = collect($this->fields($formKey))->keyBy('key');
        foreach ($filters as $key => $value) {
            $field = $fields[$key] ?? null;
            abort_unless($field && $this->canField($field, 'read') && ($field['usage_flags_json']['filter'] ?? false), 422, 'Field cannot be filtered.');
            if ($field['type'] === 'checkbox') {
                abort_unless(in_array((string) $value, ['1', '0', 'true', 'false'], true), 422, 'Invalid checkbox filter.');
                $value = in_array((string) $value, ['1', 'true'], true);
            }
            $table = $field['type'] === 'multi_select' ? 'custom_field_option_values' : 'custom_field_index';
            $column = match ($field['type']) {
                'number', 'decimal' => 'number_value', 'date' => 'date_value', 'checkbox' => 'bool_value', 'multi_select' => 'option_key', default => 'full_text_value'
            };
            $query->whereIn($query->getModel()->getTable().'.id', DB::table($table)->select('entity_id')->where('field_id', $field['id'])->where($column, $value));
        }
    }
}
