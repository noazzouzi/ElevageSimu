// Composants d'interface réutilisables.
import type { ReactNode } from 'react'
import { GAUGE_LABELS } from '../domain/constants'
import type { GaugeId } from '../domain/types'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  )
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <div className="card-title">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, tone, hint }: { label: ReactNode; value: ReactNode; tone?: 'pos' | 'neg'; hint?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value${tone ? ` ${tone}` : ''}`}>{value}</div>
      {hint && <small>{hint}</small>}
    </div>
  )
}

export function GaugeChip({ gauge }: { gauge: GaugeId }) {
  return <span className={`gauge-chip ${gauge}`}>{GAUGE_LABELS[gauge]}</span>
}

export function Badge({ tone, children, title }: { tone?: 'ok' | 'warn' | 'danger' | 'info' | 'gold' | 'accent'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge${tone ? ` ${tone}` : ''}`} title={title}>
      {children}
    </span>
  )
}

export function Callout({ tone, children }: { tone?: 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  return <div className={`callout${tone ? ` ${tone}` : ''}`}>{children}</div>
}

export function Progress({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

/** Champ numérique contrôlé avec bornes. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  width,
}: {
  label: ReactNode
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: ReactNode
  width?: number
}) {
  return (
    <label className="field">
      {label}
      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          style={{ width: width ?? 110 }}
          onChange={(e) => {
            let v = e.target.value === '' ? 0 : Number(e.target.value)
            if (!Number.isFinite(v)) return
            if (min !== undefined) v = Math.max(min, v)
            if (max !== undefined) v = Math.min(max, v)
            onChange(v)
          }}
        />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
    </label>
  )
}

export function SelectField<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: ReactNode
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <label className="field">
      {label}
      <select
        value={String(value)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value)
          if (opt) onChange(opt.value)
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={`tab${t.id === value ? ' active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
