<?php

namespace App\Modules\Service\Services;

use App\Support\Money;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class ServiceReports
{
    /** Period contribution after parts, including free/unbilled work and posted returns. */
    public function technicians(array $filters = []): Collection
    {
        $billingQuery = DB::table('trade_documents as d')
            ->join('service_visits as v', fn ($join) => $join->on('v.invoice_id', '=', 'd.id')->orOn('v.invoice_id', '=', 'd.source_id'))
            ->join('trade_document_lines as l', 'l.trade_document_id', '=', 'd.id')
            ->join('products as p', 'p.id', '=', 'l.product_id')
            ->leftJoin('trade_line_service_parts as f', 'f.trade_line_id', '=', 'l.id')
            ->where('d.status', 'posted')->whereIn('d.type', ['sales_invoice', 'sales_return'])->groupBy('v.technician_id')
            ->selectRaw("v.technician_id,
                SUM(CASE WHEN p.type = 'stock' THEN l.net_amount * (CASE WHEN d.type = 'sales_return' THEN -1 ELSE 1 END) ELSE 0 END) parts_revenue,
                SUM(CASE WHEN p.type = 'service' THEN l.net_amount * (CASE WHEN d.type = 'sales_return' THEN -1 ELSE 1 END) ELSE 0 END) service_revenue,
                SUM(CASE WHEN d.type = 'sales_return' THEN -l.cost_amount ELSE l.cost_amount - COALESCE(f.cost_amount, 0) END) additional_cost");
        $this->filter($billingQuery, $filters, 'd.date');
        $billing = $billingQuery->get()->keyBy('technician_id');

        $visits = DB::table('service_visits as v')->join('users as u', 'u.id', '=', 'v.technician_id')->groupBy('u.id', 'u.name')
            ->selectRaw("u.id, u.name, COUNT(*) visits, SUM(CASE WHEN v.status = 'completed' THEN 1 ELSE 0 END) completed, SUM(v.cost_total) parts_cost");
        $this->filter($visits, $filters, DB::raw('COALESCE(v.completed_on, DATE(v.created_at))'));

        $rows = $visits->get()->keyBy('id');
        $reversals = DB::table('service_visit_corrections as c')->join('service_visits as v', 'v.id', '=', 'c.visit_id')->where('c.kind', 'reverse_consumption')->groupBy('v.technician_id')->selectRaw('v.technician_id, SUM(v.cost_total) returned_cost');
        $this->filter($reversals, $filters, 'c.effective_on');
        $reversed = $reversals->get()->keyBy('technician_id');
        $ids = $rows->keys()->merge($billing->keys())->merge($reversed->keys())->unique();
        $names = DB::table('users')->whereIn('id', $ids)->pluck('name', 'id');

        return $ids->map(function ($id) use ($rows, $billing, $reversed, $names) {
            $row = $rows[$id] ?? (object) ['id' => $id, 'name' => $names[$id], 'visits' => 0, 'completed' => 0, 'parts_cost' => 0];
            $revenue = $billing[$row->id] ?? null;
            $row->parts_revenue = Money::round($revenue?->parts_revenue ?? 0);
            $row->service_revenue = Money::round($revenue?->service_revenue ?? 0);
            $row->net_parts_cost = Money::round((float) $row->parts_cost - (float) ($reversed[$id]->returned_cost ?? 0) + (float) ($revenue?->additional_cost ?? 0));
            $row->contribution_after_parts = Money::round($row->parts_revenue + $row->service_revenue - $row->net_parts_cost);

            return $row;
        })->values();
    }

    private function filter($query, array $filters, $date): void
    {
        if (! empty($filters['from'])) {
            $query->where($date, '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $query->where($date, '<=', $filters['to']);
        }
        if (! empty($filters['technician_id'])) {
            $query->where('v.technician_id', $filters['technician_id']);
        }
        if (! empty($filters['warehouse_id'])) {
            $query->where('v.warehouse_id', $filters['warehouse_id']);
        }
    }
}
