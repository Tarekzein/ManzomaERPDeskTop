<?php

namespace App\Control\Services;

use App\Control\Models\License;
use App\Modules\Core\Http\Middleware\SelectCompany;
use Illuminate\Support\Facades\DB;

/** Correct display metadata only. Never delete an allocation or retract signed rights. */
class CompanyReconciliation
{
    public function run(bool $apply = false): array
    {
        $changes = [];
        $registry = collect(SelectCompany::companies())->keyBy('slug');
        foreach (License::query()->orderBy('id')->get() as $license) {
            DB::connection('control')->transaction(function () use ($license, $registry, $apply, &$changes) {
                $license = License::whereKey($license->id)->lockForUpdate()->firstOrFail();
                foreach ($license->companies()->where('mode', 'online')->with('registration')->get() as $company) {
                    $registration = $company->registration;
                    $values = [];
                    if ($registration) {
                        // A failed or still-running provisioning attempt is reserved capacity.
                        $ready = $registration->status === 'ready' && (! config('erp.multi_company') || $registry->has($company->company_key));
                        if ($ready && ! $company->registered_at) {
                            $values['registered_at'] = now();
                        }
                        if (in_array($registration->status, ['installing', 'failed'], true) && $company->registered_at) {
                            $values['registered_at'] = null;
                        }
                        if ($registration->name !== $company->name) {
                            $values['name'] = $registration->name;
                        }
                    } elseif ($registry->has($company->company_key) && $registry[$company->company_key]['name'] !== $company->name) {
                        $values['name'] = $registry[$company->company_key]['name'];
                    }
                    if (! $values) {
                        continue;
                    }
                    $changes[] = ['license_id' => $license->id, 'company_key' => $company->company_key, 'changes' => $values];
                    if ($apply) {
                        $company->update($values);
                        app(LicenseService::class)->audit($license->id, 'company.metadata_reconciled', ['company_key' => $company->company_key, 'fields' => array_keys($values)]);
                    }
                }
            });
        }

        return ['applied' => $apply, 'changes' => $changes, 'allocations_released' => 0];
    }
}
