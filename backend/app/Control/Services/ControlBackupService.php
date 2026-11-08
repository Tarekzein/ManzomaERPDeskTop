<?php

namespace App\Control\Services;

use Illuminate\Support\Facades\DB;
use RuntimeException;
use Symfony\Component\Process\Process;
use ZipArchive;

/** Encrypted recovery set. Restores to an empty staging directory, never over a live issuer. */
class ControlBackupService
{
    private const FILES = ['control.sqlite', 'control.sql', 'signing-private.pem', 'signing-public.pem', 'app-key.txt', 'companies.json', 'legacy-public-keys.json', 'manifest.json'];

    public function create(string $destination, string $password): string
    {
        $this->password($password);
        $stage = sys_get_temp_dir().'/manzoma-control-'.bin2hex(random_bytes(12));
        mkdir($stage, 0700, true);
        try {
            $connection = DB::connection('control');
            $config = $connection->getConfig();
            $driver = $connection->getDriverName();
            if ($driver === 'sqlite') {
                $connection->statement('VACUUM INTO '.$connection->getPdo()->quote($stage.'/control.sqlite'));
            } else {
                if (! in_array($driver, ['mysql', 'mariadb'], true)) {
                    throw new RuntimeException('Unsupported control database.');
                }
                $process = new Process(['mysqldump', '--single-transaction', '--no-tablespaces', '-h', (string) $config['host'], '-P', (string) $config['port'], '-u', (string) $config['username'], (string) $config['database'], '--result-file='.$stage.'/control.sql'], null, ['MYSQL_PWD' => (string) $config['password']]);
                $process->setTimeout(600);
                $process->mustRun();
            }
            foreach (['private_key' => 'signing-private.pem', 'public_key' => 'signing-public.pem'] as $setting => $name) {
                if (! is_file(config('licensing.'.$setting))) {
                    throw new RuntimeException('Issuer keys are missing.');
                }
                copy(config('licensing.'.$setting), $stage.'/'.$name);
            }
            if (! config('app.key')) {
                throw new RuntimeException('APP_KEY is required.');
            }
            file_put_contents($stage.'/app-key.txt', config('app.key'));
            $legacy = config('licensing.legacy_public_keys');
            file_put_contents($stage.'/legacy-public-keys.json', $legacy && is_file($legacy) ? file_get_contents($legacy) : '[]');
            $registry = config('erp.companies_registry');
            $contents = is_file($registry) ? file_get_contents($registry) : '[]';
            json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
            file_put_contents($stage.'/companies.json', $contents);
            $manifest = ['version' => 1, 'driver' => $driver, 'issuer' => config('licensing.issuer'), 'created_at' => now()->toIso8601String(), 'files' => []];
            foreach (glob($stage.'/*') as $file) {
                $manifest['files'][basename($file)] = hash_file('sha256', $file);
            }
            file_put_contents($stage.'/manifest.json', json_encode($manifest, JSON_THROW_ON_ERROR));
            $zip = new ZipArchive;
            if ($zip->open($stage.'/bundle.zip', ZipArchive::CREATE | ZipArchive::EXCL) !== true) {
                throw new RuntimeException('Cannot create recovery archive.');
            }
            foreach (self::FILES as $name) {
                if (is_file($stage.'/'.$name)) {
                    $zip->addFile($stage.'/'.$name, $name);
                }
            }
            if (! $zip->close()) {
                throw new RuntimeException('Cannot finalize recovery archive.');
            }
            $sealed = $this->seal(file_get_contents($stage.'/bundle.zip'), $password);
            if (! is_dir($destination) && ! mkdir($destination, 0700, true)) {
                throw new RuntimeException('Cannot create backup destination.');
            }
            $file = rtrim($destination, '/').'/issuer-'.now()->format('Ymd-His').'-'.bin2hex(random_bytes(4)).'.mzb';
            if (file_put_contents($file, $sealed, LOCK_EX) === false) {
                throw new RuntimeException('Cannot save recovery archive.');
            }
            chmod($file, 0600);

            return $file;
        } finally {
            foreach (glob($stage.'/*') as $file) {
                unlink($file);
            }
            rmdir($stage);
        }
    }

    public function seal(string $plaintext, string $password): string
    {
        $this->password($password);
        $salt = random_bytes(16);
        $iv = random_bytes(12);
        $key = hash_pbkdf2('sha256', $password, $salt, 600000, 32, true);
        $cipher = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, 'manzoma-issuer-v1');
        if ($cipher === false) {
            throw new RuntimeException('Cannot encrypt recovery archive.');
        }

        return json_encode(['v' => 1, 'salt' => base64_encode($salt), 'iv' => base64_encode($iv), 'tag' => base64_encode($tag), 'data' => base64_encode($cipher)], JSON_THROW_ON_ERROR);
    }

    public function unpack(string $source, string $password, string $destination): array
    {
        $this->password($password);
        if (! is_file($source) || filesize($source) > 256 * 1024 * 1024) {
            throw new RuntimeException('Invalid recovery archive size.');
        }
        if (file_exists($destination)) {
            throw new RuntimeException('Restore staging directory must not already exist.');
        }
        $envelope = json_decode(file_get_contents($source), true, 512, JSON_THROW_ON_ERROR);
        if (($envelope['v'] ?? null) !== 1) {
            throw new RuntimeException('Unsupported recovery archive.');
        }
        $decode = static fn ($key) => base64_decode($envelope[$key] ?? '', true);
        $salt = $decode('salt');
        $iv = $decode('iv');
        $tag = $decode('tag');
        $cipher = $decode('data');
        if (strlen($salt ?: '') !== 16 || strlen($iv ?: '') !== 12 || strlen($tag ?: '') !== 16 || $cipher === false) {
            throw new RuntimeException('Invalid recovery envelope.');
        }
        $key = hash_pbkdf2('sha256', $password, $salt, 600000, 32, true);
        $plain = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, 'manzoma-issuer-v1');
        if ($plain === false) {
            throw new RuntimeException('Recovery password or archive integrity is invalid.');
        }
        $temporary = tempnam(sys_get_temp_dir(), 'issuer-restore-');
        chmod($temporary, 0600);
        file_put_contents($temporary, $plain);
        $zip = new ZipArchive;
        $opened = false;
        try {
            if ($zip->open($temporary) !== true) {
                throw new RuntimeException('Invalid recovery ZIP.');
            }
            $opened = true;
            $manifest = json_decode($zip->getFromName('manifest.json') ?: '', true, 512, JSON_THROW_ON_ERROR);
            if (($manifest['version'] ?? null) !== 1 || ! is_array($manifest['files'] ?? null)) {
                throw new RuntimeException('Invalid recovery manifest.');
            }
            $files = [];
            $total = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $entry = $zip->statIndex($i);
                $total += $entry['size'];
                if (! in_array($entry['name'], self::FILES, true) || $total > 256 * 1024 * 1024 || isset($files[$entry['name']])) {
                    throw new RuntimeException('Unsafe recovery ZIP entry.');
                }
                $files[$entry['name']] = $zip->getFromIndex($i);
            }
            foreach (['signing-private.pem', 'signing-public.pem', 'app-key.txt', 'companies.json', ($manifest['driver'] === 'sqlite' ? 'control.sqlite' : 'control.sql')] as $required) {
                if (! isset($files[$required], $manifest['files'][$required])) {
                    throw new RuntimeException('Incomplete recovery set.');
                }
            }
            foreach ($manifest['files'] as $name => $checksum) {
                if (! isset($files[$name]) || ! hash_equals($checksum, hash('sha256', $files[$name]))) {
                    throw new RuntimeException('Recovery checksum mismatch.');
                }
            }
            $private = openssl_pkey_get_private($files['signing-private.pem']);
            if (! $private || openssl_pkey_get_details($private)['key'] !== $files['signing-public.pem']) {
                throw new RuntimeException('Issuer signing keys do not match.');
            }
            mkdir($destination, 0700, true);
            foreach ($files as $name => $contents) {
                file_put_contents($destination.'/'.$name, $contents);
                chmod($destination.'/'.$name, 0600);
            }

            return $manifest;
        } finally {
            if ($opened) {
                $zip->close();
            } unlink($temporary);
        }
    }

    private function password(string $password): void
    {
        if (strlen($password) < 16) {
            throw new RuntimeException('Use a recovery password of at least 16 characters.');
        }
    }
}
