// Page « Génétique » : explorer les arbres de croisement des trois familles, la fiche de chaque monture
// et le chemin (recette + effort attendu) depuis les captures.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { childrenOf, FAMILIES, FAMILY_IDS, findMakina, getSpecies, speciesOfFamily, statValue, STRATEGY } from '../../data'
import {
  ancestorsOf,
  cheapestRecipe,
  crossingChance,
  crossingOptions,
  descendantsOf,
  expectedEffort,
  recipeFor,
  requiredSpecies,
  type EffortEstimate,
  type RecipeNode,
  type RequiredSpecies,
} from '../../domain/breedingPath'
import { TAKEZA_BONUS, TARGET_BASE, TARGET_PER_LEVEL } from '../../domain/genetics'
import { resolvePrice } from '../../domain/pricing'
import type { Ruleset } from '../../domain/rules'
import type { FamilyId, Species } from '../../domain/types'
import { formatKamas, formatNumber, formatPercent } from '../../lib/format'
import { useInventory } from '../../store/inventory'
import { usePriceContext } from '../../store/prices'
import { useRules, useSettings } from '../../store/settings'
import { Badge, Callout, Card, Empty, NumberField, PageHeader, SelectField, Stat, Tabs } from '../components'
import { href, navigate, useRoute } from '../router'
import { ConfidenceBadge, GenBadge } from '../species'
import './GeneticsPage.css'

type KindFilter = 'toutes' | 'mono' | 'bi'
type OptiMode = 'none' | 'g6' | 'all'

interface EffortSettings {
  level: number
  opti: OptiMode
  cloning: boolean
  takeza: boolean
  recycle: boolean
}

const LEVEL_PRESETS = [1, 40, 100, 200]

/** Nom sans le préfixe de famille (« Volkorne Prune et Roux » → « Prune et Roux »). */
function shortName(s: Species): string {
  const prefix = `${FAMILIES[s.family].label} `
  return s.name.startsWith(prefix) ? s.name.slice(prefix.length) : s.name
}

function isMono(s: Species): boolean {
  return s.colors.length === 1
}

/** Nombre décimal lisible pour une espérance (« ≈ 3,4 », « ≈ 128 »). */
function approx(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `≈ ${formatNumber(n, n < 10 ? 1 : 0)}`
}

function SpeciesLink({ id, short = true }: { id: number; short?: boolean }) {
  const s = getSpecies(id)
  if (!s) return <span className="muted">#{id}</span>
  return (
    <a className="gen-link" href={href('genetique', { id })} title={s.name}>
      <GenBadge generation={s.generation} />
      <span className="gen-link-name">{short ? shortName(s) : s.name}</span>
    </a>
  )
}

export default function GeneticsPage() {
  const route = useRoute()
  const rules = useRules()
  const preferredFamily = useSettings((x) => x.family)
  const goalSpeciesId = useSettings((x) => x.goalSpeciesId)
  const parentTargetLevel = useSettings((x) => x.parentTargetLevel)
  const useOptimakina = useSettings((x) => x.useOptimakina)
  const mounts = useInventory((s) => s.mounts)

  const selectedId = Number(route.params.get('id')) || null
  const selected = selectedId !== null ? getSpecies(selectedId) : undefined
  const paramFamily = route.params.get('famille') as FamilyId | null
  const family: FamilyId = selected?.family ?? (paramFamily && FAMILY_IDS.includes(paramFamily) ? paramFamily : preferredFamily)

  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('toutes')
  const [onlyLineage, setOnlyLineage] = useState(false)
  const [level, setLevel] = useState(100)
  const [effort, setEffort] = useState<EffortSettings>(() => ({
    level: parentTargetLevel,
    opti: useOptimakina ? 'g6' : 'none',
    cloning: true,
    takeza: false,
    recycle: false,
  }))

  const owned = useMemo(() => {
    const m = new Map<number, number>()
    for (const x of mounts) m.set(x.speciesId, (m.get(x.speciesId) ?? 0) + 1)
    return m
  }, [mounts])

  const lineage = useMemo(() => {
    if (!selected) return { ancestors: new Set<number>(), recipe: new Set<number>(), children: new Set<number>() }
    const tree = cheapestRecipe(selected.id)
    return {
      ancestors: new Set(ancestorsOf(selected.id)),
      recipe: new Set(tree ? requiredSpecies(tree).map((r) => r.speciesId) : []),
      children: new Set(childrenOf(selected.id).map((c) => c.child)),
    }
  }, [selected])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = speciesOfFamily(family).filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false
      if (kind === 'mono' && !isMono(s)) return false
      if (kind === 'bi' && s.colors.length !== 2) return false
      if (onlyLineage && selected && s.id !== selected.id && !lineage.ancestors.has(s.id) && !lineage.children.has(s.id)) return false
      return true
    })
    const byGen = new Map<number, Species[]>()
    for (const s of list) byGen.set(s.generation, [...(byGen.get(s.generation) ?? []), s])
    for (const l of byGen.values()) l.sort((a, b) => Number(isMono(b)) - Number(isMono(a)) || a.name.localeCompare(b.name, 'fr'))
    // Générations 1 → 10, puis les spéciales (G0) à la fin.
    return [...byGen.entries()].sort((a, b) => (a[0] === 0 ? 99 : a[0]) - (b[0] === 0 ? 99 : b[0]))
  }, [family, query, kind, onlyLineage, selected, lineage])

  const shownCount = rows.reduce((s, [, l]) => s + l.length, 0)
  const detailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId || !detailRef.current) return
    if (window.matchMedia?.('(max-width: 1100px)').matches) detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedId])

  const tabs = FAMILY_IDS.map((f) => ({ id: f, label: `${FAMILIES[f].plural} · ${speciesOfFamily(f, { breedableOnly: true }).length}` }))

  return (
    <>
      <PageHeader
        title="Génétique"
        subtitle="Arbres de croisement, fiche de chaque monture et chemin le plus court depuis les captures."
        actions={<Badge tone="info" title={rules.label}>Règles {rules.id}</Badge>}
      />
      <Tabs tabs={tabs} value={family} onChange={(f) => navigate('genetique', { famille: f })} />
      <div className={`gen-layout${selected ? ' has-selection' : ''}`}>
        <div className="gen-browser">
          <Card>
            <div className="gen-filters">
              <label className="field" style={{ flex: 1, minWidth: 150 }}>
                Rechercher
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ex. Émeraude, Doré et…" />
              </label>
              <SelectField<KindFilter>
                label="Type"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'toutes', label: 'Toutes' },
                  { value: 'mono', label: 'Monocolores' },
                  { value: 'bi', label: 'Bicolores' },
                ]}
              />
              <label className="gen-check" title={selected ? undefined : 'Choisissez d’abord une monture'}>
                <input type="checkbox" checked={onlyLineage} disabled={!selected} onChange={(e) => setOnlyLineage(e.target.checked)} />
                Seulement sa lignée
              </label>
            </div>
            <div className="gen-legend" aria-hidden>
              <span>
                <i className="gen-swatch sel" /> sélection
              </span>
              <span>
                <i className="gen-swatch rec" /> chemin le moins cher
              </span>
              <span>
                <i className="gen-swatch anc" /> autre ascendance possible
              </span>
              <span>
                <i className="gen-swatch kid" /> enfants directs
              </span>
              <span>⌖ capturable</span>
              <span>🎯 objectif</span>
              <span>
                <span className="gen-chip-count">×2</span> possédées
              </span>
            </div>
            <small>
              {shownCount} monture{shownCount > 1 ? 's' : ''} affichée{shownCount > 1 ? 's' : ''}. Les monocolores (en gras) des générations
              impaires sont les « pivots » de l'arbre ; une bicolore « X et Y » s'obtient toujours en croisant X × Y.
            </small>
            {rows.length === 0 && <Empty>Aucune monture ne correspond à ces filtres.</Empty>}
            {rows.map(([gen, list]) => (
              <div key={gen} className="gen-row">
                <div className="gen-row-head">
                  {gen === 0 ? <Badge>Spéciales</Badge> : <GenBadge generation={gen} />}
                  <span>
                    {gen === 0
                      ? 'non élevables (ni accouplement, ni extraction)'
                      : gen === 1
                        ? `${list.length} capturable${list.length > 1 ? 's' : ''}`
                        : `${list.length} monture${list.length > 1 ? 's' : ''}`}
                  </span>
                </div>
                <div className="gen-chips">
                  {list.map((s) => {
                    const cls = [
                      'gen-chip',
                      isMono(s) ? 'is-mono' : '',
                      s.id === selected?.id
                        ? 'is-selected'
                        : lineage.recipe.has(s.id)
                          ? 'is-recipe'
                          : lineage.ancestors.has(s.id)
                            ? 'is-ancestor'
                            : lineage.children.has(s.id)
                              ? 'is-child'
                              : '',
                    ]
                      .filter(Boolean)
                      .join(' ')
                    const n = owned.get(s.id) ?? 0
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={cls}
                        aria-pressed={s.id === selected?.id}
                        title={`${s.name} — génération ${s.generation}${n ? ` — ${n} possédée${n > 1 ? 's' : ''}` : ''}`}
                        onClick={() => navigate('genetique', { id: s.id })}
                      >
                        <span className="gen-chip-name">{shortName(s)}</span>
                        {s.capturable && (
                          <span className="gen-chip-tag" aria-label="capturable">
                            ⌖
                          </span>
                        )}
                        {goalSpeciesId === s.id && <span aria-label="objectif">🎯</span>}
                        {n > 0 && <span className="gen-chip-count">×{n}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </Card>
        </div>
        <div className="gen-detail" ref={detailRef}>
          {selected ? (
            <SpeciesDetail
              key={selected.id}
              species={selected}
              rules={rules}
              level={level}
              setLevel={setLevel}
              effort={effort}
              setEffort={setEffort}
              ownedCount={owned.get(selected.id) ?? 0}
            />
          ) : (
            <FamilyOverview family={family} rules={rules} />
          )}
        </div>
      </div>
    </>
  )
}

// ---------- Vue d'ensemble d'une famille (aucune monture sélectionnée) ----------

function FamilyOverview({ family, rules }: { family: FamilyId; rules: Ruleset }) {
  const info = FAMILIES[family]
  const goalId = useSettings((s) => s.goalSpeciesId)
  const goal = goalId !== null ? getSpecies(goalId) : undefined
  const all = speciesOfFamily(family, { breedableOnly: true })
  const perGen = Array.from({ length: 10 }, (_, i) => all.filter((s) => s.generation === i + 1).length)
  const g1 = all.filter((s) => s.generation === 1)
  const specials = speciesOfFamily(family).filter((s) => !s.breedable)
  return (
    <>
      <Card title={info.plural}>
        <Empty>
          Choisissez une monture dans l'arbre pour voir ses croisements, ses statistiques, ce qu'elle permet d'obtenir et le chemin le plus
          court depuis les captures.
          {goal && (
            <div style={{ marginTop: 10 }}>
              <a className="btn primary" href={href('genetique', { id: goal.id })}>
                🎯 Voir mon objectif : {goal.name}
              </a>
            </div>
          )}
        </Empty>
        <div className="gen-facts">
          <Stat label="Montures élevables" value={all.length} hint={specials.length ? `+ ${specials.length} spéciales non élevables` : undefined} />
          <Stat label="Capturables (G1)" value={g1.length} hint={g1.map(shortName).join(', ')} />
          <Stat label="Bonus commun" value={<span style={{ fontSize: '0.95rem' }}>{info.commonBonus}</span>} />
          <Stat label="Extraction" value={<span style={{ fontSize: '0.95rem' }}>{info.extractionItemName}</span>} hint="quantité = génération" />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Génération</th>
                {perGen.map((_, i) => (
                  <th key={i} className="num">
                    G{i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Montures</td>
                {perGen.map((n, i) => (
                  <td key={i} className="num">
                    {n}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Génétons / parent ({rules.id})</td>
                {perGen.map((_, i) => (
                  <td key={i} className="num">
                    {rules.genetonsByGeneration[i + 1] ?? 0}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      <CaptureZoneCard family={family} />
      <Card title="Lire l'arbre">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Un croisement donne au plus une monture, de génération = génération max des parents + 1.</li>
          <li>
            Le bébé n'est pas garanti : la génération cible sort avec {formatPercent(TARGET_BASE, 0)} de base, +{formatPercent(TARGET_PER_LEVEL, 2)}{' '}
            par niveau cumulé des parents, +{formatPercent(rules.optimakinaBonus, 0)} avec Optimakina (règles {rules.id}) et +
            {formatPercent(TAKEZA_BONUS, 0)} le jour Takeza.
          </li>
          <li>
            {family === 'dragodinde'
              ? 'Dragodindes : un seul croisement par monture.'
              : `${info.plural} : les monocolores de génération impaire ont plusieurs croisements possibles ; l'application retient le moins cher en captures.`}
          </li>
          <li>Les génétons ne tombent que si le bébé dépasse toutes les générations des deux arbres (parents et grands-parents).</li>
        </ul>
      </Card>
    </>
  )
}

function CaptureZoneCard({ family, monsterId }: { family: FamilyId; monsterId?: number | null }) {
  const zone = FAMILIES[family].captureZone
  if (!zone) return null
  const monster = monsterId ? zone.monsters.find((m) => m.id === monsterId) : undefined
  return (
    <Card title="Où capturer">
      <dl className="gen-dl">
        <dt>Zone</dt>
        <dd>
          {zone.subarea} ({zone.area})
        </dd>
        <dt>Coordonnées</dt>
        <dd>
          x {zone.xRange[0]} → {zone.xRange[1]}, y {zone.yRange[0]} → {zone.yRange[1]}
        </dd>
        <dt>Zaap le plus proche</dt>
        <dd>
          {zone.nearestZaap.name} [{zone.nearestZaap.coords.join(',')}]
        </dd>
        <dt>Niveau des montures</dt>
        <dd>
          {zone.levels[0]} à {zone.levels[1]}
        </dd>
        {monsterId ? (
          <>
            <dt>Monstre</dt>
            <dd>{monster ? `${monster.name} (n° ${monster.id})` : `monstre n° ${monsterId}`}</dd>
          </>
        ) : (
          <>
            <dt>Monstres</dt>
            <dd>{zone.monsters.map((m) => m.name + (m.archimonster ? ' (archimonstre)' : '')).join(', ')}</dd>
          </>
        )}
      </dl>
      {monsterId && !monster && (
        <Callout tone="warn">
          Ce monstre n'apparaît pas dans la liste de la zone enregistrée : la zone de capture de cette couleur est à vérifier en jeu.
        </Callout>
      )}
      <small>Équiper un filet en consommable donne le sort « Apprivoisement de monture » : capture à 100 % si le combat est gagné. 30 XP d'Éleveur par monture capturée.</small>
    </Card>
  )
}

// ---------- Fiche d'une monture ----------

interface DetailProps {
  species: Species
  rules: Ruleset
  level: number
  setLevel: (l: number) => void
  effort: EffortSettings
  setEffort: (e: EffortSettings) => void
  ownedCount: number
}

function SpeciesDetail({ species, rules, level, setLevel, effort, setEffort, ownedCount }: DetailProps) {
  const s = species
  const info = FAMILIES[s.family]
  const goalId = useSettings((x) => x.goalSpeciesId)
  const updateSettings = useSettings((x) => x.update)
  const options = useMemo(() => (s.breedable ? crossingOptions(s.id) : []), [s])
  const [recipeCrossing, setRecipeCrossing] = useState<[number, number] | null>(options[0]?.crossing ?? null)
  const isGoal = goalId === s.id
  const genetons = s.genetons[rules.id] ?? 0
  const mainSim = recipeCrossing ? href('accouplement', { a: recipeCrossing[0], b: recipeCrossing[1] }) : href('accouplement', { a: s.id })

  return (
    <>
      <Card>
        <div className="gen-title">
          <GenBadge generation={s.generation} />
          <h2>{s.name}</h2>
          <Badge>{isMono(s) ? 'Monocolore' : s.colors.length === 2 ? 'Bicolore' : 'Spéciale'}</Badge>
          {s.capturable && <Badge tone="ok">Capturable</Badge>}
          {!s.breedable && <Badge tone="warn">Non élevable</Badge>}
          {isGoal && <Badge tone="accent">🎯 Objectif</Badge>}
          {ownedCount > 0 && (
            <a href={href('montures')} className="badge info" style={{ textDecoration: 'none' }}>
              {ownedCount} possédée{ownedCount > 1 ? 's' : ''}
            </a>
          )}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          {s.breedable && (
            <a className="btn primary" href={mainSim} title={recipeCrossing ? 'Ouvre le simulateur avec le croisement retenu' : 'Ouvre le simulateur avec cette monture comme parent'}>
              🥚 Simuler un accouplement
            </a>
          )}
          {s.breedable &&
            (isGoal ? (
              <button className="btn" onClick={() => updateSettings({ goalSpeciesId: null })}>
                Retirer l'objectif
              </button>
            ) : (
              <button className="btn" onClick={() => updateSettings({ goalSpeciesId: s.id })} title="Le plan d'élevage visera cette monture">
                🎯 Définir comme objectif
              </button>
            ))}
          {isGoal && (
            <a className="btn ghost" href={href('plan')}>
              Voir le plan →
            </a>
          )}
        </div>
        <div className="gen-facts">
          <Stat label="Génération" value={s.generation === 0 ? 'Spéciale (G0)' : `G${s.generation}`} />
          <Stat label="Couleurs" value={<span style={{ fontSize: '0.95rem' }}>{s.colors.length ? s.colors.join(' + ') : '—'}</span>} />
          <Stat
            label={`Génétons comme parent (${rules.id})`}
            value={genetons}
            hint={
              s.generation === 10
                ? 'une G10 ne rapporte pas de génétons'
                : s.generation === 0
                  ? '—'
                  : genetons === 0
                    ? '0 dans les données du client (probable bug, non confirmé en jeu)'
                    : 'si le bébé dépasse tout l’arbre'
            }
          />
          <Stat
            label="Extraction"
            value={s.extractionQty}
            hint={s.generation === 1 ? 'une G1 ne s’extrait pas' : `${info.extractionItemName} (détruit la monture)`}
          />
          <Stat label="XP d'Éleveur (parent)" value={s.generation > 0 ? `+${rules.matingXpPerGeneration * s.generation}` : '—'} hint="par accouplement" />
          <Stat label="Poids génétique" value={s.geneticWeight} hint="pèse sur les issues « autres »" />
        </div>
        <dl className="gen-dl">
          <dt>Objet-monture</dt>
          <dd>{s.itemId ? `n° ${s.itemId} — équipable dès le niveau 60 (prix d'HDV : page Prix)` : '—'}</dd>
          <dt>Bonus commun</dt>
          <dd>
            {info.plural} : {info.commonBonus}
          </dd>
          {s.breedable && s.generation >= 2 && (
            <>
              <dt>Makina utilisable</dt>
              <dd>
                génération ≥ G{s.generation} (ex. {findMakina('optimakina', s.family, s.generation)?.name ?? `Optimakina G${s.generation}`})
              </dd>
            </>
          )}
        </dl>
        {!s.breedable && (
          <Callout tone="warn">Monture spéciale : elle ne peut ni s'accoupler ni être extraite. Elle n'entre dans aucun croisement.</Callout>
        )}
      </Card>

      {s.capturable && <CaptureZoneCard family={s.family} monsterId={s.captureMonsterId} />}

      <StatsCard species={s} level={level} setLevel={setLevel} />

      {s.breedable && (
        <CrossingsCard species={s} rules={rules} effort={effort} recipeCrossing={recipeCrossing} setRecipeCrossing={setRecipeCrossing} />
      )}

      {s.breedable && <ChildrenCard species={s} />}

      {s.breedable && <PathCard species={s} rules={rules} effort={effort} setEffort={setEffort} recipeCrossing={recipeCrossing} />}
    </>
  )
}

function StatsCard({ species, level, setLevel }: { species: Species; level: number; setLevel: (l: number) => void }) {
  const refLevels = [100, 200].filter((l) => l !== level)
  return (
    <Card title="Statistiques">
      <div className="gen-level">
        <label htmlFor="gen-level" className="muted" style={{ fontSize: '0.85rem' }}>
          Niveau
        </label>
        <input id="gen-level" type="range" min={1} max={200} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
        <output htmlFor="gen-level">Niv. {level}</output>
        <div className="row" style={{ gap: 4 }}>
          {LEVEL_PRESETS.map((l) => (
            <button key={l} type="button" className={`btn small${l === level ? ' gen-btn-active' : ''}`} onClick={() => setLevel(l)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {species.stats.length === 0 ? (
        <Empty>Aucune statistique connue.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Caractéristique</th>
                <th className="num">Niv. {level}</th>
                {refLevels.map((l) => (
                  <th key={l} className="num">
                    Niv. {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {species.stats.map((st) => (
                <tr key={st.effectId}>
                  <td>{st.name}</td>
                  <td className="num">
                    <strong>{statValue(st, level)}</strong>
                  </td>
                  {refLevels.map((l) => (
                    <td key={l} className="num muted">
                      {statValue(st, l)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <small>
        Valeur = taux par niveau du client (progression linéaire jusqu'au niveau 100, puis plus lente), arrondie à l'inférieur entre deux
        paliers <ConfidenceBadge level="medium" />. PM et PA n'apparaissent qu'au niveau 100.
      </small>
    </Card>
  )
}

function CrossingsCard({
  species,
  rules,
  effort,
  recipeCrossing,
  setRecipeCrossing,
}: {
  species: Species
  rules: Ruleset
  effort: EffortSettings
  recipeCrossing: [number, number] | null
  setRecipeCrossing: (c: [number, number]) => void
}) {
  const s = species
  const useOpti = effort.opti === 'all' || (effort.opti === 'g6' && s.generation >= 6)
  const rows = useMemo(
    () =>
      crossingOptions(s.id).map((o) => ({
        ...o,
        chance: crossingChance(s.id, o.crossing, { parentLevel: effort.level, makina: useOpti ? 'optimakina' : 'none', rules, takeza: effort.takeza }),
      })),
    [s, effort.level, effort.takeza, useOpti, rules],
  )
  if (s.generation === 1)
    return (
      <Card title="Comment l'obtenir">
        <p>
          <strong>Capture uniquement</strong> (génération 1). Une {shortName(s)} peut aussi naître comme bébé « hors cible » d'un accouplement dont
          l'arbre contient sa couleur.
        </p>
      </Card>
    )
  const same = (c: [number, number]) => recipeCrossing !== null && c[0] === recipeCrossing[0] && c[1] === recipeCrossing[1]
  return (
    <Card title={`Croisements (${rows.length})`}>
      <p className="muted" style={{ fontSize: '0.88rem' }}>
        Chance calculée pour deux parents « propres » (issus de leur recette) au niveau {effort.level}
        {useOpti ? ', avec Optimakina' : ', sans makina'}
        {effort.takeza ? ', jour Takeza' : ''}. « Captures min. » = montures G1 nécessaires si chaque accouplement réussissait.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Parents</th>
              <th>Gén.</th>
              <th className="num">Captures min.</th>
              <th className="num">Chance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.crossing.join('-')}>
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    <SpeciesLink id={o.crossing[0]} />
                    <span className="muted">×</span>
                    <SpeciesLink id={o.crossing[1]} />
                  </span>
                  <span className="row" style={{ gap: 4, marginTop: 2 }}>
                    {o.cheapest && <Badge tone="ok">la moins chère</Badge>}
                    {same(o.crossing) && <Badge tone="accent">chemin affiché</Badge>}
                    {o.chance.sharedWith.length > 0 && (
                      <Badge tone="warn" title={o.chance.sharedWith.map((x) => getSpecies(x)?.name).join(', ')}>
                        cible partagée
                      </Badge>
                    )}
                  </span>
                </td>
                <td>
                  G{getSpecies(o.crossing[0])?.generation} + G{getSpecies(o.crossing[1])?.generation}
                </td>
                <td className="num">{o.captures}</td>
                <td className="num" title={`Génération cible : ${formatPercent(o.chance.targetChance)}`}>
                  {formatPercent(o.chance.chance)}
                </td>
                <td>
                  <span className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    {!same(o.crossing) && rows.length > 1 && (
                      <button className="btn small" onClick={() => setRecipeCrossing(o.crossing)} title="Afficher le chemin depuis les captures avec ce croisement">
                        Chemin
                      </button>
                    )}
                    <a className="btn small" href={href('accouplement', { a: o.crossing[0], b: o.crossing[1] })}>
                      Simuler
                    </a>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function ChildrenCard({ species }: { species: Species }) {
  const rows = useMemo(
    () =>
      childrenOf(species.id)
        .map((c) => ({ ...c, cs: getSpecies(c.child), ps: getSpecies(c.partner) }))
        .filter((c): c is typeof c & { cs: Species; ps: Species } => !!c.cs && !!c.ps)
        .sort((a, b) => a.cs.generation - b.cs.generation || a.cs.name.localeCompare(b.cs.name, 'fr')),
    [species],
  )
  const desc = useMemo(() => descendantsOf(species.id), [species])
  const g10 = desc.filter((d) => getSpecies(d)?.generation === 10).length
  return (
    <Card title="Ce qu'elle permet d'obtenir">
      {rows.length === 0 ? (
        <Empty>
          {species.generation === 10 ? 'Génération maximale : aucune monture ne descend d’une G10.' : 'Aucun croisement ne part de cette monture.'}
        </Empty>
      ) : (
        <>
          <p className="muted" style={{ fontSize: '0.88rem' }}>
            {rows.length} croisement{rows.length > 1 ? 's' : ''} direct{rows.length > 1 ? 's' : ''} ; {desc.length} monture
            {desc.length > 1 ? 's' : ''} en descendent au total{g10 ? `, dont ${g10} G10` : ''}.
          </p>
          <div className="table-wrap gen-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Avec</th>
                  <th>Donne</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.partner}>
                    <td>
                      <SpeciesLink id={r.partner} />
                    </td>
                    <td>
                      <SpeciesLink id={r.child} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <a className="btn small" href={href('accouplement', { a: species.id, b: r.partner })}>
                        Simuler
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

// ---------- Chemin depuis les captures ----------

function RecipeTreeNode({ node, depth }: { node: RecipeNode; depth: number }) {
  const s = getSpecies(node.speciesId)
  const label: ReactNode = (
    <span className="gen-tree-node">
      <SpeciesLink id={node.speciesId} />
      {node.parents ? (
        <span className="gen-tree-x">
          {node.captures} capture{node.captures > 1 ? 's' : ''}
        </span>
      ) : (
        <Badge tone="ok">capture</Badge>
      )}
    </span>
  )
  if (!node.parents || !s) return <li className="gen-tree-leaf">{label}</li>
  return (
    <li>
      <details open={depth < 2}>
        <summary>{label}</summary>
        <ul>
          <RecipeTreeNode node={node.parents[0]} depth={depth + 1} />
          <RecipeTreeNode node={node.parents[1]} depth={depth + 1} />
        </ul>
      </details>
    </li>
  )
}

function PathCard({
  species,
  rules,
  effort,
  setEffort,
  recipeCrossing,
}: {
  species: Species
  rules: Ruleset
  effort: EffortSettings
  setEffort: (e: EffortSettings) => void
  recipeCrossing: [number, number] | null
}) {
  const s = species
  const tree = useMemo(() => (recipeCrossing ? recipeFor(s.id, recipeCrossing) : cheapestRecipe(s.id)), [s, recipeCrossing])
  const isCheapest = useMemo(
    () => !recipeCrossing || crossingOptions(s.id).some((o) => o.cheapest && o.crossing[0] === recipeCrossing[0] && o.crossing[1] === recipeCrossing[1]),
    [s, recipeCrossing],
  )
  const required = useMemo(() => (tree ? requiredSpecies(tree) : []), [tree])
  const estimate = useMemo<EffortEstimate | null>(() => {
    if (!tree || !tree.parents) return null
    return expectedEffort(s.id, {
      recipe: tree,
      parentLevel: effort.level,
      makina: effort.opti === 'none' ? 'none' : 'optimakina',
      optimakinaFromGeneration: effort.opti === 'g6' ? 6 : 2,
      cloning: effort.cloning,
      takeza: effort.takeza,
      recycleByproducts: effort.recycle,
      rules,
    })
  }, [s, tree, effort, rules])
  if (!tree) return null
  if (!tree.parents)
    return (
      <Card title="Chemin depuis les captures">
        <p>
          Se capture directement : aucun accouplement nécessaire. Voir « Où capturer » ci-dessus.
        </p>
      </Card>
    )
  const g1 = required.filter((r) => r.generation === 1)
  const intermediates = required.filter((r) => r.generation > 1 && r.speciesId !== s.id)
  return (
    <>
      <Card title="Chemin depuis les captures">
        <p className="muted" style={{ fontSize: '0.88rem' }}>
          {isCheapest ? 'Recette la moins chère en captures' : 'Recette choisie (plus chère que le minimum)'} : chaque espèce intermédiaire suit
          son croisement le moins cher. Chiffres « idéaux » : chaque accouplement donnerait le bon bébé, sans clonage ni Reproducteur — c'est un minimum théorique.
        </p>
        <div className="gen-facts">
          <Stat label="Captures minimales" value={tree.captures} hint="montures G1" />
          <Stat label="Accouplements minimaux" value={tree.captures - 1} />
          <Stat label="Espèces intermédiaires" value={intermediates.length} hint={`G2 → G${s.generation - 1}`} />
        </div>
        <h3>Captures par couleur</h3>
        <div className="gen-colors" style={{ marginBottom: 12 }}>
          {g1.map((r) => (
            <span key={r.speciesId} className="badge accent" title={getSpecies(r.speciesId)?.name}>
              {shortName(getSpecies(r.speciesId) as Species)} × {r.count}
              {estimate && <span className="muted"> (≈ {formatNumber(estimate.capturesByColor.get(r.speciesId) ?? 0, 0)} en pratique)</span>}
            </span>
          ))}
        </div>
        <h3>Arbre de la recette</h3>
        <ul className="gen-tree">
          <RecipeTreeNode node={tree} depth={0} />
        </ul>
        <small>Cliquez sur une ligne pour déplier ; les G1 sont à capturer. Les espèces qui reviennent plusieurs fois doivent être produites autant de fois.</small>
      </Card>
      {estimate && <EffortCard species={s} estimate={estimate} required={required} effort={effort} setEffort={setEffort} rules={rules} />}
    </>
  )
}

function EffortCard({
  species,
  estimate,
  required,
  effort,
  setEffort,
  rules,
}: {
  species: Species
  estimate: EffortEstimate
  required: RequiredSpecies[]
  effort: EffortSettings
  setEffort: (e: EffortSettings) => void
  rules: Ruleset
}) {
  const ctx = usePriceContext()
  const idealCount = new Map(required.map((r) => [r.speciesId, r.count]))
  const steps = [...estimate.nodes].reverse()

  // Coût des Optimakinas : une makina de la génération du bébé visé par accouplement.
  const optiCost = useMemo(() => {
    let total = 0
    let complete = true
    const missing: string[] = []
    for (const n of estimate.nodes) {
      if (!n.optimakina || n.matings <= 0) continue
      const mk = findMakina('optimakina', species.family, n.generation)
      if (!mk) {
        complete = false
        missing.push(`Optimakina G${n.generation}`)
        continue
      }
      const p = resolvePrice(mk.id, ctx)
      if (p.price !== null) total += p.price * n.matings
      if (p.price === null || !p.complete) {
        complete = false
        missing.push(mk.name)
      }
    }
    return { total, complete, missing: [...new Set(missing)] }
  }, [estimate, ctx, species.family])

  const set = (patch: Partial<EffortSettings>) => setEffort({ ...effort, ...patch })
  return (
    <Card title="Effort attendu avec vos réglages" actions={<ConfidenceBadge level="low" />}>
      <div className="gen-filters">
        <NumberField label="Niveau des parents" value={effort.level} min={1} max={200} onChange={(v) => set({ level: Math.round(v) })} width={80} />
        <SelectField<OptiMode>
          label="Optimakina"
          value={effort.opti}
          onChange={(v) => set({ opti: v })}
          options={[
            { value: 'none', label: 'Aucune' },
            { value: 'g6', label: 'Dès la G6 (recommandé)' },
            { value: 'all', label: 'À chaque accouplement' },
          ]}
        />
        <label className="gen-check">
          <input type="checkbox" checked={effort.cloning} onChange={(e) => set({ cloning: e.target.checked })} />
          Clonage systématique
        </label>
        <label className="gen-check">
          <input type="checkbox" checked={effort.takeza} onChange={(e) => set({ takeza: e.target.checked })} />
          Jour Takeza
        </label>
        <label className="gen-check" title="Borne optimiste : ignore les sexes et les délais">
          <input type="checkbox" checked={effort.recycle} onChange={(e) => set({ recycle: e.target.checked })} />
          Réutiliser les bébés hors cible
        </label>
      </div>
      <small>
        Valeurs initiales reprises des <a href={href('reglages')}>réglages</a> (niveau visé des parents, Optimakina). Règles {rules.id} :
        Optimakina +{formatPercent(rules.optimakinaBonus, 0)}.
      </small>
      <div className="gen-facts">
        <Stat label="Captures" value={approx(estimate.captures)} hint={`idéal sans clonage : ${estimate.ideal.captures}`} />
        <Stat label="Accouplements" value={approx(estimate.matings)} hint={`idéal sans clonage : ${estimate.ideal.matings}`} />
        <Stat label="Fécondations" value={approx(estimate.fecundations)} hint="2 par accouplement" />
        {effort.cloning && <Stat label="Clonages" value={approx(estimate.clonings)} />}
        {estimate.optimakinas > 0 && <Stat label="Optimakinas" value={approx(estimate.optimakinas)} />}
        <Stat label="Génétons en route" value={approx(estimate.genetons)} hint={`règles ${rules.id}`} />
        <Stat label="XP d'Éleveur" value={approx(estimate.jobXp.total)} hint={`dont captures ${formatNumber(estimate.jobXp.captures, 0)}`} />
      </div>
      {estimate.optimakinas > 0 && (
        <p style={{ fontSize: '0.9rem' }}>
          Coût des Optimakinas :{' '}
          <strong>
            {optiCost.total > 0 ? `${optiCost.complete ? '≈' : 'au moins ≈'} ${formatKamas(optiCost.total, true)}` : 'inconnu'}
          </strong>{' '}
          {!optiCost.complete && (
            <>
              <Badge tone="warn">coût incomplet</Badge>{' '}
              <small>
                prix manquants pour{' '}
                {optiCost.missing.slice(0, 3).map((m, i) => (
                  <span key={m}>
                    {i > 0 && ', '}
                    <a href={href('prix', { q: m })}>{m}</a>
                  </span>
                ))}
                {optiCost.missing.length > 3 && ` et ${optiCost.missing.length - 3} autres`} — à saisir dans la page Prix.
              </small>
            </>
          )}
        </p>
      )}
      <h3>Étapes, des captures à la cible</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Monture</th>
              <th>Comment</th>
              <th className="num" title="Exemplaires dans la recette idéale">Idéal</th>
              <th className="num" title="Exemplaires à obtenir en moyenne">À obtenir</th>
              <th className="num">Accoupl.</th>
              <th className="num" title="Chance d'obtenir cette monture à chaque accouplement">Chance</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((n) => (
              <tr key={n.speciesId}>
                <td>
                  <SpeciesLink id={n.speciesId} />
                </td>
                <td>
                  {n.crossing ? (
                    <span className="row" style={{ gap: 4 }}>
                      <span className="muted">croiser</span> {shortName(getSpecies(n.crossing[0]) as Species)} ×{' '}
                      {shortName(getSpecies(n.crossing[1]) as Species)}
                      {n.optimakina && <Badge tone="info">Opti</Badge>}
                    </span>
                  ) : (
                    <span className="muted">capturer</span>
                  )}
                </td>
                <td className="num">{idealCount.get(n.speciesId) ?? '—'}</td>
                <td className="num">
                  {approx(n.needed)}
                  {n.recycled > 0.05 && <small className="muted"> (+{formatNumber(n.recycled, 1)} recyclés)</small>}
                </td>
                <td className="num">{n.crossing ? approx(n.matings) : '—'}</td>
                <td className="num">{n.crossing ? formatPercent(n.chance) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Callout>
        <strong>Comment lire ces chiffres ?</strong> Ce sont des <strong>moyennes</strong> calculées avec le modèle de naissance validé en jeu.
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {estimate.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </Callout>
      <details>
        <summary className="muted" style={{ cursor: 'pointer' }}>
          Repères de la simulation Monte-Carlo de la recherche (60 places, sexes et places compris)
        </summary>
        <ul style={{ paddingLeft: 18 }}>
          {STRATEGY.simulation.keyFindings.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
        <small>
          Limites : {STRATEGY.simulation.caveats.join(' ; ')}. Écarts avec cette estimation : les captures sont plus élevées ici sur les
          longues chaînes sans makina (bébés hors cible non réutilisés), plus basses au niveau 100 (la simulation capture pour remplir les
          places).
        </small>
      </details>
    </Card>
  )
}
