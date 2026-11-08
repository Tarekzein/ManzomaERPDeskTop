<?php

namespace App\Modules\Service\Services;

use App\Models\User;
use App\Modules\Core\Services\SettingsService;
use App\Modules\CRM\Models\Task;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\MaintenanceEvent;
use App\Modules\Service\Models\MaintenanceFollowup;
use App\Modules\Service\Models\UnitStageSchedule;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class MaintenanceService
{
    public static function today(): string
    {
        return now('Africa/Cairo')->toDateString();
    }

    public function nextDue(string $date, int $count, string $unit): string
    {
        $base = Carbon::createFromFormat('!Y-m-d', $date, 'Africa/Cairo');

        return ($unit === 'months' ? $base->addMonthsNoOverflow($count) : $base->addDays($count))->toDateString();
    }

    public function install(CustomerUnit $unit, string $date, ?int $visitId = null): CustomerUnit
    {
        return DB::transaction(function () use ($unit, $date, $visitId) {
            $unit = CustomerUnit::query()->whereKey($unit->id)->lockForUpdate()->firstOrFail();
            abort_unless($unit->status === 'pending_installation' && ! $unit->installed_on, 409, 'Unit already installed or retired.');
            abort_if($date > self::today() || ($unit->purchased_on && $date < $unit->purchased_on->toDateString()), 422, 'Invalid installation date.');
            $unit->update(['installed_on' => $date, 'status' => 'active']);
            foreach ($unit->profile->stages as $stage) {
                UnitStageSchedule::query()->create(['unit_id' => $unit->id, 'profile_stage_id' => $stage->id, 'stage_key' => $stage->stage_key,
                    'label_ar' => $stage->label_ar, 'label_en' => $stage->label_en, 'replacement_product_id' => $stage->replacement_product_id,
                    'interval_count' => $stage->interval_count, 'interval_unit' => $stage->interval_unit, 'last_replaced_on' => $date,
                    'next_due_on' => $this->nextDue($date, $stage->interval_count, $stage->interval_unit)]);
            }
            MaintenanceEvent::query()->create(['unit_id' => $unit->id, 'kind' => 'installation', 'event_on' => $date, 'visit_id' => $visitId, 'actor_id' => auth()->id()]);

            return $unit->refresh()->load('schedules', 'events');
        });
    }

    public function replace(UnitStageSchedule $schedule, string $date, ?int $visitId, string $kind = 'replacement', ?string $reason = null): void
    {
        $schedule = UnitStageSchedule::query()->whereKey($schedule->id)->lockForUpdate()->firstOrFail();
        abort_if($date > self::today() || ($kind === 'replacement' && $schedule->last_replaced_on && $date < $schedule->last_replaced_on->toDateString()), 422, 'Invalid replacement date.');
        $old = $schedule->only(['last_replaced_on', 'next_due_on', 'cycle_number']);
        $followups = MaintenanceFollowup::query()->where('schedule_id', $schedule->id)->whereNotIn('status', ['resolved', 'cancelled'])->get();
        foreach ($followups as $followup) {
            $followup->update(['status' => $kind === 'replacement' ? 'resolved' : 'cancelled']);
            if ($followup->task_id) {
                Task::query()->whereKey($followup->task_id)->update(['status' => $kind === 'replacement' ? 'done' : 'cancelled', 'completed_at' => now()]);
            }
        }
        $schedule->update(['last_replaced_on' => $date, 'next_due_on' => $this->nextDue($date, $schedule->interval_count, $schedule->interval_unit), 'cycle_number' => $schedule->cycle_number + 1]);
        MaintenanceEvent::query()->create(['unit_id' => $schedule->unit_id, 'schedule_id' => $schedule->id, 'kind' => $kind, 'event_on' => $date,
            'visit_id' => $visitId, 'actor_id' => auth()->id(), 'notes' => $reason, 'changes' => ['old' => $old, 'new' => $schedule->only(['last_replaced_on', 'next_due_on', 'cycle_number'])]]);
    }

    public function suspend(CustomerUnit $unit, string $status): void
    {
        $unit->update(['status' => $status]);
        $unit->schedules()->update(['paused' => true]);
        $followups = MaintenanceFollowup::query()->whereIn('schedule_id', $unit->schedules()->select('id'))->whereNotIn('status', ['resolved', 'cancelled'])->get();
        foreach ($followups as $followup) {
            $followup->update(['status' => 'cancelled']);
            Task::query()->whereKey($followup->task_id)->update(['status' => 'cancelled', 'completed_at' => now()]);
        }
    }

    public function scan(): array
    {
        $today = self::today();
        $created = 0;
        $updated = 0;
        $settings = app(SettingsService::class);
        $before = (int) $settings->get('maintenance.reminder_days', 7);
        $overdue = (int) $settings->get('maintenance.overdue_days', 7);
        $candidate = User::query()->where('is_active', true)->find($settings->get('maintenance.owner_id'));
        $eligible = fn ($user) => $user && $user->can('service.manage') && $user->can('service.view_all');
        $owner = ($eligible($candidate) ? $candidate : User::query()->where('is_active', true)->whereHas('roles', fn ($q) => $q->whereIn('name', ['service_coordinator', 'admin']))->orderBy('id')->get()->first($eligible))?->id;
        UnitStageSchedule::query()->where('paused', false)->whereNotNull('next_due_on')->where('next_due_on', '<=', Carbon::parse($today)->addDays($before)->toDateString())
            ->whereHas('unit', fn ($q) => $q->where('status', 'active'))->orderBy('id')->chunkById(200, function ($rows) use ($today, $owner, $overdue, &$created, &$updated) {
                foreach ($rows as $row) {
                    DB::transaction(function () use ($row, $today, $owner, $overdue, &$created, &$updated) {
                        $schedule = UnitStageSchedule::query()->whereKey($row->id)->lockForUpdate()->firstOrFail();
                        if ($schedule->paused || $schedule->unit->status !== 'active') {
                            return;
                        }
                        $due = $schedule->next_due_on->toDateString();
                        $level = $due <= Carbon::parse($today)->subDays($overdue)->toDateString() ? 2 : ($due <= $today ? 1 : 0);
                        $followup = MaintenanceFollowup::query()->firstOrCreate(['schedule_id' => $schedule->id, 'cycle_number' => $schedule->cycle_number], ['due_on' => $due, 'owner_id' => $owner]);
                        if ($followup->wasRecentlyCreated || $followup->status === 'cancelled') {
                            $task = Task::query()->create(['title' => $schedule->unit->unit_code.' — '.$schedule->label_ar, 'notes' => 'Maintenance due: '.$due,
                                'party_id' => $schedule->unit->party_id, 'assigned_to' => $owner, 'due_at' => Carbon::parse($due.' 09:00:00', 'Africa/Cairo')->utc(),
                                'remind_at' => now(), 'priority' => $level ? 'high' : 'normal', 'status' => 'open']);
                            $followup->update(['task_id' => $task->id, 'escalation' => $level, 'status' => 'open']);
                            $created++;
                        } elseif ($level > $followup->escalation && ! in_array($followup->status, ['resolved', 'cancelled'], true)) {
                            $followup->update(['escalation' => $level]);
                            Task::query()->whereKey($followup->task_id)->update(['priority' => 'high', 'remind_at' => now()]);
                            $updated++;
                        }
                    });
                }
            });
        app(SettingsService::class)->set('system.maintenance_last_scan', now()->toIso8601String());

        return ['created' => $created, 'escalated' => $updated, 'scanned_at' => now()->toIso8601String()];
    }
}
