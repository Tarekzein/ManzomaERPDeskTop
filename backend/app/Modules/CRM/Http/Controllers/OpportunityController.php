<?php

namespace App\Modules\CRM\Http\Controllers;

use App\Modules\CRM\Models\Opportunity;
use App\Modules\CRM\Models\Stage;
use App\Modules\CRM\Services\CrmService;
use App\Modules\Trading\Services\TradingService;
use App\Support\ApiController;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Http\Request;

class OpportunityController extends ApiController
{
    public function __construct(private readonly CrmService $crm) {}

    public function index(Request $request)
    {
        $this->allow('crm.view');
        $query = Opportunity::query()->with($this->crm->opportunityRelations());
        $this->scope($query, $request);
        foreach (['status', 'stage_id', 'owner_id', 'party_id', 'lead_id'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->query($filter));
            }
        }
        $this->search($query, $request->query('search'), ['title']);

        return $this->paginate($query, $request, ['id', 'title', 'value', 'expected_close_date', 'created_at'], '-id');
    }

    /**
     * Kanban board: open deals per stage plus recently closed ones.
     */
    public function board(Request $request)
    {
        $this->allow('crm.view');
        $query = Opportunity::query()->with($this->crm->opportunityRelations())
            ->where(fn ($q) => $q->where('status', 'open')->orWhere('updated_at', '>=', now()->subDays(30)));
        $this->scope($query, $request);
        $deals = $query->orderBy('sort_order')->orderByDesc('id')->get();
        $stages = Stage::query()->orderBy('sort_order')->get();

        return response()->json([
            'stages' => $stages->map(fn ($s) => $s->toArray() + [
                'deals' => $deals->where('stage_id', $s->id)->values(),
                'total' => Money::round($deals->where('stage_id', $s->id)->sum('value')),
            ]),
            'summary' => [
                'open_value' => Money::round($deals->where('status', 'open')->sum('value')),
                'weighted_value' => Money::round($deals->where('status', 'open')->sum(fn ($d) => (float) $d->value * $d->probability / 100)),
                'open_count' => $deals->where('status', 'open')->count(),
            ],
        ]);
    }

    public function show(Opportunity $opportunity)
    {
        $this->allow('crm.view');
        $this->assertVisible($opportunity);

        return response()->json(['data' => $opportunity->load($this->crm->opportunityRelations())]);
    }

    public function store(Request $request)
    {
        $this->allow('crm.manage');
        $data = $this->validated($request);
        $stage = Stage::query()->findOrFail($data['stage_id'] ?? Stage::query()->orderBy('sort_order')->value('id'));
        $opportunity = Opportunity::query()->create($data + [
            'stage_id' => $stage->id,
            'probability' => $data['probability'] ?? $stage->probability,
            'owner_id' => $data['owner_id'] ?? $this->user()->id,
        ]);

        return response()->json(['data' => $opportunity->load($this->crm->opportunityRelations())], 201);
    }

    public function update(Request $request, Opportunity $opportunity)
    {
        $this->allow('crm.manage');
        $this->assertVisible($opportunity);
        $data = $this->validated($request);
        $stageId = $data['stage_id'] ?? null;
        unset($data['stage_id']);
        $opportunity->update($data);
        if ($stageId && (int) $stageId !== (int) $opportunity->stage_id) {
            $opportunity = $this->crm->moveOpportunity($opportunity, (int) $stageId, $request->all());
        }

        return response()->json(['data' => $opportunity->refresh()->load($this->crm->opportunityRelations())]);
    }

    public function move(Request $request, Opportunity $opportunity)
    {
        $this->allow('crm.manage');
        $this->assertVisible($opportunity);
        $data = $request->validate(['stage_id' => 'required|exists:crm_stages,id', 'lost_reason_id' => 'nullable|exists:crm_lost_reasons,id', 'lost_note' => 'nullable|string|max:250', 'sort_order' => 'nullable|integer']);

        return response()->json(['data' => $this->crm->moveOpportunity($opportunity, (int) $data['stage_id'], $data)]);
    }

    public function quotation(Opportunity $opportunity, TradingService $trading)
    {
        $this->allow('sales.quotations');
        $this->assertVisible($opportunity);
        if ($opportunity->quotation_id) {
            throw BusinessException::make(__('erp.opportunity_has_quotation'), 'has_quotation', ['quotation_id' => $opportunity->quotation_id]);
        }

        return response()->json(['data' => $this->crm->quotationFor($opportunity, $trading)], 201);
    }

    public function destroy(Opportunity $opportunity)
    {
        $this->allow('crm.manage');
        $this->assertVisible($opportunity);
        $opportunity->delete();

        return response()->json(['ok' => true]);
    }

    private function assertVisible(Opportunity $opportunity): void
    {
        abort_unless(! $opportunity->owner_id || $opportunity->owner_id === $this->user()->id || $this->can('crm.view_all'), 403);
    }

    private function scope($query, Request $request): void
    {
        if (! $this->can('crm.view_all')) {
            $query->where(fn ($q) => $q->where('owner_id', $this->user()->id)->orWhereNull('owner_id'));
        } elseif ($request->filled('owner_id')) {
            $query->where('owner_id', $request->integer('owner_id'));
        } elseif ($request->boolean('mine')) {
            $query->where('owner_id', $this->user()->id);
        }
    }

    private function validated(Request $request): array
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:190'],
            'lead_id' => ['nullable', 'exists:crm_leads,id'],
            'party_id' => ['nullable', 'exists:parties,id'],
            'stage_id' => ['nullable', 'exists:crm_stages,id'],
            'owner_id' => ['nullable', 'exists:users,id'],
            'source_id' => ['nullable', 'exists:crm_sources,id'],
            'value' => ['nullable', 'numeric', 'min:0'],
            'probability' => ['nullable', 'integer', 'between:0,100'],
            'expected_close_date' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:4000'],
        ]);
        if (empty($data['lead_id']) && empty($data['party_id'])) {
            throw BusinessException::make(__('erp.opportunity_needs_contact'), 'contact_required');
        }
        $data['value'] = (float) ($data['value'] ?? 0);

        return $data;
    }
}
