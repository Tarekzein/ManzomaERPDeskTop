<?php

namespace App\Modules\Trading\Services;

use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\NumberingService;
use App\Modules\Core\Services\SettingsService;
use App\Modules\Finance\Models\TaxRate;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\ProductUnit;
use App\Modules\Inventory\Models\Warehouse;
use App\Modules\Parties\Models\Party;
use App\Modules\Trading\Models\TradeDocument;
use App\Modules\Trading\Models\TradeDocumentLine;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Drafting, editing and converting sales and purchase documents.
 * Posting lives in TradingPoster.
 */
class TradingService
{
    public const TYPES = [
        'sales_quotation', 'sales_order', 'sales_invoice', 'sales_return',
        'purchase_order', 'purchase_receipt', 'purchase_invoice', 'purchase_return',
    ];

    /** Types whose final number is assigned when posted (gap-free series). */
    public const NUMBER_ON_POST = ['sales_invoice', 'sales_return', 'purchase_receipt', 'purchase_invoice', 'purchase_return'];

    /** Allowed conversions: source type → target types. */
    public const CONVERSIONS = [
        'sales_quotation' => ['sales_order', 'sales_invoice'],
        'sales_order' => ['sales_invoice'],
        'sales_invoice' => ['sales_return'],
        'purchase_order' => ['purchase_receipt', 'purchase_invoice'],
        'purchase_receipt' => ['purchase_invoice'],
        'purchase_invoice' => ['purchase_return'],
    ];

    public function __construct(
        private readonly DocumentCalculator $calculator,
        private readonly NumberingService $numbers,
        private readonly SettingsService $settings,
        private readonly AuditService $audit,
    ) {}

    public static function isSales(string $type): bool
    {
        return str_starts_with($type, 'sales_');
    }

    public static function isReturn(string $type): bool
    {
        return in_array($type, ['sales_return', 'purchase_return'], true);
    }

    public function editable(TradeDocument $doc): bool
    {
        return $doc->status === 'draft' || ($doc->type === 'sales_quotation' && $doc->status === 'sent');
    }

    public function save(string $type, array $data, ?TradeDocument $doc = null): TradeDocument
    {
        if (! in_array($type, self::TYPES, true)) {
            throw BusinessException::make(__('erp.unknown_document_type'), 'invalid_type');
        }
        if ($doc && ! $this->editable($doc)) {
            throw BusinessException::make(__('erp.only_draft_editable'), 'not_draft');
        }

        $party = Party::query()->findOrFail($data['party_id']);
        $this->assertPartyRole($party, $type);

        $source = null;
        $sourceId = $data['source_id'] ?? $doc?->source_id;
        if ($sourceId) {
            $source = TradeDocument::query()->with('lines')->findOrFail($sourceId);
            if ((int) $source->party_id !== (int) $party->id && self::isReturn($type)) {
                throw BusinessException::make(__('erp.return_party_mismatch'), 'party_mismatch');
            }
        }

        $date = $data['date'] ?? now()->toDateString();
        $user = auth()->user();
        $warehouseId = $data['warehouse_id'] ?? $doc?->warehouse_id ?? $user?->default_warehouse_id
            ?? Warehouse::query()->where('is_transit', false)->where('is_active', true)->value('id');
        if ($warehouseId && ! Warehouse::query()->whereKey($warehouseId)->where('is_transit', false)->exists()) {
            throw BusinessException::make(__('erp.invalid_warehouse'), 'invalid_warehouse');
        }

        $isSales = self::isSales($type);
        $includesTax = array_key_exists('price_includes_tax', $data)
            ? (bool) $data['price_includes_tax']
            : ($source ? (bool) $source->price_includes_tax : ($isSales ? (bool) $this->settings->get('sales.price_includes_tax', false) : false));

        $whtRate = 0.0;
        if (in_array($type, ['sales_invoice', 'sales_return', 'purchase_invoice', 'purchase_return'], true)) {
            $whtRate = self::isReturn($type) && $source ? (float) $source->wht_rate : ($party->subject_to_wht ? (float) $party->wht_rate : 0.0);
            if (array_key_exists('wht_rate', $data) && ! self::isReturn($type)) {
                $whtRate = (float) $data['wht_rate'];
            }
        }

        $dueDate = $data['due_date'] ?? null;
        if (! $dueDate && in_array($type, ['sales_invoice', 'purchase_invoice'], true)) {
            $dueDate = Carbon::parse($date)->addDays((int) $party->payment_terms_days)->toDateString();
        }

        $header = [
            'type' => $type,
            'date' => $date,
            'due_date' => $dueDate,
            'valid_until' => $data['valid_until'] ?? ($type === 'sales_quotation' ? Carbon::parse($date)->addDays(15)->toDateString() : null),
            'branch_id' => $data['branch_id'] ?? $doc?->branch_id ?? $user?->branch_id,
            'warehouse_id' => $warehouseId,
            'party_id' => $party->id,
            'salesperson_id' => $data['salesperson_id'] ?? $doc?->salesperson_id ?? $party->salesperson_id ?? ($isSales && $user?->is_salesperson ? $user->id : null),
            'price_list_id' => $data['price_list_id'] ?? $party->price_list_id,
            'source_id' => $source?->id,
            'opportunity_id' => $data['opportunity_id'] ?? $doc?->opportunity_id,
            'reference' => $data['reference'] ?? null,
            'currency' => $data['currency'] ?? $this->settings->currency(),
            'exchange_rate' => $data['exchange_rate'] ?? 1,
            'price_includes_tax' => $includesTax,
            'invoice_discount_percent' => self::isReturn($type) ? 0 : (float) ($data['invoice_discount_percent'] ?? 0),
            'invoice_discount_amount' => self::isReturn($type) ? 0 : (float) ($data['invoice_discount_amount'] ?? 0),
            'wht_rate' => $whtRate,
            'notes' => $data['notes'] ?? null,
            'terms' => $data['terms'] ?? null,
        ];

        $lines = $this->prepareLines($type, $data['lines'] ?? [], $source);
        if ($lines === []) {
            throw BusinessException::make(__('erp.document_needs_lines'), 'no_lines');
        }

        $calc = $this->calculator->calculate($header + [
            'wht_threshold' => (float) $this->settings->get('tax.wht_threshold', 0),
            'wht_fixed' => self::isReturn($type) && $source && (float) $source->wht_amount > 0 ? null : null,
        ], $lines);

        return DB::transaction(function () use ($type, $doc, $header, $lines, $calc, $source) {
            $totals = collect($calc['totals'])->except('invoice_discount_effective')->all();
            if ($doc) {
                $doc->update($header + $totals);
                // Child ids carry custom data, serials and service fulfillment links.
            } else {
                $doc = TradeDocument::query()->create($header + $totals + [
                    'number' => in_array($type, self::NUMBER_ON_POST, true) ? 'D-'.uniqid() : $this->numbers->next($type, $header['date']),
                    'status' => 'draft',
                    'created_by' => auth()->id(),
                ]);
                if (str_starts_with($doc->number, 'D-')) {
                    $doc->update(['number' => 'D-'.$doc->id]);
                }
            }

            $kept = [];
            foreach ($lines as $i => $line) {
                $attributes = collect($line)->except(['id', 'fixed', 'tax_rate_given'])->all() + $calc['lines'][$i] + ['line_no' => $i + 1];
                $existing = ! empty($line['id']) ? $doc->lines()->whereKey($line['id'])->firstOrFail() : null;
                if ($existing && DB::table('trade_line_service_parts')->where('trade_line_id', $existing->id)->exists()) {
                    abort_if((int) $existing->product_id !== (int) $attributes['product_id'] || abs((float) $existing->base_quantity - (float) $attributes['base_quantity']) > 0.00001, 422, 'Consumed service lines cannot change product or quantity.');
                }
                if ($existing) {
                    $existing->update($attributes);
                    $kept[] = $existing->id;
                } else {
                    $kept[] = $doc->lines()->create($attributes)->id;
                }
            }
            $removed = $doc->lines()->whereNotIn('id', $kept)->pluck('id');
            abort_if(DB::table('trade_line_service_parts')->whereIn('trade_line_id', $removed)->exists(), 422, 'Consumed service lines cannot be removed.');
            $doc->lines()->whereIn('id', $removed)->delete();

            // Returns inherit their share of the original withholding.
            if (self::isReturn($type) && $source && (float) $source->net_total > 0 && (float) $source->wht_amount > 0) {
                $wht = Money::round((float) $source->wht_amount * $calc['totals']['net_total'] / (float) $source->net_total);
                $doc->update(['wht_amount' => $wht, 'balance_due' => Money::round($calc['totals']['total'] - $wht)]);
            }

            return $doc->refresh()->load($this->relations());
        });
    }

    public function relations(): array
    {
        return ['lines.components', 'lines.sourceLine.components', 'lines.product.units.unit', 'lines.productUnit.unit', 'lines.batch', 'party', 'warehouse', 'salesperson:id,name', 'source:id,type,number,date', 'children:id,type,number,date,status,source_id,total', 'allocations.voucher:id,number,date,method', 'allocations.returnDocument:id,number,date', 'creator:id,name'];
    }

    /**
     * Normalise incoming lines: product, unit, factor, tax and source checks.
     */
    private function prepareLines(string $type, array $input, ?TradeDocument $source): array
    {
        $products = Product::query()->with('units')->whereIn('id', collect($input)->pluck('product_id')->filter())->get()->keyBy('id');
        $sourceLines = $source ? $source->lines->keyBy('id') : collect();
        $taxRates = TaxRate::query()->get()->keyBy('id');
        $lines = [];

        foreach ($input as $row) {
            $qty = Money::qty($row['quantity'] ?? 0);
            if ($qty <= 0) {
                continue;
            }
            $product = $products[$row['product_id'] ?? 0] ?? null;
            if (! $product) {
                throw BusinessException::make(__('erp.product_not_found'), 'invalid_product');
            }

            $unit = null;
            if (! empty($row['product_unit_id'])) {
                $unit = $product->units->firstWhere('id', (int) $row['product_unit_id']);
                if (! $unit) {
                    throw BusinessException::make(__('erp.unit_not_for_product', ['product' => $product->name]), 'invalid_unit');
                }
            }
            $unit ??= $product->units->firstWhere('unit_id', $product->base_unit_id) ?? $product->units->first();
            $factor = $unit ? (float) $unit->factor : 1.0;

            $taxRateId = array_key_exists('tax_rate_id', $row) ? ($row['tax_rate_id'] ?: null) : $product->tax_rate_id;
            $taxRate = $taxRateId && isset($taxRates[$taxRateId]) ? (float) $taxRates[$taxRateId]->rate : 0.0;

            $line = [
                'id' => $row['id'] ?? null,
                'serial_numbers' => $row['serial_numbers'] ?? [],
                'product_id' => $product->id,
                'product_unit_id' => $unit?->id,
                'factor' => $factor,
                'description' => $row['description'] ?? null,
                'quantity' => $qty,
                'base_quantity' => Money::qty($qty * $factor),
                'unit_price' => round((float) ($row['unit_price'] ?? 0), 4),
                'discount_percent' => (float) ($row['discount_percent'] ?? 0),
                'discount_amount' => Money::round($row['discount_amount'] ?? 0),
                'tax_rate_id' => $taxRateId,
                'tax_rate' => $taxRate,
                'batch_id' => (int) ($row['batch_id'] ?? 0),
                'batch_no' => $row['batch_no'] ?? null,
                'expiry_date' => $row['expiry_date'] ?? null,
                'source_line_id' => null,
            ];

            if (! empty($row['source_line_id'])) {
                $sourceLine = $sourceLines[(int) $row['source_line_id']] ?? null;
                if (! $sourceLine || (int) $sourceLine->product_id !== (int) $product->id) {
                    throw BusinessException::make(__('erp.source_line_mismatch'), 'source_line_mismatch');
                }
                $line['source_line_id'] = $sourceLine->id;

                if (self::isReturn($type)) {
                    // A return carries the original price, discount, tax and batch.
                    $ratio = (float) $sourceLine->base_quantity > 0 ? $line['base_quantity'] / (float) $sourceLine->base_quantity : 0;
                    $line['product_unit_id'] = $sourceLine->product_unit_id;
                    $line['factor'] = (float) $sourceLine->factor;
                    $line['base_quantity'] = Money::qty($qty * (float) $sourceLine->factor);
                    $ratio = (float) $sourceLine->base_quantity > 0 ? $line['base_quantity'] / (float) $sourceLine->base_quantity : 0;
                    $line['unit_price'] = (float) $sourceLine->unit_price;
                    $line['discount_percent'] = (float) $sourceLine->discount_percent;
                    $line['discount_amount'] = 0;
                    $line['tax_rate_id'] = $sourceLine->tax_rate_id;
                    $line['tax_rate'] = (float) $sourceLine->tax_rate;
                    $line['batch_id'] = (int) $sourceLine->batch_id;
                    $line['batch_no'] = $sourceLine->batch_no;
                    $line['expiry_date'] = $sourceLine->expiry_date?->toDateString();
                    $line['fixed'] = [
                        'gross' => Money::round((float) $sourceLine->gross_amount * $ratio),
                        'net' => Money::round((float) $sourceLine->net_amount * $ratio),
                        'tax' => Money::round((float) $sourceLine->tax_amount * $ratio),
                    ];
                }
            } elseif (self::isReturn($type) && $source) {
                throw BusinessException::make(__('erp.return_line_needs_source'), 'source_line_required');
            }

            $lines[] = $line;
        }

        return $lines;
    }

    private function assertPartyRole(Party $party, string $type): void
    {
        if (! $party->is_active) {
            throw BusinessException::make(__('erp.party_inactive', ['party' => $party->name]), 'party_inactive');
        }
        if (self::isSales($type) && ! $party->is_customer) {
            throw BusinessException::make(__('erp.party_not_customer', ['party' => $party->name]), 'party_role');
        }
        if (! self::isSales($type) && ! $party->is_supplier) {
            throw BusinessException::make(__('erp.party_not_supplier', ['party' => $party->name]), 'party_role');
        }
    }

    /**
     * Build a draft of the next document in the flow from a source document,
     * carrying only what has not been processed yet.
     */
    public function convert(TradeDocument $source, string $targetType, array $overrides = []): TradeDocument
    {
        if (! in_array($targetType, self::CONVERSIONS[$source->type] ?? [], true)) {
            throw BusinessException::make(__('erp.conversion_not_allowed'), 'conversion_not_allowed');
        }
        $allowedStatus = match ($source->type) {
            'sales_quotation' => ['draft', 'sent', 'accepted'],
            'sales_order', 'purchase_order' => ['confirmed', 'partially_invoiced', 'partially_received'],
            default => ['posted'],
        };
        if (! in_array($source->status, $allowedStatus, true)) {
            throw BusinessException::make(__('erp.source_status_invalid'), 'source_status');
        }

        $lines = [];
        foreach ($source->lines as $line) {
            $remaining = $source->type === 'sales_quotation' ? (float) $line->quantity : $line->remainingQuantity();
            if ($remaining <= 0.00001) {
                continue;
            }
            $lines[] = [
                'product_id' => $line->product_id,
                'product_unit_id' => $line->product_unit_id,
                'description' => $line->description,
                'quantity' => $remaining,
                'unit_price' => (float) $line->unit_price,
                'discount_percent' => (float) $line->discount_percent,
                'discount_amount' => (float) $line->discount_amount > 0 && (float) $line->quantity > 0 ? Money::round((float) $line->discount_amount * $remaining / (float) $line->quantity) : 0,
                'tax_rate_id' => $line->tax_rate_id,
                'batch_id' => $line->batch_id,
                'batch_no' => $line->batch_no,
                'expiry_date' => $line->expiry_date?->toDateString(),
                'source_line_id' => $line->id,
            ];
        }
        if ($lines === []) {
            throw BusinessException::make(__('erp.nothing_left_to_convert'), 'nothing_to_convert');
        }

        $data = array_merge([
            'party_id' => $source->party_id,
            'date' => now()->toDateString(),
            'warehouse_id' => $source->warehouse_id,
            'branch_id' => $source->branch_id,
            'salesperson_id' => $source->salesperson_id,
            'price_list_id' => $source->price_list_id,
            'currency' => $source->currency,
            'exchange_rate' => (float) $source->exchange_rate,
            'price_includes_tax' => (bool) $source->price_includes_tax,
            'invoice_discount_percent' => self::isReturn($targetType) ? 0 : (float) $source->invoice_discount_percent,
            'reference' => $source->reference,
            'opportunity_id' => $source->opportunity_id,
            'notes' => $source->notes,
            'terms' => $source->terms,
            'source_id' => $source->id,
            'lines' => $lines,
        ], $overrides);

        $doc = $this->save($targetType, $data);
        if ($source->type === 'sales_quotation' && in_array($source->status, ['draft', 'sent'], true)) {
            $source->update(['status' => 'accepted']);
        }
        $this->audit->record('converted', $source, $source->number.' → '.$targetType);

        return $doc;
    }

    public function delete(TradeDocument $doc): void
    {
        if ($doc->status !== 'draft') {
            throw BusinessException::make(__('erp.only_draft_deletable'), 'not_draft');
        }
        $doc->delete();
    }

    /**
     * Status changes that do not post anything (quotations and orders).
     */
    public function transition(TradeDocument $doc, string $action): TradeDocument
    {
        $map = [
            'sales_quotation' => ['send' => [['draft'], 'sent'], 'accept' => [['draft', 'sent'], 'accepted'], 'reject' => [['draft', 'sent'], 'rejected'], 'reopen' => [['rejected', 'expired'], 'draft']],
            'sales_order' => ['confirm' => [['draft'], 'confirmed'], 'cancel' => [['draft', 'confirmed'], 'cancelled'], 'close' => [['partially_invoiced'], 'closed']],
            'purchase_order' => ['confirm' => [['draft'], 'confirmed'], 'cancel' => [['draft', 'confirmed'], 'cancelled'], 'close' => [['partially_received'], 'closed']],
        ];
        $rule = $map[$doc->type][$action] ?? null;
        if (! $rule || ! in_array($doc->status, $rule[0], true)) {
            throw BusinessException::make(__('erp.transition_not_allowed'), 'transition_not_allowed');
        }
        $doc->update(['status' => $rule[1]]);
        $this->audit->record($action, $doc);

        return $doc->refresh()->load($this->relations());
    }

    /**
     * Pricing helper for the desktop line grid: price list → unit price → base.
     */
    public function priceFor(Product $product, ?ProductUnit $unit, ?int $priceListId, ?int $partyId, string $kind = 'sale'): array
    {
        $unit ??= $product->units()->where('unit_id', $product->base_unit_id)->first();
        $price = $kind === 'sale' ? ($unit ? $unit->effectiveSalePrice() : (float) $product->sale_price) : ($unit ? $unit->effectivePurchasePrice() : (float) $product->purchase_price);
        $source = 'product';

        if ($kind === 'sale' && $priceListId && $unit) {
            $listPrice = DB::table('price_list_items')->where('price_list_id', $priceListId)->where('product_unit_id', $unit->id)->value('price');
            if ($listPrice !== null) {
                $price = (float) $listPrice;
                $source = 'price_list';
            }
        }

        $last = null;
        if ($partyId) {
            $types = $kind === 'sale' ? ['sales_invoice'] : ['purchase_invoice', 'purchase_receipt'];
            $last = TradeDocumentLine::query()
                ->join('trade_documents', 'trade_documents.id', '=', 'trade_document_lines.trade_document_id')
                ->where('trade_documents.party_id', $partyId)
                ->whereIn('trade_documents.type', $types)
                ->where('trade_documents.status', 'posted')
                ->where('trade_document_lines.product_id', $product->id)
                ->orderByDesc('trade_documents.date')->orderByDesc('trade_documents.id')
                ->select('trade_document_lines.unit_price', 'trade_document_lines.factor', 'trade_documents.date', 'trade_documents.number')
                ->first();
        }

        return [
            'unit_price' => round($price, 4),
            'source' => $source,
            'last' => $last ? [
                'unit_price_per_base' => round((float) $last->unit_price / max((float) $last->factor, 0.0001), 4),
                'date' => $last->date,
                'number' => $last->number,
            ] : null,
        ];
    }
}
