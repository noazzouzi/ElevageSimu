// Composants d'interface réutilisables.
import { useId, useState, type ReactNode } from 'react'
import { GAUGE_LABELS } from '../domain/constants'
import type { GaugeId } from '../domain/types'
import { downloadBackup } from '../lib/backup'
import { formatNumber } from '../lib/format'
import { overwriteBlocked, retryPendingWrites, useStorageHealth, type StorageIssueKind } from '../store/persistence'
import { useSettings } from '../store/settings'
import { href } from './router'

/** En-tête de page (titre, sous-titre, actions), précédé des alertes de stockage éventuelles. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <>
      <StorageAlerts />
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </header>
    </>
  )
}

/**
 * Actions de secours quand une page ne peut pas s'afficher (filet d'erreur de page) : télécharger une
 * sauvegarde et réinitialiser les réglages sans passer par la page Réglages (qui peut elle-même être en
 * cause), avec confirmation.
 */
export function DataRecoveryActions() {
  const reset = useSettings((s) => s.reset)
  const [confirm, setConfirm] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            try {
              setMessage(`Sauvegarde téléchargée : ${downloadBackup()}`)
            } catch {
              setMessage('Le téléchargement a échoué : votre navigateur bloque peut-être les téléchargements.')
            }
          }}
        >
          Télécharger une sauvegarde
        </button>
        {confirm ? (
          <>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                reset()
                setConfirm(false)
                setMessage('Réglages réinitialisés (montures, prix et journal inchangés) : rechargez la page.')
              }}
            >
              Oui, réinitialiser les réglages
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirm(false)}>
              Annuler
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirm(true)}>
            Réinitialiser les réglages…
          </button>
        )}
      </div>
      {message && <small role="status">{message}</small>}
    </div>
  )
}

const STORAGE_ISSUE_TITLES: Record<StorageIssueKind, string> = {
  ecriture: 'Modifications non enregistrées.',
  version: 'Données d’une version plus récente.',
  illisible: 'Données illisibles.',
  corrige: 'Données corrigées.',
}

/**
 * Alertes de stockage (src/store/persistence.ts) : enregistrement impossible (quota plein), données
 * d'une version plus récente ou illisibles (conservées, non modifiées), données corrigées au chargement.
 * Affichées en haut de chaque page (via PageHeader), avec les actions utiles.
 */
export function StorageAlerts() {
  const issues = useStorageHealth((s) => s.issues)
  const dismiss = useStorageHealth((s) => s.dismiss)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  if (!issues.length) return null
  const download = () => {
    try {
      setMessage(`Sauvegarde téléchargée : ${downloadBackup()}`)
    } catch {
      setMessage('Le téléchargement a échoué : votre navigateur bloque peut-être les téléchargements.')
    }
  }
  return (
    <div className="stack" role="alert" style={{ gap: 0, marginBottom: 8 }}>
      {issues.map((i) => {
        const id = `${i.key}|${i.kind}`
        return (
          <div key={id} className={`callout ${i.kind === 'corrige' ? 'warn' : 'danger'}`}>
            <strong>{STORAGE_ISSUE_TITLES[i.kind]}</strong> {i.message}
            <div className="row" style={{ marginTop: 6 }}>
              {i.kind !== 'corrige' && (
                <button type="button" className="btn small primary" onClick={download}>
                  Télécharger une sauvegarde
                </button>
              )}
              {i.kind === 'ecriture' && (
                <>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setMessage(retryPendingWrites() ? 'Modifications enregistrées.' : 'Toujours impossible : libérez de la place (Réglages › Données).')}
                  >
                    Réessayer d’enregistrer
                  </button>
                  <a className="btn small" href={href('reglages', { s: 'donnees' })}>
                    Libérer de la place
                  </a>
                </>
              )}
              {i.kind === 'version' && (
                <button type="button" className="btn small" onClick={() => window.location.reload()}>
                  Recharger la page
                </button>
              )}
              {(i.kind === 'version' || i.kind === 'illisible') &&
                (confirm === id ? (
                  <>
                    <span>
                      {i.kind === 'version'
                        ? 'Les données enregistrées seront remplacées par celles affichées ici (ce que cette version ne connaît pas sera perdu).'
                        : 'Les données illisibles seront remplacées par celles affichées ici.'}
                    </span>
                    <button
                      type="button"
                      className="btn small danger"
                      onClick={() => {
                        overwriteBlocked(i.key)
                        setConfirm(null)
                      }}
                    >
                      Oui, remplacer
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => setConfirm(null)}>
                      Annuler
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn small ghost" onClick={() => setConfirm(id)}>
                    {i.kind === 'version' ? 'Écraser avec cette version…' : 'Repartir de zéro pour ces données…'}
                  </button>
                ))}
              {i.kind === 'corrige' && (
                <button type="button" className="btn small" onClick={() => dismiss(i.key, i.kind)}>
                  Compris
                </button>
              )}
            </div>
          </div>
        )
      })}
      {message && <small role="status">{message}</small>}
    </div>
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

export interface NumberFieldProps {
  label: ReactNode
  value: number
  /** Appelé avec une valeur bornée (et entière si `integer`), seulement quand elle change. */
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  /** Valeur entière (arrondie) ; défaut : vrai si `step` est absent ou entier. */
  integer?: boolean
  suffix?: ReactNode
  width?: number
}

/** Texte saisi → nombre (virgule acceptée), ou null s'il est vide ou illisible. */
function parseNumberDraft(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

/** Valeur validée d'une saisie : bornée, arrondie si entière ; null si vide ou illisible. */
export function commitNumberDraft(text: string, opts: { min?: number; max?: number; integer?: boolean }): number | null {
  let v = parseNumberDraft(text)
  if (v === null) return null
  if (opts.integer) v = Math.round(v)
  if (opts.min !== undefined) v = Math.max(opts.min, v)
  if (opts.max !== undefined) v = Math.min(opts.max, v)
  return v
}

/** Problème d'une saisie en cours (affiché sous le champ), ou null si elle est valide (ou vide). */
function numberDraftProblem(text: string, opts: { min?: number; max?: number; integer?: boolean }): string | null {
  const v = parseNumberDraft(text)
  if (text.trim() === '') return null
  if (v === null) return 'Nombre attendu (sinon la valeur précédente est gardée).'
  const committed = commitNumberDraft(text, opts)
  const out = (opts.min !== undefined && v < opts.min) || (opts.max !== undefined && v > opts.max)
  if (out) {
    const range =
      opts.min !== undefined && opts.max !== undefined
        ? `entre ${formatNumber(opts.min, 2)} et ${formatNumber(opts.max, 2)}`
        : opts.min !== undefined
          ? `au moins ${formatNumber(opts.min, 2)}`
          : `au plus ${formatNumber(opts.max ?? 0, 2)}`
    return `Valeur ${range} : ramenée à ${formatNumber(committed ?? 0, 2)} en quittant le champ.`
  }
  if (opts.integer && !Number.isInteger(v)) return `Nombre entier : arrondi à ${formatNumber(committed ?? 0)} en quittant le champ.`
  return null
}

/**
 * Champ numérique à brouillon local : la saisie n'est validée (bornée, arrondie si entière, puis
 * transmise à `onChange`) qu'en quittant le champ ou avec Entrée — on peut donc effacer « 100 » et taper
 * « 87 » sans que le champ devienne 187. Pendant la saisie, une valeur hors bornes est signalée (et non
 * corrigée) ; un champ vidé reprend la valeur précédente. Les flèches et boutons du champ (valeur déjà
 * dans les bornes) sont validés tout de suite. Échap annule la saisie en cours.
 */
export function NumberField({ label, value, onChange, min, max, step, integer, suffix, width }: NumberFieldProps) {
  const isInt = integer ?? (step === undefined || Number.isInteger(step))
  const [draft, setDraft] = useState<string | null>(null)
  const hintId = useId()
  const opts = { min, max, integer: isInt }
  const problem = draft === null ? null : numberDraftProblem(draft, opts)
  const commit = (text: string) => {
    setDraft(null)
    const v = commitNumberDraft(text, opts)
    if (v !== null && v !== value) onChange(v)
  }
  return (
    <label className="field">
      {label}
      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <input
          type="number"
          inputMode={isInt && (min === undefined || min >= 0) ? 'numeric' : 'decimal'}
          value={draft ?? (Number.isFinite(value) ? String(value) : '')}
          min={min}
          max={max}
          step={step}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? hintId : undefined}
          style={{ width: width ?? 110, ...(problem ? { borderColor: 'var(--danger)', outlineColor: 'var(--danger)' } : {}) }}
          onChange={(e) => {
            // Frappe au clavier, collage : brouillon. Flèches / boutons du champ (événement sans
            // inputType dans les navigateurs Chromium) : validation immédiate.
            const inputType = (e.nativeEvent as Partial<InputEvent>).inputType
            if (typeof inputType === 'string' && inputType !== '') setDraft(e.target.value)
            else commit(e.target.value)
          }}
          onBlur={() => {
            if (draft !== null) commit(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft !== null) commit(draft)
            else if (e.key === 'Escape' && draft !== null) setDraft(null)
          }}
        />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
      {problem && (
        <small id={hintId} style={{ color: 'var(--danger)' }}>
          {problem}
        </small>
      )}
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
