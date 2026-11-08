<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_visit_corrections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('visit_id')->constrained('service_visits')->restrictOnDelete();
            $table->string('request_key', 100);
            $table->string('input_hash', 64);
            $table->string('kind', 30);
            $table->date('effective_on');
            $table->text('reason');
            $table->foreignId('actor_id')->constrained('users')->restrictOnDelete();
            $table->json('details');
            $table->timestamps();
            $table->unique(['visit_id', 'request_key']);
        });
        Schema::create('unit_import_receipts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('unit_id')->unique()->constrained('customer_units')->restrictOnDelete();
            $table->string('input_hash', 64);
            $table->json('source_data');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('unit_import_receipts');
        Schema::dropIfExists('service_visit_corrections');
    }
};
