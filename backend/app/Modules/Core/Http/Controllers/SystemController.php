<?php

namespace App\Modules\Core\Http\Controllers;

use App\Control\Services\DeviceProof;
use App\Modules\Core\Http\Middleware\SelectCompany;
use App\Modules\Core\Models\AuditLog;
use App\Modules\Core\Services\BackupService;
use App\Modules\Core\Services\InstallService;
use App\Modules\Core\Services\SettingsService;
use App\Support\ApiController;
use Illuminate\Http\Request;

class SystemController extends ApiController
{
    public function ping()
    {
        return response()->json(['ok' => true, 'app' => 'manzoma-erp', 'version' => config('erp.version'), 'license_required' => (bool) config('licensing.enforce'), 'time' => now()->toIso8601String()]);
    }

    /**
     * What the login screen shows before anyone signs in.
     */
    public function info(SettingsService $settings, InstallService $installer)
    {
        $installed = $installer->isInstalled();

        return response()->json([
            'installed' => $installed,
            'version' => config('erp.version'),
            'multi_company' => (bool) config('erp.multi_company'),
            'company' => $installed ? [
                'name' => $settings->get('company.name'),
                'name_en' => $settings->get('company.name_en'),
                'logo' => $settings->get('company.logo'),
                'currency' => $settings->currency(),
            ] : null,
            'database' => config('database.default'),
        ]);
    }

    public function companies()
    {
        $companies = SelectCompany::companies();
        if (config('licensing.enforce')) {
            $device = app(DeviceProof::class)->verify(request(), false);
            $allowed = $device->license->companies()->where('mode', 'online')->pluck('company_key')->all();
            if ($device->assignedCompany) {
                $allowed = $device->assignedCompany->mode === 'online' ? [$device->assignedCompany->company_key] : [];
            }
            $companies = array_values(array_filter($companies, fn ($company) => in_array($company['slug'], $allowed, true)));
        }

        return response()->json(['data' => $companies]);
    }

    public function audit(Request $request)
    {
        $this->allow('audit.view');
        $query = AuditLog::query()->with('user:id,name,username');
        if ($request->filled('user_id')) {
            $query->where('user_id', $request->integer('user_id'));
        }
        if ($request->filled('action')) {
            $query->where('action', $request->string('action'));
        }
        if ($request->filled('type')) {
            $query->where('auditable_type', $request->string('type'));
        }
        $this->search($query, $request->query('search'), ['description', 'auditable_type', 'action']);
        $this->dateRange($query, $request, 'created_at');

        return $this->paginate($query, $request, ['id', 'created_at'], '-id');
    }

    public function backups(BackupService $backups)
    {
        $this->allow('backup.manage');

        return response()->json(['data' => $backups->list()]);
    }

    public function createBackup(BackupService $backups)
    {
        $this->allow('backup.manage');

        return response()->json(['data' => $backups->bundle()]);
    }

    public function downloadBackup(BackupService $backups, string $file)
    {
        $this->allow('backup.manage');
        $path = $backups->path($file);
        abort_unless($path, 404);

        return response()->download($path);
    }
}
