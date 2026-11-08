<?php

namespace App\Modules\Core\Services;

use Illuminate\Support\Facades\DB;
use PDO;

class CompanyImportService
{
    /** Import into a new desktop company only; existing databases are never replaced. */
    public function import(string $source): array
    {
        abort_if(config('erp.multi_company') || DB::connection()->getDriverName() !== 'sqlite', 422, 'Desktop import requires a new local SQLite company.');
        $target = DB::connection()->getDatabaseName();
        abort_unless($target !== ':memory:' && is_file($source) && realpath($source) !== realpath($target), 422, 'Select a company backup file.');
        abort_if(is_file($target), 422, 'The target company already has a database. Import into an unused licensed company slot.');
        if (! is_dir(dirname($target))) {
            mkdir(dirname($target), 0700, true);
        }
        $stage = $target.'.import-'.bin2hex(random_bytes(6));
        $created = false;
        try {
            if (strtolower(pathinfo($source, PATHINFO_EXTENSION)) === 'zip') {
                $handle = fopen($target, 'x');
                abort_unless($handle, 422, 'Company slot is already in use.');
                fclose($handle);
                $created = true;
                app(RestoreService::class)->restore($source, freshTarget: true);
            } else {
                $handle = fopen($source, 'rb');
                $header = fread($handle, 16);
                fclose($handle);
                abort_unless($header === "SQLite format 3\0", 422, 'The selected file is not a SQLite company backup.');
                $probe = new PDO('sqlite:'.$source, null, null, [PDO::SQLITE_ATTR_OPEN_FLAGS => 1]);
                abort_unless($probe->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 422, 'The company backup is damaged.');
                $tables = $probe->query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('settings','users','migrations')")->fetchAll(PDO::FETCH_COLUMN);
                abort_unless(count($tables) === 3, 422, 'This is not a compatible Manzoma company database.');
                $probe->query('SELECT id,username,password FROM users LIMIT 0');
                $probe->query('SELECT key,value FROM settings LIMIT 0');
                // A SQLite snapshot includes committed WAL contents and leaves the source untouched.
                $probe->exec('VACUUM INTO '.$probe->quote($stage));
                $probe = null;
                $handle = fopen($target, 'x');
                abort_unless($handle, 422, 'Company slot is already in use.');
                fclose($handle);
                $created = true;
                abort_unless(rename($stage, $target), 500, 'Cannot import the company database.');
                DB::purge();
            }

            return ['ok' => true];
        } catch (\Throwable $failure) {
            DB::purge();
            if ($created) {
                foreach (['', '-wal', '-shm'] as $suffix) {
                    if (is_file($target.$suffix)) {
                        unlink($target.$suffix);
                    }
                }
            }
            throw $failure;
        } finally {
            if (is_file($stage)) {
                unlink($stage);
            }
        }
    }
}
