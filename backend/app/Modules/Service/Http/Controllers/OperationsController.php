<?php

namespace App\Modules\Service\Http\Controllers;

use App\Modules\Inventory\Models\Warehouse;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\ServiceRequest;
use App\Modules\Service\Models\ServiceVisit;
use App\Modules\Service\Models\UnitStageSchedule;
use App\Support\ApiController;
use Illuminate\Support\Facades\DB;

/** Small, permission-scoped work queue for the daily workspace. No financial details. */
class OperationsController extends ApiController
{
    public function today(): array
    {
        $start = now('Africa/Cairo')->startOfDay();
        $end = $start->copy()->addDay();
        $result = ['business_date' => $start->toDateString()];
        if ($this->can('service.view')) {
            $all = $this->can('service.view_all');
            $assignedUnits = fn () => ServiceRequest::query()->whereHas('visits', fn ($q) => $q->where('technician_id', $this->user()->id))->select('unit_id');
            $visits = ServiceVisit::query()->when(! $all, fn ($q) => $q->where('technician_id', $this->user()->id));
            $planned = (clone $visits)->where('scheduled_start', '>=', $start->copy()->utc())->where('scheduled_start', '<', $end->copy()->utc())->whereNotIn('status', ['completed', 'cancelled']);
            $late = (clone $visits)->where('scheduled_start', '<', $start->copy()->utc())->whereNotIn('status', ['completed', 'cancelled']);
            $stages = UnitStageSchedule::query()->where('paused', false)->whereHas('unit', fn ($q) => $q->where('status', 'active'))
                ->when(! $all, fn ($q) => $q->whereIn('unit_id', $assignedUnits()));
            $requests = ServiceRequest::query()->whereNotIn('status', ['completed', 'cancelled'])->whereDoesntHave('visits', fn ($q) => $q->whereNotIn('status', ['draft', 'cancelled']));
            // Unassigned requests belong to coordinators; technicians see assigned work only.
            $pending = CustomerUnit::query()->where('status', 'pending_installation')->when(! $all, fn ($q) => $q->whereIn('id', $assignedUnits()));
            $result['service'] = [
                'visits_today' => (clone $planned)->count(),
                'late_visits' => (clone $late)->count(),
                'due_week' => (clone $stages)->whereBetween('next_due_on', [$start->toDateString(), $start->copy()->addDays(7)->toDateString()])->count(),
                'overdue' => (clone $stages)->where('next_due_on', '<', $start->toDateString())->count(),
                'awaiting_installation' => $pending->count(),
                'awaiting_scheduling' => $all ? (clone $requests)->count() : 0,
                'visits' => (clone $planned)->with('request.party:id,name,mobile,phone', 'request.unit:id,unit_code', 'technician:id,name')->orderBy('scheduled_start')->orderBy('id')->limit(6)->get(['id', 'request_id', 'technician_id', 'scheduled_start', 'status']),
                'requests' => $all ? $requests->with('party:id,name,mobile,phone', 'unit:id,unit_code', 'visits:id,request_id,status')->orderBy('id')->limit(6)->get() : [],
            ];
        }
        if ($this->can('stock.view')) {
            $alerts = DB::table('stock_alerts as a')->join('products as p', 'p.id', '=', 'a.product_id')->where('a.active', true)->whereNull('p.deleted_at');
            if ($this->user()->hasRole('technician') && ! $this->can('service.view_all')) {
                $alerts->whereIn('a.warehouse_id', Warehouse::query()->where('technician_id', $this->user()->id)->select('id'));
            }
            $result['stock'] = ['low_stock' => (clone $alerts)->count(), 'alerts' => $alerts->orderBy('p.name')->limit(6)->get(['p.id as product_id', 'p.name', 'p.name_en', 'a.warehouse_id'])];
        }

        return $result;
    }
}
