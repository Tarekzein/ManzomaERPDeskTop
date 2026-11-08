import { useEffect, useRef, useState } from 'react'
import { platform } from '@/lib/platform'
import { useSession } from '@/store/session'
import { useT } from '@/store/prefs'
import { Button } from '@/components/ui'

interface SavedDraft<T> { value: T; savedAt: string }

/** Recovery is explicit. Drafts are never automatically submitted or posted. */
export function useRecoverableDraft<T>(resource: string, value: T, restore: (value: T) => void, enabled = true) {
  const t = useT()
  const profile = useSession((state) => state.profile)
  const userId = useSession((state) => state.user?.id)
  const key = `${profile?.serverUrl ?? 'local'}|${profile?.company ?? profile?.id}|${userId}|${resource}`
  const [recovered, setRecovered] = useState<SavedDraft<T> | null>(null)
  const [ready, setReady] = useState(false)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const current = useRef(value)
  current.current = value
  useEffect(() => {
    let active = true; setReady(false)
    void platform.drafts.get(key).then((draft) => { if (active) { setRecovered(draft as SavedDraft<T> | null); setReady(true) } }).catch(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [key])
  const serialized = JSON.stringify(value)
  useEffect(() => {
    if (!enabled || !ready || recovered || !userId) return
    const timer = setTimeout(() => { void platform.drafts.set(key, { value: current.current, savedAt: new Date().toISOString() }).then((result) => setPersisted(result.persisted)).catch(() => setPersisted(false)) }, 700)
    return () => clearTimeout(timer)
  }, [key, serialized, enabled, ready, recovered, userId])
  return {
    clear: () => platform.drafts.remove(key),
    banner: recovered ? <div className="flex flex-wrap items-center gap-3 rounded border p-3"><span>{t('توجد مسودة محفوظة. راجع السجل الحالي قبل الحفظ.', 'A saved draft is available. Review the current record before saving.')}</span>
      <Button size="sm" onClick={() => { restore(recovered.value); setRecovered(null) }}>{t('استعادة المسودة', 'Restore draft')}</Button>
      <Button size="sm" onClick={() => { void platform.drafts.remove(key); setRecovered(null) }}>{t('تجاهل', 'Discard')}</Button></div>
      : persisted === false ? <p className="muted text-[12px]">{t('المسودة في الذاكرة فقط؛ التخزين المشفر غير متاح على هذا الجهاز.', 'Draft is in memory only; encrypted storage is unavailable on this device.')}</p> : null,
  }
}
