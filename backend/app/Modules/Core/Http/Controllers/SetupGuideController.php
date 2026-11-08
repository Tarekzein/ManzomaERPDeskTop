<?php

namespace App\Modules\Core\Http\Controllers;

use App\Modules\Core\Services\SetupGuideService;
use App\Support\ApiController;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SetupGuideController extends ApiController
{
    public function show(SetupGuideService $guide)
    {
        $this->allow('settings.manage');

        return response()->json($guide->status());
    }

    public function update(Request $request, SetupGuideService $guide)
    {
        $this->allow('settings.manage');
        $data = $request->validate(['action' => ['required', Rule::in(['start', 'pause', 'review', 'complete'])], 'step' => ['required_if:action,review', 'nullable', Rule::in(SetupGuideService::STEPS)], 'defer' => ['sometimes', 'boolean']]);

        return response()->json($guide->transition($data['action'], $data['step'] ?? null, $data['defer'] ?? false));
    }
}
