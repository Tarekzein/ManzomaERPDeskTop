<?php

namespace App\Modules\Finance\Http\Controllers;

use App\Modules\Finance\Models\JournalEntry;
use App\Modules\Finance\Services\JournalService;
use App\Support\ApiController;
use App\Support\BusinessException;
use Illuminate\Http\Request;

class JournalController extends ApiController
{
    public function __construct(private readonly JournalService $journal) {}

    public function index(Request $request)
    {
        $this->allow('journals.manage', 'finance.reports');
        $query = JournalEntry::query()->with('creator:id,name');
        foreach (['status', 'type', 'source_type'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->string($filter));
            }
        }
        if ($request->filled('account_id')) {
            $query->whereHas('lines', fn ($q) => $q->where('account_id', $request->integer('account_id')));
        }
        $this->dateRange($query, $request);
        $this->search($query, $request->query('search'), ['number', 'description', 'reference']);

        return $this->paginate($query, $request, ['id', 'number', 'date', 'total'], '-id');
    }

    public function show(JournalEntry $journal)
    {
        $this->allow('journals.manage', 'finance.reports');

        return response()->json(['data' => $journal->load('lines.account:id,code,name,name_en', 'lines.party:id,code,name', 'lines.costCenter:id,code,name', 'creator:id,name', 'poster:id,name')]);
    }

    public function store(Request $request)
    {
        $this->allow('journals.manage');
        $data = $this->validated($request);
        $entry = $this->journal->saveDraft($data, $this->lines($data));
        if ($request->boolean('post')) {
            $this->allow('journals.post');
            $entry = $this->journal->postDraft($entry);
        }

        return response()->json(['data' => $entry->load('lines.account:id,code,name,name_en', 'lines.party:id,code,name')], 201);
    }

    public function update(Request $request, JournalEntry $journal)
    {
        $this->allow('journals.manage');
        $this->assertManual($journal);
        $data = $this->validated($request);
        $entry = $this->journal->saveDraft($data, $this->lines($data), $journal);
        if ($request->boolean('post')) {
            $this->allow('journals.post');
            $entry = $this->journal->postDraft($entry);
        }

        return response()->json(['data' => $entry]);
    }

    public function post(JournalEntry $journal)
    {
        $this->allow('journals.post');

        return response()->json(['data' => $this->journal->postDraft($journal)]);
    }

    public function reverse(Request $request, JournalEntry $journal)
    {
        $this->allow('journals.post');
        $this->assertManual($journal);
        $data = $request->validate(['date' => 'nullable|date', 'reason' => 'required|string|max:250']);

        return response()->json(['data' => $this->journal->reverse($journal, $data['date'] ?? null, $data['reason'])]);
    }

    public function destroy(JournalEntry $journal)
    {
        $this->allow('journals.manage');
        if ($journal->status !== 'draft') {
            throw BusinessException::make(__('erp.only_draft_deletable'), 'not_draft');
        }
        $journal->delete();

        return response()->json(['ok' => true]);
    }

    /**
     * Entries made by documents are reversed by voiding the document.
     */
    private function assertManual(JournalEntry $entry): void
    {
        if (! in_array($entry->type, ['manual', 'opening'], true) || ($entry->source_type && ! in_array($entry->source_type, ['party_opening', 'accounts_opening'], true))) {
            throw BusinessException::make(__('erp.journal_from_document'), 'journal_from_document');
        }
    }

    private function lines(array $data): array
    {
        return collect($data['lines'])->map(fn ($l) => [
            'account' => (int) $l['account_id'],
            'debit' => $l['debit'] ?? 0,
            'credit' => $l['credit'] ?? 0,
            'party_id' => $l['party_id'] ?? null,
            'cost_center_id' => $l['cost_center_id'] ?? null,
            'description' => $l['description'] ?? null,
        ])->all();
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'date' => ['required', 'date'],
            'description' => ['required', 'string', 'max:250'],
            'reference' => ['nullable', 'string', 'max:80'],
            'branch_id' => ['nullable', 'exists:branches,id'],
            'lines' => ['required', 'array', 'min:2'],
            'lines.*.account_id' => ['required', 'exists:accounts,id'],
            'lines.*.debit' => ['nullable', 'numeric', 'min:0'],
            'lines.*.credit' => ['nullable', 'numeric', 'min:0'],
            'lines.*.party_id' => ['nullable', 'exists:parties,id'],
            'lines.*.cost_center_id' => ['nullable', 'exists:cost_centers,id'],
            'lines.*.description' => ['nullable', 'string', 'max:250'],
        ]);
    }
}
