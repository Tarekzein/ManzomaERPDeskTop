<?php

namespace App\Modules\Service\Services;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

/** Group every OR clause so customer filters and technician visibility stay authoritative. */
class ServiceSearch
{
    public static function term(Request $request): string
    {
        $data = $request->validate(['search' => 'nullable|string|max:190']);

        return trim($data['search'] ?? '');
    }

    public static function party(Builder $query, string $term): void
    {
        $query->where(function ($q) use ($term) {
            foreach (['name', 'name_en', 'code', 'mobile', 'phone'] as $column) {
                $q->orWhere($column, 'like', '%'.$term.'%');
            }
        });
    }

    public static function unit(Builder $query, string $term): void
    {
        if ($term === '') {
            return;
        }
        $query->where(fn ($q) => $q->where('unit_code', 'like', '%'.$term.'%')
            ->orWhereHas('party', fn ($party) => self::party($party, $term))
            ->orWhereHas('serial', fn ($serial) => $serial->where('serial_number', 'like', '%'.$term.'%'))
            ->orWhereHas('product', fn ($product) => $product->where(fn ($p) => $p->where('name', 'like', '%'.$term.'%')->orWhere('name_en', 'like', '%'.$term.'%')->orWhere('code', 'like', '%'.$term.'%'))));
    }

    public static function request(Builder $query, string $term): void
    {
        if ($term === '') {
            return;
        }
        $query->where(function ($q) use ($term) {
            $q->where('description', 'like', '%'.$term.'%')
                ->orWhereHas('party', fn ($party) => self::party($party, $term))
                ->orWhereHas('unit', fn ($unit) => self::unit($unit, $term));
            if (ctype_digit(ltrim($term, '#'))) {
                $q->orWhereKey(ltrim($term, '#'));
            }
        });
    }

    public static function visit(Builder $query, string $term): void
    {
        if ($term === '') {
            return;
        }
        $query->where(function ($q) use ($term) {
            $q->where('report', 'like', '%'.$term.'%')
                ->orWhereHas('request', fn ($request) => self::request($request, $term))
                ->orWhereHas('technician', fn ($person) => $person->where('name', 'like', '%'.$term.'%'));
            if (ctype_digit(ltrim($term, '#'))) {
                $q->orWhereKey(ltrim($term, '#'));
            }
        });
    }
}
