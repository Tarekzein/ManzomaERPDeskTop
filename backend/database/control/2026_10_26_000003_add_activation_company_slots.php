<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    protected $connection = 'control';

    public function up(): void
    {
        Schema::connection('control')->table('licenses', function (Blueprint $table) {
            $table->unsignedInteger('offline_company_slots')->default(1);
        });
    }

    public function down(): void
    {
        Schema::connection('control')->table('licenses', fn (Blueprint $table) => $table->dropColumn('offline_company_slots'));
    }
};
