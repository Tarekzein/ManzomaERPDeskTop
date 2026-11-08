import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useSession } from '@/store/session'
import { useT } from '@/store/prefs'
import { Button, Field, Input } from '@/components/ui'

export function LockScreen() {
  const t = useT()
  const { user, unlock, logout } = useSession()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await unlock(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="overlay" style={{ background: 'color-mix(in srgb, var(--paper) 92%, transparent)', backdropFilter: 'blur(6px)' }}>
      <form className="sheet w-[360px] p-6" onSubmit={submit}>
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'var(--ledger-soft)', color: 'var(--ledger)' }}>
            <Lock size={18} />
          </div>
          <div>
            <div className="font-semibold">{t('الشاشة مقفلة', 'Screen locked')}</div>
            <div className="muted text-[12px]">{user?.name}</div>
          </div>
        </div>
        <Field label={t('كلمة المرور', 'Password')} error={error}>
          <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="mt-4 flex justify-between gap-2">
          <Button variant="ghost" onClick={() => void logout()}>{t('تسجيل الخروج', 'Sign out')}</Button>
          <Button type="submit" variant="primary" loading={busy}>{t('فتح', 'Unlock')}</Button>
        </div>
      </form>
    </div>
  )
}
