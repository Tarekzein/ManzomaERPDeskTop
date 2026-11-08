<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->boolean('uses_spare_parts')->default(false);
        });
        Schema::create('product_spare_parts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $table->foreignId('spare_part_id')->constrained('products')->restrictOnDelete();
            $table->decimal('quantity_per_unit', 18, 4);
            $table->unique(['product_id', 'spare_part_id']);
        });
        Schema::table('trade_document_lines', function (Blueprint $table) {
            $table->decimal('component_cost_amount', 18, 2)->default(0);
        });
        Schema::create('trade_line_components', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trade_document_line_id')->constrained('trade_document_lines')->restrictOnDelete();
            $table->foreignId('source_component_id')->nullable()->constrained('trade_line_components')->restrictOnDelete();
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $table->foreignId('stock_move_id')->unique()->constrained('stock_moves')->restrictOnDelete();
            $table->unsignedBigInteger('batch_id')->default(0);
            $table->string('code', 40);
            $table->string('name', 190);
            $table->string('name_en', 190)->nullable();
            $table->string('unit_name');
            $table->string('unit_name_en')->nullable();
            $table->string('batch_no', 60)->nullable();
            $table->decimal('quantity_per_unit', 18, 4);
            $table->decimal('quantity', 18, 4);
            $table->decimal('unit_cost', 18, 4);
            $table->decimal('cost_amount', 18, 2);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trade_line_components');
        Schema::table('trade_document_lines', fn (Blueprint $table) => $table->dropColumn('component_cost_amount'));
        Schema::dropIfExists('product_spare_parts');
        Schema::table('products', fn (Blueprint $table) => $table->dropColumn('uses_spare_parts'));
    }
};
