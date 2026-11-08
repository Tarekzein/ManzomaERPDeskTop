<?php

namespace App\Modules\Service\Services;

use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\PeriodGuard;
use App\Modules\Finance\Models\JournalEntry;
use App\Modules\Finance\Services\JournalService;
use App\Modules\Inventory\Services\StockService;
use App\Modules\Service\Models\MaintenanceEvent;
use App\Modules\Service\Models\ServiceVisit;
use App\Modules\Service\Models\UnitStageSchedule;
use Illuminate\Support\Facades\DB;

/** Append-only corrections. Financial credits for billed visits stay in the trading return flow. */
class VisitCorrectionService
{
    public function correct(ServiceVisit $visit, string $key, array $data): array
    {
        return DB::transaction(function () use ($visit, $key, $data) {
            $visit = ServiceVisit::whereKey($visit->id)->lockForUpdate()->firstOrFail();
            $hash = hash('sha256', json_encode($data, JSON_THROW_ON_ERROR));
            $previous = DB::table('service_visit_corrections')->where('visit_id', $visit->id)->where('request_key', $key)->first();
            if ($previous) {
                abort_unless(hash_equals($previous->input_hash, $hash), 409, __('The correction request has changed. Use a new request key.'));

                return ['id' => $previous->id, 'visit_id' => $visit->id, 'kind' => $previous->kind];
            }
            abort_unless(in_array($visit->status, ['completed', 'reversed'], true), 422, __('Only completed visits can be corrected.'));
            $details = [];
            if ($data['kind'] === 'reverse_consumption') {
                abort_unless($visit->status === 'completed', 409, __('Visit consumption has already been reversed.'));
                abort_if($visit->invoice_id, 422, __('This visit has an invoice. Use its linked return or credit workflow; do not restock it twice.'));
                abort_unless($data['restock_confirmed'] ?? false, 422, __('Confirm that all recorded parts were physically returned before reversing consumption.'));
                abort_if($data['effective_on'] > MaintenanceService::today() || $data['effective_on'] < $visit->completed_on?->toDateString(), 422, __('Invalid correction date.'));
                app(PeriodGuard::class)->assertOpen($data['effective_on']);
                $events = MaintenanceEvent::where('visit_id', $visit->id)->where('kind', 'replacement')->orderBy('schedule_id')->get();
                foreach ($events as $event) {
                    $schedule = UnitStageSchedule::whereKey($event->schedule_id)->lockForUpdate()->firstOrFail();
                    $latest = MaintenanceEvent::where('schedule_id', $schedule->id)->latest('id')->first();
                    abort_unless($latest?->id === $event->id, 422, __('A later replacement exists. Correct its history separately before reversing this visit.'));
                    abort_unless($data['restore_stage_history'] ?? false, 422, __('Explicitly confirm restoration of the stage history for this visit.'));
                    $old = $event->changes['old']['last_replaced_on'] ?? null;
                    abort_unless($old, 422, __('The original stage date is unknown. Review its history first.'));
                    app(MaintenanceService::class)->replace($schedule, substr($old, 0, 10), null, 'correction', $data['reason']);
                    $details['restored_events'][] = $event->id;
                }
                app(StockService::class)->reverseSource('service_visit', $visit->id, ['date' => $data['effective_on'], 'source_type' => 'service_visit_reversal', 'source_id' => $visit->id, 'reference' => 'VISIT-'.$visit->id, 'party_id' => $visit->request->party_id]);
                if ($visit->journal_entry_id) {
                    $entry = JournalEntry::whereKey($visit->journal_entry_id)->lockForUpdate()->firstOrFail();
                    $details['journal_id'] = app(JournalService::class)->reverse($entry, $data['effective_on'], $data['reason'])->id;
                }
                $visit->update(['status' => 'reversed']);
                $visit->request->update(['status' => 'open']);
            }
            $id = DB::table('service_visit_corrections')->insertGetId(['visit_id' => $visit->id, 'request_key' => $key, 'input_hash' => $hash, 'kind' => $data['kind'], 'effective_on' => $data['effective_on'], 'reason' => $data['reason'], 'actor_id' => auth()->id(), 'details' => json_encode($details), 'created_at' => now(), 'updated_at' => now()]);
            app(AuditService::class)->record('visit_corrected', $visit, $data['reason']);

            return ['id' => $id, 'visit_id' => $visit->id, 'kind' => $data['kind']];
        });
    }
}
