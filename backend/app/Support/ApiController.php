<?php

namespace App\Support;

use App\Models\User;
use App\Modules\Core\Services\DynamicFormService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;

abstract class ApiController extends Controller
{
    protected function user(): User
    {
        /** @var User $user */
        $user = auth()->user();

        return $user;
    }

    /**
     * Abort with 403 unless the user holds at least one of the permissions.
     */
    protected function allow(string ...$permissions): void
    {
        $user = $this->user();
        foreach ($permissions as $permission) {
            if ($user->can($permission)) {
                return;
            }
        }
        abort(403, __('erp.forbidden'));
    }

    protected function can(string $permission): bool
    {
        return $this->user()->can($permission);
    }

    /**
     * Standard list response. `per_page=0` returns everything (for pickers),
     * capped to keep the desktop responsive.
     */
    protected function paginate(Builder $query, Request $request, array $sortable = ['id'], string $defaultSort = '-id')
    {
        $formKey = $request->attributes->get('dynamic_form');
        if ($formKey && $request->has('custom')) {
            $filters = $request->query('custom');
            abort_unless(is_array($filters) && count($filters) <= 20, 422);
            app(DynamicFormService::class)->filter($query, $formKey, $filters);
        }
        $sort = (string) $request->query('sort', $defaultSort);
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $column = ltrim($sort, '-');
        if ($formKey && str_starts_with($column, 'custom:')) {
            $forms = app(DynamicFormService::class);
            $field = collect($forms->fields($formKey))->firstWhere('key', substr($column, 7));
            abort_unless($field && $forms->canField($field, 'read') && ($field['usage_flags_json']['list'] ?? false) && $field['type'] !== 'multi_select', 422, 'Field cannot be sorted.');
            $valueColumn = match ($field['type']) {
                'number', 'decimal' => 'number_value', 'date' => 'date_value', 'checkbox' => 'bool_value', default => 'text_value'
            };
            $query->orderBy(DB::table('custom_field_index')->select($valueColumn)->where('field_id', $field['id'])->whereColumn('entity_id', $query->getModel()->getTable().'.id'), $direction);
        } elseif (in_array($column, $sortable, true)) {
            $query->orderBy($column, $direction);
        }
        if ($column !== 'id') {
            $query->orderBy($query->getModel()->getTable().'.id', 'desc');
        }

        $perPage = (int) $request->query('per_page', 25);
        if ($perPage === 0) {
            return ['data' => $query->limit(1000)->get()];
        }

        return $query->paginate(min(max($perPage, 1), 500));
    }

    /**
     * Case-insensitive LIKE across columns (works on SQLite and MySQL).
     */
    protected function search(Builder $query, ?string $term, array $columns): Builder
    {
        $term = trim((string) $term);
        if ($term === '') {
            return $query;
        }

        return $query->where(function (Builder $q) use ($term, $columns) {
            foreach ($columns as $column) {
                $q->orWhere($column, 'like', '%'.$term.'%');
            }
            $this->searchCustom($q, $term);
        });
    }

    protected function searchCustom(Builder $query, string $term): void
    {
        $formKey = request()->attributes->get('dynamic_form');
        if (! $formKey) {
            return;
        }
        $forms = app(DynamicFormService::class);
        $ids = collect($forms->fields($formKey))->filter(fn ($f) => $forms->canField($f, 'read') && ($f['usage_flags_json']['search'] ?? false))->pluck('id');
        if ($ids->isEmpty()) {
            return;
        }
        $query->orWhereIn($query->getModel()->getTable().'.id', DB::table('custom_field_index')->select('entity_id')->whereIn('field_id', $ids)->where(function ($search) use ($term) {
            $search->where('full_text_value', 'like', '%'.$term.'%');
            if (is_numeric($term)) {
                $search->orWhere('number_value', (float) $term);
            }
            if (in_array(strtolower($term), ['true', 'false'], true)) {
                $search->orWhere('bool_value', strtolower($term) === 'true');
            }
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $term)) {
                $search->orWhere('date_value', $term);
            }
        }))->orWhereIn($query->getModel()->getTable().'.id', DB::table('custom_field_option_values')->select('entity_id')->whereIn('field_id', $ids)->where('option_key', 'like', '%'.$term.'%'));
    }

    protected function dateRange(Builder $query, Request $request, string $column = 'date'): Builder
    {
        if ($from = $request->query('from')) {
            $query->whereDate($column, '>=', $from);
        }
        if ($to = $request->query('to')) {
            $query->whereDate($column, '<=', $to);
        }

        return $query;
    }
}
