<?php

namespace App\Control\Services;

use RuntimeException;

class SigningKeys
{
    public function ensure(): void
    {
        $private = config('licensing.private_key');
        $public = config('licensing.public_key');
        foreach ([$private, $public] as $file) {
            if (! is_dir(dirname($file))) {
                mkdir(dirname($file), 0700, true);
            }
        }
        $lock = fopen(dirname($private).'/.signing-key.lock', 'c');
        if (! $lock || ! flock($lock, LOCK_EX)) {
            throw new RuntimeException('Cannot lock the signing-key directory.');
        }
        try {
            if (! is_file($private)) {
                if (is_file($public)) {
                    throw new RuntimeException('Restore the original private key. Refusing to rotate the existing public key.');
                }
                $key = openssl_pkey_new(['private_key_bits' => 3072, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
                if (! $key || ! openssl_pkey_export($key, $pem)) {
                    throw new RuntimeException('Cannot generate the signing key.');
                }
                file_put_contents($private, $pem, LOCK_EX);
                chmod($private, 0600);
                file_put_contents($public, openssl_pkey_get_details($key)['key'], LOCK_EX);
                chmod($public, 0644);
            }
            if (! is_file($public)) {
                throw new RuntimeException('Restore the original matching public key.');
            }
            $a = openssl_pkey_get_private(file_get_contents($private));
            $b = openssl_pkey_get_public(file_get_contents($public));
            if (! $a || ! $b || openssl_pkey_get_details($a)['key'] !== openssl_pkey_get_details($b)['key']) {
                throw new RuntimeException('The signing keys do not match. Restore the original pair.');
            }
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}
