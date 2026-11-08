<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    protected $connection = 'control';

    public function up(): void
    {
        Schema::connection('control')->create('company_registrations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('license_id')->constrained('licenses');
            $table->string('device_id', 64);
            $table->foreign('device_id')->references('id')->on('licensed_devices');
            $table->string('slug', 40)->unique();
            $table->string('name', 120);
            $table->string('input_hash', 64);
            $table->string('status')->default('installing');
            $table->timestamp('lease_until')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::connection('control')->dropIfExists('company_registrations');
    }
};
