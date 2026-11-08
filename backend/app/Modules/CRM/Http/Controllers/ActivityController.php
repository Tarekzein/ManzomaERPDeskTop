<?php

namespace App\Modules\CRM\Http\Controllers;

use App\Modules\CRM\Models\Activity;
use App\Modules\CRM\Models\Lead;
use App\Modules\CRM\Models\Task;
use App\Modules\CRM\Services\CrmService;
use App\Support\ApiController;
use App\Support\BusinessException;
use Illuminate\Http\Request;

class ActivityController extends ApiController
{
    public function index(Request $request)
    {
        $this->allow('crm.view');
        $query = Activity::query()->with('user:id,name', 'lead:id,name,company_name', 'party:id,code,name', 'opportunity:id,title');
        foreach (['type', 'lead_id', 'party_id', 'opportunity_id', 'user_id'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->query($filter));
            }
        }
        if (! $this->can('crm.view_all')) {
            $query->where('user_id', $this->user()->id);
        }
        $this->dateRange($query, $request, 'occurred_at');
        $this->search($query, $request->query('search'), ['subject', 'body']);

        return $this->paginate($query, $request, ['id', 'occurred_at'], '-occurred_at');
    }

    public function store(Request $request, CrmService $crm)
    {
        $this->allow('crm.manage');
        $data = $request->validate([
            'type' => 'required|in:call,meeting,visit,whatsapp,email,note',
            'subject' => 'required|string|max:190',
            'body' => 'nullable|string|max:4000',
            'outcome' => 'nullable|string|max:30',
            'lead_id' => 'nullable|exists:crm_leads,id',
            'party_id' => 'nullable|exists:parties,id',
            'opportunity_id' => 'nullable|exists:crm_opportunities,id',
            'occurred_at' => 'nullable|date',
            'duration_minutes' => 'nullable|integer|min:0|max:1440',
            'follow_up' => 'nullable|array',
            'follow_up.title' => 'required_with:follow_up|string|max:190',
            'follow_up.due_at' => 'required_with:follow_up|date',
        ]);
        $this->requireLink($data);
        $activity = Activity::query()->create(collect($data)->except('follow_up')->all() + ['user_id' => $this->user()->id, 'occurred_at' => $data['occurred_at'] ?? now()]);
        // Log a call and book the next step in one go.
        if (! empty($data['follow_up'])) {
            Task::query()->create([
                'title' => $data['follow_up']['title'],
                'due_at' => $data['follow_up']['due_at'],
                'remind_at' => $data['follow_up']['due_at'],
                'lead_id' => $data['lead_id'] ?? null,
                'party_id' => $data['party_id'] ?? null,
                'opportunity_id' => $data['opportunity_id'] ?? null,
                'assigned_to' => $this->user()->id,
                'created_by' => $this->user()->id,
            ]);
        }
        if (! empty($data['lead_id'])) {
            $lead = Lead::query()->find($data['lead_id']);
            if ($lead->status === 'new') {
                $lead->update(['status' => 'contacted']);
            }
            $crm->scoreLead($lead);
        }

        return response()->json(['data' => $activity->load('user:id,name', 'lead:id,name', 'party:id,name', 'opportunity:id,title')], 201);
    }

    public function destroy(Activity $activity)
    {
        $this->allow('crm.manage');
        if ($activity->user_id !== $this->user()->id && ! $this->can('crm.view_all')) {
            abort(403, __('erp.forbidden'));
        }
        $activity->delete();

        return response()->json(['ok' => true]);
    }

    private function requireLink(array $data): void
    {
        if (empty($data['lead_id']) && empty($data['party_id']) && empty($data['opportunity_id'])) {
            throw BusinessException::make(__('erp.activity_needs_link'), 'link_required');
        }
    }
}
