<?php

namespace App\Modules\Core\Http\Controllers;

use App\Modules\Core\Models\Attachment;
use App\Modules\Core\Models\CustomField;
use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Core\Services\FormRegistry;
use App\Support\ApiController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class AttachmentController extends ApiController
{
    private function diskPath(): string
    {
        return 'companies/'.hash('sha256', DB::connection()->getDatabaseName()).'/attachments';
    }

    public function store(Request $request, FormRegistry $registry)
    {
        $data = $request->validate(['form_key' => 'required|string', 'entity_id' => 'nullable|integer', 'field_key' => 'nullable|string|max:60', 'file' => 'required|file|max:10240|mimes:jpg,jpeg,png,webp,pdf,csv,txt']);
        $form = $registry->get($data['form_key']);
        $record = ! empty($data['entity_id']) && $form['entity_type'] !== 'settings' ? $form['model']::query()->findOrFail($data['entity_id']) : null;
        if ($form['entity_type'] === 'settings' && isset($data['entity_id'])) {
            abort_unless((int) $data['entity_id'] === 1, 422);
        }
        $registry->authorize($data['form_key'], 'manage', $record);
        if ($record && in_array($record->status, ['posted', 'completed', 'reversed', 'cancelled', 'void'], true)) {
            abort(422, 'Issued records cannot accept new attachments.');
        }
        $fieldId = null;
        if (! empty($data['field_key'])) {
            $forms = app(DynamicFormService::class);
            $field = collect($forms->fields($data['form_key']))->firstWhere('key', $data['field_key']);
            abort_unless($field && in_array($field['type'], ['file', 'image'], true) && $forms->canField($field, 'read') && $forms->canField($field, 'write'), 403);
            $fieldId = $field['id'];
        } else {
            abort_unless($form['entity_type'] === 'service_visits', 422, 'The target field is required.');
        }
        $file = $request->file('file');
        $attachment = Attachment::query()->create(['entity_type' => $form['entity_type'], 'entity_id' => $form['entity_type'] === 'settings' ? ($data['entity_id'] ?? null) : $record?->id,
            'field_id' => $fieldId, 'storage_key' => $file->store($this->diskPath(), 'local'), 'original_name' => basename($file->getClientOriginalName()),
            'mime' => $file->getMimeType(), 'size' => $file->getSize(), 'checksum' => hash_file('sha256', $file->getRealPath()), 'uploaded_by' => $this->user()->id]);

        return response()->json(['data' => $attachment], 201);
    }

    public function show(Attachment $attachment, FormRegistry $registry, DynamicFormService $forms)
    {
        if (! $attachment->entity_id) {
            abort_unless($attachment->uploaded_by === $this->user()->id, 403);
        } else {
            $entry = collect($registry->all())->first(fn ($v) => $v[0] === $attachment->entity_type);
            abort_unless($entry, 404);
            $record = $attachment->entity_type === 'settings' ? null : $entry[1]::query()->findOrFail($attachment->entity_id);
            $registry->authorize($record ? $registry->forModel($record) : 'company-settings', 'view', $record);
            if ($attachment->field_id) {
                $field = CustomField::query()->findOrFail($attachment->field_id);
                abort_unless($forms->canField($field->toArray(), 'read'), 403);
            }
        }
        abort_unless(str_starts_with($attachment->getRawOriginal('storage_key'), $this->diskPath().'/'), 404);

        return Storage::disk('local')->download($attachment->getRawOriginal('storage_key'), $attachment->original_name, ['X-Content-Type-Options' => 'nosniff']);
    }

    public function destroy(Attachment $attachment)
    {
        abort_unless($attachment->uploaded_by === $this->user()->id && ! $attachment->entity_id, 403, 'Linked evidence cannot be deleted.');
        Storage::disk('local')->delete($attachment->getRawOriginal('storage_key'));
        $attachment->delete();

        return ['ok' => true];
    }
}
