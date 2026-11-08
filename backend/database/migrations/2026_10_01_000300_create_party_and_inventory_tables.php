<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('price_lists', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // One master for customers and suppliers. A trader is often both.
        Schema::create('parties', function (Blueprint $table) {
            $table->id();
            $table->string('code', 30)->unique();
            $table->boolean('is_customer')->default(false);
            $table->boolean('is_supplier')->default(false);
            $table->string('kind', 20)->default('company'); // company, individual
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->string('tax_number', 40)->nullable();
            $table->string('commercial_register', 40)->nullable();
            $table->string('national_id', 20)->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('mobile', 40)->nullable();
            $table->string('email')->nullable();
            $table->string('city')->nullable();
            $table->string('address')->nullable();
            $table->unsignedSmallInteger('payment_terms_days')->default(0);
            // Null means no limit.
            $table->decimal('credit_limit', 18, 2)->nullable();
            $table->foreignId('price_list_id')->nullable()->constrained('price_lists')->nullOnDelete();
            $table->foreignId('salesperson_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            // Egyptian withholding tax (خصم وإضافة).
            $table->boolean('subject_to_wht')->default(false);
            $table->decimal('wht_rate', 5, 2)->default(1);
            $table->string('currency', 3)->default('EGP');
            $table->text('notes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();
            $table->index('name');
            $table->index(['is_customer', 'is_active']);
            $table->index(['is_supplier', 'is_active']);
        });

        Schema::create('party_contacts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('party_id')->constrained('parties')->cascadeOnDelete();
            $table->string('name');
            $table->string('position')->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('email')->nullable();
            $table->timestamps();
        });

        Schema::create('categories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('parent_id')->nullable()->constrained('categories')->nullOnDelete();
            $table->string('code', 30)->unique();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->timestamps();
        });

        Schema::create('brands', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->timestamps();
        });

        // Catalogue of unit names: piece, box, carton, kg…
        Schema::create('units', function (Blueprint $table) {
            $table->id();
            $table->string('name', 40);
            $table->string('name_en', 40)->nullable();
            $table->boolean('allow_fraction')->default(false);
            $table->timestamps();
        });

        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->string('code', 40)->unique();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->string('type', 20)->default('stock'); // stock, service
            $table->foreignId('category_id')->nullable()->constrained('categories')->nullOnDelete();
            $table->foreignId('brand_id')->nullable()->constrained('brands')->nullOnDelete();
            $table->foreignId('base_unit_id')->constrained('units')->restrictOnDelete();
            $table->foreignId('tax_rate_id')->nullable()->constrained('tax_rates')->nullOnDelete();
            $table->text('description')->nullable();
            $table->boolean('track_batches')->default(false);
            // Prices per base unit; unit rows may override.
            $table->decimal('sale_price', 18, 4)->default(0);
            $table->decimal('min_sale_price', 18, 4)->default(0);
            $table->decimal('purchase_price', 18, 4)->default(0);
            // Moving average (or last FIFO) cost per base unit.
            $table->decimal('avg_cost', 18, 4)->default(0);
            $table->decimal('reorder_level', 18, 4)->default(0);
            $table->decimal('reorder_qty', 18, 4)->default(0);
            // ETA item coding.
            $table->string('eta_code_type', 10)->nullable(); // GS1, EGS
            $table->string('eta_item_code', 60)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();
            $table->index('name');
        });

        Schema::create('product_units', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignId('unit_id')->constrained('units')->restrictOnDelete();
            $table->decimal('factor', 18, 4)->default(1); // base units per this unit
            $table->string('barcode', 64)->nullable()->unique();
            $table->decimal('sale_price', 18, 4)->nullable();
            $table->decimal('purchase_price', 18, 4)->nullable();
            $table->boolean('is_default_sale')->default(false);
            $table->boolean('is_default_purchase')->default(false);
            $table->timestamps();
            $table->unique(['product_id', 'unit_id']);
        });

        Schema::create('price_list_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('price_list_id')->constrained('price_lists')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignId('product_unit_id')->constrained('product_units')->cascadeOnDelete();
            $table->decimal('price', 18, 4);
            $table->timestamps();
            $table->unique(['price_list_id', 'product_unit_id']);
        });

        Schema::create('warehouses', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignId('keeper_id')->nullable()->constrained('users')->nullOnDelete();
            // Stock between two branches during a two-step transfer.
            $table->boolean('is_transit')->default(false);
            $table->string('address')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('batch_no', 60);
            $table->date('mfg_date')->nullable();
            $table->date('expiry_date')->nullable();
            $table->timestamps();
            $table->unique(['product_id', 'batch_no']);
            $table->index('expiry_date');
        });

        // batch_id 0 means "no batch" so the unique key works on every engine.
        Schema::create('stock_balances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignId('warehouse_id')->constrained('warehouses')->cascadeOnDelete();
            $table->unsignedBigInteger('batch_id')->default(0);
            $table->decimal('quantity', 18, 4)->default(0);
            $table->timestamps();
            $table->unique(['product_id', 'warehouse_id', 'batch_id']);
            $table->index('warehouse_id');
        });

        // Immutable stock ledger: the item card and valuation read from here.
        Schema::create('stock_moves', function (Blueprint $table) {
            $table->id();
            $table->date('date');
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $table->foreignId('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->unsignedBigInteger('batch_id')->default(0);
            $table->decimal('quantity', 18, 4); // signed, base units
            $table->decimal('unit_cost', 18, 4)->default(0);
            $table->decimal('total_cost', 18, 4)->default(0); // signed
            $table->string('source_type', 40);
            $table->unsignedBigInteger('source_id');
            $table->unsignedBigInteger('source_line_id')->nullable();
            $table->string('reference', 60)->nullable();
            $table->unsignedBigInteger('party_id')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['product_id', 'date']);
            $table->index(['warehouse_id', 'date']);
            $table->index(['source_type', 'source_id']);
        });

        // FIFO cost layers (used only when the company costs by FIFO).
        Schema::create('cost_layers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->unsignedBigInteger('stock_move_id')->nullable();
            $table->date('date');
            $table->decimal('original_quantity', 18, 4);
            $table->decimal('remaining_quantity', 18, 4);
            $table->decimal('unit_cost', 18, 4);
            $table->timestamps();
            $table->index(['product_id', 'remaining_quantity']);
        });

        // Adjustments, transfers, counts and opening stock.
        Schema::create('stock_documents', function (Blueprint $table) {
            $table->id();
            $table->string('type', 20); // adjustment, transfer, count, opening
            $table->string('number', 40)->unique();
            $table->date('date');
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignId('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->foreignId('to_warehouse_id')->nullable()->constrained('warehouses')->restrictOnDelete();
            $table->string('status', 20)->default('draft'); // draft, in_progress, posted, in_transit, received, cancelled
            $table->string('reason', 30)->nullable();
            $table->text('notes')->nullable();
            $table->decimal('total_cost', 18, 2)->default(0);
            $table->unsignedBigInteger('journal_entry_id')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('posted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->foreignId('received_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('received_at')->nullable();
            $table->timestamps();
            $table->index(['type', 'status']);
        });

        Schema::create('stock_document_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stock_document_id')->constrained('stock_documents')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $table->foreignId('product_unit_id')->nullable()->constrained('product_units')->nullOnDelete();
            $table->decimal('factor', 18, 4)->default(1);
            $table->unsignedBigInteger('batch_id')->default(0);
            $table->string('batch_no', 60)->nullable();
            $table->date('expiry_date')->nullable();
            $table->string('direction', 3)->default('in'); // in, out (adjustments)
            $table->decimal('quantity', 18, 4)->default(0);
            $table->decimal('system_quantity', 18, 4)->nullable(); // counts
            $table->decimal('counted_quantity', 18, 4)->nullable(); // counts
            $table->decimal('received_quantity', 18, 4)->nullable(); // transfers
            $table->decimal('unit_cost', 18, 4)->default(0);
            $table->decimal('total_cost', 18, 2)->default(0);
            $table->string('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        foreach (['stock_document_lines', 'stock_documents', 'cost_layers', 'stock_moves', 'stock_balances', 'batches', 'warehouses', 'price_list_items', 'product_units', 'products', 'units', 'brands', 'categories', 'party_contacts', 'parties', 'price_lists'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
