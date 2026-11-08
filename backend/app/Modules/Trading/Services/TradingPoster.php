<?php

namespace App\Modules\Trading\Services;

use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\NumberingService;
use App\Modules\Core\Services\PeriodGuard;
use App\Modules\Core\Services\SettingsService;
use App\Modules\Finance\Models\JournalEntry;
use App\Modules\Finance\Services\JournalService;
use App\Modules\Finance\Services\VoucherService;
use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Services\SparePartsService;
use App\Modules\Inventory\Services\StockService;
use App\Modules\Service\Models\ServiceVisitPart;
use App\Modules\Trading\Models\Allocation;
use App\Modules\Trading\Models\TradeDocument;
use App\Modules\Trading\Models\TradeDocumentLine;
use App\Modules\Trading\Models\TradeLineComponent;
use App\Support\BusinessException;
use App\Support\Money;
use Illuminate\Support\Facades\DB;

/**
 * Posts sales and purchase documents: stock, journal entry, settlement and
 * the progress of the source document, all in one transaction.
 */
class TradingPoster
{
    public function __construct(
        private readonly StockService $stock,
        private readonly JournalService $journal,
        private readonly NumberingService $numbers,
        private readonly PeriodGuard $period,
        private readonly SettingsService $settings,
        private readonly AllocationService $allocations,
        private readonly AuditService $audit,
        private readonly TradingService $trading,
        private readonly SparePartsService $parts,
    ) {}

    /**
     * @param  array  $options  payment: {amount, cash_account_id, method, reference, cheque}, override_credit: bool,
     *                          refund: {amount, cash_account_id, method}
     */
    public function post(TradeDocument $doc, array $options = []): TradeDocument
    {
        return DB::transaction(function () use ($doc, $options) {
            $doc = TradeDocument::query()->whereKey($doc->id)->lockForUpdate()->firstOrFail();
            if ($doc->status !== 'draft') {
                throw BusinessException::make(__('erp.only_draft_postable'), 'not_draft');
            }
            if ($doc->source_id) {
                TradeDocument::query()->whereKey($doc->source_id)->lockForUpdate()->firstOrFail();
                TradeDocumentLine::query()->where('trade_document_id', $doc->source_id)->orderBy('id')->lockForUpdate()->get();
            }
            $doc->load('lines.product', 'party', 'source.lines');
            $this->period->assertOpen($doc->date->toDateString());

            match ($doc->type) {
                'sales_invoice' => $this->postSalesInvoice($doc, $options),
                'sales_return' => $this->postSalesReturn($doc, $options),
                'purchase_receipt' => $this->postPurchaseReceipt($doc),
                'purchase_invoice' => $this->postPurchaseInvoice($doc, $options),
                'purchase_return' => $this->postPurchaseReturn($doc, $options),
                default => throw BusinessException::make(__('erp.document_not_postable'), 'not_postable'),
            };

            $this->audit->record('posted', $doc, $doc->number);

            return $doc->refresh()->load($this->trading->relations());
        });
    }

    // ───────────────────────────── Sales ─────────────────────────────

    private function postSalesInvoice(TradeDocument $doc, array $options): void
    {
        $this->assertWarehouse($doc);
        $this->checkDiscountAndPrice($doc);
        $payNow = Money::round($options['payment']['amount'] ?? 0);
        $this->checkCredit($doc, $payNow, (bool) ($options['override_credit'] ?? false));
        $this->checkSourceQuantities($doc);

        $this->assignNumber($doc);
        $ctx = $this->ctx($doc);
        $products = $this->parts->lockForSale($doc->lines->pluck('product_id')->all());

        $costTotal = 0.0;
        $newCostTotal = 0.0;
        $salesGross = 0.0;
        $serviceGross = 0.0;
        foreach ($doc->lines as $line) {
            $product = $products[$line->product_id];
            if (! $product->isStock()) {
                $serviceGross += (float) $line->gross_amount;

                continue;
            }
            $fulfilled = DB::table('trade_line_service_parts')->where('trade_line_id', $line->id)->first();
            if ($fulfilled) {
                $part = ServiceVisitPart::query()->with('visit.request')->findOrFail($fulfilled->visit_part_id);
                abort_unless($part->visit->status === 'completed' && $part->visit->request->party_id === $doc->party_id && (int) $part->product_id === (int) $line->product_id && abs((float) $fulfilled->base_quantity - (float) $line->base_quantity) < 0.00001, 422, 'Invalid service fulfillment.');
                $parentCost = (float) $fulfilled->cost_amount;
                $unitCost = (float) $part->unit_cost;
            } else {
                $moves = $this->stock->issue($product, (int) $doc->warehouse_id, (float) $line->base_quantity, $line->batch_id ?: null, $ctx + ['source_line_id' => $line->id, 'serial_numbers' => $line->serial_numbers ?? []]);
                $parentCost = Money::round(abs(collect($moves)->sum(fn ($m) => (float) $m->total_cost)));
                $unitCost = round($parentCost / (float) $line->base_quantity, 4);
                $line->batch_id = count($moves) === 1 ? (int) $moves[0]->batch_id : $line->batch_id;
                $newCostTotal += $parentCost;
            }
            $componentCost = $this->parts->consume($line, $product, $products, (int) $doc->warehouse_id, $ctx);
            // unit_cost remains the parent's base-unit cost for existing return flows.
            $line->update(['unit_cost' => $unitCost, 'cost_amount' => Money::round($parentCost + $componentCost),
                'component_cost_amount' => $componentCost, 'batch_id' => $line->batch_id]);
            $costTotal += $parentCost + $componentCost;
            $newCostTotal += $componentCost;
            $salesGross += (float) $line->gross_amount;
        }
        $costTotal = Money::round($costTotal);

        $party = $doc->party;
        $entry = $this->journal->post($this->header($doc, __('erp.je_sales_invoice', ['number' => $doc->number, 'party' => $party->name])), [
            ['account' => 'ar', 'debit' => $doc->balance_due, 'party_id' => $party->id],
            ['account' => 'wht_receivable', 'debit' => $doc->wht_amount],
            ['account' => 'sales_discount', 'debit' => $doc->discount_total],
            ['account' => 'sales', 'credit' => Money::round($salesGross)],
            ['account' => 'service_revenue', 'credit' => Money::round($serviceGross)],
            ['account' => 'vat_output', 'credit' => $doc->tax_total],
            ['account' => 'cogs', 'debit' => Money::round($newCostTotal)],
            ['account' => 'inventory', 'credit' => Money::round($newCostTotal)],
        ]);

        $doc->update(['status' => 'posted', 'cost_total' => $costTotal, 'journal_entry_id' => $entry?->id, 'posted_by' => auth()->id(), 'posted_at' => now()]);
        $this->advanceSource($doc);

        if ($payNow > 0) {
            app(VoucherService::class)->settleInvoice($doc->refresh(), $options['payment']);
        }
    }

    private function postSalesReturn(TradeDocument $doc, array $options): void
    {
        $this->assertWarehouse($doc);
        $this->checkSourceQuantities($doc);
        if ($doc->source && ($doc->source->type !== 'sales_invoice' || $doc->source->status !== 'posted')) {
            throw BusinessException::make(__('erp.return_source_invalid'), 'return_source_invalid');
        }

        $this->assignNumber($doc);
        $ctx = $this->ctx($doc);
        $sourceComponentIds = TradeLineComponent::query()->whereIn('trade_document_line_id', $doc->lines->pluck('source_line_id')->filter())->pluck('product_id')->all();
        $products = $this->stock->lockProducts([...$doc->lines->pluck('product_id')->all(), ...$sourceComponentIds]);
        $costTotal = 0.0;
        foreach ($doc->lines as $line) {
            $product = $products[$line->product_id];
            if (! $product->isStock()) {
                continue;
            }
            if ($product->track_serials && $line->source_line_id) {
                $original = array_map(fn ($number) => mb_strtoupper(trim($number)), $line->sourceLine->serial_numbers ?? []);
                $returned = array_map(fn ($number) => mb_strtoupper(trim($number)), $line->serial_numbers ?? []);
                abort_if(array_diff($returned, $original), 422, 'Returned serials must belong to the source invoice line.');
            }
            // Back at the cost it left with, so the margin reverses exactly.
            $unitCost = $line->source_line_id ? (float) $line->sourceLine->unit_cost : (float) $product->avg_cost;
            $batchId = (int) $line->batch_id;
            if ($product->track_batches && ! $batchId) {
                $batchId = $this->stock->batch($product, $line->batch_no, $line->expiry_date?->toDateString());
            }
            $move = $this->stock->receive($product, (int) $doc->warehouse_id, (float) $line->base_quantity, $unitCost, $batchId, $ctx + ['source_line_id' => $line->id, 'serial_numbers' => $line->serial_numbers ?? []]);
            $cost = Money::round((float) $move->total_cost);
            $componentCost = $this->parts->restore($line, $products, (int) $doc->warehouse_id, $ctx);
            $line->update(['unit_cost' => $unitCost, 'cost_amount' => Money::round($cost + $componentCost), 'component_cost_amount' => $componentCost, 'batch_id' => $batchId]);
            $costTotal += $cost + $componentCost;
        }
        $costTotal = Money::round($costTotal);

        $party = $doc->party;
        $entry = $this->journal->post($this->header($doc, __('erp.je_sales_return', ['number' => $doc->number, 'party' => $party->name])), [
            ['account' => 'sales_returns', 'debit' => $doc->net_total],
            ['account' => 'vat_output', 'debit' => $doc->tax_total],
            ['account' => 'ar', 'credit' => $doc->balance_due, 'party_id' => $party->id],
            ['account' => 'wht_receivable', 'credit' => $doc->wht_amount],
            ['account' => 'inventory', 'debit' => $costTotal],
            ['account' => 'cogs', 'credit' => $costTotal],
        ]);
        $doc->update(['status' => 'posted', 'cost_total' => $costTotal, 'journal_entry_id' => $entry?->id, 'posted_by' => auth()->id(), 'posted_at' => now()]);
        $this->advanceSource($doc);

        $credit = (float) $doc->balance_due;
        // Reduce what the customer still owes on the original invoice first.
        if ($doc->source && $doc->source->outstanding > 0) {
            $applied = min($credit, $doc->source->outstanding);
            $this->allocations->allocate($doc->source, $applied, $doc->date->toDateString(), null, $doc->id);
            $credit = Money::round($credit - $applied);
        }
        $doc->update(['paid_amount' => Money::round((float) $doc->balance_due - $credit)]);

        if (! empty($options['refund']['amount']) && (float) $options['refund']['amount'] > 0) {
            if ((float) $options['refund']['amount'] - $credit > 0.005) {
                throw BusinessException::make(__('erp.refund_exceeds_credit', ['credit' => $credit]), 'refund_exceeds');
            }
            app(VoucherService::class)->refundForReturn($doc->refresh(), $options['refund']);
        }
    }

    // ─────────────────────────── Purchasing ───────────────────────────

    private function postPurchaseReceipt(TradeDocument $doc): void
    {
        $this->assertWarehouse($doc);
        $this->checkSourceQuantities($doc);
        $this->assignNumber($doc);
        $ctx = $this->ctx($doc);
        $products = $this->stock->lockProducts($doc->lines->pluck('product_id')->all());

        $value = 0.0;
        foreach ($doc->lines as $line) {
            $product = $products[$line->product_id];
            if (! $product->isStock()) {
                continue;
            }
            $value += $this->receivePurchaseLine($doc, $line, $product, $ctx);
        }
        $value = Money::round($value);

        $entry = $this->journal->post($this->header($doc, __('erp.je_purchase_receipt', ['number' => $doc->number, 'party' => $doc->party->name])), [
            ['account' => 'inventory', 'debit' => $value],
            ['account' => 'grni', 'credit' => $value],
        ]);
        $doc->update(['status' => 'posted', 'cost_total' => $value, 'journal_entry_id' => $entry?->id, 'posted_by' => auth()->id(), 'posted_at' => now()]);
        $this->advanceSource($doc);
    }

    private function postPurchaseInvoice(TradeDocument $doc, array $options): void
    {
        $this->checkSourceQuantities($doc);
        $fromReceipt = $doc->source && $doc->source->type === 'purchase_receipt';
        if (! $fromReceipt && $doc->lines->contains(fn ($l) => $l->product->isStock())) {
            $this->assertWarehouse($doc);
        }
        $this->assignNumber($doc);
        $ctx = $this->ctx($doc);
        $products = $this->stock->lockProducts($doc->lines->pluck('product_id')->all());

        $inventory = 0.0;
        $grni = 0.0;
        $expense = 0.0;
        $variance = 0.0;
        foreach ($doc->lines as $line) {
            $product = $products[$line->product_id];
            if (! $product->isStock()) {
                $expense += (float) $line->net_amount;

                continue;
            }
            if ($fromReceipt && $line->source_line_id) {
                // Already in stock at the receipt value; clear GRNI and book
                // any price difference against the receipt.
                $src = $line->sourceLine;
                $received = (float) $src->base_quantity > 0 ? Money::round((float) $src->cost_amount * (float) $line->base_quantity / (float) $src->base_quantity) : 0.0;
                $grni += $received;
                $variance += (float) $line->net_amount - $received;
                $line->update(['unit_cost' => (float) $src->unit_cost, 'cost_amount' => $received]);
            } else {
                $inventory += $this->receivePurchaseLine($doc, $line, $product, $ctx);
            }
        }

        $party = $doc->party;
        $entry = $this->journal->post($this->header($doc, __('erp.je_purchase_invoice', ['number' => $doc->number, 'party' => $party->name])), [
            ['account' => 'inventory', 'debit' => Money::round($inventory)],
            ['account' => 'grni', 'debit' => Money::round($grni)],
            ['account' => 'price_variance', 'debit' => Money::round($variance)],
            ['account' => 'purchase_expense', 'debit' => Money::round($expense)],
            ['account' => 'vat_input', 'debit' => $doc->tax_total],
            ['account' => 'ap', 'credit' => $doc->balance_due, 'party_id' => $party->id],
            ['account' => 'wht_payable', 'credit' => $doc->wht_amount],
        ]);
        $doc->update(['status' => 'posted', 'cost_total' => Money::round($inventory + $grni + $variance), 'journal_entry_id' => $entry?->id, 'posted_by' => auth()->id(), 'posted_at' => now()]);
        $this->advanceSource($doc);

        if (! empty($options['payment']['amount']) && (float) $options['payment']['amount'] > 0) {
            app(VoucherService::class)->settleInvoice($doc->refresh(), $options['payment']);
        }
    }

    private function postPurchaseReturn(TradeDocument $doc, array $options): void
    {
        $this->assertWarehouse($doc);
        $this->checkSourceQuantities($doc);
        if ($doc->source && ($doc->source->type !== 'purchase_invoice' || $doc->source->status !== 'posted')) {
            throw BusinessException::make(__('erp.return_source_invalid'), 'return_source_invalid');
        }
        $this->assignNumber($doc);
        $ctx = $this->ctx($doc);
        $products = $this->stock->lockProducts($doc->lines->pluck('product_id')->all());

        $inventory = 0.0;
        $stockNet = 0.0;
        $expense = 0.0;
        foreach ($doc->lines as $line) {
            $product = $products[$line->product_id];
            if (! $product->isStock()) {
                $expense += (float) $line->net_amount;

                continue;
            }
            $moves = $this->stock->issue($product, (int) $doc->warehouse_id, (float) $line->base_quantity, $line->batch_id ?: null, $ctx + ['source_line_id' => $line->id, 'serial_numbers' => $line->serial_numbers ?? []]);
            $cost = Money::round(abs(collect($moves)->sum(fn ($m) => (float) $m->total_cost)));
            $line->update(['unit_cost' => (float) $line->base_quantity > 0 ? round($cost / (float) $line->base_quantity, 4) : 0, 'cost_amount' => $cost]);
            $inventory += $cost;
            $stockNet += (float) $line->net_amount;
        }
        $inventory = Money::round($inventory);
        $variance = Money::round($stockNet - $inventory); // positive: supplier credits more than our cost

        $party = $doc->party;
        $entry = $this->journal->post($this->header($doc, __('erp.je_purchase_return', ['number' => $doc->number, 'party' => $party->name])), [
            ['account' => 'ap', 'debit' => $doc->balance_due, 'party_id' => $party->id],
            ['account' => 'wht_payable', 'debit' => $doc->wht_amount],
            ['account' => 'vat_input', 'credit' => $doc->tax_total],
            ['account' => 'inventory', 'credit' => $inventory],
            ['account' => 'price_variance', 'credit' => $variance],
            ['account' => 'purchase_expense', 'credit' => Money::round($expense)],
        ]);
        $doc->update(['status' => 'posted', 'cost_total' => $inventory, 'journal_entry_id' => $entry?->id, 'posted_by' => auth()->id(), 'posted_at' => now()]);
        $this->advanceSource($doc);

        $credit = (float) $doc->balance_due;
        if ($doc->source && $doc->source->outstanding > 0) {
            $applied = min($credit, $doc->source->outstanding);
            $this->allocations->allocate($doc->source, $applied, $doc->date->toDateString(), null, $doc->id);
            $credit = Money::round($credit - $applied);
        }
        $doc->update(['paid_amount' => Money::round((float) $doc->balance_due - $credit)]);

        if (! empty($options['refund']['amount']) && (float) $options['refund']['amount'] > 0) {
            if ((float) $options['refund']['amount'] - $credit > 0.005) {
                throw BusinessException::make(__('erp.refund_exceeds_credit', ['credit' => $credit]), 'refund_exceeds');
            }
            app(VoucherService::class)->refundForReturn($doc->refresh(), $options['refund']);
        }
    }

    /**
     * Receive one purchase line into stock at its net cost (discounts reduce
     * cost; VAT is recoverable and stays out). Returns the value received.
     */
    private function receivePurchaseLine(TradeDocument $doc, TradeDocumentLine $line, Product $product, array $ctx): float
    {
        $baseQty = (float) $line->base_quantity;
        $netBase = (float) $line->net_amount * (float) $doc->exchange_rate;
        $unitCost = $baseQty > 0 ? round($netBase / $baseQty, 4) : 0;
        $batchId = (int) $line->batch_id;
        if ($product->track_batches && ! $batchId) {
            $batchId = $this->stock->batch($product, $line->batch_no, $line->expiry_date?->toDateString());
        }
        $value = Money::round($netBase);
        $this->stock->receive($product, (int) $doc->warehouse_id, $baseQty, $unitCost, $batchId, $ctx + ['source_line_id' => $line->id, 'serial_numbers' => $line->serial_numbers ?? []], false, $value);
        $line->update(['unit_cost' => $unitCost, 'cost_amount' => $value, 'batch_id' => $batchId]);
        $product->update(['purchase_price' => $unitCost]);

        return $value;
    }

    // ───────────────────────────── Void ─────────────────────────────

    public function void(TradeDocument $doc, string $reason): TradeDocument
    {
        return DB::transaction(function () use ($doc, $reason) {
            $doc = TradeDocument::query()->whereKey($doc->id)->lockForUpdate()->firstOrFail();
            if ($doc->status !== 'posted') {
                throw BusinessException::make(__('erp.only_posted_voidable'), 'not_posted');
            }
            $doc->load('lines', 'source.lines');
            $this->period->assertOpen($doc->date->toDateString());

            if ($doc->isInvoice() && Allocation::query()->where('document_id', $doc->id)->whereNotNull('voucher_id')->exists()) {
                throw BusinessException::make(__('erp.void_has_payments'), 'has_payments');
            }
            $activeChildren = TradeDocument::query()->where('source_id', $doc->id)->whereIn('status', ['posted', 'draft'])->exists();
            if ($activeChildren) {
                throw BusinessException::make(__('erp.void_has_children'), 'has_children');
            }

            // Returns give back the settlement they applied to the invoice.
            if (TradingService::isReturn($doc->type)) {
                $this->allocations->removeForReturn($doc->id);
                if (DB::table('vouchers')->where('source_document_id', $doc->id)->where('status', 'posted')->exists()) {
                    throw BusinessException::make(__('erp.void_has_payments'), 'has_payments');
                }
            }

            $this->stock->reverseSource($doc->type, $doc->id, $this->ctx($doc));
            if ($doc->journal_entry_id) {
                $this->journal->reverse(JournalEntry::query()->findOrFail($doc->journal_entry_id), null, $reason);
            }

            $this->rewindSource($doc);
            $doc->update(['status' => 'void', 'voided_by' => auth()->id(), 'voided_at' => now(), 'void_reason' => $reason]);
            $this->audit->record('voided', $doc, $reason);

            return $doc->refresh()->load($this->trading->relations());
        });
    }

    // ─────────────────────────── Checks ───────────────────────────

    private function assertWarehouse(TradeDocument $doc): void
    {
        if (! $doc->warehouse_id && $doc->lines->contains(fn ($l) => $l->product?->isStock())) {
            throw BusinessException::make(__('erp.warehouse_required'), 'warehouse_required');
        }
    }

    private function checkDiscountAndPrice(TradeDocument $doc): void
    {
        $user = auth()->user();
        if (! $user) {
            return;
        }
        $limit = $user->max_discount_percent;
        if ($limit !== null && ! $user->can('sales.override_discount') && (float) $doc->gross_total > 0) {
            $percent = round((float) $doc->discount_total / (float) $doc->gross_total * 100, 2);
            if ($percent - (float) $limit > 0.01) {
                throw BusinessException::make(__('erp.discount_limit', ['percent' => $percent, 'limit' => $limit]), 'discount_limit', ['percent' => $percent, 'limit' => (float) $limit]);
            }
        }
        if (! $user->can('sales.override_price')) {
            foreach ($doc->lines as $line) {
                $min = (float) $line->product->min_sale_price;
                if ($min > 0 && (float) $line->base_quantity > 0) {
                    $unitNet = (float) $line->net_amount / (float) $line->base_quantity;
                    if ($unitNet + 0.0001 < $min) {
                        throw BusinessException::make(__('erp.price_below_min', ['product' => $line->product->name, 'min' => $min]), 'price_below_min', ['product_id' => $line->product_id, 'min' => $min]);
                    }
                }
            }
        }
    }

    private function checkCredit(TradeDocument $doc, float $payNow, bool $override): void
    {
        $user = auth()->user();
        $canOverride = $override && $user && $user->can('sales.override_credit');
        $party = $doc->party;

        if ($party->credit_limit !== null) {
            $balance = $this->journal->partyBalance($party->id);
            $exposure = Money::round($balance + (float) $doc->balance_due - $payNow);
            if ($exposure - (float) $party->credit_limit > 0.005 && ! $canOverride) {
                throw BusinessException::make(
                    __('erp.credit_limit_exceeded', ['party' => $party->name, 'limit' => $party->credit_limit, 'exposure' => $exposure]),
                    'credit_limit_exceeded',
                    ['limit' => (float) $party->credit_limit, 'balance' => $balance, 'exposure' => $exposure, 'can_override' => (bool) $user?->can('sales.override_credit')],
                );
            }
        }

        $days = (int) $this->settings->get('sales.block_overdue_days', 0);
        if ($days > 0 && Money::round((float) $doc->balance_due - $payNow) > 0) {
            $overdue = TradeDocument::query()
                ->where('party_id', $party->id)->where('type', 'sales_invoice')->where('status', 'posted')
                ->whereColumn('paid_amount', '<', 'balance_due')
                ->whereDate('due_date', '<', now()->subDays($days)->toDateString())
                ->count();
            if ($overdue > 0 && ! $canOverride) {
                throw BusinessException::make(__('erp.overdue_invoices', ['party' => $party->name, 'count' => $overdue, 'days' => $days]), 'overdue_invoices', ['count' => $overdue, 'can_override' => (bool) $user?->can('sales.override_credit')]);
            }
        }
    }

    /**
     * A child document may not take more than its source has left.
     */
    private function checkSourceQuantities(TradeDocument $doc): void
    {
        if (! $doc->source || $doc->source->type === 'sales_quotation') {
            return;
        }
        $sourceLines = $doc->source->lines->keyBy('id');
        $requested = [];
        foreach ($doc->lines as $line) {
            if (! $line->source_line_id) {
                if (TradingService::isReturn($doc->type)) {
                    throw BusinessException::make(__('erp.return_line_needs_source'), 'source_line_required');
                }

                continue;
            }
            $requested[$line->source_line_id] = ($requested[$line->source_line_id] ?? 0) + (float) $line->base_quantity;
        }
        foreach ($requested as $sourceLineId => $baseQty) {
            $src = $sourceLines[$sourceLineId] ?? null;
            if (! $src) {
                throw BusinessException::make(__('erp.source_line_mismatch'), 'source_line_mismatch');
            }
            $remainingBase = (float) $src->base_quantity - (float) $src->processed_quantity * (float) $src->factor;
            if ($baseQty - $remainingBase > 0.0001) {
                throw BusinessException::make(
                    __('erp.exceeds_source_quantity', ['product' => $src->product?->name ?? '', 'remaining' => Money::qty($remainingBase / max((float) $src->factor, 0.0001))]),
                    'exceeds_source_quantity',
                );
            }
        }
    }

    private function advanceSource(TradeDocument $doc): void
    {
        $source = $doc->source;
        if (! $source) {
            return;
        }
        if ($source->type === 'sales_quotation') {
            $source->update(['status' => 'accepted']);

            return;
        }
        foreach ($doc->lines as $line) {
            if ($line->source_line_id) {
                $src = TradeDocumentLine::query()->find($line->source_line_id);
                $src->update(['processed_quantity' => Money::qty((float) $src->processed_quantity + (float) $line->base_quantity / max((float) $src->factor, 0.0001))]);
            }
        }
        $this->refreshSourceStatus($source);
    }

    private function rewindSource(TradeDocument $doc): void
    {
        $source = $doc->source;
        if (! $source || $source->type === 'sales_quotation') {
            return;
        }
        foreach ($doc->lines as $line) {
            if ($line->source_line_id) {
                $src = TradeDocumentLine::query()->find($line->source_line_id);
                $src->update(['processed_quantity' => max(0, Money::qty((float) $src->processed_quantity - (float) $line->base_quantity / max((float) $src->factor, 0.0001)))]);
            }
        }
        $this->refreshSourceStatus($source);
    }

    private function refreshSourceStatus(TradeDocument $source): void
    {
        if (! in_array($source->type, ['sales_order', 'purchase_order'], true) || in_array($source->status, ['cancelled', 'closed'], true)) {
            return;
        }
        $lines = $source->lines()->get();
        $done = $lines->every(fn ($l) => $l->remainingQuantity() <= 0.0001);
        $none = $lines->every(fn ($l) => (float) $l->processed_quantity <= 0.0001);
        $status = $source->type === 'sales_order'
            ? ($done ? 'invoiced' : ($none ? 'confirmed' : 'partially_invoiced'))
            : ($done ? 'received' : ($none ? 'confirmed' : 'partially_received'));
        $source->update(['status' => $status]);
    }

    private function assignNumber(TradeDocument $doc): void
    {
        if (str_starts_with($doc->number, 'D-')) {
            $doc->update(['number' => $this->numbers->next($doc->type, $doc->date->toDateString())]);
        }
    }

    private function ctx(TradeDocument $doc): array
    {
        return [
            'date' => $doc->date->toDateString(),
            'source_type' => $doc->type,
            'source_id' => $doc->id,
            'reference' => $doc->number,
            'party_id' => $doc->party_id,
        ];
    }

    private function header(TradeDocument $doc, string $description): array
    {
        return [
            'date' => $doc->date->toDateString(),
            'description' => $description,
            'reference' => $doc->number,
            'source_type' => $doc->type,
            'source_id' => $doc->id,
            'branch_id' => $doc->branch_id,
        ];
    }
}
