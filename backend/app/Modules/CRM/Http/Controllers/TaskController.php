<?php

namespace App\Modules\CRM\Http\Controllers;

use App\Modules\CRM\Models\Task;
use App\Support\ApiController;
use Illuminate\Http\Request;

class TaskController extends ApiController
{
    public function index(Request $request)
    {
        $this->allow('crm.view');
        $query = Task::query()->with('assignee:id,name', 'lead:id,name,company_name,phone,mobile', 'party:id,code,name,phone,mobile', 'opportunity:id,title');
        $this->scope($query, $request);
        if ($request->filled('status')) {
            $query->where('status', $request->string('status'));
        }
        match ($request->query('when')) {
            'today' => $query->where('status', 'open')->whereDate('due_at', now()->toDateString()),
            'overdue' => $query->where('status', 'open')->where('due_at', '<', now()->startOfDay()),
            'upcoming' => $query->where('status', 'open')->where('due_at', '>', now()->endOfDay()),
            default => null,
        };
        foreach (['lead_id', 'party_id', 'opportunity_id'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->query($filter));
            }
        }
        $this->search($query, $request->query('search'), ['title', 'notes']);

        return $this->paginate($query, $request, ['id', 'due_at', 'priority'], 'due_at');
    }

    /**
     * My agenda: overdue, today and the next 7 days, plus reminders due now.
     */
    public function agenda()
    {
        $this->allow('crm.view');
        $base = Task::query()->with('lead:id,name,company_name,phone,mobile', 'party:id,code,name,phone,mobile', 'opportunity:id,title')
            ->where('assigned_to', $this->user()->id)->where('status', 'open');

        return response()->json([
            'overdue' => (clone $base)->where('due_at', '<', now()->startOfDay())->orderBy('due_at')->get(),
            'today' => (clone $base)->whereBetween('due_at', [now()->startOfDay(), now()->endOfDay()])->orderBy('due_at')->get(),
            'upcoming' => (clone $base)->whereBetween('due_at', [now()->addDay()->startOfDay(), now()->addDays(7)->endOfDay()])->orderBy('due_at')->get(),
            'reminders' => (clone $base)->whereNotNull('remind_at')->where('remind_at', '<=', now())->where('remind_at', '>=', now()->subDay())->get(),
        ]);
    }

    public function store(Request $request)
    {
        $this->allow('crm.manage');
        $data = $this->validated($request);

        return response()->json(['data' => Task::query()->create($data + ['created_by' => $this->user()->id, 'assigned_to' => $data['assigned_to'] ?? $this->user()->id])->load('assignee:id,name')], 201);
    }

    public function update(Request $request, Task $task)
    {
        $this->allow('crm.manage');
        abort_unless($this->can('crm.view_all') || $task->assigned_to === $this->user()->id, 403);
        $task->update($this->validated($request));

        return response()->json(['data' => $task->refresh()->load('assignee:id,name')]);
    }

    public function complete(Request $request, Task $task)
    {
        $this->allow('crm.manage');
        abort_unless($this->can('crm.view_all') || $task->assigned_to === $this->user()->id, 403);
        $done = $task->status !== 'done';
        $task->update(['status' => $done ? 'done' : 'open', 'completed_at' => $done ? now() : null]);

        return response()->json(['data' => $task->refresh()]);
    }

    public function snooze(Request $request, Task $task)
    {
        $this->allow('crm.manage');
        abort_unless($this->can('crm.view_all') || $task->assigned_to === $this->user()->id, 403);
        $data = $request->validate(['minutes' => 'required|integer|min:5|max:10080']);
        $task->update(['remind_at' => now()->addMinutes($data['minutes'])]);

        return response()->json(['data' => $task->refresh()]);
    }

    public function destroy(Task $task)
    {
        $this->allow('crm.manage');
        abort_unless($this->can('crm.view_all') || $task->assigned_to === $this->user()->id, 403);
        $task->delete();

        return response()->json(['ok' => true]);
    }

    private function scope($query, Request $request): void
    {
        if (! $this->can('crm.view_all') || $request->boolean('mine')) {
            $query->where('assigned_to', $this->user()->id);
        } elseif ($request->filled('assigned_to')) {
            $query->where('assigned_to', $request->integer('assigned_to'));
        }
    }

    private function validated(Request $request): array
    {
        $data = $request->validate([
            'title' => 'required|string|max:190',
            'notes' => 'nullable|string|max:4000',
            'due_at' => 'nullable|date',
            'remind_at' => 'nullable|date',
            'priority' => 'nullable|in:low,normal,high',
            'status' => 'nullable|in:open,done,cancelled',
            'lead_id' => 'nullable|exists:crm_leads,id',
            'party_id' => 'nullable|exists:parties,id',
            'opportunity_id' => 'nullable|exists:crm_opportunities,id',
            'assigned_to' => 'nullable|exists:users,id',
        ]);

        // Columns with defaults must not receive explicit nulls.
        return array_filter($data, fn ($v, $k) => ! (in_array($k, ['priority', 'status'], true) && $v === null), ARRAY_FILTER_USE_BOTH);
    }
}
