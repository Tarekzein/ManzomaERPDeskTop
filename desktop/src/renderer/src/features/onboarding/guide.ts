import { useWorkspace } from '@/store/workspace'

export const GUIDE_STEPS = ['company', 'locations', 'finance', 'products', 'maintenance', 'customers'] as const
export type GuideStepKey = typeof GUIDE_STEPS[number]
export interface GuideCheck { key: string; passed: boolean; required: boolean }
export interface GuideStep { key: GuideStepKey; required: boolean; checks: GuideCheck[]; ready: boolean; reviewed: boolean; deferred: boolean; done: boolean }
export interface GuideState { status: 'not_started' | 'active' | 'paused' | 'completed'; auto_start: boolean; steps: GuideStep[]; done: number; total: number; can_finish: boolean; current_step: GuideStepKey | 'review'; completed_at?: string | null }

export const STEP_LABELS: Record<GuideStepKey, [string, string]> = {
  company: ['بيانات الشركة', 'Company details'], locations: ['المواقع والفريق', 'Locations and team'], finance: ['الماليات والضرائب', 'Finance and tax'], products: ['الأصناف والمخزون', 'Products and stock'], maintenance: ['برامج الصيانة', 'Maintenance schedules'], customers: ['العملاء والفلاتر', 'Customers and filters'],
}
export function openSetupGuide() {
  const workspace = useWorkspace.getState()
  const tab = workspace.tabs.find(tab => tab.path.split('?')[0] === '/getting-started')
  if (tab) workspace.activate(tab.id)
  else workspace.open('/getting-started')
}
