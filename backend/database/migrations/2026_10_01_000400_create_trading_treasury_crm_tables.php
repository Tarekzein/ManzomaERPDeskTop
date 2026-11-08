<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Sales and purchasing documents share one shape:
        // sales_quotation, sales_order, sales_invoice, sales_return,
        // purchase_order, purchase_receipt, purchase_invoice, purchase_return.
        Schema::create('trade_documents', function (Blueprint $table) {
            $table->id();
            $table->string('type', 30);
            $table->string('number', 40);
            $table->date('date');
            $table->date('due_date')->nullable();
            $table->date('valid_until')->nullable();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignId('warehouse_id')->nullable()->constrained('warehouses')->nullOnDelete();
            $table->foreignId('party_id')->constrained('parties')->restrictOnDelete();
            $table->foreignId('salesperson_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('price_list_id')->nullable()->constrained('price_lists')->nullOnDelete();
            $table->foreignId('source_id')->nullable()->constrained('trade_documents')->nullOnDelete();
            $table->unsignedBigInteger('opportunity_id')->nullable();
            $table->string('reference', 80)->nullable(); // customer PO / supplier invoice no.
            $table->string('currency', 3)->default('EGP');
            $table->decimal('exchange_rate', 18, 8)->default(1);
            $table->boolean('price_includes_tax')->default(false);
            $table->string('status', 30)->default('draft');
            $table->decimal('invoice_discount_percent', 7, 4)->default(0);
            $table->decimal('invoice_discount_amount', 18, 2)->default(0);
            $table->decimal('gross_total', 18, 2)->default(0);    // qty × price, ex-tax
            $table->decimal('discount_total', 18, 2)->default(0); // line + invoice discounts, ex-tax
            $table->decimal('net_total', 18, 2)->default(0);      // taxable amount
            $table->decimal('tax_total', 18, 2)->default(0);
            $table->decimal('total', 18, 2)->default(0);          // net + tax
            $table->decimal('wht_rate', 5, 2)->default(0);
            $table->decimal('wht_amount', 18, 2)->default(0);
            $table->decimal('balance_due', 18, 2)->default(0);    // total − WHT
            $table->decimal('paid_amount', 18, 2)->default(0);    // vouchers, cheques and returns applied
            $table->decimal('cost_total', 18, 2)->default(0);     // COGS for sales
            $table->unsignedBigInteger('journal_entry_id')->nullable();
            $table->text('notes')->nullable();
            $table->text('terms')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('posted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->foreignId('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('voided_at')->nullable();
            $table->string('void_reason')->nullable();
            $table->timestamps();
            $table->unique(['type', 'number']);
            $table->index(['type', 'status', 'date']);
            $table->index(['party_id', 'type']);
        });

        Schema::create('trade_document_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trade_document_id')->constrained('trade_documents')->cascadeOnDelete();
            $table->unsignedSmallInteger('line_no')->default(1);
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $table->foreignId('product_unit_id')->nullable()->constrained('product_units')->nullOnDelete();
            $table->decimal('factor', 18, 4)->default(1);
            $table->string('description')->nullable();
            $table->decimal('quantity', 18, 4);
            $table->decimal('base_quantity', 18, 4);
            $table->decimal('unit_price', 18, 4)->default(0);
            $table->decimal('discount_percent', 7, 4)->default(0);
            $table->decimal('discount_amount', 18, 2)->default(0); // line discount as entered
            $table->foreignId('tax_rate_id')->nullable()->constrained('tax_rates')->nullOnDelete();
            $table->decimal('tax_rate', 7, 4)->default(0);
            $table->decimal('gross_amount', 18, 2)->default(0);
            $table->decimal('total_discount', 18, 2)->default(0); // line + allocated invoice discount, ex-tax
            $table->decimal('net_amount', 18, 2)->default(0);
            $table->decimal('tax_amount', 18, 2)->default(0);
            $table->decimal('line_total', 18, 2)->default(0);
            $table->decimal('unit_cost', 18, 4)->default(0); // per base unit at posting
            $table->decimal('cost_amount', 18, 2)->default(0);
            $table->unsignedBigInteger('batch_id')->default(0);
            $table->string('batch_no', 60)->nullable();
            $table->date('expiry_date')->nullable();
            $table->foreignId('source_line_id')->nullable()->constrained('trade_document_lines')->nullOnDelete();
            // Quantity already carried forward (ordered→invoiced, invoiced→returned, received→billed).
            $table->decimal('processed_quantity', 18, 4)->default(0);
            $table->timestamps();
            $table->index('product_id');
        });

        Schema::create('cheques', function (Blueprint $table) {
            $table->id();
            $table->string('direction', 10); // received, issued
            $table->string('number', 40);
            $table->string('bank_name')->nullable();
            $table->date('issue_date')->nullable();
            $table->date('due_date');
            $table->decimal('amount', 18, 2);
            $table->foreignId('party_id')->nullable()->constrained('parties')->nullOnDelete();
            $table->string('drawer_name')->nullable();
            // received: in_portfolio, deposited, collected, bounced, returned
            // issued:   issued, cleared, cancelled
            $table->string('status', 20);
            $table->foreignId('cash_account_id')->nullable()->constrained('cash_accounts')->nullOnDelete();
            $table->unsignedBigInteger('voucher_id')->nullable();
            $table->string('notes')->nullable();
            $table->timestamps();
            $table->index(['direction', 'status', 'due_date']);
        });

        Schema::create('cheque_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('cheque_id')->constrained('cheques')->cascadeOnDelete();
            $table->string('event', 20);
            $table->date('date');
            $table->foreignId('cash_account_id')->nullable()->constrained('cash_accounts')->nullOnDelete();
            $table->unsignedBigInteger('journal_entry_id')->nullable();
            $table->string('note')->nullable();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        // Receipt (سند قبض), payment (سند صرف) and transfer vouchers.
        Schema::create('vouchers', function (Blueprint $table) {
            $table->id();
            $table->string('type', 10); // receipt, payment, transfer
            $table->string('number', 40);
            $table->date('date');
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignId('cash_account_id')->nullable()->constrained('cash_accounts')->restrictOnDelete();
            $table->foreignId('to_cash_account_id')->nullable()->constrained('cash_accounts')->restrictOnDelete();
            $table->foreignId('party_id')->nullable()->constrained('parties')->restrictOnDelete();
            $table->foreignId('account_id')->nullable()->constrained('accounts')->restrictOnDelete();
            $table->foreignId('cost_center_id')->nullable()->constrained('cost_centers')->nullOnDelete();
            $table->decimal('amount', 18, 2);
            $table->foreignId('tax_rate_id')->nullable()->constrained('tax_rates')->nullOnDelete();
            $table->decimal('tax_amount', 18, 2)->default(0);
            $table->string('method', 20)->default('cash'); // cash, cheque, bank_transfer, card, wallet
            $table->foreignId('cheque_id')->nullable()->constrained('cheques')->nullOnDelete();
            $table->string('payee')->nullable();
            $table->string('reference', 80)->nullable();
            $table->string('description')->nullable();
            $table->string('status', 20)->default('draft'); // draft, posted, void
            $table->unsignedBigInteger('journal_entry_id')->nullable();
            $table->foreignId('source_document_id')->nullable()->constrained('trade_documents')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('posted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->foreignId('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('voided_at')->nullable();
            $table->string('void_reason')->nullable();
            $table->timestamps();
            $table->unique(['type', 'number']);
            $table->index(['type', 'status', 'date']);
        });

        // Settlement of an invoice by a voucher, a cheque voucher or a return.
        Schema::create('allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('document_id')->constrained('trade_documents')->cascadeOnDelete();
            $table->foreignId('voucher_id')->nullable()->constrained('vouchers')->cascadeOnDelete();
            $table->foreignId('return_id')->nullable()->constrained('trade_documents')->cascadeOnDelete();
            $table->decimal('amount', 18, 2);
            $table->date('date');
            $table->timestamps();
            $table->index('document_id');
        });

        Schema::create('crm_stages', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->unsignedTinyInteger('probability')->default(0);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->boolean('is_won')->default(false);
            $table->boolean('is_lost')->default(false);
            $table->string('color', 20)->nullable();
            $table->timestamps();
        });

        Schema::create('crm_sources', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->timestamps();
        });

        Schema::create('crm_lost_reasons', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->timestamps();
        });

        Schema::create('crm_leads', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('company_name')->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('mobile', 40)->nullable();
            $table->string('email')->nullable();
            $table->string('city')->nullable();
            $table->string('address')->nullable();
            $table->foreignId('source_id')->nullable()->constrained('crm_sources')->nullOnDelete();
            $table->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status', 20)->default('new'); // new, contacted, qualified, unqualified, converted
            $table->unsignedTinyInteger('score')->default(0);
            $table->decimal('expected_value', 18, 2)->default(0);
            $table->foreignId('party_id')->nullable()->constrained('parties')->nullOnDelete();
            $table->timestamp('converted_at')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->index(['status', 'owner_id']);
        });

        Schema::create('crm_opportunities', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->foreignId('lead_id')->nullable()->constrained('crm_leads')->nullOnDelete();
            $table->foreignId('party_id')->nullable()->constrained('parties')->nullOnDelete();
            $table->foreignId('stage_id')->constrained('crm_stages')->restrictOnDelete();
            $table->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('source_id')->nullable()->constrained('crm_sources')->nullOnDelete();
            $table->decimal('value', 18, 2)->default(0);
            $table->unsignedTinyInteger('probability')->default(0);
            $table->date('expected_close_date')->nullable();
            $table->string('status', 10)->default('open'); // open, won, lost
            $table->foreignId('lost_reason_id')->nullable()->constrained('crm_lost_reasons')->nullOnDelete();
            $table->string('lost_note')->nullable();
            $table->timestamp('won_at')->nullable();
            $table->timestamp('lost_at')->nullable();
            $table->foreignId('quotation_id')->nullable()->constrained('trade_documents')->nullOnDelete();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->index(['status', 'stage_id']);
        });

        Schema::create('crm_activities', function (Blueprint $table) {
            $table->id();
            $table->string('type', 20); // call, meeting, visit, whatsapp, email, note
            $table->string('subject');
            $table->text('body')->nullable();
            $table->string('outcome', 30)->nullable();
            $table->foreignId('lead_id')->nullable()->constrained('crm_leads')->cascadeOnDelete();
            $table->foreignId('party_id')->nullable()->constrained('parties')->cascadeOnDelete();
            $table->foreignId('opportunity_id')->nullable()->constrained('crm_opportunities')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('occurred_at');
            $table->unsignedSmallInteger('duration_minutes')->nullable();
            $table->timestamps();
            $table->index('occurred_at');
        });

        Schema::create('crm_tasks', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->text('notes')->nullable();
            $table->timestamp('due_at')->nullable();
            $table->timestamp('remind_at')->nullable();
            $table->string('priority', 10)->default('normal'); // low, normal, high
            $table->string('status', 12)->default('open'); // open, done, cancelled
            $table->foreignId('lead_id')->nullable()->constrained('crm_leads')->cascadeOnDelete();
            $table->foreignId('party_id')->nullable()->constrained('parties')->cascadeOnDelete();
            $table->foreignId('opportunity_id')->nullable()->constrained('crm_opportunities')->cascadeOnDelete();
            $table->foreignId('assigned_to')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->index(['assigned_to', 'status', 'due_at']);
        });
    }

    public function down(): void
    {
        foreach (['crm_tasks', 'crm_activities', 'crm_opportunities', 'crm_leads', 'crm_lost_reasons', 'crm_sources', 'crm_stages', 'allocations', 'vouchers', 'cheque_events', 'cheques', 'trade_document_lines', 'trade_documents'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
