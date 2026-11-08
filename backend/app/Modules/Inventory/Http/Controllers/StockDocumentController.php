<?php

namespace App\Modules\Inventory\Http\Controllers;

use App\Modules\Inventory\Models\StockDocument;
use App\Modules\Inventory\Services\StockDocumentService;
use App\Support\ApiController;
use App\Support\BusinessException;
use Illuminate\Http\Request;

class StockDocumentController extends ApiController
{
    private const PERMISSIONS = [
        'adjustment' => 'stock.adjust',
        'opening' => 'stock.adjust',
        'transfer' => 'stock.transfer',
        'count' => 'stock.count',
    ];

    public function __construct(private readonly StockDocumentService $service) {}

    public function index(Request $request, string $type)
    {
        $this->allowType($type, true);
        $query = StockDocument::query()->with('warehouse:id,code,name,name_en', 'toWarehouse:id,code,name,name_en', 'creator:id,name')
            ->withCount('lines')->where('type', $type);
        if ($request->filled('status')) {
            $query->where('status', $request->string('status'));
        }
        if ($request->filled('warehouse_id')) {
            $w = $request->integer('warehouse_id');
            $query->where(fn ($q) => $q->where('warehouse_id', $w)->orWhere('to_warehouse_id', $w));
        }
        $this->dateRange($query, $request);
        $this->search($query, $request->query('search'), ['number', 'notes']);

        return $this->paginate($query, $request, ['id', 'number', 'date'], '-id');
    }

    public function show(string $type, StockDocument $document)
    {
        $this->allowType($document->type, true);

        return response()->json(['data' => $document->load($this->service->relations())]);
    }

    public function store(Request $request, string $type)
    {
        $this->allowType($type);
        $doc = $this->service->save($type, $this->validated($request));

        return response()->json(['data' => $doc], 201);
    }

    public function update(Request $request, string $type, StockDocument $document)
    {
        $this->allowType($document->type);

        return response()->json(['data' => $this->service->save($document->type, $this->validated($request), $document)]);
    }

    public function destroy(string $type, StockDocument $document)
    {
        $this->allowType($document->type);
        if ($document->status !== 'draft') {
            throw BusinessException::make(__('erp.only_draft_deletable'), 'not_draft');
        }
        $document->delete();

        return response()->json(['ok' => true]);
    }

    public function action(Request $request, string $type, StockDocument $document, string $action)
    {
        $this->allowType($document->type);
        $doc = match ($action) {
            'post' => $this->service->post($document, $request->only('direct')),
            'start' => $this->service->startCount($document, $request->integer('category_id') ?: null),
            'receive' => $this->service->receiveTransfer($document, collect($request->input('lines', []))->mapWithKeys(fn ($l) => [(int) $l['id'] => (float) $l['received_quantity']])->all(), $request->input('date'), collect($request->input('lines', []))->filter(fn ($l) => isset($l['serial_numbers']))->mapWithKeys(fn ($l) => [(int) $l['id'] => $l['serial_numbers']])->all()),
            'cancel' => $this->service->cancel($document),
            'void' => $this->service->void($document, (string) $request->validate(['reason' => 'required|string|max:250'])['reason']),
            default => abort(404),
        };

        return response()->json(['data' => $doc]);
    }

    private function allowType(string $type, bool $view = false): void
    {
        abort_unless(isset(self::PERMISSIONS[$type]), 404);
        $view ? $this->allow(self::PERMISSIONS[$type], 'stock.view') : $this->allow(self::PERMISSIONS[$type]);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'date' => ['required', 'date'],
            'warehouse_id' => ['required', 'exists:warehouses,id'],
            'to_warehouse_id' => ['nullable', 'exists:warehouses,id'],
            'reason' => ['nullable', 'string', 'max:30'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'lines' => ['array'],
            'lines.*.id' => ['nullable', 'integer'],
            'lines.*.serial_numbers' => ['nullable', 'array'],
            'lines.*.serial_numbers.*' => ['string', 'max:100', 'distinct'],
            'lines.*.product_id' => ['required', 'exists:products,id'],
            'lines.*.product_unit_id' => ['nullable', 'exists:product_units,id'],
            'lines.*.quantity' => ['nullable', 'numeric', 'min:0'],
            'lines.*.counted_quantity' => ['nullable', 'numeric', 'min:0'],
            'lines.*.system_quantity' => ['nullable', 'numeric'],
            'lines.*.direction' => ['nullable', 'in:in,out'],
            'lines.*.unit_cost' => ['nullable', 'numeric', 'min:0'],
            'lines.*.batch_id' => ['nullable', 'integer'],
            'lines.*.batch_no' => ['nullable', 'string', 'max:60'],
            'lines.*.expiry_date' => ['nullable', 'date'],
            'lines.*.notes' => ['nullable', 'string', 'max:250'],
        ]);
    }
}
