<?php

namespace App\Modules\CRM\Http\Controllers;

use App\Modules\CRM\Models\Lead;
use App\Modules\CRM\Services\CrmService;
use App\Support\ApiController;
use Illuminate\Http\Request;

class LeadController extends ApiController
{
    public function __construct(private readonly CrmService $crm) {}

    public function index(Request $request)
    {
        $this->allow('crm.view');
        $query = Lead::query()->with('owner:id,name', 'source:id,name,name_en', 'tags:id,name,color', 'party:id,code,name')
            ->withCount(['opportunities as open_opportunities' => fn ($q) => $q->where('status', 'open')]);
        $this->scopeOwner($query, $request);
        foreach (['status', 'source_id', 'owner_id'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->query($filter));
            }
        }
        if ($request->filled('tag_id')) {
            $query->whereHas('tags', fn ($q) => $q->where('tags.id', $request->integer('tag_id')));
        }
        $this->search($query, $request->query('search'), ['name', 'company_name', 'phone', 'mobile', 'email', 'city']);

        return $this->paginate($query, $request, ['id', 'name', 'score', 'created_at', 'expected_value'], '-id');
    }

    public function show(Lead $lead)
    {
        $this->allow('crm.view');
        $this->assertVisible($lead->owner_id);

        return response()->json(['data' => $lead->load('owner:id,name', 'source', 'tags:id,name,color', 'party:id,code,name', 'opportunities.stage')]);
    }

    public function store(Request $request)
    {
        $this->allow('crm.manage');
        $data = $this->validated($request);
        $lead = Lead::query()->create(collect($data)->except('tags')->all() + ['owner_id' => $data['owner_id'] ?? $this->user()->id]);
        $lead->syncTags($data['tags'] ?? []);
        $this->crm->scoreLead($lead);

        return response()->json(['data' => $lead->load('owner:id,name', 'source', 'tags:id,name,color')], 201);
    }

    public function update(Request $request, Lead $lead)
    {
        $this->allow('crm.manage');
        $this->assertVisible($lead->owner_id);
        $data = $this->validated($request);
        $lead->update(collect($data)->except('tags')->all());
        if (array_key_exists('tags', $data)) {
            $lead->syncTags($data['tags'] ?? []);
        }
        $this->crm->scoreLead($lead);

        return response()->json(['data' => $lead->refresh()->load('owner:id,name', 'source', 'tags:id,name,color', 'party:id,code,name')]);
    }

    public function destroy(Lead $lead)
    {
        $this->allow('crm.manage');
        $this->assertVisible($lead->owner_id);
        $lead->delete();

        return response()->json(['ok' => true]);
    }

    public function convert(Request $request, Lead $lead)
    {
        $this->allow('crm.manage');
        $this->allow('customers.manage');
        $this->assertVisible($lead->owner_id);
        $data = $request->validate(['party_id' => 'nullable|exists:parties,id', 'credit_limit' => 'nullable|numeric|min:0', 'payment_terms_days' => 'nullable|integer|min:0']);

        return response()->json(['data' => $this->crm->convertLead($lead, $data)]);
    }

    private function scopeOwner($query, Request $request): void
    {
        if (! $this->can('crm.view_all')) {
            $query->where(fn ($q) => $q->where('owner_id', $this->user()->id)->orWhereNull('owner_id'));
        } elseif ($request->boolean('mine')) {
            $query->where('owner_id', $this->user()->id);
        }
    }

    private function assertVisible(?int $ownerId): void
    {
        if ($ownerId && $ownerId !== $this->user()->id && ! $this->can('crm.view_all')) {
            abort(403, __('erp.forbidden'));
        }
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:190'],
            'company_name' => ['nullable', 'string', 'max:190'],
            'phone' => ['nullable', 'string', 'max:40'],
            'mobile' => ['nullable', 'string', 'max:40'],
            'email' => ['nullable', 'email', 'max:190'],
            'city' => ['nullable', 'string', 'max:100'],
            'address' => ['nullable', 'string', 'max:250'],
            'source_id' => ['nullable', 'exists:crm_sources,id'],
            'owner_id' => ['nullable', 'exists:users,id'],
            'status' => ['nullable', 'in:new,contacted,qualified,unqualified'],
            'expected_value' => ['nullable', 'numeric', 'min:0'],
            'notes' => ['nullable', 'string', 'max:4000'],
            'tags' => ['nullable', 'array'],
        ]);
    }
}
