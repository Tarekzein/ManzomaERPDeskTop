<?php

namespace App\Modules\Core\Console;

use App\Modules\Core\Services\CompanyImportService;
use App\Modules\Core\Services\SettingsService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ImportCompanyCommand extends Command
{
    protected $signature = 'erp:import-company {file : ZIP or SQLite company backup} {--json}';

    protected $description = 'Import an existing company into an empty local database, preserving its users and records';

    public function handle(CompanyImportService $import): int
    {
        $import->import($this->argument('file'));
        if (Artisan::call('erp:upgrade', ['--json' => true]) !== 0) {
            throw new \RuntimeException('Imported company upgrade failed.');
        }
        abort_unless(DB::table('users')->exists(), 422, 'The imported company has no users.');
        $missing = 0;
        if (Schema::hasTable('attachments') && strtolower(pathinfo($this->argument('file'), PATHINFO_EXTENSION)) !== 'zip') {
            $prefix = 'companies/'.hash('sha256', DB::connection()->getDatabaseName()).'/attachments/';
            foreach (DB::table('attachments')->get(['id', 'storage_key']) as $attachment) {
                abort_unless(preg_match('~^companies/[a-f0-9]{64}/attachments/([a-zA-Z0-9_.-]+)$~', $attachment->storage_key, $match), 422, 'Invalid attachment reference in company file.');
                DB::table('attachments')->where('id', $attachment->id)->update(['storage_key' => $prefix.$match[1]]);
                $missing++;
            }
        }
        app(SettingsService::class)->flush();
        $result = ['ok' => true, 'name' => app(SettingsService::class)->get('company.name'), 'missing_attachments' => $missing];
        $this->option('json') ? $this->line(json_encode($result)) : $this->info('Company imported. Sign in with its existing credentials.');

        return self::SUCCESS;
    }
}
