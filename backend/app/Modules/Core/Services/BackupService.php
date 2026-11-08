<?php

namespace App\Modules\Core\Services;

use App\Support\BusinessException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;

/**
 * Point-in-time copies of the company database.
 *
 * SQLite: VACUUM INTO produces a consistent copy even while the app runs.
 * MySQL/MariaDB: mysqldump when available on the server.
 */
class BackupService
{
    public function directory(): string
    {
        $dir = config('erp.backup_path');
        if (config('erp.multi_company')) {
            // Use the selected database, never an unchecked request header.
            $database = DB::connection()->getDatabaseName();
            // Hash also supports local test database paths without allowing path traversal.
            $dir .= DIRECTORY_SEPARATOR.'company-'.hash('sha256', $database);
        }
        if (! is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        return $dir;
    }

    public function create(?string $label = null): array
    {
        $driver = DB::connection()->getDriverName();
        $stamp = now()->format('Ymd-His-u').'-'.bin2hex(random_bytes(3));
        $name = 'backup-'.$stamp.($label ? '-'.preg_replace('/[^a-z0-9\-]/i', '', $label) : '');

        if ($driver === 'sqlite') {
            $file = $this->directory().DIRECTORY_SEPARATOR.$name.'.sqlite';
            DB::statement('VACUUM INTO '.DB::getPdo()->quote($file));
        } elseif (in_array($driver, ['mysql', 'mariadb'], true)) {
            $file = $this->directory().DIRECTORY_SEPARATOR.$name.'.sql';
            $config = DB::connection()->getConfig();
            $process = new Process([
                'mysqldump', '--single-transaction', '--routines', '--no-tablespaces',
                '-h', (string) $config['host'], '-P', (string) $config['port'], '-u', (string) $config['username'],
                (string) $config['database'], '--result-file='.$file,
            ], null, ['MYSQL_PWD' => (string) $config['password']]);
            $process->setTimeout(600);
            $process->run();
            if (! $process->isSuccessful()) {
                @unlink($file);
                throw BusinessException::make(__('erp.backup_failed', ['error' => trim($process->getErrorOutput())]), 'backup_failed');
            }
        } else {
            throw BusinessException::make(__('erp.backup_unsupported'), 'backup_unsupported');
        }

        return $this->describe($file);
    }

    public function list(): array
    {
        $files = glob($this->directory().DIRECTORY_SEPARATOR.'backup-*') ?: [];
        rsort($files);

        return array_map(fn ($f) => $this->describe($f), $files);
    }

    /** Database plus private evidence, with a verifiable restore manifest. */
    public function bundle(): array
    {
        if (! class_exists(\ZipArchive::class)) {
            throw BusinessException::make('ZIP support is required for evidence backups.', 'zip_required');
        }
        $backup = $this->create();
        $target = $backup['path'].'.zip';
        $zip = new \ZipArchive;
        if ($zip->open($target, \ZipArchive::CREATE | \ZipArchive::EXCL) !== true) {
            throw BusinessException::make('Cannot create backup archive.', 'backup_failed');
        }
        try {
            $manifest = ['version' => 1, 'company_database' => DB::connection()->getDatabaseName(), 'created_at' => now()->toIso8601String(), 'files' => []];
            $zip->addFile($backup['path'], 'database/'.basename($backup['path']));
            $manifest['files'][] = ['path' => 'database/'.basename($backup['path']), 'sha256' => hash_file('sha256', $backup['path'])];
            $root = 'companies/'.hash('sha256', DB::connection()->getDatabaseName()).'/attachments';
            foreach (Storage::disk('local')->allFiles($root) as $key) {
                $file = Storage::disk('local')->path($key);
                $path = 'storage/'.$key;
                $zip->addFile($file, $path);
                $manifest['files'][] = ['path' => $path, 'sha256' => hash_file('sha256', $file)];
            }
            $zip->addFromString('manifest.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        } finally {
            if (! $zip->close()) {
                throw BusinessException::make('Cannot finalize backup archive.', 'backup_failed');
            }
        }
        @unlink($backup['path']);

        return $this->describe($target);
    }

    public function path(string $file): ?string
    {
        $file = basename($file);
        $path = $this->directory().DIRECTORY_SEPARATOR.$file;

        return str_starts_with($file, 'backup-') && is_file($path) ? $path : null;
    }

    private function describe(string $file): array
    {
        return [
            'file' => basename($file),
            'path' => $file,
            'size' => filesize($file),
            'created_at' => date('Y-m-d H:i:s', filemtime($file)),
        ];
    }
}
