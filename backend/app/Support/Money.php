<?php

namespace App\Support;

/**
 * Rounding helpers. Monetary values are rounded to 2 decimals at the line
 * level and documents sum the rounded lines, so a document always equals the
 * journal entry it produces.
 */
final class Money
{
    public static function round(float|int|string|null $value, int $decimals = 2): float
    {
        return round((float) $value + 0.0, $decimals);
    }

    public static function qty(float|int|string|null $value): float
    {
        return round((float) $value, 4);
    }

    public static function isZero(float|int|string|null $value, float $epsilon = 0.005): bool
    {
        return abs((float) $value) < $epsilon;
    }

    public static function equals(float|int|string|null $a, float|int|string|null $b, float $epsilon = 0.005): bool
    {
        return abs((float) $a - (float) $b) < $epsilon;
    }
}
