<?php

namespace App\Support;

use RuntimeException;

/**
 * A rule of the business was broken (insufficient stock, credit limit, locked
 * period…). Rendered as HTTP 422 with a machine-readable code so the desktop
 * can offer the right next step, such as a manager override.
 */
class BusinessException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $errorCode = 'business_rule',
        public readonly array $context = [],
        public readonly int $status = 422,
    ) {
        parent::__construct($message);
    }

    public static function make(string $message, string $code = 'business_rule', array $context = []): self
    {
        return new self($message, $code, $context);
    }
}
