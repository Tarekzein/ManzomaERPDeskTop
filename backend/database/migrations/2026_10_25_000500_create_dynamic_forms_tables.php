<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('custom_field_definitions', function (Blueprint $t) {
            $t->id();
            $t->string('entity_type', 60);
            $t->string('key', 60);
            $t->string('type', 20);
            $t->string('label_ar');
            $t->string('label_en');
            $t->boolean('required')->default(false);
            $t->json('default_json')->nullable();
            $t->json('validation_json')->nullable();
            $t->json('options_json')->nullable();
            $t->json('role_access_json')->nullable();
            $t->json('usage_flags_json')->nullable();
            $t->json('applicable_forms_json')->nullable();
            $t->json('condition_json')->nullable();
            $t->boolean('active')->default(true);
            $t->timestamps();
            $t->unique(['entity_type', 'key']);
        });
        Schema::create('form_definitions', function (Blueprint $t) {
            $t->id();
            $t->string('form_key', 100);
            $t->string('entity_type', 60);
            $t->unsignedInteger('version');
            $t->string('status', 12)->default('draft');
            $t->json('layout_json');
            $t->json('fields_json')->nullable();
            $t->foreignId('published_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamp('published_at')->nullable();
            $t->timestamps();
            $t->unique(['form_key', 'version']);
        });
        Schema::create('entity_custom_data', function (Blueprint $t) {
            $t->id();
            $t->string('entity_type', 60);
            $t->unsignedBigInteger('entity_id');
            $t->json('values_json');
            $t->unsignedInteger('form_version')->default(0);
            $t->unsignedInteger('lock_version')->default(0);
            $t->timestamps();
            $t->unique(['entity_type', 'entity_id']);
        });
        Schema::create('custom_field_index', function (Blueprint $t) {
            $t->id();
            $t->foreignId('field_id')->constrained('custom_field_definitions')->cascadeOnDelete();
            $t->unsignedBigInteger('entity_id');
            $t->string('text_value', 190)->nullable();
            $t->decimal('number_value', 24, 6)->nullable();
            $t->date('date_value')->nullable();
            $t->boolean('bool_value')->nullable();
            $t->unique(['field_id', 'entity_id']);
            foreach (['text_value', 'number_value', 'date_value', 'bool_value'] as $column) {
                $t->index(['field_id', $column]);
            }
        });
        Schema::create('custom_field_option_values', function (Blueprint $t) {
            $t->id();
            $t->foreignId('field_id')->constrained('custom_field_definitions')->cascadeOnDelete();
            $t->unsignedBigInteger('entity_id');
            $t->string('option_key', 80);
            $t->unique(['field_id', 'entity_id', 'option_key'], 'custom_option_unique');
            $t->index(['field_id', 'option_key']);
        });
        Schema::create('attachments', function (Blueprint $t) {
            $t->id();
            $t->string('entity_type', 60);
            $t->unsignedBigInteger('entity_id')->nullable();
            $t->foreignId('field_id')->nullable()->constrained('custom_field_definitions')->nullOnDelete();
            $t->string('storage_key');
            $t->string('original_name');
            $t->string('mime', 100);
            $t->unsignedBigInteger('size');
            $t->string('checksum', 64);
            $t->foreignId('uploaded_by')->constrained('users')->restrictOnDelete();
            $t->timestamps();
            $t->index(['entity_type', 'entity_id']);
        });
        Schema::create('document_form_snapshots', function (Blueprint $t) {
            $t->id();
            $t->string('entity_type', 60);
            $t->unsignedBigInteger('entity_id');
            $t->json('snapshot_json');
            $t->timestamps();
            $t->unique(['entity_type', 'entity_id']);
        });
        Schema::create('jobs', function (Blueprint $t) {
            $t->bigIncrements('id');
            $t->string('queue')->index();
            $t->longText('payload');
            $t->unsignedTinyInteger('attempts');
            $t->unsignedInteger('reserved_at')->nullable();
            $t->unsignedInteger('available_at');
            $t->unsignedInteger('created_at');
        });
        Schema::create('failed_jobs', function (Blueprint $t) {
            $t->id();
            $t->string('uuid')->unique();
            $t->text('connection');
            $t->text('queue');
            $t->longText('payload');
            $t->longText('exception');
            $t->timestamp('failed_at')->useCurrent();
        });
        Schema::create('job_batches', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('name');
            $t->integer('total_jobs');
            $t->integer('pending_jobs');
            $t->integer('failed_jobs');
            $t->longText('failed_job_ids');
            $t->mediumText('options')->nullable();
            $t->integer('cancelled_at')->nullable();
            $t->integer('created_at');
            $t->integer('finished_at')->nullable();
        });
    }

    public function down(): void
    {
        foreach (['job_batches', 'failed_jobs', 'jobs', 'document_form_snapshots', 'attachments', 'custom_field_option_values', 'custom_field_index', 'entity_custom_data', 'form_definitions', 'custom_field_definitions'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
