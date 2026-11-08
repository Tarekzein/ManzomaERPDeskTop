<?php

namespace App\Modules\Service\Services;

use App\Modules\Inventory\Models\Product;
use App\Modules\Inventory\Models\ProductSerial;
use App\Modules\Parties\Models\Party;
use App\Modules\Service\Models\CustomerUnit;
use App\Modules\Service\Models\MaintenanceProfile;
use App\Modules\Service\Models\PartyAddress;
use App\Modules\Trading\Models\TradeDocumentLine;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** Shared registration rules for standalone entry and customer intake. Does not move stock. */
class CustomerUnitService
{
    public function rules(): array
    {
        return ['party_id' => 'required|exists:parties,id', 'product_id' => 'required|exists:products,id', 'profile_id' => 'required|exists:maintenance_profiles,id',
            'unit_code' => 'required|string|max:50|unique:customer_units', 'serial_number' => 'nullable|string|max:100', 'address_id' => 'nullable|exists:party_addresses,id',
            'invoice_line_id' => 'nullable|exists:trade_document_lines,id', 'purchased_on' => 'nullable|date_format:Y-m-d|before_or_equal:'.MaintenanceService::today(),
            'warranty_starts_on' => 'nullable|date_format:Y-m-d', 'warranty_ends_on' => 'nullable|date_format:Y-m-d', 'notes' => 'nullable|string|max:4000'];
    }

    public function create(array $data): CustomerUnit
    {
        return DB::transaction(function () use ($data) {
            if (! empty($data['warranty_starts_on']) && ! empty($data['warranty_ends_on']) && $data['warranty_ends_on'] < $data['warranty_starts_on']) {
                throw ValidationException::withMessages(['warranty_ends_on' => 'Warranty end must not precede its start.']);
            }
            abort_unless(Party::query()->findOrFail($data['party_id'])->is_customer, 422);
            $product = Product::query()->whereKey($data['product_id'])->lockForUpdate()->firstOrFail();
            $profile = MaintenanceProfile::query()->findOrFail($data['profile_id']);
            abort_unless($profile->product_id === $product->id && $profile->active, 422, 'Profile does not match this filter.');
            if (! empty($data['address_id'])) {
                abort_unless(PartyAddress::query()->findOrFail($data['address_id'])->party_id === (int) $data['party_id'], 422);
            }
            if (! empty($data['invoice_line_id'])) {
                $line = TradeDocumentLine::query()->with('document')->lockForUpdate()->findOrFail($data['invoice_line_id']);
                abort_unless($line->document->party_id === (int) $data['party_id'] && $line->document->type === 'sales_invoice' && $line->document->status === 'posted' && $line->product_id === $product->id, 422, 'Invoice does not match customer/filter.');
                $registered = CustomerUnit::query()->where('invoice_line_id', $line->id)->where('status', '!=', 'returned')->count();
                $sold = ((float) $line->quantity - (float) $line->processed_quantity) * (float) $line->factor;
                abort_unless($registered + 1 <= $sold, 422, 'All available filter units from this invoice line are already registered.');
            }
            $serialId = null;
            if (! empty($data['serial_number'])) {
                $number = mb_strtoupper(trim($data['serial_number']));
                $serial = ProductSerial::query()->where('product_id', $product->id)->where('serial_number', $number)->lockForUpdate()->first();
                if (! $serial) {
                    abort_if(! empty($data['invoice_line_id']), 422, 'Sold serial must already exist.');
                    // External installed base: register identity without inventing stock movements.
                    $serial = ProductSerial::query()->create(['product_id' => $product->id, 'serial_number' => $number, 'status' => 'issued']);
                }
                abort_unless($serial->status === 'issued' && ! $serial->warehouse_id, 422, 'This serial is still in stock.');
                if (! empty($data['invoice_line_id'])) {
                    abort_unless(DB::table('stock_move_serials')->join('stock_moves', 'stock_moves.id', '=', 'stock_move_serials.stock_move_id')->where('serial_id', $serial->id)->where('source_type', 'sales_invoice')->where('source_line_id', $data['invoice_line_id'])->exists(), 422, 'Serial was not sold on this invoice line.');
                }
                if (CustomerUnit::query()->where('serial_id', $serial->id)->exists()) {
                    throw ValidationException::withMessages(['serial_number' => 'This serial is already registered to a customer filter.']);
                }
                $serialId = $serial->id;
            } else {
                abort_if($product->track_serials, 422, 'Serial number is required.');
            }

            return CustomerUnit::query()->create(collect($data)->except('serial_number')->all() + ['serial_id' => $serialId])->load('schedules');
        });
    }
}
