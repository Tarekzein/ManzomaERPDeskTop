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
        Schema::connection('control')->create('control_bootstrap', fn (Blueprint $t) => $t->unsignedInteger('id')->primary());
        DB::connection('control')->table('control_bootstrap')->insert(['id' => 1]);
    }

    public function down(): void
    {
        Schema::connection('control')->dropIfExists('control_bootstrap');
    }
};
