<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', fn (Blueprint $t) => $t->boolean('track_serials')->default(false));
        Schema::table('warehouses', function (Blueprint $t) {
            $t->string('kind', 12)->default('store');
            $t->foreignId('technician_id')->nullable()->constrained('users')->nullOnDelete();
        });
        foreach (['trade_document_lines', 'stock_document_lines'] as $table) {
            Schema::table($table, fn (Blueprint $t) => $t->json('serial_numbers')->nullable());
        }
        Schema::create('product_serials', function (Blueprint $t) {
            $t->id();
            $t->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $t->string('serial_number', 100);
            $t->foreignId('warehouse_id')->nullable()->constrained('warehouses')->restrictOnDelete();
            $t->string('status', 20)->default('available');
            $t->timestamps();
            $t->unique(['product_id', 'serial_number']);
        });
        Schema::create('stock_move_serials', function (Blueprint $t) {
            $t->foreignId('stock_move_id')->constrained('stock_moves')->restrictOnDelete();
            $t->foreignId('serial_id')->constrained('product_serials')->restrictOnDelete();
            $t->primary(['stock_move_id', 'serial_id']);
        });
        Schema::create('product_warehouse_settings', function (Blueprint $t) {
            $t->id();
            $t->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $t->foreignId('warehouse_id')->constrained('warehouses')->cascadeOnDelete();
            $t->decimal('reorder_level', 18, 4)->default(0);
            $t->decimal('reorder_qty', 18, 4)->default(0);
            $t->unique(['product_id', 'warehouse_id']);
        });
        Schema::create('party_addresses', function (Blueprint $t) {
            $t->id();
            $t->foreignId('party_id')->constrained('parties')->restrictOnDelete();
            $t->string('label');
            $t->string('governorate')->nullable();
            $t->string('city')->nullable();
            $t->string('street')->nullable();
            $t->string('building')->nullable();
            $t->string('floor')->nullable();
            $t->string('apartment')->nullable();
            $t->string('landmark')->nullable();
            $t->decimal('latitude', 10, 7)->nullable();
            $t->decimal('longitude', 10, 7)->nullable();
            $t->boolean('is_default')->default(false);
            $t->timestamps();
        });
        Schema::create('maintenance_profiles', function (Blueprint $t) {
            $t->id();
            $t->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $t->string('name');
            $t->unsignedInteger('version')->default(1);
            $t->boolean('active')->default(true);
            $t->timestamps();
            $t->unique(['product_id', 'version']);
        });
        Schema::create('maintenance_profile_stages', function (Blueprint $t) {
            $t->id();
            $t->foreignId('profile_id')->constrained('maintenance_profiles')->cascadeOnDelete();
            $t->string('stage_key', 40);
            $t->string('label_ar');
            $t->string('label_en');
            $t->foreignId('replacement_product_id')->constrained('products')->restrictOnDelete();
            $t->unsignedSmallInteger('interval_count');
            $t->string('interval_unit', 10)->default('months');
            $t->unsignedSmallInteger('sort_order')->default(0);
            $t->timestamps();
            $t->unique(['profile_id', 'stage_key']);
        });
        Schema::create('customer_units', function (Blueprint $t) {
            $t->id();
            $t->foreignId('party_id')->constrained('parties')->restrictOnDelete();
            $t->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $t->foreignId('serial_id')->nullable()->unique()->constrained('product_serials')->restrictOnDelete();
            $t->string('unit_code', 50)->unique();
            $t->foreignId('address_id')->nullable()->constrained('party_addresses')->restrictOnDelete();
            $t->foreignId('invoice_line_id')->nullable()->constrained('trade_document_lines')->restrictOnDelete();
            $t->foreignId('profile_id')->constrained('maintenance_profiles')->restrictOnDelete();
            $t->date('purchased_on')->nullable();
            $t->date('installed_on')->nullable();
            $t->date('warranty_starts_on')->nullable();
            $t->date('warranty_ends_on')->nullable();
            $t->string('status', 20)->default('pending_installation');
            $t->text('notes')->nullable();
            $t->timestamps();
        });
        Schema::create('unit_stage_schedules', function (Blueprint $t) {
            $t->id();
            $t->foreignId('unit_id')->constrained('customer_units')->restrictOnDelete();
            $t->foreignId('profile_stage_id')->constrained('maintenance_profile_stages')->restrictOnDelete();
            $t->string('stage_key', 40);
            $t->string('label_ar');
            $t->string('label_en');
            $t->foreignId('replacement_product_id')->constrained('products')->restrictOnDelete();
            $t->unsignedSmallInteger('interval_count');
            $t->string('interval_unit', 10);
            $t->date('last_replaced_on')->nullable();
            $t->date('next_due_on')->nullable();
            $t->unsignedInteger('cycle_number')->default(1);
            $t->boolean('paused')->default(false);
            $t->timestamps();
            $t->unique(['unit_id', 'stage_key']);
            $t->index(['paused', 'next_due_on']);
        });
        Schema::create('service_requests', function (Blueprint $t) {
            $t->id();
            $t->foreignId('party_id')->constrained('parties')->restrictOnDelete();
            $t->foreignId('unit_id')->nullable()->constrained('customer_units')->restrictOnDelete();
            $t->foreignId('address_id')->nullable()->constrained('party_addresses')->restrictOnDelete();
            $t->string('type', 20)->default('maintenance');
            $t->string('priority', 10)->default('normal');
            $t->text('description');
            $t->string('status', 20)->default('open');
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
        });
        Schema::create('service_visits', function (Blueprint $t) {
            $t->id();
            $t->foreignId('request_id')->constrained('service_requests')->restrictOnDelete();
            $t->foreignId('technician_id')->constrained('users')->restrictOnDelete();
            $t->foreignId('warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $t->dateTime('scheduled_start')->nullable();
            $t->dateTime('scheduled_end')->nullable();
            $t->dateTime('started_at')->nullable();
            $t->dateTime('completed_at')->nullable();
            $t->string('status', 20)->default('draft');
            $t->text('report')->nullable();
            $t->foreignId('signature_attachment_id')->nullable()->constrained('attachments')->restrictOnDelete();
            $t->foreignId('entered_by')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('completed_by')->nullable()->constrained('users')->nullOnDelete();
            $t->unsignedBigInteger('journal_entry_id')->nullable();
            $t->decimal('cost_total', 18, 2)->default(0);
            $t->foreignId('invoice_id')->nullable()->constrained('trade_documents')->restrictOnDelete();
            $t->string('completion_key', 100)->nullable()->unique();
            $t->timestamps();
            $t->index(['technician_id', 'scheduled_start']);
        });
        Schema::create('service_visit_parts', function (Blueprint $t) {
            $t->id();
            $t->foreignId('visit_id')->constrained('service_visits')->restrictOnDelete();
            $t->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $t->foreignId('product_unit_id')->nullable()->constrained('product_units')->restrictOnDelete();
            $t->unsignedBigInteger('batch_id')->default(0);
            $t->decimal('quantity', 18, 4);
            $t->decimal('base_quantity', 18, 4);
            $t->decimal('unit_cost', 18, 4)->default(0);
            $t->decimal('cost_amount', 18, 2)->default(0);
            $t->decimal('unit_price', 18, 4)->default(0);
            $t->string('billing', 12)->default('billable');
            $t->text('free_reason')->nullable();
            $t->json('serial_numbers')->nullable();
            $t->timestamps();
        });
        Schema::create('service_visit_stock_moves', function (Blueprint $t) {
            $t->foreignId('visit_part_id')->constrained('service_visit_parts')->restrictOnDelete();
            $t->foreignId('stock_move_id')->unique()->constrained('stock_moves')->restrictOnDelete();
            $t->primary(['visit_part_id', 'stock_move_id']);
        });
        Schema::create('service_visit_stage_actions', function (Blueprint $t) {
            $t->id();
            $t->foreignId('visit_id')->constrained('service_visits')->restrictOnDelete();
            $t->foreignId('schedule_id')->constrained('unit_stage_schedules')->restrictOnDelete();
            $t->string('action', 15)->default('replace');
            $t->date('replaced_on');
            $t->timestamps();
            $t->unique(['visit_id', 'schedule_id']);
        });
        Schema::create('maintenance_events', function (Blueprint $t) {
            $t->id();
            $t->foreignId('unit_id')->constrained('customer_units')->restrictOnDelete();
            $t->foreignId('schedule_id')->nullable()->constrained('unit_stage_schedules')->restrictOnDelete();
            $t->string('kind', 20);
            $t->date('event_on');
            $t->foreignId('visit_id')->nullable()->constrained('service_visits')->restrictOnDelete();
            $t->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $t->text('notes')->nullable();
            $t->json('changes')->nullable();
            $t->timestamps();
        });
        Schema::create('maintenance_followups', function (Blueprint $t) {
            $t->id();
            $t->foreignId('schedule_id')->constrained('unit_stage_schedules')->restrictOnDelete();
            $t->unsignedInteger('cycle_number');
            $t->date('due_on');
            $t->foreignId('task_id')->nullable()->constrained('crm_tasks')->nullOnDelete();
            $t->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete();
            $t->string('status', 15)->default('open');
            $t->unsignedTinyInteger('escalation')->default(0);
            $t->date('next_contact_on')->nullable();
            $t->timestamps();
            $t->unique(['schedule_id', 'cycle_number']);
            $t->index(['status', 'due_on']);
        });
        Schema::create('message_templates', function (Blueprint $t) {
            $t->id();
            $t->string('key', 60);
            $t->string('locale', 2);
            $t->text('body');
            $t->unsignedInteger('version')->default(1);
            $t->boolean('active')->default(true);
            $t->timestamps();
            $t->unique(['key', 'locale', 'version']);
        });
        Schema::create('followup_contacts', function (Blueprint $t) {
            $t->id();
            $t->foreignId('followup_id')->constrained('maintenance_followups')->restrictOnDelete();
            $t->foreignId('activity_id')->constrained('crm_activities')->restrictOnDelete();
            $t->string('channel', 12);
            $t->string('outcome', 20);
            $t->text('template_snapshot')->nullable();
            $t->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
        });
        Schema::create('trade_line_service_parts', function (Blueprint $t) {
            $t->foreignId('trade_line_id')->unique()->constrained('trade_document_lines')->cascadeOnDelete();
            $t->foreignId('visit_part_id')->constrained('service_visit_parts')->restrictOnDelete();
            $t->decimal('base_quantity', 18, 4);
            $t->decimal('cost_amount', 18, 2);
            $t->primary(['trade_line_id', 'visit_part_id']);
        });
        Schema::create('operation_receipts', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $t->string('operation', 40);
            $t->string('key', 100);
            $t->string('request_hash', 64);
            $t->unsignedBigInteger('resource_id');
            $t->timestamps();
            $t->unique(['user_id', 'operation', 'key']);
        });
    }

    public function down(): void
    {
        foreach (['operation_receipts', 'trade_line_service_parts', 'followup_contacts', 'message_templates', 'maintenance_followups', 'maintenance_events', 'service_visit_stage_actions', 'service_visit_stock_moves', 'service_visit_parts', 'service_visits', 'service_requests', 'unit_stage_schedules', 'customer_units', 'maintenance_profile_stages', 'maintenance_profiles', 'party_addresses', 'product_warehouse_settings', 'stock_move_serials', 'product_serials'] as $table) {
            Schema::dropIfExists($table);
        }
        foreach (['trade_document_lines', 'stock_document_lines'] as $table) {
            Schema::table($table, fn (Blueprint $t) => $t->dropColumn('serial_numbers'));
        }
        Schema::table('products', fn (Blueprint $t) => $t->dropColumn('track_serials'));
        Schema::table('warehouses', function (Blueprint $t) {
            $t->dropConstrainedForeignId('technician_id');
            $t->dropColumn('kind');
        });
    }
};
