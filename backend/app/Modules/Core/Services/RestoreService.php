<?php

namespace App\Modules\Core\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;

/** Operator-only restore. Stop HTTP, workers and scheduler before calling. */
class RestoreService
{
    public function restore(string $file, bool $freshTarget = false): array
    {
        $zip = new \ZipArchive;
        abort_unless(is_file($file) && $zip->open($file) === true, 422, 'Invalid backup archive.');
        $staging = sys_get_temp_dir().'/erp-restore-'.bin2hex(random_bytes(12));
        mkdir($staging, 0700, true);
        try {
            $manifest = json_decode($zip->getFromName('manifest.json') ?: '', true, 512, JSON_THROW_ON_ERROR);
            abort_unless(($manifest['version'] ?? null) === 1 && is_string($manifest['company_database'] ?? null) && is_array($manifest['files'] ?? null), 422, 'Invalid manifest.');
            $sourcePrefix = 'companies/'.hash('sha256', $manifest['company_database']).'/attachments/';
            $database = null;
            $attachments = [];
            $seen = [];
            $bytes = 0;
            foreach ($manifest['files'] as $index => $entry) {
                $name = $entry['path'] ?? '';
                $checksum = $entry['sha256'] ?? '';
                abort_unless(is_string($name) && ! isset($seen[$name]) && preg_match('/^[a-f0-9]{64}$/', $checksum), 422, 'Invalid manifest entry.');
                $seen[$name] = true;
                $isDatabase = preg_match('~^database/backup-[a-zA-Z0-9_.-]+\.(sqlite|sql)$~', $name);
                $isAttachment = str_starts_with($name, 'storage/'.$sourcePrefix) && preg_match('~^[a-zA-Z0-9_.-]+$~', substr($name, strlen('storage/'.$sourcePrefix)));
                abort_unless($isDatabase || $isAttachment, 422, 'Unsafe archive path.');
                $stat = $zip->statName($name);
                abort_unless($stat, 422, 'Missing archive entry.');
                $bytes += $stat['size'];
                abort_if($bytes > 10 * 1024 * 1024 * 1024, 422, 'Archive exceeds restore limit.');
                $stream = $zip->getStream($name);
                abort_unless(is_resource($stream), 422);
                $path = $staging.'/'.$index;
                $output = fopen($path, 'wb');
                try {
                    stream_copy_to_stream($stream, $output);
                } finally {
                    fclose($stream);
                    fclose($output);
                }
                abort_unless(hash_equals($checksum, hash_file('sha256', $path)), 422, 'Backup checksum mismatch.');
                if ($isDatabase) {
                    abort_if($database !== null, 422, 'Multiple databases in archive.');
                    $database = ['path' => $path, 'sqlite' => str_ends_with($name, '.sqlite')];
                } else {
                    $attachments[] = ['path' => $path, 'name' => basename($name)];
                }
            }
            abort_unless($database, 422, 'Database is missing.');
            $connection = DB::connection();
            $driver = $connection->getDriverName();
            $config = $connection->getConfig();
            abort_unless(($driver === 'sqlite') === $database['sqlite'], 422, 'Backup database type does not match target.');
            if ($database['sqlite']) {
                abort_if($config['database'] === ':memory:', 422, 'File database required for restore.');
                $probe = new \PDO('sqlite:'.$database['path']);
                abort_unless($probe->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $probe->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('settings','users','attachments')")->fetchColumn() === 3, 422, 'Invalid company database.');
                $probe = null;
            }
            // Verify every byte before making a safety backup or changing the target.
            if ($freshTarget) {
                abort_unless($driver === 'sqlite' && DB::selectOne("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")->n == 0, 422, 'A new empty company is required for import.');
            }
            $safety = $freshTarget ? null : app(BackupService::class)->bundle();
            if ($driver === 'sqlite') {
                DB::purge();
                foreach (['-wal', '-shm'] as $suffix) {
                    if (is_file($config['database'].$suffix)) {
                        unlink($config['database'].$suffix);
                    }
                }
                abort_unless(copy($database['path'], $config['database']), 500, 'Cannot restore database.');
                DB::reconnect();
            } else {
                abort_unless(in_array($driver, ['mysql', 'mariadb'], true), 422);
                $process = new Process(['mysql', '-h', (string) $config['host'], '-P', (string) $config['port'], '-u', (string) $config['username'], (string) $config['database']], null, ['MYSQL_PWD' => (string) $config['password']]);
                $input = fopen($database['path'], 'rb');
                try {
                    $process->setInput($input);
                    $process->setTimeout(600);
                    $process->mustRun();
                } finally {
                    fclose($input);
                }
            }
            $targetPrefix = 'companies/'.hash('sha256', DB::connection()->getDatabaseName()).'/attachments/';
            foreach ($attachments as $attachment) {
                $stream = fopen($attachment['path'], 'rb');
                try {
                    abort_unless(Storage::disk('local')->put($targetPrefix.$attachment['name'], $stream), 500, 'Cannot restore attachment.');
                } finally {
                    fclose($stream);
                }
            }
            foreach (DB::table('attachments')->get(['id', 'storage_key']) as $attachment) {
                abort_unless(str_starts_with($attachment->storage_key, $sourcePrefix), 422, 'Unexpected attachment namespace.');
                DB::table('attachments')->where('id', $attachment->id)->update(['storage_key' => $targetPrefix.substr($attachment->storage_key, strlen($sourcePrefix))]);
            }

            return ['ok' => true, 'attachments' => count($attachments), 'safety_backup' => $safety['file'] ?? null];
        } finally {
            $zip->close();
            foreach (glob($staging.'/*') ?: [] as $temporary) {
                unlink($temporary);
            }
            rmdir($staging);
        }
    }
}
