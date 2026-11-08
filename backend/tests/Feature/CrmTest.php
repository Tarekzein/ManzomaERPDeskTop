<?php

namespace Tests\Feature;

use App\Modules\CRM\Models\Lead;
use App\Modules\CRM\Models\LostReason;
use App\Modules\CRM\Models\Opportunity;
use App\Modules\CRM\Models\Stage;
use App\Modules\CRM\Services\CrmService;
use App\Modules\Trading\Services\TradingService;
use App\Support\BusinessException;
use Tests\TestCase;

class CrmTest extends TestCase
{
    public function test_lead_converts_to_customer_and_brings_its_deals(): void
    {
        $lead = Lead::query()->create(['name' => 'محمد', 'company_name' => 'شركة الريان', 'mobile' => '0100', 'owner_id' => $this->admin->id]);
        $deal = Opportunity::query()->create(['title' => 'صفقة', 'lead_id' => $lead->id, 'stage_id' => Stage::query()->value('id'), 'value' => 1000]);
        $lead = app(CrmService::class)->convertLead($lead);
        $this->assertSame('converted', $lead->status);
        $this->assertTrue($lead->party->is_customer);
        $this->assertSame('شركة الريان', $lead->party->name);
        $this->assertEquals($lead->party_id, $deal->refresh()->party_id);
        $this->assertSame('محمد', $lead->party->contacts->first()->name);
    }

    public function test_lost_needs_a_reason_and_won_closes_the_deal(): void
    {
        $customer = $this->customer();
        $deal = Opportunity::query()->create(['title' => 'صفقة', 'party_id' => $customer->id, 'stage_id' => Stage::query()->orderBy('sort_order')->value('id'), 'value' => 5000]);
        $lost = Stage::query()->where('is_lost', true)->first();
        try {
            app(CrmService::class)->moveOpportunity($deal, $lost->id);
            $this->fail('Reason required');
        } catch (BusinessException $e) {
            $this->assertSame('lost_reason_required', $e->errorCode);
        }
        $deal = app(CrmService::class)->moveOpportunity($deal, $lost->id, ['lost_reason_id' => LostReason::query()->value('id')]);
        $this->assertSame('lost', $deal->status);
        $deal = app(CrmService::class)->moveOpportunity($deal, Stage::query()->where('is_won', true)->value('id'));
        $this->assertSame('won', $deal->status);
        $this->assertNull($deal->lost_reason_id);
    }

    public function test_quotation_from_a_lead_deal_converts_the_lead_first(): void
    {
        $lead = Lead::query()->create(['name' => 'سارة', 'owner_id' => $this->admin->id]);
        $deal = Opportunity::query()->create(['title' => 'توريد', 'lead_id' => $lead->id, 'stage_id' => Stage::query()->value('id'), 'value' => 1000]);
        $quote = app(CrmService::class)->quotationFor($deal, app(TradingService::class), [['product_id' => $this->product()->id, 'quantity' => 1, 'unit_price' => 100]]);
        $this->assertSame('sales_quotation', $quote->type);
        $this->assertEquals($deal->id, $quote->opportunity_id);
        $this->assertEquals($quote->id, $deal->refresh()->quotation_id);
        $this->assertSame('converted', $lead->refresh()->status);
    }
}
