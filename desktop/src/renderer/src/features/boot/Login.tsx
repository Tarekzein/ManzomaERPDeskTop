import { useState } from 'react'
import { ArrowRight, Languages, LogIn } from 'lucide-react'
import { useSession } from '@/store/session'
import { nameOf, usePrefs, useT } from '@/store/prefs'
import { Button, Field, Input } from '@/components/ui'

export function Login() {
  const t = useT()
  const { info, profile, login, close } = useSession()
  const prefs = usePrefs((s) => s.prefs)
  const update = usePrefs((s) => s.update)
  const [username, setUsername] = useState(localStorage.getItem(`erp.lastUser.${profile?.id}`) ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(username.trim(), password)
      localStorage.setItem(`erp.lastUser.${profile?.id}`, username.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page grid h-full place-items-center p-6">
      <form className="sheet auth-card w-full max-w-[420px] p-8" onSubmit={submit}>
        <div className="mb-6 flex items-center gap-3">
          {info?.company?.logo ? (
            <img src={info.company.logo} alt="" className="h-12 w-12 rounded-lg object-contain" style={{ background: '#fff' }} />
          ) : (
            <div className="grid h-12 w-12 place-items-center rounded-lg text-[20px] font-bold" style={{ background: 'var(--action)', color: '#fff' }}>{(nameOf(info?.company) || 'M').slice(0, 1)}</div>
          )}
          <div className="min-w-0">
            <div className="truncate text-[17px] font-bold">{nameOf(info?.company) || profile?.name}</div>
            <div className="muted text-[12px]">{t('سجّل الدخول للمتابعة', 'Sign in to continue')}</div>
          </div>
        </div>
        <div className="grid gap-3">
          <Field label={t('اسم المستخدم', 'User name')}>
            <Input autoFocus={!username} value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" autoComplete="username" />
          </Field>
          <Field label={t('كلمة المرور', 'Password')} error={error}>
            <Input autoFocus={Boolean(username)} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Button type="submit" variant="primary" icon={LogIn} loading={busy} className="mt-3 h-11">
            {t('دخول', 'Sign in')}
          </Button>
        </div>
        <div className="mt-5 flex items-center justify-between text-[12px]">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void close()}>
            <ArrowRight size={13} style={{ transform: document.dir === 'ltr' ? 'rotate(180deg)' : undefined }} />
            {t('العودة لاتصال الشركة', 'Back to company connection')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" lang={prefs?.locale === 'ar' ? 'en' : 'ar'} onClick={() => update({ locale: prefs?.locale === 'ar' ? 'en' : 'ar' })}>
            <Languages size={13} />
            {prefs?.locale === 'ar' ? 'English' : 'العربية'}
          </button>
        </div>
      </form>
    </div>
  )
}
