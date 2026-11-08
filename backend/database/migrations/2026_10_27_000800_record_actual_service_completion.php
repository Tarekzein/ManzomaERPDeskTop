<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('service_visits', function (Blueprint $table) {
            $table->date('completed_on')->nullable()->index();
            $table->boolean('completion_time_known')->default(false);
        });
        // Older releases stored a synthetic noon timestamp. Preserve it as historical data;
        // do not claim its time of day is an observed event.
        DB::table('service_visits')->whereNotNull('completed_at')->update(['completed_on' => DB::raw('DATE(completed_at)')]);
    }

    public function down(): void
    {
        Schema::table('service_visits', fn (Blueprint $table) => $table->dropColumn(['completed_on', 'completion_time_known']));
    }
};
