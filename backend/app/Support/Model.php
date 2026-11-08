<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Model as Eloquent;

/**
 * Base model: mass assignment is controlled by validation in controllers and
 * services, so everything except the primary key is fillable.
 */
abstract class Model extends Eloquent
{
    protected $guarded = ['id'];

    public function toArray(): array
    {
        $data = parent::toArray();
        $user = auth()->user();
        if ($user && ! $user->can('inventory.view_cost') && ! $user->can('sales.view_cost')) {
            foreach (['avg_cost', 'purchase_price', 'unit_cost', 'cost_amount', 'component_cost_amount', 'cost_total', 'total_cost'] as $key) {
                unset($data[$key]);
            }
        }

        return $data;
    }

    protected function serializeDate(\DateTimeInterface $date): string
    {
        return $date->format('Y-m-d H:i:s');
    }
}
