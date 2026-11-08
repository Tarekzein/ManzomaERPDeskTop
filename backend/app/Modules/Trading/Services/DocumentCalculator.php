<?php

namespace App\Modules\Trading\Services;

use App\Support\Money;

/**
 * Computes line and document totals.
 *
 * Every monetary figure is rounded at the line level and the document sums the
 * rounded lines, so the document equals the journal entry it posts.
 *
 * Prices may include VAT (retail) or exclude it (trade). With inclusive prices
 * the customer pays exactly quantity × price − discounts, and the VAT is
 * extracted from that amount.
 */
class DocumentCalculator
{
    /**
     * @param  array  $header  price_includes_tax, invoice_discount_percent, invoice_discount_amount, wht_rate, wht_threshold
     * @param  array  $lines  quantity, unit_price, discount_percent, discount_amount, tax_rate, (fixed => [gross, net, tax])
     * @return array{lines: array, totals: array}
     */
    public function calculate(array $header, array $lines): array
    {
        $inclusive = (bool) ($header['price_includes_tax'] ?? false);
        $prepared = [];
        $sumAfter = 0.0;

        foreach ($lines as $i => $line) {
            $qty = (float) ($line['quantity'] ?? 0);
            $price = (float) ($line['unit_price'] ?? 0);
            $rate = (float) ($line['tax_rate'] ?? 0) / 100;

            if (isset($line['fixed'])) {
                // Returns copy a share of the original line's amounts exactly.
                $prepared[$i] = ['fixed' => $line['fixed'], 'rate' => $rate, 'after' => (float) $line['fixed']['net'], 'line_discount' => 0.0];
                $sumAfter += (float) $line['fixed']['net'];

                continue;
            }

            $gross = $qty * $price;
            $lineDiscount = (float) ($line['discount_amount'] ?? 0) > 0
                ? (float) $line['discount_amount']
                : $gross * (float) ($line['discount_percent'] ?? 0) / 100;
            $lineDiscount = min(max($lineDiscount, 0), $gross);
            $after = Money::round($gross - $lineDiscount);

            $prepared[$i] = [
                'rate' => $rate,
                'gross_entered' => Money::round($gross),
                'line_discount' => Money::round($lineDiscount),
                'after' => $after,
            ];
            $sumAfter += $after;
        }
        $sumAfter = Money::round($sumAfter);

        // Invoice-level discount, in the same domain as the prices.
        $invoiceDiscount = 0.0;
        if ((float) ($header['invoice_discount_percent'] ?? 0) > 0) {
            $invoiceDiscount = $sumAfter * (float) $header['invoice_discount_percent'] / 100;
        } elseif ((float) ($header['invoice_discount_amount'] ?? 0) > 0) {
            $invoiceDiscount = (float) $header['invoice_discount_amount'];
        }
        $invoiceDiscount = Money::round(min(max($invoiceDiscount, 0), $sumAfter));

        // Allocate the invoice discount across non-fixed lines by value.
        $allocatable = collect($prepared)->filter(fn ($p) => ! isset($p['fixed']) && $p['after'] > 0);
        $allocBase = $allocatable->sum('after');
        $allocations = [];
        $allocated = 0.0;
        $keys = $allocatable->keys()->all();
        foreach ($keys as $n => $key) {
            if ($n === count($keys) - 1) {
                $allocations[$key] = Money::round($invoiceDiscount - $allocated);
            } else {
                $share = $allocBase > 0 ? Money::round($invoiceDiscount * $prepared[$key]['after'] / $allocBase) : 0.0;
                $allocations[$key] = $share;
                $allocated = Money::round($allocated + $share);
            }
        }

        $out = [];
        $totals = ['gross_total' => 0.0, 'discount_total' => 0.0, 'net_total' => 0.0, 'tax_total' => 0.0, 'total' => 0.0];
        foreach ($prepared as $i => $p) {
            $rate = $p['rate'];
            if (isset($p['fixed'])) {
                $gross = Money::round($p['fixed']['gross']);
                $net = Money::round($p['fixed']['net']);
                $tax = Money::round($p['fixed']['tax']);
            } elseif ($inclusive) {
                $netIncl = Money::round($p['after'] - ($allocations[$i] ?? 0));
                $net = Money::round($netIncl / (1 + $rate));
                $tax = Money::round($netIncl - $net);
                $gross = Money::round($p['gross_entered'] / (1 + $rate));
                if ($gross < $net) {
                    $gross = $net;
                }
            } else {
                $gross = $p['gross_entered'];
                $net = Money::round($p['after'] - ($allocations[$i] ?? 0));
                $tax = Money::round($net * $rate);
            }
            $discount = Money::round($gross - $net);
            $lineTotal = Money::round($net + $tax);

            $out[$i] = [
                'gross_amount' => $gross,
                'total_discount' => $discount,
                'net_amount' => $net,
                'tax_amount' => $tax,
                'line_total' => $lineTotal,
            ];
            $totals['gross_total'] += $gross;
            $totals['discount_total'] += $discount;
            $totals['net_total'] += $net;
            $totals['tax_total'] += $tax;
            $totals['total'] += $lineTotal;
        }
        $totals = array_map(fn ($v) => Money::round($v), $totals);

        $whtRate = (float) ($header['wht_rate'] ?? 0);
        $threshold = (float) ($header['wht_threshold'] ?? 0);
        $wht = 0.0;
        if (isset($header['wht_fixed'])) {
            $wht = Money::round($header['wht_fixed']);
        } elseif ($whtRate > 0 && $totals['net_total'] >= $threshold) {
            $wht = Money::round($totals['net_total'] * $whtRate / 100);
        }
        $totals['wht_amount'] = $wht;
        $totals['balance_due'] = Money::round($totals['total'] - $wht);
        $totals['invoice_discount_effective'] = $invoiceDiscount;

        return ['lines' => $out, 'totals' => $totals];
    }
}
