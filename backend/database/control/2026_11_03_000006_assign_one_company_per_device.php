<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    protected $connection = 'control';

    public function up(): void
    {
        Schema::connection('control')->table('licensed_devices', function (Blueprint $t) {
            $t->foreignUuid('company_id')->nullable()->constrained('licensed_companies')->nullOnDelete();
        });
        // Migrate only unambiguous legacy ownership. Never choose one of several companies silently.
        $db = DB::connection('control');
        foreach ($db->table('licensed_devices')->get(['id']) as $device) {
            $owned = $db->table('licensed_companies')->where('device_id', $device->id)->pluck('id');
            if ($owned->count() === 1) {
                $db->table('licensed_devices')->where('id', $device->id)->update(['company_id' => $owned->first()]);
            }
        }
    }

    public function down(): void
    {
        Schema::connection('control')->table('licensed_devices', fn (Blueprint $t) => $t->dropConstrainedForeignId('company_id'));
    }
};
