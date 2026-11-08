import { userErrorMessage } from '@shared/userError'
import { createContext, forwardRef, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import clsx from 'clsx'
import { AlertTriangle, ChevronDown, Inbox, LoaderCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { money, toNumber } from '@/lib/format'
import { useT, usePrefs } from '@/store/prefs'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  size?: 'md' | 'sm'
  icon?: LucideIcon
  kbd?: string
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'default', size = 'md', icon: Icon, kbd, loading, children, className, disabled, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx('btn', variant !== 'default' && `btn-${variant}`, size === 'sm' && 'btn-sm', !children && 'btn-icon', className)}
      disabled={disabled || loading}
      {...rest}
      aria-busy={loading || rest['aria-busy'] || undefined}
    >
      {loading ? <LoaderCircle size={14} className="animate-spin" /> : Icon ? <Icon size={size === 'sm' ? 13 : 15} /> : null}
      {children}
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  )
})

export interface MenuEntry {
  label: ReactNode
  icon?: LucideIcon
  hint?: string
  danger?: boolean
  onSelect: () => void
}

/**
 * Button that opens a short menu. Closes on an outside click, Escape or a choice;
 * arrow keys move between items. `null` entries draw a separator.
 */
export function MenuButton({ items, header, align = 'end', children, ...button }: Omit<ButtonProps, 'onClick'> & { items: (MenuEntry | null)[]; header?: ReactNode; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        root.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus()
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const list = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
      const at = list.indexOf(document.activeElement as HTMLElement)
      list[(at + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={root} className="relative inline-flex">
      <Button {...button} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {children}
        <ChevronDown size={13} className="opacity-60" />
      </Button>
      {open && (
        <div className={clsx('menu top-full mt-1', align === 'end' ? 'end-0' : 'start-0')} role="menu">
          {header}
          {items.map((item, i) =>
            item === null ? (
              <div key={i} className="menu-sep" role="separator" />
            ) : (
              <button
                key={i}
                role="menuitem"
                className={clsx('menu-item', item.danger && 'danger')}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.icon && <item.icon size={15} />}
                <span className="truncate">{item.label}</span>
                {item.hint && <small>{item.hint}</small>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

interface FieldState { id: string; messageId?: string; invalid: boolean }
const FieldContext = createContext<FieldState | null>(null)
type ControlAccessibility = Pick<InputHTMLAttributes<HTMLInputElement>, 'id' | 'aria-invalid' | 'aria-describedby'>

/** Native and searchable controls share the field's validation description. */
export function useFieldControl(props: ControlAccessibility = {}): ControlAccessibility {
  const field = useContext(FieldContext)
  return {
    id: props.id ?? field?.id,
    'aria-invalid': props['aria-invalid'] ?? (field?.invalid || undefined),
    'aria-describedby': [props['aria-describedby'], field?.messageId].filter(Boolean).join(' ') || undefined,
  }
}

/** `group` avoids activating the first button when clicking a grouped-control label. */
export function Field({ label, hint, error, children, className, group }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; group?: boolean }) {
  const id = useId()
  const Tag = group ? 'div' : 'label'
  const messageId = error || hint ? `${id}-message` : undefined
  return <FieldContext.Provider value={{ id, messageId, invalid: Boolean(error) }}>
    <Tag className={clsx('field', className)} data-invalid={error ? 'true' : undefined} role={group ? 'group' : undefined} aria-labelledby={group && label ? `${id}-label` : undefined}>
      {label && <span id={`${id}-label`}>{label}</span>}
      {children}
      {error ? <small id={messageId} className="error" role="alert">{error}</small> : hint ? <small id={messageId} className="hint">{hint}</small> : null}
    </Tag>
  </FieldContext.Provider>
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { small?: boolean }>(function Input({ className, small, ...rest }, ref) {
  const accessibility = useFieldControl(rest)
  return <input ref={ref} className={clsx('input', small && 'input-sm', className)} {...rest} {...accessibility} />
})

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const accessibility = useFieldControl(props)
  return <textarea {...props} {...accessibility} className={clsx('textarea', props.className)} />
}

export function Select({ options, placeholder, small, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string | number; label: string }[]; placeholder?: string; small?: boolean }) {
  const accessibility = useFieldControl(rest)
  return (
    <select className={clsx('select', small && 'input-sm', className)} {...rest} {...accessibility}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Number entry that keeps the user's text while typing and reports a number.
 * Selects its content on focus so overtyping is quick in the line grid.
 */
export function NumberInput({ value, onChange, small, className, decimals, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | string | null | undefined; onChange: (n: number) => void; small?: boolean; decimals?: number }) {
  const accessibility = useFieldControl(rest)
  const [text, setText] = useState(value === null || value === undefined || value === '' ? '' : String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(value === null || value === undefined || value === '' ? '' : decimals !== undefined ? toNumber(value).toFixed(decimals) : String(toNumber(value)))
  }, [value, focused, decimals])
  return (
    <input
      {...rest}
      {...accessibility}
      inputMode="decimal"
      className={clsx('input num', small && 'input-sm', className)}
      value={text}
      onFocus={(e) => {
        setFocused(true)
        e.currentTarget.select()
        rest.onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        rest.onBlur?.(e)
      }}
      onChange={(e) => {
        // Accept Arabic-Indic digits typed from an Arabic keyboard.
        const raw = e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫,]/g, '.')
        if (!/^-?\d*\.?\d*$/.test(raw)) return
        setText(raw)
        onChange(raw === '' || raw === '-' || raw === '.' ? 0 : parseFloat(raw))
      }}
    />
  )
}

export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Pill({ tone, children }: { tone?: 'green' | 'red' | 'amber' | 'blue' | 'brand'; children: ReactNode }) {
  return <span className={clsx('pill', tone && `pill-${tone}`)}>{children}</span>
}

export function Spinner({ label }: { label?: string }) {
  const t = useT()
  return (
    <div className="flex items-center justify-center gap-2 p-10 muted" role="status">
      <LoaderCircle size={18} className="animate-spin" />
      {label ?? <span className="sr-only">{t('جارٍ التحميل…', 'Loading…')}</span>}
    </div>
  )
}

export function Empty({ icon: Icon = Inbox, title, hint, action }: { icon?: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <Icon size={28} className="muted" />
      <div className="font-semibold">{title}</div>
      {hint && <div className="muted max-w-md">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT()
  const locale = usePrefs(state => state.locale)
  return (
    <div role="alert" className="m-4 flex items-start gap-3 rounded-lg p-3" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1">{userErrorMessage(error, locale)}</div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          {t('إعادة المحاولة', 'Try again')}
        </Button>
      )}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 pt-5 pb-4">
      <div className="min-w-0">
        <h1 className="m-0 truncate text-[22px] font-semibold">{title}</h1>
        {subtitle && <div className="muted mt-1 text-[13px]">{subtitle}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
      {children}
    </div>
  )
}

export function Money({ value, paren, colored, className, currency }: { value: unknown; paren?: boolean; colored?: boolean; className?: string; currency?: string }) {
  const n = toNumber(value)
  return (
    <span className={clsx('num', colored && n < -0.004 && 'neg', className)}>
      {money(n, { paren })}
      {currency && <span className="muted ms-1 text-[11px]">{currency}</span>}
    </span>
  )
}

export function Sheet({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx('sheet', className)}>
      {(title || actions) && (
        <div className="sheet-head">
          {typeof title === 'string' ? <h3>{title}</h3> : title}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/**
 * A record-editor section: a short title and plain-language explanation beside
 * (or above, in narrow tabs) the fields it describes.
 */
export function FormSection({ title, description, actions, children, card = true, bodyClassName }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; card?: boolean; bodyClassName?: string }) {
  return (
    <section className="form-section">
      <div className="form-section-intro">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className={clsx(card && 'sheet', bodyClassName ?? (card && 'p-4'))}>{children}</div>
    </section>
  )
}

/** `block` stretches the choices to fill a form field and match input height. */
export function Segmented<T extends string>({ value, onChange, options, block }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; block?: boolean }) {
  return (
    <div className={clsx('segmented', block && 'block')} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className="segmented-option"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Kv({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5" style={{ borderColor: 'var(--rule)' }}>
      <span className="muted text-[12px]">{label}</span>
      <span className="text-end">{children}</span>
    </div>
  )
}
