<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('branches', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->string('phone')->nullable();
            $table->string('address')->nullable();
            // ETA e-invoice branch identifier (0 for the head office).
            $table->string('eta_branch_code', 20)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('username', 60)->unique();
            $table->string('email')->nullable()->unique();
            $table->string('phone')->nullable();
            $table->string('password');
            $table->string('locale', 5)->default('ar');
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            // Warehouse and cash account are plain ids here; their tables are
            // created later and the relation is enforced in the service layer.
            $table->unsignedBigInteger('default_warehouse_id')->nullable();
            $table->unsignedBigInteger('default_cash_account_id')->nullable();
            // Null means no personal limit (the permission still applies).
            $table->decimal('max_discount_percent', 5, 2)->nullable();
            $table->boolean('is_salesperson')->default(false);
            $table->decimal('commission_rate', 5, 2)->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamp('last_login_at')->nullable();
            $table->rememberToken();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
        Schema::dropIfExists('branches');
    }
};
