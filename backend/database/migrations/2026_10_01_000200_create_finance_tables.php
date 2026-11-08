<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('parent_id')->nullable()->constrained('accounts')->restrictOnDelete();
            $table->string('code', 30)->unique();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->string('type', 20); // asset, liability, equity, revenue, expense
            $table->boolean('is_group')->default(false);
            // Stable key the posting engine uses (ar, ap, inventory, vat_output…).
            $table->string('system_key', 40)->nullable()->unique();
            $table->boolean('allow_manual')->default(true);
            $table->string('currency', 3)->nullable();
            $table->boolean('is_active')->default(true);
            $table->string('description')->nullable();
            $table->timestamps();
            $table->index('type');
        });

        Schema::create('cost_centers', function (Blueprint $table) {
            $table->id();
            $table->string('code', 30)->unique();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('tax_rates', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->string('type', 20)->default('vat'); // vat, wht
            $table->decimal('rate', 7, 4);
            // ETA tax type / sub-type codes, e.g. T1 / V009.
            $table->string('eta_type', 10)->nullable();
            $table->string('eta_subtype', 10)->nullable();
            $table->boolean('is_default')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('fiscal_years', function (Blueprint $table) {
            $table->id();
            $table->string('name', 40)->unique();
            $table->date('start_date');
            $table->date('end_date');
            $table->string('status', 20)->default('open');
            $table->timestamp('closed_at')->nullable();
            $table->foreignId('closed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedBigInteger('closing_entry_id')->nullable();
            $table->timestamps();
        });

        Schema::create('journal_entries', function (Blueprint $table) {
            $table->id();
            $table->string('number', 40)->unique();
            $table->date('date');
            $table->string('type', 20)->default('manual'); // manual, opening, system, closing, reversal
            $table->string('description');
            $table->string('reference', 80)->nullable();
            $table->string('status', 20)->default('draft'); // draft, posted, reversed
            $table->string('source_type', 40)->nullable();
            $table->unsignedBigInteger('source_id')->nullable();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignId('reversal_of_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->unsignedBigInteger('reversed_by_id')->nullable();
            $table->decimal('total', 18, 2)->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('posted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->timestamps();
            $table->index(['date', 'status']);
            $table->index(['source_type', 'source_id']);
        });

        Schema::create('journal_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('journal_entry_id')->constrained('journal_entries')->cascadeOnDelete();
            $table->unsignedSmallInteger('line_no')->default(1);
            $table->foreignId('account_id')->constrained('accounts')->restrictOnDelete();
            $table->unsignedBigInteger('party_id')->nullable();
            $table->foreignId('cost_center_id')->nullable()->constrained('cost_centers')->nullOnDelete();
            $table->string('description')->nullable();
            $table->decimal('debit', 18, 2)->default(0);
            $table->decimal('credit', 18, 2)->default(0);
            $table->string('currency', 3)->nullable();
            $table->decimal('fx_rate', 18, 8)->default(1);
            $table->decimal('fx_amount', 18, 2)->nullable();
            $table->timestamps();
            $table->index('account_id');
            $table->index('party_id');
        });

        // Cash boxes (خزائن) and bank accounts, each backed by a GL account.
        Schema::create('cash_accounts', function (Blueprint $table) {
            $table->id();
            $table->string('type', 10); // cash, bank
            $table->string('code', 20)->unique();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignId('account_id')->constrained('accounts')->restrictOnDelete();
            $table->string('currency', 3)->default('EGP');
            $table->string('bank_name')->nullable();
            $table->string('account_number')->nullable();
            $table->string('iban')->nullable();
            $table->foreignId('custodian_id')->nullable()->constrained('users')->nullOnDelete();
            $table->boolean('allow_negative')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        foreach (['cash_accounts', 'journal_lines', 'journal_entries', 'fiscal_years', 'tax_rates', 'cost_centers', 'accounts'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
