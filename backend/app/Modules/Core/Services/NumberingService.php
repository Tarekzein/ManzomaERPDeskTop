<?php

namespace App\Modules\Core\Services;

use App\Modules\Core\Models\DocumentSequence;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Sequential, gap-free per type and year: SI-2026-000001.
 *
 * Ported from the web ERP's DocumentNumberService: the counter row is read
 * under a lock inside the caller's transaction, so concurrent users queue
 * instead of receiving the same number (MySQL). SQLite serialises writers.
 */
class NumberingService
{
    public function __construct(private readonly SettingsService $settings) {}

    public function next(string $docType, ?string $date = null): string
    {
        $prefix = $this->prefix($docType);
        $year = $date ? substr($date, 0, 4) : now()->format('Y');
        $value = $this->increment($docType, $year);

        return sprintf('%s-%s-%06d', $prefix, $year, $value);
    }

    /**
     * Master-data codes without a period: C00001, P00042.
     */
    public function code(string $kind): string
    {
        $prefix = (string) $this->settings->get("numbering.code.{$kind}", config("erp.codes.{$kind}", strtoupper(substr($kind, 0, 1))));

        return sprintf('%s%05d', $prefix, $this->increment('code:'.$kind, 'all'));
    }

    public function prefix(string $docType): string
    {
        return (string) $this->settings->get("numbering.prefix.{$docType}", config("erp.numbering.{$docType}", strtoupper($docType)));
    }

    private function increment(string $docType, string $period): int
    {
        return DB::transaction(function () use ($docType, $period) {
            $query = fn () => DocumentSequence::query()
                ->where('doc_type', $docType)
                ->where('period', $period)
                ->lockForUpdate()
                ->first();

            $sequence = $query();
            if (! $sequence) {
                try {
                    $sequence = DocumentSequence::create(['doc_type' => $docType, 'period' => $period, 'next_value' => 1]);
                } catch (UniqueConstraintViolationException) {
                    $sequence = $query();
                }
            }

            $value = (int) $sequence->next_value;
            $sequence->forceFill(['next_value' => $value + 1])->save();

            return $value;
        });
    }
}
