<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('custom_field_index', fn (Blueprint $t) => $t->text('full_text_value')->nullable());
        DB::table('custom_field_index')->update(['full_text_value' => DB::raw('text_value')]);
        Schema::create('stock_alerts', function (Blueprint $t) {
            $t->id();
            $t->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $t->unsignedBigInteger('warehouse_id')->default(0);
            $t->boolean('active')->default(false);
            $t->foreignId('task_id')->nullable()->constrained('crm_tasks')->nullOnDelete();
            $t->timestamps();
            $t->unique(['product_id', 'warehouse_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_alerts');
        Schema::table('custom_field_index', fn (Blueprint $t) => $t->dropColumn('full_text_value'));
    }
};
