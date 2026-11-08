<?php

namespace App\Modules\Core\Console;

use App\Modules\Core\Http\Middleware\SelectCompany;
use App\Modules\Core\Services\BackupService;
use App\Modules\Core\Services\SettingsService;
use App\Modules\Core\Services\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\Process\Process;

class HealthCommand extends Command
{
    protected $signature = 'erp:health {--company=} {--all} {--json} {--ready : Check schema/readiness without freshness alerts}';

    protected $description = 'Check tenant schema, automation, backups and issuer recovery readiness';

    public function handle(TenantContext $tenants): int
    {
        if ($this->option('all') && config('erp.multi_company')) {
            $path = config('erp.companies_registry');
            if (is_file($path) && ! is_array(json_decode(file_get_contents($path), true))) {
                $this->line(json_encode(['ready' => false, 'problems' => ['company_registry_invalid']]));

                return self::FAILURE;
            }
            $issuer = $this->issuerProblems();
            $failed = (bool) $issuer;
            $this->line(json_encode(['scope' => 'issuer', 'ready' => ! $issuer, 'problems' => $issuer]));
            foreach (SelectCompany::registered() as $slug) {
                $args = [PHP_BINARY, base_path('artisan'), 'erp:health', '--company='.$slug, '--json'];
                if ($this->option('ready')) {
                    $args[] = '--ready';
                }
                $process = new Process($args, base_path());
                $process->setTimeout(60);
                $process->run();
                $this->line(trim($process->getOutput()));
                if (! $process->isSuccessful()) {
                    $failed = true;
                }
            }

            return $failed ? self::FAILURE : self::SUCCESS;
        }
        $problems = [];
        try {
            $tenants->select($this->option('company'));
            DB::select('SELECT 1');
            foreach (['users', 'jobs', 'failed_jobs', 'unit_stage_schedules', 'service_visits'] as $table) {
                if (! Schema::hasTable($table)) {
                    $problems[] = 'schema:'.$table;
                }
            }
            if (! Schema::hasColumn('service_visits', 'completed_on')) {
                $problems[] = 'schema:completed_on';
            }
            if (! $this->option('ready') && ! $problems) {
                $last = app(SettingsService::class)->get('system.maintenance_last_scan');
                if (! $last || Carbon::parse($last)->lt(now()->subMinutes(45))) {
                    $problems[] = 'maintenance_scan_stale';
                }
                if (DB::table('failed_jobs')->exists()) {
                    $problems[] = 'failed_jobs';
                }
                if (DB::table('jobs')->where('created_at', '<', now()->subMinutes(30)->timestamp)->exists()) {
                    $problems[] = 'queue_stale';
                }
                $backups = app(BackupService::class)->list();
                if (! $backups || max(array_map(fn ($file) => strtotime($file['created_at']), $backups)) < now()->subHours(30)->timestamp) {
                    $problems[] = 'company_backup_stale';
                }
            }
            $problems = [...$problems, ...$this->issuerProblems()];
        } catch (\Throwable $error) {
            report($error);
            $problems[] = 'database_or_configuration_unavailable';
        }
        $this->line(json_encode(['company' => $this->option('company') ?: 'default', 'ready' => ! $problems, 'problems' => $problems, 'checked_at' => now()->toIso8601String()]));

        return $problems ? self::FAILURE : self::SUCCESS;
    }

    private function issuerProblems(): array
    {
        if (! config('licensing.control_enabled')) {
            return [];
        }
        $problems = [];
        try {
            DB::connection('control')->select('SELECT 1');
            if (! Schema::connection('control')->hasTable('company_registrations')) {
                $problems[] = 'control_schema';
            }
            if (! is_file(config('licensing.private_key')) || ! is_file(config('licensing.public_key'))) {
                $problems[] = 'issuer_keys';
            }
            if (! $this->option('ready')) {
                if (! config('licensing.backup_enabled') || strlen((string) config('licensing.backup_password')) < 16) {
                    $problems[] = 'issuer_backup_not_configured';
                }
                $copies = glob(rtrim(config('licensing.backup_path'), '/').'/issuer-*.mzb') ?: [];
                if (! $copies || max(array_map('filemtime', $copies)) < now()->subHours(30)->timestamp) {
                    $problems[] = 'issuer_backup_stale';
                }
            }
        } catch (\Throwable $error) {
            report($error);
            $problems[] = 'issuer_unavailable';
        }

        return $problems;
    }
}
