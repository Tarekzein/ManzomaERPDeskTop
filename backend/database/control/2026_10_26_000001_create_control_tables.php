<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    protected $connection = 'control';

    public function up(): void
    {
        $s = Schema::connection('control');
        $s->create('control_admins', function (Blueprint $t) {
            $t->id();
            $t->string('name');
            $t->string('email')->unique();
            $t->string('password');
            $t->boolean('active')->default(true);
            $t->rememberToken();
            $t->timestamps();
        });
        $s->create('licenses', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->string('customer_name');
            $t->string('email')->nullable();
            $t->string('mode');
            $t->string('status')->default('active');
            $t->unsignedInteger('max_companies');
            $t->unsignedInteger('max_devices');
            $t->timestamp('expires_at');
            $t->text('activation_secret');
            $t->string('activation_hash', 64);
            $t->unsignedInteger('revision')->default(1);
            $t->text('notes')->nullable();
            $t->timestamps();
        });
        $s->create('licensed_devices', function (Blueprint $t) {
            $t->string('id', 64)->primary();
            $t->foreignUuid('license_id')->constrained('licenses');
            $t->string('name');
            $t->text('public_key');
            $t->string('machine_hash', 64);
            $t->string('status')->default('active');
            $t->string('platform', 40)->nullable();
            $t->string('app_version', 40)->nullable();
            $t->string('last_ip', 45)->nullable();
            $t->timestamp('last_seen_at')->nullable()->index();
            $t->timestamp('offline_reserved_until')->nullable();
            $t->timestamps();
        });
        $s->create('licensed_companies', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignUuid('license_id')->constrained('licenses');
            $t->string('device_id', 64)->nullable();
            $t->foreign('device_id')->references('id')->on('licensed_devices');
            $t->string('mode');
            $t->string('company_key', 80);
            $t->string('name');
            $t->timestamp('reserved_until')->nullable();
            $t->timestamps();
            $t->unique(['mode', 'company_key']);
        });
        $s->create('license_events', function (Blueprint $t) {
            $t->id();
            $t->uuid('license_id')->nullable()->index();
            $t->unsignedBigInteger('actor_id')->nullable();
            $t->string('event');
            $t->json('details');
            $t->timestamp('created_at');
        });
        $s->create('device_nonces', function (Blueprint $t) {
            $t->string('device_id', 64);
            $t->foreign('device_id')->references('id')->on('licensed_devices');
            $t->string('nonce', 64);
            $t->timestamp('expires_at')->index();
            $t->unique(['device_id', 'nonce']);
        });
    }

    public function down(): void
    {
        foreach (['device_nonces', 'license_events', 'licensed_companies', 'licensed_devices', 'licenses', 'control_admins'] as $table) {
            Schema::connection('control')->dropIfExists($table);
        }
    }
};
