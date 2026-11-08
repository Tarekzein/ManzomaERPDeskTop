<?php

namespace App\Modules\Service\Http\Controllers;

use App\Models\User;
use App\Modules\Core\Models\Attachment;
use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\SettingsService;
use App\Modules\CRM\Models\Activity;
use App\Modules\CRM\Models\Task;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\Warehouse;
use App\Modules\Parties\Models\Party;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\FollowupContact;
use App\Modules\Service\Models\MaintenanceFollowup;
use App\Modules\Service\Models\MaintenanceProfile;
use App\Modules\Service\Models\MessageTemplate;
use App\Modules\Service\Models\PartyAddress;
use App\Modules\Service\Models\ServiceRequest;
use App\Modules\Service\Models\ServiceVisit;
use App\Modules\Service\Models\UnitStageSchedule;
use App\Modules\Service\Services\CustomerUnitService;
use App\Modules\Service\Services\MaintenanceService;
use App\Modules\Service\Services\ServiceReports;
use App\Modules\Service\Services\ServiceSearch;
use App\Modules\Service\Services\VisitCorrectionService;
use App\Modules\Service\Services\VisitService;
use App\Modules\Trading\Models\TradeDocument;
use App\Modules\Trading\Models\TradeDocumentLine;
use App\Support\ApiController;
use App\Support\Money;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ServiceController extends ApiController
{
    private function searchRecords(Builder $query, Request $request, string $kind): void
    {
        $term = ServiceSearch::term($request);
        if ($term === '') {
            return;
        }
        $query->where(function ($q) use ($term, $kind) {
            ServiceSearch::{$kind}($q, $term);
            $this->searchCustom($q, $term);
        });
    }

    private function coordinator(): void
    {
        $this->allow('service.manage');
        $this->allow('service.view_all');
    }

    private function visitVisible(ServiceVisit $visit): void
    {
        abort_unless($this->can('service.view_all') || $visit->technician_id === $this->user()->id, 403);
    }

    private function unitVisible(CustomerUnit $unit): void
    {
        abort_unless($this->can('service.view_all') || ServiceRequest::query()->where('unit_id', $unit->id)->whereHas('visits', fn ($q) => $q->where('technician_id', $this->user()->id))->exists(), 403);
    }

    public function profiles(Request $request)
    {
        $this->allow('service.view');

        $query = MaintenanceProfile::query()->with('stages', 'product:id,code,name,name_en');
        $term = ServiceSearch::term($request);
        if ($term !== '') {
            $query->where(function ($q) use ($term) {
                $q->where('name', 'like', '%'.$term.'%')->orWhereHas('product', fn ($p) => $p->where('name', 'like', '%'.$term.'%')->orWhere('name_en', 'like', '%'.$term.'%')->orWhere('code', 'like', '%'.$term.'%'));
                $this->searchCustom($q, $term);
            });
        }
        $query->orderBy('product_id')->orderByDesc('version');
        if ($request->hasAny(['page', 'per_page', 'custom'])) {
            return $this->paginate($query, $request);
        }

        return ['data' => $query->get()];
    }

    public function saveProfile(Request $request)
    {
        $this->allow('service.settings');
        $data = $request->validate(['product_id' => 'required|exists:products,id', 'name' => 'required|string|max:190', 'stages' => 'required|array|min:1|max:30',
            'stages.*.stage_key' => 'required|regex:/^[a-z][a-z0-9_]{0,39}$/|distinct', 'stages.*.label_ar' => 'required|string|max:190', 'stages.*.label_en' => 'required|string|max:190',
            'stages.*.replacement_product_id' => 'required|exists:products,id', 'stages.*.interval_count' => 'required|integer|between:1,3650', 'stages.*.interval_unit' => 'required|in:days,months']);

        return DB::transaction(function () use ($data) {
            $product = Product::query()->whereKey($data['product_id'])->lockForUpdate()->firstOrFail();
            abort_unless($product->isStock() && $product->is_active, 422);
            $profile = MaintenanceProfile::query()->create(['product_id' => $product->id, 'name' => $data['name'], 'version' => (MaintenanceProfile::query()->where('product_id', $product->id)->max('version') ?? 0) + 1]);
            foreach ($data['stages'] as $i => $stage) {
                abort_unless(Product::query()->findOrFail($stage['replacement_product_id'])->isStock(), 422, 'Replacement must be a stock item.');
                $profile->stages()->create(collect($stage)->only(['stage_key', 'label_ar', 'label_en', 'replacement_product_id', 'interval_count', 'interval_unit'])->all() + ['sort_order' => $i]);
            }

            return response()->json(['data' => $profile->load('stages')], 201);
        });
    }

    public function addresses(Request $request, Party $party)
    {
        $this->coordinator();
        if ($request->isMethod('get')) {
            return ['data' => PartyAddress::query()->where('party_id', $party->id)->get()];
        }
        $data = $request->validate(['label' => 'required|string|max:190', 'governorate' => 'nullable|string|max:100', 'city' => 'nullable|string|max:100', 'street' => 'nullable|string|max:190',
            'building' => 'nullable|string|max:60', 'floor' => 'nullable|string|max:40', 'apartment' => 'nullable|string|max:40', 'landmark' => 'nullable|string|max:190',
            'latitude' => 'nullable|numeric|between:-90,90', 'longitude' => 'nullable|numeric|between:-180,180', 'is_default' => 'boolean']);

        return DB::transaction(function () use ($party, $data) {
            if ($data['is_default'] ?? false) {
                PartyAddress::query()->where('party_id', $party->id)->update(['is_default' => false]);
            }

            return response()->json(['data' => PartyAddress::query()->create($data + ['party_id' => $party->id])], 201);
        });
    }

    public function units(Request $request)
    {
        $this->allow('service.view');
        $query = CustomerUnit::query()->with('party:id,name,name_en,mobile,phone', 'product:id,name,name_en', 'serial', 'schedules', 'address');
        if (! $this->can('service.view_all')) {
            $query->whereIn('id', ServiceRequest::query()->whereHas('visits', fn ($q) => $q->where('technician_id', $this->user()->id))->select('unit_id'));
        }
        if ($request->filled('party_id')) {
            $query->where('party_id', $request->integer('party_id'));
        }
        if ($request->filled('invoice_id')) {
            $query->whereIn('invoice_line_id', TradeDocumentLine::query()->where('trade_document_id', $request->integer('invoice_id'))->select('id'));
        }
        $request->validate(['status' => ['nullable', Rule::in(['pending_installation', 'active', 'paused', 'retired', 'returned'])]]);
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }
        $this->searchRecords($query, $request, 'unit');

        return $this->paginate($query, $request);
    }

    public function invoiceRegistrations(Request $request)
    {
        $this->coordinator();
        $this->allow('service.view');
        $this->allow('sales.invoices');
        $data = $request->validate(['invoice_id' => 'required|integer|min:1']);
        $invoice = TradeDocument::query()->where('type', 'sales_invoice')->where('status', 'posted')->findOrFail($data['invoice_id']);
        $units = CustomerUnit::query()->where('party_id', $invoice->party_id)->whereIn('invoice_line_id', TradeDocumentLine::query()->where('trade_document_id', $invoice->id)->select('id'));
        $counts = (clone $units)->where('status', '!=', 'returned')->selectRaw('invoice_line_id, COUNT(*) as registered_count')->groupBy('invoice_line_id')->get()->mapWithKeys(fn ($row) => [$row->invoice_line_id => (int) $row->registered_count]);
        $serials = (clone $units)->whereNotNull('serial_id')->with('serial:id,serial_number')->orderBy('id')->get(['id', 'invoice_line_id', 'serial_id'])->map(fn ($unit) => ['id' => $unit->id, 'invoice_line_id' => $unit->invoice_line_id, 'serial_number' => $unit->serial?->serial_number]);

        return ['counts' => $counts, 'serial_units' => $serials];
    }

    public function unit(CustomerUnit $unit)
    {
        $this->allow('service.view');
        $this->unitVisible($unit);

        return ['data' => $unit->load('party', 'product', 'serial', 'address', 'profile.stages', 'schedules', 'events')];
    }

    public function saveUnit(Request $request)
    {
        $this->coordinator();
        $service = app(CustomerUnitService::class);
        $data = $request->validate($service->rules());

        return response()->json(['data' => $service->create($data)], 201);
    }

    public function updateUnit(Request $request, CustomerUnit $unit)
    {
        $this->coordinator();
        $data = $request->validate(['status' => 'sometimes|in:active,paused,retired,returned', 'notes' => 'nullable|string|max:4000']);

        return DB::transaction(function () use ($unit, $data) {
            abort_if(! $unit->installed_on && ($data['status'] ?? '') === 'active', 422, 'Confirm installation first.');
            $unit = CustomerUnit::query()->whereKey($unit->id)->lockForUpdate()->firstOrFail();
            $unit->update($data);
            if (isset($data['status'])) {
                if ($data['status'] === 'active') {
                    $unit->schedules()->update(['paused' => false]);
                } else {
                    app(MaintenanceService::class)->suspend($unit, $data['status']);
                }
            }

            return ['data' => $unit->refresh()->load('schedules')];
        });
    }

    public function install(Request $request, CustomerUnit $unit, MaintenanceService $maintenance)
    {
        $this->coordinator();
        $data = $request->validate(['installed_on' => 'required|date_format:Y-m-d']);

        return ['data' => $maintenance->install($unit, $data['installed_on'])];
    }

    public function overrideSchedule(Request $request, CustomerUnit $unit, MaintenanceService $maintenance)
    {
        $this->allow('service.settings');
        $data = $request->validate(['schedule_id' => 'required|integer', 'last_replaced_on' => 'required|date_format:Y-m-d', 'reason' => 'required|string|max:2000']);
        DB::transaction(fn () => $maintenance->replace($unit->schedules()->findOrFail($data['schedule_id']), $data['last_replaced_on'], null, 'correction', $data['reason']));

        return ['data' => $unit->refresh()->load('schedules', 'events')];
    }

    public function due(Request $request)
    {
        $this->allow('service.view');
        $term = ServiceSearch::term($request);
        if ($request->query('when') === 'review') {
            $units = CustomerUnit::query()->with('party:id,name,name_en,mobile,phone', 'product:id,name,name_en', 'address')->whereNull('installed_on')->where('status', 'pending_installation');
            if (! $this->can('service.view_all')) {
                $units->whereIn('id', ServiceRequest::query()->whereHas('visits', fn ($q) => $q->where('technician_id', $this->user()->id))->select('unit_id'));
            }
            if ($request->filled('party_id')) {
                $units->where('party_id', $request->integer('party_id'));
            }
            ServiceSearch::unit($units, $term);
            $result = $this->paginate($units, $request, ['id'], 'id');
            $result->setCollection($result->getCollection()->map(fn ($unit) => ['id' => 'unit-'.$unit->id, 'unit' => $unit, 'status' => 'needs_review', 'label_ar' => 'تاريخ التركيب غير معروف', 'label_en' => 'Installation history required']));

            return $result;
        }
        $query = UnitStageSchedule::query()->with('unit.party:id,name,name_en,mobile,phone', 'unit.product:id,name,name_en', 'unit.address')->where('paused', false)->whereHas('unit', fn ($q) => $q->where('status', 'active'));
        if (! $this->can('service.view_all')) {
            $query->whereIn('unit_id', ServiceRequest::query()->whereHas('visits', fn ($q) => $q->where('technician_id', $this->user()->id))->select('unit_id'));
        }
        if ($request->filled('party_id')) {
            $query->whereHas('unit', fn ($q) => $q->where('party_id', $request->integer('party_id')));
        }
        $today = MaintenanceService::today();
        if ($term !== '') {
            $query->where(fn ($q) => $q->where('label_ar', 'like', '%'.$term.'%')->orWhere('label_en', 'like', '%'.$term.'%')->orWhereHas('unit', fn ($unit) => ServiceSearch::unit($unit, $term)));
        }
        match ($request->query('when', 'week')) {
            'overdue' => $query->where('next_due_on', '<', $today),
            'review' => $query->whereNull('next_due_on'),
            default => $query->whereBetween('next_due_on', [$today, now('Africa/Cairo')->addDays(7)->toDateString()]),
        };
        $result = $this->paginate($query, $request, ['id', 'next_due_on'], 'next_due_on');

        return $result;
    }

    public function followups(Request $request)
    {
        $this->coordinator();

        $query = MaintenanceFollowup::query()->with('schedule.unit.party:id,name,name_en,mobile,phone', 'schedule.unit.product:id,name,name_en', 'contacts')->whereNotIn('status', ['resolved', 'cancelled']);
        if ($request->filled('party_id')) {
            $query->whereHas('schedule.unit', fn ($q) => $q->where('party_id', $request->integer('party_id')));
        }
        $request->validate(['status' => ['nullable', Rule::in(['open', 'contacted', 'booked'])], 'owner_id' => ['nullable', 'regex:/^(unassigned|me|[1-9][0-9]*)$/']]);
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }
        if ($request->query('owner_id') === 'unassigned') {
            $query->whereNull('owner_id');
        } elseif ($request->filled('owner_id')) {
            $query->where('owner_id', $request->query('owner_id') === 'me' ? $this->user()->id : $request->integer('owner_id'));
        }
        $term = ServiceSearch::term($request);
        if ($term !== '') {
            $query->whereHas('schedule', fn ($schedule) => $schedule->where(fn ($q) => $q->where('label_ar', 'like', '%'.$term.'%')->orWhere('label_en', 'like', '%'.$term.'%')->orWhereHas('unit', fn ($unit) => ServiceSearch::unit($unit, $term))));
        }

        return $this->paginate($query, $request, ['id', 'due_on'], 'due_on');
    }

    public function assignFollowup(Request $request, MaintenanceFollowup $followup)
    {
        $this->coordinator();
        $data = $request->validate(['owner_id' => ['required', 'integer', Rule::exists('users', 'id')->where('is_active', true)]]);
        $owner = User::findOrFail($data['owner_id']);
        abort_unless($owner->can('service.view_all') && $owner->can('service.manage'), 422, __('Choose an owner who can access maintenance follow-ups.'));
        DB::transaction(function () use ($followup, $owner) {
            $locked = MaintenanceFollowup::whereKey($followup->id)->lockForUpdate()->firstOrFail();
            abort_if(in_array($locked->status, ['resolved', 'cancelled'], true), 422);
            $locked->update(['owner_id' => $owner->id]);
            Task::whereKey($locked->task_id)->update(['assigned_to' => $owner->id]);
            app(AuditService::class)->record('followup_assigned', $locked);
        });

        return ['data' => $followup->fresh()];
    }

    public function contact(Request $request, MaintenanceFollowup $followup)
    {
        $this->coordinator();
        $data = $request->validate(['channel' => 'required|in:call,whatsapp,email', 'outcome' => 'required|in:contacted,no_answer,booked,declined', 'notes' => 'nullable|string|max:2000', 'message' => 'nullable|string|max:4000', 'next_contact_on' => 'nullable|date_format:Y-m-d']);

        return DB::transaction(function () use ($followup, $data) {
            $followup = MaintenanceFollowup::query()->whereKey($followup->id)->lockForUpdate()->firstOrFail();
            abort_if(in_array($followup->status, ['resolved', 'cancelled'], true), 422);
            $activity = Activity::query()->create(['type' => $data['channel'], 'subject' => 'Maintenance follow-up #'.$followup->id, 'body' => $data['notes'] ?? null, 'outcome' => $data['outcome'], 'party_id' => $followup->schedule->unit->party_id, 'user_id' => $this->user()->id, 'occurred_at' => now()]);
            FollowupContact::query()->create(['followup_id' => $followup->id, 'activity_id' => $activity->id, 'channel' => $data['channel'], 'outcome' => $data['outcome'], 'template_snapshot' => $data['message'] ?? null, 'actor_id' => $this->user()->id]);
            $followup->update(['status' => $data['outcome'] === 'booked' ? 'booked' : 'contacted', 'next_contact_on' => $data['next_contact_on'] ?? null]);

            return ['data' => $followup->refresh()->load('contacts')];
        });
    }

    public function requests(Request $request)
    {
        $this->allow('service.view');
        $q = ServiceRequest::query()->with('party:id,name,name_en,mobile,phone', 'unit.product:id,name,name_en', 'unit.serial', 'visits');
        if (! $this->can('service.view_all')) {
            $q->whereHas('visits', fn ($v) => $v->where('technician_id', $this->user()->id));
        }

        if ($request->filled('party_id')) {
            $q->where('party_id', $request->integer('party_id'));
        }
        if ($request->filled('id')) {
            $q->whereKey($request->integer('id'));
        }
        if ($request->query('status') === 'open') {
            $q->whereNotIn('status', ['completed', 'cancelled', 'reversed']);
        } elseif ($request->filled('status')) {
            $q->where('status', $request->query('status'));
        }
        $request->validate(['status' => ['nullable', Rule::in(['open', 'scheduled', 'completed', 'cancelled', 'reversed'])]]);
        $this->searchRecords($q, $request, 'request');

        return $this->paginate($q, $request);
    }

    public function saveRequest(Request $request)
    {
        $this->coordinator();
        $data = $request->validate(['party_id' => 'required|exists:parties,id', 'unit_id' => 'nullable|exists:customer_units,id', 'address_id' => 'nullable|exists:party_addresses,id', 'type' => 'required|in:installation,maintenance,repair,complaint', 'priority' => 'required|in:low,normal,high', 'description' => 'required|string|max:4000']);
        if (! empty($data['unit_id'])) {
            abort_unless(CustomerUnit::query()->findOrFail($data['unit_id'])->party_id === (int) $data['party_id'], 422);
        }
        if (! empty($data['address_id'])) {
            abort_unless(PartyAddress::query()->findOrFail($data['address_id'])->party_id === (int) $data['party_id'], 422);
        }

        return response()->json(['data' => ServiceRequest::query()->create($data + ['created_by' => $this->user()->id])], 201);
    }

    public function visits(Request $request)
    {
        $this->allow('service.view');
        $q = ServiceVisit::query()->with('request.party:id,name,name_en,mobile,phone', 'request.unit.product:id,name,name_en', 'technician:id,name', 'warehouse:id,name,name_en', 'parts.product', 'stageActions');
        if (! $this->can('service.view_all')) {
            $q->where('technician_id', $this->user()->id);
        }
        if ($request->filled('status')) {
            $q->where('status', $request->query('status'));
        }
        $request->validate(['status' => ['nullable', Rule::in(['draft', 'scheduled', 'in_progress', 'completed', 'cancelled', 'reversed'])]]);
        $this->searchRecords($q, $request, 'visit');

        if ($request->filled('party_id')) {
            $q->whereHas('request', fn ($r) => $r->where('party_id', $request->integer('party_id')));
        }
        if ($request->filled('request_id')) {
            $q->where('request_id', $request->integer('request_id'));
        }
        if (in_array($request->query('when'), ['today', 'late'], true)) {
            $start = now('Africa/Cairo')->startOfDay();
            $q->whereNotIn('status', ['completed', 'cancelled', 'reversed']);
            if ($request->query('when') === 'today') {
                $q->where('scheduled_start', '>=', $start->copy()->utc())->where('scheduled_start', '<', $start->copy()->addDay()->utc());
            } else {
                $q->where('scheduled_start', '<', $start->copy()->utc());
            }
        }

        return $this->paginate($q, $request, ['id', 'scheduled_start'], '-id');
    }

    public function visit(ServiceVisit $visit)
    {
        $this->allow('service.view');
        $this->visitVisible($visit);

        $visit->setAttribute('corrections', DB::table('service_visit_corrections as c')->join('users as u', 'u.id', '=', 'c.actor_id')->where('c.visit_id', $visit->id)->orderBy('c.id')->get(['c.id', 'c.kind', 'c.reason', 'c.effective_on', 'c.created_at', 'u.name as actor_name']));

        return ['data' => $visit->load('request.party', 'request.unit.schedules', 'request.address', 'technician:id,name', 'warehouse', 'parts.product', 'stageActions')->setRelation('attachments', Attachment::query()->where('entity_type', 'service_visits')->where('entity_id', $visit->id)->whereNull('field_id')->get())];
    }

    public function saveVisit(Request $request, ?ServiceVisit $visit = null)
    {
        $this->coordinator();
        $data = $request->validate(['request_id' => 'required|exists:service_requests,id', 'technician_id' => 'required|exists:users,id', 'warehouse_id' => 'required|exists:warehouses,id',
            'schedule' => 'sometimes|boolean', 'scheduled_start' => 'required_if:schedule,true|nullable|date', 'scheduled_end' => 'required_if:schedule,true|nullable|date|after:scheduled_start', 'report' => 'nullable|string|max:10000',
            'signature_attachment_id' => 'nullable|exists:attachments,id', 'attachment_ids' => 'nullable|array|max:20', 'attachment_ids.*' => 'integer|exists:attachments,id',
            'parts' => 'nullable|array|max:100', 'parts.*.product_id' => 'required|exists:products,id', 'parts.*.product_unit_id' => 'nullable|exists:product_units,id',
            'parts.*.batch_id' => 'nullable|integer|min:0', 'parts.*.quantity' => 'required|numeric|gt:0', 'parts.*.unit_price' => 'nullable|numeric|min:0',
            'parts.*.billing' => 'required|in:billable,free,warranty', 'parts.*.free_reason' => 'nullable|string|max:1000', 'parts.*.serial_numbers' => 'nullable|array',
            'parts.*.serial_numbers.*' => 'string|max:100|distinct', 'stage_actions' => 'nullable|array|max:30', 'stage_actions.*.schedule_id' => 'required|integer|distinct',
            'stage_actions.*.action' => 'required|in:replace,inspect', 'stage_actions.*.replaced_on' => 'required|date_format:Y-m-d']);

        // Database datetimes and overlap predicates use the same UTC representation.
        foreach (['scheduled_start', 'scheduled_end'] as $column) {
            if (! empty($data[$column])) {
                $data[$column] = Carbon::parse($data[$column])->utc()->format('Y-m-d H:i:s');
            }
        }

        return DB::transaction(function () use ($data, $visit) {
            if ($visit) {
                $visit = ServiceVisit::query()->whereKey($visit->id)->lockForUpdate()->firstOrFail();
                abort_if(in_array($visit->status, ['completed', 'cancelled', 'reversed'], true), 422, 'Finalized visits are immutable.');
            }
            $technician = User::query()->whereKey($data['technician_id'])->where('is_active', true)->lockForUpdate()->firstOrFail();
            abort_unless($technician->hasRole('technician'), 422, 'Assign an active technician.');
            $warehouse = Warehouse::query()->whereKey($data['warehouse_id'])->where('is_active', true)->where('is_transit', false)->firstOrFail();
            abort_if($warehouse->kind === 'van' && $warehouse->technician_id !== $technician->id, 422, 'Van belongs to another technician.');
            if (! empty($data['scheduled_start']) && ! empty($data['scheduled_end'])) {
                abort_if(ServiceVisit::query()->where('technician_id', $technician->id)->when($visit, fn ($q) => $q->where('id', '!=', $visit->id))->whereIn('status', ['scheduled', 'in_progress'])->where('scheduled_start', '<', $data['scheduled_end'])->where('scheduled_end', '>', $data['scheduled_start'])->exists(), 422, 'Technician has an overlapping visit.');
            }
            $attributes = collect($data)->except(['schedule', 'parts', 'stage_actions', 'attachment_ids', 'signature_attachment_id'])->all();
            if ($data['schedule'] ?? false) {
                abort_if($visit && $visit->status !== 'draft', 422, 'Only a draft can be scheduled here.');
                $attributes['status'] = 'scheduled';
            }
            if ($visit) {
                $visit->update($attributes);
            } else {
                $visit = ServiceVisit::query()->create($attributes + ['entered_by' => $this->user()->id]);
            }
            if (array_key_exists('parts', $data)) {
                $visit->parts()->delete();
                foreach ($data['parts'] ?? [] as $row) {
                    $product = Product::query()->with('units')->findOrFail($row['product_id']);
                    abort_unless($product->isStock(), 422);
                    $unit = ! empty($row['product_unit_id']) ? $product->units->firstWhere('id', (int) $row['product_unit_id']) : null;
                    if (! empty($row['product_unit_id'])) {
                        abort_unless($unit, 422);
                    }
                    if (($row['batch_id'] ?? 0) > 0) {
                        abort_unless(DB::table('batches')->where('id', $row['batch_id'])->where('product_id', $product->id)->exists(), 422);
                    }
                    if ($row['billing'] !== 'billable') {
                        $this->allow('service.free');
                        abort_if(empty($row['free_reason']), 422, 'Provide a reason for free work.');
                    }
                    $visit->parts()->create(collect($row)->only(['product_id', 'product_unit_id', 'quantity', 'batch_id', 'billing', 'free_reason', 'serial_numbers'])->all() + ['base_quantity' => Money::qty($row['quantity'] * ($unit?->factor ?? 1)), 'unit_price' => $row['unit_price'] ?? $product->sale_price]);
                }
            }
            if (array_key_exists('stage_actions', $data)) {
                $visit->stageActions()->delete();
                foreach ($data['stage_actions'] ?? [] as $action) {
                    UnitStageSchedule::query()->where('unit_id', $visit->request->unit_id)->findOrFail($action['schedule_id']);
                    $visit->stageActions()->create(collect($action)->only(['schedule_id', 'action', 'replaced_on'])->all());
                }
            }
            foreach (array_unique(array_filter(array_merge($data['attachment_ids'] ?? [], [$data['signature_attachment_id'] ?? null]))) as $id) {
                $attachment = Attachment::query()->findOrFail($id);
                abort_unless($attachment->entity_type === 'service_visits' && (($attachment->entity_id === $visit->id) || (! $attachment->entity_id && $attachment->uploaded_by === $this->user()->id)), 403);
                $attachment->update(['entity_id' => $visit->id]);
            }
            if (array_key_exists('signature_attachment_id', $data)) {
                $visit->update(['signature_attachment_id' => $data['signature_attachment_id']]);
            }

            return response()->json(['data' => $visit->load('parts.product', 'stageActions', 'request.unit.schedules')], 200);
        });
    }

    public function transition(Request $request, ServiceVisit $visit)
    {
        $this->coordinator();
        $data = $request->validate(['status' => 'required|in:scheduled,in_progress,cancelled']);

        return DB::transaction(function () use ($visit, $data) {
            $visit = ServiceVisit::query()->whereKey($visit->id)->lockForUpdate()->firstOrFail();
            $allowed = ['draft' => ['scheduled', 'cancelled'], 'scheduled' => ['in_progress', 'cancelled'], 'in_progress' => ['scheduled', 'cancelled']];
            abort_unless(in_array($data['status'], $allowed[$visit->status] ?? [], true), 422, 'Invalid visit transition.');
            abort_if($data['status'] === 'scheduled' && (! $visit->scheduled_start || ! $visit->scheduled_end), 422, 'Set the appointment time first.');
            $visit->update(['status' => $data['status']] + ($data['status'] === 'in_progress' ? ['started_at' => now()] : []));

            return ['data' => $visit->refresh()];
        });
    }

    public function complete(Request $request, ServiceVisit $visit, VisitService $service)
    {
        $this->allow('service.complete');
        $this->visitVisible($visit);
        $data = $request->validate(['completed_on' => 'required|date_format:Y-m-d', 'confirm_installation' => 'sometimes|boolean']);
        if ($data['confirm_installation'] ?? false) {
            $this->coordinator();
        }
        $key = $request->header('Idempotency-Key');
        abort_unless(is_string($key) && strlen($key) >= 8 && strlen($key) <= 100, 422, 'Idempotency-Key is required.');

        return ['data' => $service->complete($visit, $key, $data['completed_on'], $data['confirm_installation'] ?? false)];
    }

    public function invoice(Request $request, ServiceVisit $visit, VisitService $service)
    {
        $this->coordinator();
        $this->allow('sales.invoices');
        $data = $request->validate(['services' => 'nullable|array|max:30', 'services.*.product_id' => 'required|exists:products,id', 'services.*.quantity' => 'required|numeric|gt:0', 'services.*.unit_price' => 'required|numeric|min:0']);

        return ['data' => $service->invoice($visit, $data['services'] ?? [])];
    }

    public function templates(Request $request)
    {
        $this->allow('service.view');
        if ($request->isMethod('get')) {
            return ['data' => MessageTemplate::query()->where('active', true)->get()];
        }
        $this->allow('service.settings');
        $data = $request->validate(['key' => 'required|regex:/^[a-z][a-z0-9_]{0,59}$/', 'locale' => 'required|in:ar,en', 'body' => 'required|string|max:4000']);
        preg_match_all('/\{\{(.*?)\}\}/', $data['body'], $matches);
        abort_if(array_diff($matches[1], ['customer', 'unit', 'stage', 'due_date', 'company']), 422, 'Unknown template placeholder.');

        return DB::transaction(function () use ($data) {
            $versions = MessageTemplate::query()->where('key', $data['key'])->where('locale', $data['locale'])->lockForUpdate()->get();
            MessageTemplate::query()->whereIn('id', $versions->pluck('id'))->update(['active' => false]);

            return ['data' => MessageTemplate::query()->create($data + ['version' => ($versions->max('version') ?? 0) + 1])];
        });
    }

    public function correctVisit(Request $request, ServiceVisit $visit, VisitCorrectionService $service)
    {
        $this->allow('service.correct');
        $this->visitVisible($visit);
        $data = $request->validate(['kind' => 'required|in:note,reverse_consumption', 'reason' => 'required|string|min:5|max:4000', 'effective_on' => 'required|date_format:Y-m-d|before_or_equal:'.MaintenanceService::today(), 'restock_confirmed' => 'sometimes|boolean', 'restore_stage_history' => 'sometimes|boolean']);
        $key = $request->header('Idempotency-Key');
        abort_unless(is_string($key) && strlen($key) >= 8 && strlen($key) <= 100, 422, __('A valid idempotency key is required.'));

        return ['data' => $service->correct($visit, $key, $data)];
    }

    public function reports(Request $request)
    {
        $this->allow('service.reports');
        $today = MaintenanceService::today();
        $active = UnitStageSchedule::query()->where('paused', false)->whereHas('unit', fn ($q) => $q->where('status', 'active'));

        $filters = $request->validate(['from' => 'nullable|date_format:Y-m-d', 'to' => 'nullable|date_format:Y-m-d', 'technician_id' => 'nullable|integer|exists:users,id', 'warehouse_id' => 'nullable|integer|exists:warehouses,id']);
        abort_if(! empty($filters['from']) && ! empty($filters['to']) && $filters['to'] < $filters['from'], 422, __('End date must not precede start date.'));
        if (! $this->can('service.view_all')) {
            $filters['technician_id'] = $this->user()->id;
        }
        $technicians = app(ServiceReports::class)->technicians($filters);
        if (! $this->can('inventory.view_cost') && ! $this->can('sales.view_cost')) {
            foreach ($technicians as $row) {
                unset($row->parts_cost, $row->net_parts_cost, $row->contribution_after_parts);
            }
        }

        return ['filters' => $filters, 'unassigned_followups' => MaintenanceFollowup::query()->whereNull('owner_id')->whereNotIn('status', ['resolved', 'cancelled'])->count(), 'due_week' => (clone $active)->whereBetween('next_due_on', [$today, now('Africa/Cairo')->addDays(7)->toDateString()])->count(),
            'overdue' => (clone $active)->where('next_due_on', '<', $today)->count(), 'needs_review' => CustomerUnit::query()->whereNull('installed_on')->where('status', 'pending_installation')->count(),
            'open_followups' => MaintenanceFollowup::query()->whereNotIn('status', ['resolved', 'cancelled'])->count(),
            'last_scan' => app(SettingsService::class)->get('system.maintenance_last_scan'), 'failed_jobs' => DB::table('failed_jobs')->count(), 'pending_jobs' => DB::table('jobs')->count(),
            'technicians' => $technicians];
    }
}
