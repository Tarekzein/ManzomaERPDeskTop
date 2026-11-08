<?php

namespace App\Modules\Core\Console;

use App\Modules\Core\Models\CustomField;
use App\Modules\Core\Services\DynamicFormService;
use App\Modules\Core\Services\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class RebuildCustomFieldsCommand extends Command
{
    protected $signature = 'erp:custom-fields-rebuild {--company=}';

    protected $description = 'Rebuild searchable custom-field projections from canonical company data';

    public function handle(TenantContext $tenants, DynamicFormService $forms): int
    {
        $tenants->select($this->option('company'));
        $fields = CustomField::query()->where('active', true)->get()->groupBy('entity_type');
        DB::table('entity_custom_data')->orderBy('id')->chunkById(200, function ($rows) use ($fields, $forms) {
            foreach ($rows as $row) {
                DB::transaction(function () use ($row, $fields, $forms) {
                    $current = DB::table('entity_custom_data')->where('id', $row->id)->lockForUpdate()->first();
                    $forms->project(($fields[$row->entity_type] ?? collect())->toArray(), $row->entity_id, json_decode($current->values_json, true));
                });
            }
        });
        $this->info('Custom-field projections rebuilt.');

        return self::SUCCESS;
    }
}
