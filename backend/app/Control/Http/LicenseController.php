<?php

namespace App\Control\Http;

use App\Control\Services\CompanyRegistrationService;
use App\Control\Services\DeviceProof;
use App\Control\Services\LicenseService;
use Illuminate\Http\Request;

class LicenseController
{
    public function assignCompany(Request $request, DeviceProof $proof, LicenseService $service)
    {
        abort_unless(config('licensing.control_enabled'), 404);
        $device = $proof->verify($request, false, allowOffline: true);
        $data = $request->validate(['mode' => 'required|in:offline,online', 'company' => 'required|string|max:80']);

        return response()->json(['certificate' => $service->assignCompany($device, $data['mode'], $data['company'])]);
    }

    public function reserveOffline(Request $request, DeviceProof $proof, LicenseService $service)
    {
        abort_unless(config('licensing.control_enabled'), 404);
        $device = $proof->verify($request, false, allowOffline: true);
        $data = $request->validate(['id' => 'required|uuid']);

        return response()->json(['certificate' => $service->reserveOffline($device, $data['id'])]);
    }

    public function confirmOffline(Request $request, DeviceProof $proof, LicenseService $service)
    {
        abort_unless(config('licensing.control_enabled'), 404);
        $device = $proof->verify($request, false, allowOffline: true);
        $data = $request->validate(['companies' => 'required|array|max:1000', 'companies.*.id' => 'required|uuid', 'companies.*.name' => 'required|string|max:120']);

        return response()->json(['certificate' => $service->confirmOffline($device, $data['companies'])]);
    }

    public function registerCompany(Request $request, DeviceProof $proof, CompanyRegistrationService $service)
    {
        abort_unless(config('licensing.control_enabled'), 404);
        $device = $proof->verify($request, false);
        $data = $request->validate([
            'registration_id' => 'required|uuid', 'name' => 'required|string|max:120', 'nameEn' => 'nullable|string|max:120',
            'currency' => 'required|in:EGP,SAR,AED,USD', 'vatRate' => 'required|numeric|min:0|max:100', 'taxNumber' => 'nullable|string|max:100',
            'adminName' => 'required|string|max:120', 'adminUsername' => 'required|string|max:120|regex:/^[a-zA-Z0-9_.@-]+$/',
            'adminPassword' => 'required|string|min:6|max:200', 'locale' => 'required|in:ar,en', 'demo' => 'sometimes|declined',
        ]);

        return response()->json($service->register($device, $data));
    }

    public function activate(Request $request, LicenseService $service)
    {
        abort_unless(config('licensing.control_enabled'), 404);
        $data = $request->validate(['activation_key' => 'required|string|max:150', 'request' => 'required|array']);

        return response()->json(['certificate' => $service->activate($data['activation_key'], $data['request'], $request->ip())]);
    }

    public function refresh(Request $request, LicenseService $service, DeviceProof $proof)
    {
        abort_unless(config('licensing.control_enabled'), 404);
        $device = $proof->verify($request, false, true);

        return response()->json(['certificate' => $service->certificate($device->license, $device, true)]);
    }
}
