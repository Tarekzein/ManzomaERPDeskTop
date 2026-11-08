<?php

namespace App\Modules\Inventory\Services;

use App\Models\User;
use App\Modules\Core\Services\SettingsService;
use App\Modules\CRM\Models\Task;
use App\Modules\Inventory\Models\Product;
use Illuminate\Support\Facades\DB;

class StockAlertService
{
    public function scan(): int
    {
        $created = 0;
        $candidate = User::query()->where('is_active', true)->find(app(SettingsService::class)->get('inventory.alert_owner_id'));
        $eligible = fn ($user) => $user && $user->can('stock.view');
        $owner = ($eligible($candidate) ? $candidate : User::query()->where('is_active', true)->whereHas('roles', fn ($q) => $q->whereIn('name', ['storekeeper', 'admin']))->orderBy('id')->get()->first($eligible))?->id;
        $checks = Product::query()->where('type', 'stock')->where('is_active', true)->where('reorder_level', '>', 0)->get(['id', 'name', 'reorder_level'])->map(fn ($p) => ['product_id' => $p->id, 'warehouse_id' => 0, 'name' => $p->name, 'level' => (float) $p->reorder_level])->all();
        foreach (DB::table('product_warehouse_settings as s')->join('products as p', 'p.id', '=', 's.product_id')->where('s.reorder_level', '>', 0)->where('p.is_active', true)->whereNull('p.deleted_at')->get(['s.*', 'p.name']) as $row) {
            $checks[] = ['product_id' => $row->product_id, 'warehouse_id' => $row->warehouse_id, 'name' => $row->name, 'level' => (float) $row->reorder_level];
        }
        $enabled = collect($checks)->map(fn ($check) => $check['product_id'].':'.$check['warehouse_id'])->all();
        foreach (DB::table('stock_alerts')->where('active', true)->get() as $alert) {
            if (in_array($alert->product_id.':'.$alert->warehouse_id, $enabled, true)) {
                continue;
            }
            DB::transaction(function () use ($alert) {
                $current = DB::table('stock_alerts')->where('id', $alert->id)->lockForUpdate()->first();
                Task::query()->whereKey($current->task_id)->update(['status' => 'cancelled', 'completed_at' => now()]);
                DB::table('stock_alerts')->where('id', $alert->id)->update(['active' => false, 'updated_at' => now()]);
            });
        }
        foreach ($checks as $check) {
            DB::transaction(function () use ($check, $owner, &$created) {
                $where = ['product_id' => $check['product_id'], 'warehouse_id' => $check['warehouse_id']];
                DB::table('stock_alerts')->insertOrIgnore($where + ['active' => false, 'created_at' => now(), 'updated_at' => now()]);
                $alert = DB::table('stock_alerts')->where($where)->lockForUpdate()->first();
                $balances = DB::table('stock_balances')->where('product_id', $check['product_id']);
                if ($check['warehouse_id']) {
                    $balances->where('warehouse_id', $check['warehouse_id']);
                }
                $low = (float) $balances->sum('quantity') <= $check['level'];
                if ($low && ! $alert->active) {
                    $task = Task::query()->create(['title' => 'مخزون منخفض / Low stock — '.$check['name'], 'notes' => 'Warehouse: '.($check['warehouse_id'] ?: 'all').'; reorder level: '.$check['level'], 'assigned_to' => $owner, 'status' => 'open', 'priority' => 'high', 'due_at' => now(), 'remind_at' => now()]);
                    DB::table('stock_alerts')->where('id', $alert->id)->update(['active' => true, 'task_id' => $task->id, 'updated_at' => now()]);
                    $created++;
                } elseif (! $low && $alert->active) {
                    Task::query()->whereKey($alert->task_id)->update(['status' => 'done', 'completed_at' => now()]);
                    DB::table('stock_alerts')->where('id', $alert->id)->update(['active' => false, 'updated_at' => now()]);
                }
            });
        }

        return $created;
    }
}
