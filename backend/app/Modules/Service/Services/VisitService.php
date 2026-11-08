<?php

namespace App\Modules\Service\Services;

use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Core\Services\PeriodGuard;
use App\Modules\Finance\Services\JournalService;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Services\StockService;
use App\Modules\Service\Models\ServiceVisit;
use App\Modules\Service\Models\UnitStageSchedule;
use App\Modules\Trading\Models\TradeDocument;
use App\Modules\Trading\Services\TradingService;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

class VisitService
{
    public function __construct(private readonly StockService $stock, private readonly JournalService $journal, private readonly MaintenanceService $maintenance) {}

    public function complete(ServiceVisit $visit, string $key, string $date, bool $confirmInstallation = false): ServiceVisit
    {
        return DB::transaction(function () use ($visit, $key, $date, $confirmInstallation) {
            $visit = ServiceVisit::query()->whereKey($visit->id)->lockForUpdate()->firstOrFail();
            if ($visit->status === 'completed') {
                abort_unless($visit->completion_key === $key, 409, 'Visit already completed.');

                return $visit->load('parts.product', 'stageActions', 'request.unit');
            }
            abort_unless(in_array($visit->status, ['scheduled', 'in_progress'], true), 422, 'Schedule or start the visit first.');
            abort_if(! $visit->report || $date > MaintenanceService::today(), 422, 'A visit report and valid completion date are required.');
            app(PeriodGuard::class)->assertOpen($date);
            $parts = $visit->parts()->orderBy('product_id')->get();
            $products = $this->stock->lockProducts($parts->pluck('product_id')->all());
            $total = 0;
            foreach ($parts as $part) {
                if ($part->billing !== 'billable') {
                    abort_unless(auth()->user()?->can('service.free'), 403, 'Free or warranty work needs approval.');
                }
                $moves = $this->stock->issue($products[$part->product_id], $visit->warehouse_id, (float) $part->base_quantity, $part->batch_id ?: null,
                    ['date' => $date, 'source_type' => 'service_visit', 'source_id' => $visit->id, 'source_line_id' => $part->id, 'reference' => 'VISIT-'.$visit->id, 'party_id' => $visit->request->party_id, 'serial_numbers' => $part->serial_numbers ?? []]);
                $cost = Money::round(abs(collect($moves)->sum('total_cost')));
                $part->update(['cost_amount' => $cost, 'unit_cost' => round($cost / (float) $part->base_quantity, 4)]);
                $total += $cost;
                foreach ($moves as $move) {
                    DB::table('service_visit_stock_moves')->insert(['visit_part_id' => $part->id, 'stock_move_id' => $move->id]);
                }
            }
            if ($confirmInstallation) {
                abort_unless($visit->request->type === 'installation' && $visit->request->unit, 422, 'An installation request linked to a customer filter is required.');
                $this->maintenance->install($visit->request->unit, $date, $visit->id);
            }
            $entry = $this->journal->post(['date' => $date, 'description' => 'Service visit '.$visit->id, 'source_type' => 'service_visit', 'source_id' => $visit->id, 'branch_id' => $visit->warehouse->branch_id],
                [['account' => 'cogs', 'debit' => Money::round($total)], ['account' => 'inventory', 'credit' => Money::round($total)]]);
            $replacedQuantities = [];
            foreach ($visit->stageActions as $action) {
                $schedule = UnitStageSchedule::query()->whereKey($action->schedule_id)->where('unit_id', $visit->request->unit_id)->lockForUpdate()->firstOrFail();
                abort_if($action->replaced_on->toDateString() > $date, 422, 'Replacement cannot be later than completion.');
                if ($action->action === 'replace') {
                    $replacedQuantities[$schedule->replacement_product_id] = ($replacedQuantities[$schedule->replacement_product_id] ?? 0) + 1;
                    abort_unless((float) $parts->where('product_id', $schedule->replacement_product_id)->sum('base_quantity') >= $replacedQuantities[$schedule->replacement_product_id], 422, 'Every replaced stage requires its recorded part quantity.');
                }
                if ($action->action === 'replace') {
                    $this->maintenance->replace($schedule, $action->replaced_on->toDateString(), $visit->id);
                }
            }
            $visit->update(['status' => 'completed', 'completed_on' => $date, 'completed_at' => now(), 'completion_time_known' => true, 'completed_by' => auth()->id(), 'cost_total' => Money::round($total), 'journal_entry_id' => $entry?->id, 'completion_key' => $key]);
            $visit->request->update(['status' => 'completed']);
            app(AuditService::class)->record('visit_completed', $visit);
            app(DynamicFormService::class)->snapshot('service-visits', $visit->id);

            return $visit->refresh()->load('parts.product', 'stageActions', 'request.unit');
        });
    }

    public function invoice(ServiceVisit $visit, array $services = []): TradeDocument
    {
        return DB::transaction(function () use ($visit, $services) {
            $visit = ServiceVisit::query()->whereKey($visit->id)->lockForUpdate()->firstOrFail();
            abort_unless($visit->status === 'completed', 422, 'Complete the visit before invoicing.');
            if ($visit->invoice_id) {
                return TradeDocument::query()->findOrFail($visit->invoice_id)->load('lines.product', 'party');
            }
            $parts = $visit->parts()->where('billing', 'billable')->orderBy('id')->get();
            $lines = $parts->map(fn ($p) => ['product_id' => $p->product_id, 'product_unit_id' => $p->product_unit_id, 'quantity' => $p->quantity, 'unit_price' => $p->unit_price, 'batch_id' => $p->batch_id, 'serial_numbers' => $p->serial_numbers ?? []])->all();
            foreach ($services as $line) {
                $product = Product::query()->findOrFail($line['product_id']);
                abort_unless($product->type === 'service', 422, 'Additional invoice lines must be service products.');
                $lines[] = $line;
            }
            abort_if(! $lines, 422, 'No billable parts or services.');
            $doc = app(TradingService::class)->save('sales_invoice', ['party_id' => $visit->request->party_id, 'warehouse_id' => $visit->warehouse_id,
                'date' => MaintenanceService::today(), 'notes' => 'Service visit #'.$visit->id, 'lines' => $lines]);
            $docLines = $doc->lines->values();
            foreach ($parts->values() as $i => $part) {
                DB::table('trade_line_service_parts')->insert(['trade_line_id' => $docLines[$i]->id, 'visit_part_id' => $part->id, 'base_quantity' => $part->base_quantity, 'cost_amount' => $part->cost_amount]);
            }
            $visit->update(['invoice_id' => $doc->id]);

            return $doc;
        });
    }
}
