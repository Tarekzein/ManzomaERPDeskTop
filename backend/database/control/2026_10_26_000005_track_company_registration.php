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
        Schema::connection('control')->table('licensed_companies', function (Blueprint $table) {
            $table->timestamp('registered_at')->nullable()->index();
        });
        DB::connection('control')->table('licensed_companies')->where('mode', 'online')->update(['registered_at' => now()]);
        DB::connection('control')->table('licenses')->where('offline_company_slots', '>', 1)->update(['offline_company_slots' => 1]);
    }

    public function down(): void
    {
        Schema::connection('control')->table('licensed_companies', fn (Blueprint $table) => $table->dropColumn('registered_at'));
    }
};
