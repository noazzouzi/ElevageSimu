// Composants partagés autour des espèces de montures.
import { useMemo, useState } from 'react'
import { FAMILIES, FAMILY_IDS, getSpecies, SPECIES } from '../data'
import type { FamilyId, Species } from '../domain/types'

export function GenBadge({ generation }: { generation: number }) {
  return (
    <span className="badge gold" title={`Génération ${generation}`}>
      G{generation}
    </span>
  )
}

export function SpeciesName({ id, withGen = true }: { id: number; withGen?: boolean }) {
  const s = getSpecies(id)
  if (!s) return <span className="muted">#{id}</span>
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      {withGen && <GenBadge generation={s.generation} />}
      <span>{s.name}</span>
    </span>
  )
}

export function ConfidenceBadge({ level }: { level?: string | null }) {
  if (!level) return null
  const l = level.toLowerCase()
  const tone = l.startsWith('high') ? 'ok' : l.startsWith('medium') ? 'info' : 'warn'
  const label = l.startsWith('high') ? 'fiable' : l.startsWith('medium') ? 'moyenne' : 'estimation'
  return (
    <span className={`badge ${tone}`} title={`Confiance : ${level}`}>
      {label}
    </span>
  )
}

/** Sélecteur d'espèce : famille + recherche + liste groupée par génération. */
export function SpeciesPicker({
  value,
  onChange,
  family,
  onFamilyChange,
  filter,
  label = 'Monture',
  allowEmpty = false,
}: {
  value: number | null
  onChange: (id: number | null) => void
  family?: FamilyId
  onFamilyChange?: (f: FamilyId) => void
  filter?: (s: Species) => boolean
  label?: string
  allowEmpty?: boolean
}) {
  const current = value !== null ? getSpecies(value) : undefined
  const [localFamily, setLocalFamily] = useState<FamilyId>(family ?? current?.family ?? 'muldo')
  const fam = family ?? localFamily
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = SPECIES.filter((s) => s.family === fam && s.breedable && (!filter || filter(s)) && (!q || s.name.toLowerCase().includes(q)))
    const byGen = new Map<number, Species[]>()
    for (const s of list) byGen.set(s.generation, [...(byGen.get(s.generation) ?? []), s])
    return [...byGen.entries()].sort((a, b) => a[0] - b[0])
  }, [fam, query, filter])
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6 }}>
        {!family || onFamilyChange ? (
          <label className="field">
            Famille
            <select
              value={fam}
              onChange={(e) => {
                const f = e.target.value as FamilyId
                setLocalFamily(f)
                onFamilyChange?.(f)
                if (current && current.family !== f) onChange(null)
              }}
            >
              {FAMILY_IDS.map((f) => (
                <option key={f} value={f}>
                  {FAMILIES[f].label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field" style={{ flex: 1, minWidth: 140 }}>
          Rechercher
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ex. Émeraude" />
        </label>
      </div>
      <label className="field">
        {label}
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
          {(allowEmpty || value === null) && <option value="">— Choisir —</option>}
          {current && current.family === fam && !groups.some(([, l]) => l.some((s) => s.id === current.id)) && (
            <option value={current.id}>{current.name}</option>
          )}
          {groups.map(([gen, list]) => (
            <optgroup key={gen} label={`Génération ${gen}`}>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  )
}
