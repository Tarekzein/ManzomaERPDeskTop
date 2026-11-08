<?php

namespace App\Modules\Finance\Http\Controllers;

use App\Modules\Core\Services\SettingsService;
use App\Modules\Finance\Models\FiscalYear;
use App\Modules\Finance\Services\FiscalService;
use App\Support\ApiController;
use App\Support\BusinessException;
use Illuminate\Http\Request;

class FiscalController extends ApiController
{
    public function __construct(private readonly FiscalService $fiscal) {}

    public function index(SettingsService $settings)
    {
        $this->allow('fiscal.manage', 'finance.reports');

        return response()->json(['data' => FiscalYear::query()->orderByDesc('start_date')->get(), 'lock_date' => $settings->get('accounting.lock_date')]);
    }

    public function store(Request $request)
    {
        $this->allow('fiscal.manage');
        $data = $request->validate(['name' => 'required|string|max:40|unique:fiscal_years,name', 'start_date' => 'required|date', 'end_date' => 'required|date|after:start_date']);
        $overlap = FiscalYear::query()->whereDate('start_date', '<=', $data['end_date'])->whereDate('end_date', '>=', $data['start_date'])->exists();
        if ($overlap) {
            throw BusinessException::make(__('erp.fiscal_year_overlap'), 'fiscal_overlap');
        }

        return response()->json(['data' => FiscalYear::query()->create($data)], 201);
    }

    public function close(FiscalYear $year)
    {
        $this->allow('fiscal.manage');

        return response()->json(['data' => $this->fiscal->closeYear($year, $this->user())]);
    }

    public function lock(Request $request)
    {
        $this->allow('fiscal.manage');
        $data = $request->validate(['lock_date' => 'nullable|date']);
        $this->fiscal->setLockDate($data['lock_date'] ?? null);

        return response()->json(['lock_date' => $data['lock_date'] ?? null]);
    }

    public function accountsOpening(Request $request)
    {
        $this->allow('fiscal.manage');
        $data = $request->validate([
            'date' => 'required|date',
            'lines' => 'required|array|min:1',
            'lines.*.account_id' => 'required|exists:accounts,id',
            'lines.*.debit' => 'nullable|numeric|min:0',
            'lines.*.credit' => 'nullable|numeric|min:0',
        ]);

        return response()->json(['data' => $this->fiscal->accountsOpening($data['lines'], $data['date'])]);
    }
}
