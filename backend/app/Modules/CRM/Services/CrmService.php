<?php

namespace App\Modules\CRM\Services;

use App\Modules\Core\Services\AuditService;
use App\Modules\Core\Services\NumberingService;
use App\Modules\CRM\Models\Activity;
use App\Modules\CRM\Models\Lead;
use App\Modules\CRM\Models\Opportunity;
use App\Modules\CRM\Models\Stage;
use App\Modules\CRM\Models\Task;
use App\Modules\Parties\Models\Party;
use App\Modules\Trading\Models\TradeDocument;
use App\Modules\Trading\Services\TradingService;
use App\Support\BusinessException;
use Illuminate\Support\Facades\DB;

class CrmService
{
    public function __construct(
        private readonly NumberingService $numbers,
        private readonly AuditService $audit,
    ) {}

    /**
     * Turn a lead into a customer (or link it to an existing one).
     */
    public function convertLead(Lead $lead, array $data = []): Lead
    {
        if ($lead->status === 'converted' && $lead->party_id) {
            throw BusinessException::make(__('erp.lead_already_converted'), 'already_converted');
        }

        return DB::transaction(function () use ($lead, $data) {
            if (! empty($data['party_id'])) {
                $party = Party::query()->findOrFail($data['party_id']);
                if (! $party->is_customer) {
                    $party->update(['is_customer' => true]);
                }
            } else {
                $party = Party::query()->create([
                    'code' => $this->numbers->code('customer'),
                    'is_customer' => true,
                    'kind' => $lead->company_name ? 'company' : 'individual',
                    'name' => $lead->company_name ?: $lead->name,
                    'phone' => $lead->phone,
                    'mobile' => $lead->mobile,
                    'email' => $lead->email,
                    'city' => $lead->city,
                    'address' => $lead->address,
                    'salesperson_id' => $lead->owner_id,
                    'payment_terms_days' => (int) ($data['payment_terms_days'] ?? 0),
                    'credit_limit' => $data['credit_limit'] ?? null,
                    'notes' => $lead->notes,
                ]);
                if ($lead->company_name && $lead->name) {
                    $party->contacts()->create(['name' => $lead->name, 'phone' => $lead->mobile ?: $lead->phone, 'email' => $lead->email]);
                }
            }
            $lead->update(['status' => 'converted', 'party_id' => $party->id, 'converted_at' => now()]);
            // Open deals follow the lead to the new customer.
            Opportunity::query()->where('lead_id', $lead->id)->whereNull('party_id')->update(['party_id' => $party->id]);
            Activity::query()->where('lead_id', $lead->id)->whereNull('party_id')->update(['party_id' => $party->id]);
            Task::query()->where('lead_id', $lead->id)->whereNull('party_id')->update(['party_id' => $party->id]);
            $this->audit->record('converted', $lead, $party->code.' '.$party->name);

            return $lead->refresh()->load('party', 'owner:id,name', 'source');
        });
    }

    /**
     * Move a deal on the board. Won and lost stages close the deal; a lost
     * deal must say why.
     */
    public function moveOpportunity(Opportunity $opportunity, int $stageId, array $data = []): Opportunity
    {
        $stage = Stage::query()->findOrFail($stageId);
        $attributes = ['stage_id' => $stage->id, 'probability' => $stage->probability];
        if (isset($data['sort_order'])) {
            $attributes['sort_order'] = (int) $data['sort_order'];
        }

        if ($stage->is_lost) {
            if (empty($data['lost_reason_id'])) {
                throw BusinessException::make(__('erp.lost_reason_required'), 'lost_reason_required');
            }
            $attributes += ['status' => 'lost', 'lost_reason_id' => $data['lost_reason_id'], 'lost_note' => $data['lost_note'] ?? null, 'lost_at' => now(), 'won_at' => null];
        } elseif ($stage->is_won) {
            $attributes += ['status' => 'won', 'won_at' => now(), 'lost_at' => null, 'lost_reason_id' => null];
        } else {
            $attributes += ['status' => 'open', 'won_at' => null, 'lost_at' => null, 'lost_reason_id' => null];
        }
        $opportunity->update($attributes);

        return $opportunity->refresh()->load($this->opportunityRelations());
    }

    /**
     * Start a quotation for a deal's customer.
     */
    public function quotationFor(Opportunity $opportunity, TradingService $trading, array $lines = []): TradeDocument
    {
        if (! $opportunity->party_id) {
            if ($opportunity->lead) {
                $this->convertLead($opportunity->lead);
                $opportunity->refresh();
            } else {
                throw BusinessException::make(__('erp.opportunity_needs_customer'), 'customer_required');
            }
        }

        return DB::transaction(function () use ($opportunity, $trading, $lines) {
            $quote = $trading->save('sales_quotation', [
                'party_id' => $opportunity->party_id,
                'salesperson_id' => $opportunity->owner_id,
                'opportunity_id' => $opportunity->id,
                'notes' => $opportunity->title,
                'lines' => $lines,
            ]);
            $opportunity->update(['quotation_id' => $quote->id]);

            return $quote;
        });
    }

    /**
     * Simple, explainable score: profile completeness, engagement and status.
     */
    public function scoreLead(Lead $lead): int
    {
        $score = 0;
        $score += $lead->phone || $lead->mobile ? 10 : 0;
        $score += $lead->email ? 10 : 0;
        $score += $lead->company_name ? 10 : 0;
        $score += match ($lead->status) {
            'contacted' => 10, 'qualified' => 30, 'converted' => 40, default => 0,
        };
        $activities = Activity::query()->where('lead_id', $lead->id)->count();
        $score += min($activities * 5, 25);
        $score += (float) $lead->expected_value > 0 ? 15 : 0;
        $score = min($score, 100);
        $lead->forceFill(['score' => $score])->saveQuietly();

        return $score;
    }

    public function opportunityRelations(): array
    {
        return ['stage', 'lead:id,name,company_name,phone,mobile', 'party:id,code,name,phone,mobile', 'owner:id,name', 'source', 'lostReason', 'quotation:id,number,status,total'];
    }
}
