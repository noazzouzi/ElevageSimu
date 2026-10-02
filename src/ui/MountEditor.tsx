// Formulaire réutilisable de création / modification d'une monture (fenêtre modale), et petits
// composants d'affichage associés (smiley de sérénité, jauges E/M/A, fenêtre modale).
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { FAMILIES, crossingChild, getSpecies } from '../data'
import { ABILITY_LABELS, MOUNT_STAT_MAX, PADDOCK_SLOTS, PADDOCK_UNLOCK_LEVELS, SERENITY_MAX, SERENITY_MIN } from '../domain/constants'
import { locationKey, paddockOccupancy, parseLocationKey, SERENITY_BAND_MIDPOINT, SERENITY_BANDS, SERENITY_SMILEYS, serenitySmiley, unlockedPaddocks, type LocationKey } from '../domain/mountFate'
import { FERTILITY_LABELS, GENDER_ICONS, GENDER_LABELS } from '../domain/mounts'
import type { Ability, Fertility, Gender, Mount } from '../domain/types'
import { formatNumber } from '../lib/format'
import { useInventory, type NewMount } from '../store/inventory'
import { useRules, useSettings } from '../store/settings'
import { Badge, Callout, Progress } from './components'
import { SpeciesName, SpeciesPicker } from './species'
import './pages/MountsPage.css'

// ---------- Petits composants partagés ----------

/** Smiley de sérénité du jeu (rouge :C, bleu :(, violet :), vert :D). */
export function SerenitySmiley({ serenity, withValue = false }: { serenity: number; withValue?: boolean }) {
  const s = serenitySmiley(serenity)
  return (
    <span className={`mt-smiley ${s.color}`} title={`${s.label} — sérénité ${formatNumber(serenity)}`}>
      <span className="mt-smiley-face" aria-hidden>
        {s.face}
      </span>
      <span className="mt-sr">{s.label}</span>
      {withValue && <span className="mt-smiley-value">{formatNumber(serenity)}</span>}
    </span>
  )
}

const GAUGE_COLORS = { endurance: 'var(--g-foudroyeur)', maturity: 'var(--g-abreuvoir)', love: 'var(--g-dragofesse)' } as const

/** Trois mini-barres Endurance / Maturité / Amour (0 … 20 000). */
export function GaugeBars({ mount }: { mount: Pick<Mount, 'endurance' | 'maturity' | 'love'> }) {
  const rows: { key: keyof typeof GAUGE_COLORS; letter: string; label: string }[] = [
    { key: 'endurance', letter: 'E', label: 'Endurance' },
    { key: 'maturity', letter: 'M', label: 'Maturité' },
    { key: 'love', letter: 'A', label: 'Amour' },
  ]
  return (
    <div className="mt-gauges" title={rows.map((r) => `${r.label} ${formatNumber(mount[r.key])} / ${formatNumber(MOUNT_STAT_MAX)}`).join(' · ')}>
      {rows.map((r) => (
        <div key={r.key} className={`mt-gauge${mount[r.key] >= MOUNT_STAT_MAX ? ' full' : ''}`}>
          <span className="mt-gauge-letter">{r.letter}</span>
          <Progress value={mount[r.key]} max={MOUNT_STAT_MAX} color={GAUGE_COLORS[r.key]} />
        </div>
      ))}
    </div>
  )
}

/** Fenêtre modale accessible (Échap pour fermer). */
export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.mt-modal-close)')
    first?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [onClose])
  return (
    <div className="mt-modal-backdrop">
      <div className={`mt-modal card${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="mt-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="btn ghost small mt-modal-close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="mt-modal-body">{children}</div>
        {footer && <div className="mt-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ---------- Éditeur ----------

interface Draft {
  speciesId: number | null
  gender: Gender
  level: number
  ability: Ability | null
  fertility: Exclude<Fertility, 'feconde'>
  serenity: number
  endurance: number
  maturity: number
  love: number
  parent1: number | null
  parent2: number | null
  location: LocationKey
  name: string
  notes: string
}

type Field = keyof Draft | 'parents'

function draftFrom(m: Partial<NewMount> | null | undefined): Draft {
  const parents = m?.parents ?? []
  return {
    speciesId: m?.speciesId ?? null,
    gender: m?.gender ?? 'male',
    level: m?.level ?? 1,
    ability: m?.ability ?? null,
    fertility: m?.fertility === 'sterile' || m?.fertility === 'senile' ? m.fertility : 'fertile',
    serenity: m?.serenity ?? 0,
    endurance: m?.endurance ?? 0,
    maturity: m?.maturity ?? 0,
    love: m?.love ?? 0,
    parent1: parents[0] ?? null,
    parent2: parents[1] ?? null,
    location: m?.location ? locationKey(m.location) : 'etable',
    name: m?.name ?? '',
    notes: m?.notes ?? '',
  }
}

const isInt = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi

/** Erreurs bloquantes (par champ) et avertissements d'un brouillon. */
function validateMountDraft(
  d: Draft,
  ctx: { jobLevel: number; occupancy: Map<number, number>; originalLocation: LocationKey | null },
): { errors: Partial<Record<Field, string>>; warnings: string[] } {
  const errors: Partial<Record<Field, string>> = {}
  const warnings: string[] = []
  const sp = d.speciesId !== null ? getSpecies(d.speciesId) : undefined
  if (!sp) errors.speciesId = 'Choisissez la couleur de la monture.'
  if (!isInt(d.level, 1, 200)) errors.level = 'Le niveau doit être un entier entre 1 et 200.'
  if (!isInt(d.serenity, SERENITY_MIN, SERENITY_MAX)) errors.serenity = 'La sérénité est un entier entre −5 000 et 5 000.'
  for (const [k, label] of [
    ['endurance', "L'endurance"],
    ['maturity', 'La maturité'],
    ['love', "L'amour"],
  ] as const)
    if (!isInt(d[k], 0, MOUNT_STAT_MAX)) errors[k] = `${label} est un entier entre 0 et 20 000.`
  const parents = [d.parent1, d.parent2].filter((p): p is number => p !== null)
  if (parents.length === 1) errors.parents = 'Indiquez les deux parents, ou aucun pour une monture capturée.'
  else if (parents.length === 2 && sp) {
    const [p1, p2] = parents.map((p) => getSpecies(p))
    if (!p1 || !p2) errors.parents = 'Parent inconnu.'
    else if (p1.family !== sp.family || p2.family !== sp.family) errors.parents = `Les parents doivent être des ${FAMILIES[sp.family].plural}.`
    else if (sp.generation > Math.max(p1.generation, p2.generation) + 1)
      warnings.push(`Génération incohérente : une G${sp.generation} ne peut pas naître de parents G${p1.generation} et G${p2.generation} (au plus une génération de plus que le parent le plus haut).`)
  }
  const loc = parseLocationKey(d.location)
  if (!loc) errors.location = 'Emplacement inconnu.'
  else if (loc.kind === 'enclos') {
    const unlock = PADDOCK_UNLOCK_LEVELS[loc.paddock - 1]
    if (loc.paddock > unlockedPaddocks(ctx.jobLevel)) errors.location = `L'enclos ${loc.paddock} n'est pas débloqué (Éleveur niveau ${unlock?.level ?? '?'} requis).`
    else {
      const here = (ctx.occupancy.get(loc.paddock) ?? 0) - (ctx.originalLocation === d.location ? 1 : 0)
      if (here >= PADDOCK_SLOTS) errors.location = `L'enclos ${loc.paddock} est plein (${PADDOCK_SLOTS}/${PADDOCK_SLOTS}).`
    }
  }
  if (d.name.length > 60) errors.name = '60 caractères au plus.'
  if (d.notes.length > 1000) errors.notes = '1 000 caractères au plus.'
  if (sp && !sp.breedable) warnings.push('Monture spéciale (génération 0) : ni accouplement, ni clonage, ni extraction.')
  if (d.fertility === 'senile' && d.ability) warnings.push('Une monture sénile date d’avant la 3.5 : sa capacité est conservée mais elle ne se reproduit plus.')
  return { errors, warnings }
}

export interface MountEditorProps {
  /** Monture à modifier ; absente = création. */
  mount?: Mount | null
  /** Valeurs de départ d'une création (ex. espèce ou emplacement pré-choisis). */
  initial?: Partial<NewMount>
  /** Reçoit la monture validée (et son id en modification). La persistance revient à l'appelant. */
  onSave: (data: NewMount, id: string | null) => void
  onCancel: () => void
  /** Affiche un bouton « Supprimer » en modification. */
  onDelete?: (id: string) => void
}

/** Formulaire complet d'une monture, dans une fenêtre modale. */
export function MountEditor({ mount, initial, onSave, onCancel, onDelete }: MountEditorProps) {
  const jobLevel = useSettings((s) => s.jobLevel)
  const rules = useRules()
  const mounts = useInventory((s) => s.mounts)
  const [d, setD] = useState<Draft>(() => draftFrom(mount ?? initial))
  const [touched, setTouched] = useState(false)
  const occupancy = useMemo(() => paddockOccupancy(mounts), [mounts])
  const originalLocation = mount ? locationKey(mount.location) : null
  const { errors, warnings } = validateMountDraft(d, { jobLevel, occupancy, originalLocation })
  const hasErrors = Object.keys(errors).length > 0
  const sp = d.speciesId !== null ? getSpecies(d.speciesId) : undefined
  const unlocked = unlockedPaddocks(jobLevel)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }))
  const eff: Fertility = d.fertility !== 'fertile' ? d.fertility : d.endurance >= MOUNT_STAT_MAX && d.maturity >= MOUNT_STAT_MAX && d.love >= MOUNT_STAT_MAX ? 'feconde' : 'fertile'
  const err = (f: Field) => (touched || f !== 'speciesId') && errors[f] ? <span className="mt-error">{errors[f]}</span> : null

  const save = () => {
    setTouched(true)
    if (hasErrors || d.speciesId === null) return
    const loc = parseLocationKey(d.location) ?? { kind: 'etable' as const }
    const parents = [d.parent1, d.parent2].filter((p): p is number => p !== null)
    const sameParents = mount && mount.parents.length === parents.length && mount.parents.every((p, i) => p === parents[i])
    const data: NewMount = {
      speciesId: d.speciesId,
      gender: d.gender,
      level: d.level,
      ability: d.ability,
      fertility: d.fertility,
      parents,
      grandparents: sameParents ? mount?.grandparents : undefined,
      location: loc,
      serenity: d.serenity,
      endurance: d.endurance,
      maturity: d.maturity,
      love: d.love,
      name: d.name.trim() || undefined,
      notes: d.notes.trim() || undefined,
      xp: mount && mount.level === d.level ? mount.xp : undefined,
    }
    onSave(data, mount?.id ?? null)
  }

  const child = d.parent1 !== null && d.parent2 !== null ? crossingChild(d.parent1, d.parent2) : undefined

  return (
    <Modal
      title={mount ? 'Modifier la monture' : 'Ajouter une monture'}
      onClose={onCancel}
      wide
      footer={
        <>
          {mount && onDelete && (
            <button className="btn danger" onClick={() => onDelete(mount.id)}>
              Supprimer
            </button>
          )}
          <span className="spacer" />
          {touched && hasErrors && <span className="mt-error">Corrigez les champs signalés.</span>}
          <button className="btn" onClick={onCancel}>
            Annuler
          </button>
          <button className="btn primary" onClick={save}>
            {mount ? 'Enregistrer' : 'Ajouter'}
          </button>
        </>
      }
    >
      <form
        className="mt-editor"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <fieldset className="mt-fieldset">
          <legend>Identité</legend>
          <div className="mt-editor-grid">
            <div className="mt-span-2">
              <SpeciesPicker
                label="Couleur"
                value={d.speciesId}
                onChange={(id) => {
                  setD((prev) => {
                    const next = { ...prev, speciesId: id }
                    const ns = id !== null ? getSpecies(id) : undefined
                    // Parents d'une autre famille : on les retire.
                    if (ns) {
                      if (prev.parent1 !== null && getSpecies(prev.parent1)?.family !== ns.family) next.parent1 = null
                      if (prev.parent2 !== null && getSpecies(prev.parent2)?.family !== ns.family) next.parent2 = null
                    }
                    return next
                  })
                }}
              />
              {err('speciesId')}
            </div>
            <div className="field-like">
              <span className="mt-label">Sexe</span>
              <div className="mt-seg" role="radiogroup" aria-label="Sexe">
                {(['male', 'femelle'] as Gender[]).map((g) => (
                  <button key={g} type="button" role="radio" aria-checked={d.gender === g} className={`btn small${d.gender === g ? ' on' : ''}`} onClick={() => set('gender', g)}>
                    {GENDER_ICONS[g]} {GENDER_LABELS[g]}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              Niveau
              <input type="number" min={1} max={200} step={1} value={Number.isFinite(d.level) ? d.level : ''} onChange={(e) => set('level', e.target.value === '' ? NaN : Number(e.target.value))} />
              {err('level')}
            </label>
            <label className="field">
              Nom (facultatif)
              <input value={d.name} maxLength={80} placeholder={sp?.name ?? 'ex. Doré n° 12'} onChange={(e) => set('name', e.target.value)} />
              {err('name')}
            </label>
            <label className="field">
              Capacité
              <select value={d.ability ?? ''} onChange={(e) => set('ability', e.target.value === '' ? null : (e.target.value as Ability))}>
                <option value="">Aucune</option>
                {(Object.keys(ABILITY_LABELS) as Ability[]).map((a) => (
                  <option key={a} value={a}>
                    {ABILITY_LABELS[a]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className="mt-fieldset">
          <legend>Reproduction</legend>
          <div className="mt-editor-grid">
            <label className="field">
              Statut
              <select value={d.fertility} onChange={(e) => set('fertility', e.target.value as Draft['fertility'])}>
                <option value="fertile">Fertile (féconde si les 3 jauges sont au max)</option>
                <option value="sterile">Stérile (déjà accouplée)</option>
                <option value="senile">Sénile (d’avant la 3.5)</option>
              </select>
            </label>
            <div className="field-like">
              <span className="mt-label">Statut affiché</span>
              <span className="row" style={{ gap: 6 }}>
                <StatusBadge status={eff} />
                {d.fertility === 'fertile' && eff !== 'feconde' && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setD((p) => ({ ...p, endurance: MOUNT_STAT_MAX, maturity: MOUNT_STAT_MAX, love: MOUNT_STAT_MAX }))}
                  >
                    Rendre féconde
                  </button>
                )}
              </span>
            </div>
          </div>
          <SerenityInput value={d.serenity} onChange={(v) => set('serenity', v)} error={errors.serenity} />
          <div className="mt-gauge-inputs">
            <GaugeInput label="Endurance" hint="Foudroyeur, sérénité < 0" color={GAUGE_COLORS.endurance} value={d.endurance} onChange={(v) => set('endurance', v)} error={errors.endurance} />
            <GaugeInput label="Maturité" hint="Abreuvoir, sérénité −2 000 à 2 000" color={GAUGE_COLORS.maturity} value={d.maturity} onChange={(v) => set('maturity', v)} error={errors.maturity} />
            <GaugeInput label="Amour" hint="Dragofesse, sérénité ≥ 0" color={GAUGE_COLORS.love} value={d.love} onChange={(v) => set('love', v)} error={errors.love} />
          </div>
        </fieldset>

        <fieldset className="mt-fieldset">
          <legend>Parents (arbre vu par le jeu)</legend>
          <p className="muted mt-help">
            Les deux parents de cette monture ; laissez vide pour une capture. Ils comptent dans le calcul des naissances (poids 6 chacun) et des génétons.
          </p>
          {sp ? (
            <div className="mt-editor-grid">
              <SpeciesPicker label="Parent 1" family={sp.family} value={d.parent1} onChange={(id) => set('parent1', id)} allowEmpty />
              <SpeciesPicker label="Parent 2" family={sp.family} value={d.parent2} onChange={(id) => set('parent2', id)} allowEmpty />
            </div>
          ) : (
            <p className="muted">Choisissez d’abord la couleur de la monture.</p>
          )}
          {errors.parents && <span className="mt-error">{errors.parents}</span>}
          {child !== undefined && sp && (
            <p className="mt-help">
              {child === sp.id ? (
                <>
                  <Badge tone="ok">Croisement réussi</Badge> <SpeciesName id={d.parent1 as number} withGen={false} /> × <SpeciesName id={d.parent2 as number} withGen={false} /> → {sp.name}.
                </>
              ) : (
                <>
                  <Badge tone="info">Bébé hors cible</Badge> Ce couple vise <SpeciesName id={child} /> ; {sp.name} est une autre issue possible (couleur d’un parent ou de l’arbre).
                </>
              )}
            </p>
          )}
        </fieldset>

        <fieldset className="mt-fieldset">
          <legend>Emplacement et notes</legend>
          <div className="mt-editor-grid">
            <label className="field">
              Emplacement
              <select value={d.location} onChange={(e) => set('location', e.target.value as LocationKey)}>
                <option value="etable">Étable ({rules.stableSlots} places)</option>
                <option value="inventaire">Inventaire / banque</option>
                {PADDOCK_UNLOCK_LEVELS.map((p, i) => {
                  const n = i + 1
                  const locked = n > unlocked
                  const occ = (occupancy.get(n) ?? 0) - (originalLocation === `enclos-${n}` ? 1 : 0)
                  return (
                    <option key={n} value={`enclos-${n}`} disabled={locked || occ >= PADDOCK_SLOTS}>
                      Enclos {n} — {locked ? `verrouillé (Éleveur niv. ${p.level})` : `${occ}/${PADDOCK_SLOTS} occupées`}
                    </option>
                  )
                })}
              </select>
              {err('location')}
            </label>
            <label className="field mt-span-2">
              Notes
              <textarea rows={2} value={d.notes} maxLength={1200} placeholder="ex. réservée au croisement avec la Pourpre ♀ n° 3" onChange={(e) => set('notes', e.target.value)} />
              {err('notes')}
            </label>
          </div>
        </fieldset>

        {warnings.length > 0 && (
          <Callout tone="warn">
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </Callout>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}

export function StatusBadge({ status }: { status: Fertility }) {
  const tone = status === 'feconde' ? 'ok' : status === 'fertile' ? 'info' : status === 'sterile' ? 'warn' : 'danger'
  return <Badge tone={tone}>{FERTILITY_LABELS[status]}</Badge>
}

function SerenityInput({ value, onChange, error }: { value: number; onChange: (v: number) => void; error?: string }) {
  const s = serenitySmiley(Number.isFinite(value) ? value : 0)
  return (
    <div className="mt-serenity">
      <div className="mt-serenity-head">
        <span className="mt-label">Sérénité</span>
        <SerenitySmiley serenity={Number.isFinite(value) ? value : 0} />
        <span className="muted">{s.short}</span>
      </div>
      <div className="mt-serenity-row">
        <input
          type="range"
          min={SERENITY_MIN}
          max={SERENITY_MAX}
          step={100}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Sérénité (curseur)"
          className="mt-range serenity"
        />
        <input type="number" min={SERENITY_MIN} max={SERENITY_MAX} step={1} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} aria-label="Sérénité (valeur)" style={{ width: 96 }} />
      </div>
      <div className="mt-band-buttons" role="group" aria-label="Je ne connais que le smiley">
        <span className="muted">Je ne connais que le smiley :</span>
        {SERENITY_BANDS.map((b) => (
          <button key={b} type="button" className={`btn small mt-band-btn ${SERENITY_SMILEYS[b].color}${s.band === b ? ' on' : ''}`} title={`${SERENITY_SMILEYS[b].label} — valeur approchée ${formatNumber(SERENITY_BAND_MIDPOINT[b])}`} onClick={() => onChange(SERENITY_BAND_MIDPOINT[b])}>
            {SERENITY_SMILEYS[b].face}
          </button>
        ))}
      </div>
      {error && <span className="mt-error">{error}</span>}
    </div>
  )
}

function GaugeInput({ label, hint, color, value, onChange, error }: { label: string; hint: string; color: string; value: number; onChange: (v: number) => void; error?: string }) {
  const v = Number.isFinite(value) ? value : 0
  return (
    <div className="mt-gauge-input">
      <div className="mt-gauge-input-head">
        <span className="mt-label">{label}</span>
        <small className="muted">{hint}</small>
      </div>
      <div className="mt-gauge-input-row">
        <input type="range" min={0} max={MOUNT_STAT_MAX} step={100} value={v} onChange={(e) => onChange(Number(e.target.value))} aria-label={`${label} (curseur)`} className="mt-range" style={{ accentColor: color }} />
        <input type="number" min={0} max={MOUNT_STAT_MAX} step={1} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} aria-label={`${label} (valeur)`} style={{ width: 92 }} />
        <button type="button" className="btn small" onClick={() => onChange(0)} aria-label={`${label} à 0`}>
          0
        </button>
        <button type="button" className="btn small" onClick={() => onChange(MOUNT_STAT_MAX)} aria-label={`${label} au maximum`}>
          Max
        </button>
      </div>
      <Progress value={v} max={MOUNT_STAT_MAX} color={color} />
      <small className="muted">
        {formatNumber(v)} / {formatNumber(MOUNT_STAT_MAX)}
        {v >= MOUNT_STAT_MAX ? ' — plein' : ''}
      </small>
      {error && <span className="mt-error">{error}</span>}
    </div>
  )
}
