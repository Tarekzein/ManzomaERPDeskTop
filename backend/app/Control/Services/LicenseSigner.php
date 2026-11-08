<?php

namespace App\Control\Services;

use Illuminate\Validation\ValidationException;

class LicenseSigner
{
    public static function encode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    public static function decode(string $value): string
    {
        $raw = base64_decode(strtr($value, '-_', '+/'), true);
        if ($raw === false) {
            throw ValidationException::withMessages(['license' => 'Invalid license encoding.']);
        }

        return $raw;
    }

    public function sign(array $claims): array
    {
        $payload = self::encode(json_encode($claims, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
        $key = @file_get_contents(config('licensing.private_key'));
        if (! $key || ! openssl_sign($payload, $signature, $key, OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('License signing key is not configured.');
        }

        return ['payload' => $payload, 'signature' => self::encode($signature)];
    }

    public function verify(array $envelope): array
    {
        $key = @file_get_contents(config('licensing.public_key'));
        $keys = $key ? [$key] : [];
        $legacyPath = config('licensing.legacy_public_keys');
        if ($legacyPath && is_file($legacyPath)) {
            $legacy = json_decode(file_get_contents($legacyPath), true, 16, JSON_THROW_ON_ERROR);
            if (! is_array($legacy) || count($legacy) > 5 || array_filter($legacy, fn ($value) => ! is_string($value) || ! str_contains($value, 'BEGIN PUBLIC KEY') || str_contains($value, 'PRIVATE KEY'))) {
                throw new \RuntimeException('Invalid issuer trust configuration.');
            }
            $keys = array_merge($keys, $legacy);
        }
        $valid = isset($envelope['payload'], $envelope['signature']) && collect($keys)->contains(fn ($public) => openssl_verify($envelope['payload'], self::decode($envelope['signature']), $public, OPENSSL_ALGO_SHA256) === 1);
        if (! $valid) {
            throw ValidationException::withMessages(['license' => 'The license signature is invalid.']);
        }
        $claims = json_decode(self::decode($envelope['payload']), true, 32, JSON_THROW_ON_ERROR);
        if (($claims['status'] ?? 'active') !== 'active' || ($claims['v'] ?? null) !== 1 || now()->timestamp >= ($claims['expires_at'] ?? 0) || now()->timestamp + 300 < ($claims['issued_at'] ?? PHP_INT_MAX)) {
            throw ValidationException::withMessages(['license' => 'The license has expired or its dates are invalid.']);
        }

        return $claims;
    }
}
