// Page « Accouplement » : simulateur d'accouplement (probabilités, chance de génération cible,
// génétons, makinas), couples recommandés de l'étable avec plan d'appariement et enregistrement des
// naissances, historique et calibration du modèle sur vos naissances réelles.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FAMILIES, FAMILY_IDS, getSpecies, speciesOfFamily } from '../../data'
import { almanaxOn, isoDaysBetween, TAKEZA_DATES, type AlmanaxEffect } from '../../domain/almanax'
import { cleanParent } from '../../domain/breedingPath'
import { ABILITY_LABELS } from '../../domain/constants'
import { genetonKamasValue, makinaCost, mountValuation, type MakinaCost, type MountValuation } from '../../domain/economy'
import { POSITION_WEIGHT_PARENT, POSITION_WEIGHT_SELF, TARGET_BASE, TARGET_PER_LEVEL, TAKEZA_BONUS, type BreedingParent, type BreedingResult } from '../../domain/genetics'
import { effectiveFertility, FERTILITY_LABELS, GENDER_ICONS, GENDER_LABELS, mountName } from '../../domain/mounts'
import {
  ACQUISITION_METHOD_LABELS,
  analyzePair,
  bestDisjointPairs,
  CALIBRATION_MIN_BIRTHS,
  clonePairSummary,
  economyCoupleCost,
  MAKINA_LABELS,
  MAKINA_POLICY_LABELS,
  matingCalibration,
  OBJECTIVE_LABELS,
  objectiveFromGoal,
  OPTIMAKINA_SYSTEMATIC_GENERATION,
  rankPairs,
  recordMating,
  STACK_MIN_ATTEMPTS,
  sterileClonePairs,
  SUCCESS_BASIS_LABELS,
  TAKEZA_PRIORITY_GENERATION,
  targetBreakdown,
  theMakina,
  type BabyChoice,
  type CoupleCostBreakdown,
  type CoupleCostModel,
  type MakinaAdvice,
  type MakinaPolicy,
  type MatingCalibration,
  type MatingRecord,
  type PairAnalysis,
  type PairingObjective,
  type PairSuggestion,
  type TargetBreakdown,
} from '../../domain/pairing'
import type { Ruleset } from '../../domain/rules'
import type { Ability, FamilyId, Gender, MakinaKind, Mount, Species } from '../../domain/types'
import { capitalize, formatDate, formatIsoDay, formatKamas, formatNumber, formatPercent } from '../../lib/format'
import { useInventory } from '../../store/inventory'
import { useJournal, type JournalEntry } from '../../store/journal'
import { usePriceContext, usePrices } from '../../store/prices'
import { useRules, useSettings } from '../../store/settings'
import { Badge, Callout, Card, Empty, NumberField, PageHeader, SelectField, Stat, Tabs } from '../components'
import { href, useRoute } from '../router'
import { ConfidenceBadge, GenBadge, SpeciesName, SpeciesPicker } from '../species'
import { useServerDay } from '../useServerDay'
import './BreedingPage.css'

type TabId = 'simulateur' | 'couples' | 'historique'
type MakinaChoice = 'none' | MakinaKind
type MatingEntry = Extract<JournalEntry, { kind: 'accouplement' }>

const TAB_IDS: TabId[] = ['simulateur', 'couples', 'historique']
const LEVEL_PRESETS = [1, 40, 100, 200]
const MAKINA_CHOICES: { value: MakinaChoice; label: string }[] = [
  { value: 'none', label: 'Aucune makina' },
  { value: 'optimakina', label: 'Optimakina (+ chance de cible)' },
  { value: 'animakina', label: 'Animakina' },
  { value: 'kromakina', label: 'Kromakina (Caméléone)' },
]
const ABILITY_IDS = Object.keys(ABILITY_LABELS) as Ability[]
const PLAN_PAGE = 12
const TABLE_PAGE = 30

// ---------- Contexte économique (prix, valeurs, makinas) ----------

interface EconomyKit {
  valueOf: (speciesId: number, level: number) => number | null
  valuation: (speciesId: number, level: number) => MountValuation
  makina: (kind: MakinaKind, family: FamilyId, generation: number) => MakinaCost
  genetonValue: number
  genetonFromPlayer: boolean
  /** C_eff de la règle de prix de l'Optimakina (remplacement des parents − valeur des stériles). */
  coupleCost: CoupleCostModel
}

function useEconomyKit(rules: Ruleset): EconomyKit {
  const priceCtx = usePriceContext()
  const mountOverrides = usePrices((s) => s.mounts)
  const generationOverrides = usePrices((s) => s.generations)
  const genetonOverride = usePrices((s) => s.genetonValue)
  const useDefaults = useSettings((s) => s.useDefaultPrices)
  const saleTax = useSettings((s) => s.saleTax)
  const jobLevel = useSettings((s) => s.jobLevel)
  const tier = useSettings((s) => s.preferredTier)
  return useMemo(() => {
    // Niveau d'Éleveur : une makina ou un filet hors de portée du métier est payé au prix HDV (economy.md).
    const ctx = { ...priceCtx, jobLevel }
    const mountPrices = { mountOverrides, generationOverrides, useDefaults }
    const vals = new Map<string, MountValuation>()
    const valuation = (id: number, level: number) => {
      const k = `${id}|${level}`
      let v = vals.get(k)
      if (!v) {
        v = mountValuation(id, level, { ctx, mountPrices, saleTax, state: 'fertile' })
        vals.set(k, v)
      }
      return v
    }
    const mks = new Map<string, MakinaCost>()
    const makina = (kind: MakinaKind, family: FamilyId, generation: number) => {
      const k = `${kind}|${family}|${generation}`
      let m = mks.get(k)
      if (!m) {
        m = makinaCost(kind, family, generation, ctx, rules)
        mks.set(k, m)
      }
      return m
    }
    const g = genetonKamasValue(genetonOverride)
    const coupleCost = economyCoupleCost({ ctx, mountPrices, saleTax, rules, jobLevel, tier })
    return { valueOf: (id: number, level: number) => valuation(id, level).best, valuation, makina, genetonValue: g.value, genetonFromPlayer: g.origin === 'joueur', coupleCost }
  }, [priceCtx, mountOverrides, generationOverrides, useDefaults, saleTax, genetonOverride, rules, jobLevel, tier])
}

// ---------- Takeza et Almanax ----------

interface DayInfo {
  /** Jour de jeu (AAAA-MM-JJ, heure du serveur). */
  iso: string
  today: AlmanaxEffect | null
  isTakeza: boolean
  nextTakeza: string | null
  daysToTakeza: number | null
}

/** Jour de jeu courant, mis à jour à minuit (heure du serveur) et au retour sur l'onglet (useServerDay). */
function useDayInfo(): DayInfo {
  const todayIso = useServerDay()
  return useMemo(() => {
    const today = almanaxOn(todayIso)
    const nextTakeza = TAKEZA_DATES.find((d) => d >= todayIso) ?? null
    const daysToTakeza = nextTakeza ? isoDaysBetween(todayIso, nextTakeza) : null
    return { iso: todayIso, today, isTakeza: !!today?.takeza, nextTakeza, daysToTakeza }
  }, [todayIso])
}

/** Case « Jour Takeza » : cochée par défaut le jour Takeza ; le choix du joueur vaut pour la journée. */
function useTakezaToggle(day: DayInfo): [boolean, (v: boolean) => void] {
  const [state, setState] = useState({ day: day.iso, value: day.isTakeza })
  if (state.day !== day.iso) setState({ day: day.iso, value: day.isTakeza })
  const value = state.day === day.iso ? state.value : day.isTakeza
  return [value, (v: boolean) => setState({ day: day.iso, value: v })]
}

const longDay = (iso: string) => formatIsoDay(iso, { year: true })

// ---------- Petits composants ----------

function shortName(s: Species): string {
  const prefix = `${FAMILIES[s.family].label} `
  return s.name.startsWith(prefix) ? s.name.slice(prefix.length) : s.name
}

function GenderIcon({ gender }: { gender: Gender }) {
  return (
    <span className={`br-gender ${gender}`} title={GENDER_LABELS[gender]} aria-label={GENDER_LABELS[gender]}>
      {GENDER_ICONS[gender]}
    </span>
  )
}

function MountLabel({ m }: { m: Mount }) {
  const s = getSpecies(m.speciesId)
  return (
    <span className="br-mount">
      <GenderIcon gender={m.gender} />
      {s && <GenBadge generation={s.generation} />}
      <strong>{mountName(m)}</strong>
      <span className="muted">niv. {m.level}</span>
      {m.ability && <Badge tone="accent">{ABILITY_LABELS[m.ability]}</Badge>}
    </span>
  )
}

function ProbBar({ p, target }: { p: number; target?: boolean }) {
  return (
    <div className="br-prob">
      <div className={`br-prob-track${target ? ' target' : ''}`} aria-hidden>
        <span style={{ width: `${Math.max(0, Math.min(100, p * 100))}%` }} />
      </div>
      <span className="br-prob-value">{formatPercent(p, 2)}</span>
    </div>
  )
}

function Notes({ items, tone }: { items: string[]; tone?: 'warn' | 'ok' }) {
  if (!items.length) return null
  return (
    <ul className={`br-notes${tone ? ` ${tone}` : ''}`}>
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  )
}

function PriceLink({ name, children }: { name?: string; children?: ReactNode }) {
  return <a href={href('prix', name ? { q: name } : undefined)}>{children ?? 'compléter les prix'}</a>
}

/** Prix d'une makina : montant, « coût incomplet » + lien Prix, ou introuvable. */
function MakinaPriceView({ cost }: { cost: MakinaCost }) {
  if (!cost.makina) return <span className="muted">makina introuvable</span>
  if (cost.price === null)
    return (
      <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
        <Badge tone="warn">prix inconnu</Badge>
        <PriceLink name={cost.makina.name} />
      </span>
    )
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <strong>
        {cost.complete ? '' : '≥ '}
        {formatKamas(cost.price)}
      </strong>
      {!cost.complete && (
        <>
          <Badge tone="warn" title="Un ingrédient au moins n'a pas de prix : ce montant est une borne basse.">
            coût incomplet
          </Badge>
          <PriceLink name={cost.makina.name} />
        </>
      )}
      {cost.complete && cost.origin !== 'joueur' && <span className="muted">({cost.origin === 'craft' ? 'coût des ingrédients' : 'prix par défaut'})</span>}
    </span>
  )
}

/** Sélecteur compact d'espèce (une famille, groupée par génération). */
function CompactSpeciesSelect({
  label,
  family,
  value,
  onChange,
  emptyLabel,
}: {
  label: string
  family: FamilyId
  value: number | null
  onChange: (id: number | null) => void
  emptyLabel: string
}) {
  const groups = useMemo(() => {
    const byGen = new Map<number, Species[]>()
    for (const s of speciesOfFamily(family, { breedableOnly: true })) byGen.set(s.generation, [...(byGen.get(s.generation) ?? []), s])
    for (const l of byGen.values()) l.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    return [...byGen.entries()].sort((a, b) => a[0] - b[0])
  }, [family])
  return (
    <label className="field">
      {label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">{emptyLabel}</option>
        {groups.map(([gen, list]) => (
          <optgroup key={gen} label={`Génération ${gen}`}>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {shortName(s)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

// ---------- État d'un parent du simulateur ----------

interface ParentState {
  speciesId: number | null
  tree: [number | null, number | null]
  level: number
  ability: Ability | null
}

function standardTree(id: number | null): [number | null, number | null] {
  if (id === null || !getSpecies(id)?.breedable) return [null, null]
  const p = cleanParent(id, 1).parents
  return [p[0] ?? null, p[1] ?? null]
}

function parentOf(id: number | null, level: number): ParentState {
  return { speciesId: id, tree: standardTree(id), level, ability: null }
}

function parentFromMount(m: Mount): ParentState {
  return { speciesId: m.speciesId, tree: [m.parents[0] ?? null, m.parents[1] ?? null], level: m.level, ability: m.ability }
}

function toBreeding(p: ParentState): BreedingParent | null {
  if (p.speciesId === null || !getSpecies(p.speciesId)) return null
  return { speciesId: p.speciesId, level: p.level, parents: p.tree.filter((x): x is number => x !== null), ability: p.ability }
}

function validSpecies(raw: string | null): Species | undefined {
  const id = Number(raw)
  const s = Number.isFinite(id) && id > 0 ? getSpecies(id) : undefined
  return s?.breedable ? s : undefined
}

// ---------- Page ----------

export default function BreedingPage() {
  const route = useRoute()
  const rules = useRules()
  const settingsFamily = useSettings((s) => s.family)
  const parentTargetLevel = useSettings((s) => s.parentTargetLevel)
  const mounts = useInventory((s) => s.mounts)
  const entries = useJournal((s) => s.entries)
  const kit = useEconomyKit(rules)
  const day = useDayInfo()

  const initial = () => {
    const sa = validSpecies(route.params.get('a'))
    const sb0 = validSpecies(route.params.get('b'))
    const sb = sb0 && (!sa || sb0.family === sa.family) ? sb0 : undefined
    return { sa, sb, family: sa?.family ?? sb?.family ?? settingsFamily }
  }
  const [init] = useState(initial)
  const routeTab = route.params.get('onglet') as TabId | null
  const [tab, setTab] = useState<TabId>(routeTab && TAB_IDS.includes(routeTab) ? routeTab : init.sa || init.sb ? 'simulateur' : mounts.length ? 'couples' : 'simulateur')
  const [family, setFamily] = useState<FamilyId>(init.family)
  const [simA, setSimA] = useState<ParentState>(() => parentOf(init.sa?.id ?? null, parentTargetLevel))
  const [simB, setSimB] = useState<ParentState>(() => parentOf(init.sb?.id ?? null, parentTargetLevel))

  // Navigation vers #/accouplement?a=…&b=… depuis une autre page : préremplir le simulateur.
  const routeKey = `${route.params.get('a') ?? ''}|${route.params.get('b') ?? ''}|${route.params.get('onglet') ?? ''}`
  const [seenRouteKey, setSeenRouteKey] = useState(routeKey)
  if (routeKey !== seenRouteKey) {
    setSeenRouteKey(routeKey)
    const next = initial()
    if (next.sa || next.sb) {
      setFamily(next.family)
      setSimA(parentOf(next.sa?.id ?? null, parentTargetLevel))
      setSimB(parentOf(next.sb?.id ?? null, parentTargetLevel))
      setTab('simulateur')
    } else if (routeTab && TAB_IDS.includes(routeTab)) setTab(routeTab)
  }

  const changeFamily = (f: FamilyId) => {
    setFamily(f)
    if (simA.speciesId !== null && getSpecies(simA.speciesId)?.family !== f) setSimA(parentOf(null, simA.level))
    if (simB.speciesId !== null && getSpecies(simB.speciesId)?.family !== f) setSimB(parentOf(null, simB.level))
  }

  const simulatePair = (a: Mount, b: Mount) => {
    const f = getSpecies(a.speciesId)?.family
    if (f) setFamily(f)
    setSimA(parentFromMount(a))
    setSimB(parentFromMount(b))
    setTab('simulateur')
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  const fecundCount = mounts.filter((m) => effectiveFertility(m) === 'feconde').length
  const matingEntries = useMemo(() => entries.filter((e): e is MatingEntry => e.kind === 'accouplement'), [entries])

  return (
    <>
      <PageHeader
        title="Accouplement"
        subtitle="Simulez un accouplement, trouvez les meilleurs couples de votre étable et enregistrez les naissances réelles."
        actions={
          <>
            {day.isTakeza && (
              <Badge tone="ok" title="Almanax : +20 % de chance d'obtenir la génération cible">
                Takeza aujourd'hui · +20 %
              </Badge>
            )}
            <a href={href('reglages')} style={{ textDecoration: 'none' }}>
              <Badge tone="info" title={rules.label}>
                Règles {rules.id}
              </Badge>
            </a>
          </>
        }
      />
      <Tabs<TabId>
        tabs={[
          { id: 'simulateur', label: 'Simulateur' },
          { id: 'couples', label: `Mes couples${fecundCount ? ` · ${fecundCount} féconde${fecundCount > 1 ? 's' : ''}` : ''}` },
          { id: 'historique', label: `Historique${matingEntries.length ? ` · ${matingEntries.length}` : ''}` },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'simulateur' && (
        <SimulatorTab
          a={simA}
          b={simB}
          setA={setSimA}
          setB={setSimB}
          family={family}
          setFamily={changeFamily}
          mounts={mounts}
          rules={rules}
          kit={kit}
          day={day}
        />
      )}
      {tab === 'couples' && <CouplesTab mounts={mounts} rules={rules} kit={kit} day={day} onSimulate={simulatePair} />}
      {tab === 'historique' && <HistoryTab entries={matingEntries} rules={rules} />}
    </>
  )
}

// ---------- Onglet Simulateur ----------

function ParentPanel({
  title,
  state,
  onChange,
  family,
  onFamilyChange,
  mounts,
}: {
  title: string
  state: ParentState
  onChange: (p: ParentState) => void
  family: FamilyId
  onFamilyChange: (f: FamilyId) => void
  mounts: Mount[]
}) {
  const s = state.speciesId !== null ? getSpecies(state.speciesId) : undefined
  const owned = useMemo(
    () =>
      mounts
        .filter((m) => getSpecies(m.speciesId)?.family === family && getSpecies(m.speciesId)?.breedable)
        .sort((x, y) => (getSpecies(y.speciesId)?.generation ?? 0) - (getSpecies(x.speciesId)?.generation ?? 0) || mountName(x).localeCompare(mountName(y), 'fr')),
    [mounts, family],
  )
  const treeIds = state.tree.filter((x): x is number => x !== null)
  const treeMax = Math.max(s?.generation ?? 0, ...treeIds.map((id) => getSpecies(id)?.generation ?? 0))
  const std = standardTree(state.speciesId)
  const isStandard = std[0] === state.tree[0] && std[1] === state.tree[1]
  return (
    <Card>
      <div className="stack">
        <div className="br-parent-head">
          <h2>{title}</h2>
          {s && <SpeciesName id={s.id} />}
        </div>
        {owned.length > 0 && (
          <label className="field br-field-full">
            Depuis mes montures
            <select
              value=""
              onChange={(e) => {
                const m = owned.find((x) => x.id === e.target.value)
                if (m) onChange(parentFromMount(m))
              }}
            >
              <option value="">— Choisir une monture de l'étable ({owned.length}) —</option>
              {owned.map((m) => {
                const sm = getSpecies(m.speciesId)
                return (
                  <option key={m.id} value={m.id}>
                    {GENDER_ICONS[m.gender]} G{sm?.generation} {mountName(m)} · niv. {m.level} · {FERTILITY_LABELS[effectiveFertility(m)]}
                  </option>
                )
              })}
            </select>
          </label>
        )}
        <SpeciesPicker
          label="Espèce"
          value={state.speciesId}
          family={family}
          onFamilyChange={onFamilyChange}
          onChange={(id) => onChange({ ...state, speciesId: id, tree: standardTree(id) })}
        />
        <div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong style={{ fontSize: '0.9rem' }}>Arbre (ses propres parents)</strong>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn small" disabled={!s || isStandard} onClick={() => onChange({ ...state, tree: std })} title="Parents de la recette la moins chère">
                Arbre standard
              </button>
              <button className="btn small" disabled={!treeIds.length} onClick={() => onChange({ ...state, tree: [null, null] })} title="Monture capturée : aucun parent">
                Capturée
              </button>
            </div>
          </div>
          <div className="br-tree" style={{ marginTop: 6 }}>
            <CompactSpeciesSelect label="Parent 1" family={family} value={state.tree[0]} onChange={(id) => onChange({ ...state, tree: [id, state.tree[1]] })} emptyLabel="— aucun (capturée) —" />
            <CompactSpeciesSelect label="Parent 2" family={family} value={state.tree[1]} onChange={(id) => onChange({ ...state, tree: [state.tree[0], id] })} emptyLabel="— aucun —" />
          </div>
          <div className="br-subtle" style={{ marginTop: 4 }}>
            {!s
              ? 'Choisissez une espèce : son arbre standard est rempli automatiquement.'
              : treeIds.length === 0
                ? 'Monture capturée (ou arbre inconnu) : elle seule compte dans son arbre.'
                : `Génération la plus haute de l'arbre : G${treeMax}${isStandard ? ' · arbre standard' : ''}.`}
          </div>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <NumberField label="Niveau" value={state.level} min={1} max={200} width={80} onChange={(v) => onChange({ ...state, level: Math.round(v) })} />
          <div className="br-presets" role="group" aria-label="Niveaux usuels">
            {LEVEL_PRESETS.map((l) => (
              <button key={l} className="btn small" aria-pressed={state.level === l} onClick={() => onChange({ ...state, level: l })}>
                {l}
              </button>
            ))}
          </div>
          <SelectField<Ability | ''>
            label="Capacité"
            value={state.ability ?? ''}
            onChange={(v) => onChange({ ...state, ability: v === '' ? null : v })}
            options={[{ value: '', label: 'Aucune' }, ...ABILITY_IDS.map((id) => ({ value: id, label: ABILITY_LABELS[id] }))]}
          />
        </div>
      </div>
    </Card>
  )
}

function SimulatorTab({
  a,
  b,
  setA,
  setB,
  family,
  setFamily,
  mounts,
  rules,
  kit,
  day,
}: {
  a: ParentState
  b: ParentState
  setA: (p: ParentState) => void
  setB: (p: ParentState) => void
  family: FamilyId
  setFamily: (f: FamilyId) => void
  mounts: Mount[]
  rules: Ruleset
  kit: EconomyKit
  day: DayInfo
}) {
  const goalSpeciesId = useSettings((s) => s.goalSpeciesId)
  const goal = useSettings((s) => s.goal)
  const [makina, setMakina] = useState<MakinaChoice>('none')
  const [takeza, setTakeza] = useTakezaToggle(day)
  const [kappa, setKappa] = useState(1)
  const [targetMode, setTargetMode] = useState<'exact' | 'max'>('exact')

  const sim = useMemo((): { an: PairAnalysis | null; error: string | null; ceff?: CoupleCostBreakdown } => {
    const pa = toBreeding(a)
    const pb = toBreeding(b)
    if (!pa || !pb) return { an: null, error: null }
    try {
      const an = analyzePair(pa, pb, {
        rules,
        objective: objectiveFromGoal(goal),
        goalSpeciesId,
        makinaPolicy: 'auto',
        takeza,
        mountValue: kit.valueOf,
        makinaCost: kit.makina,
        genetonValue: kit.genetonValue,
        coupleCost: kit.coupleCost.cost,
        kappa,
        targetMode,
        forcedMakina: makina === 'none' ? null : makina,
      })
      return { an, error: null, ceff: kit.coupleCost.breakdown(pa, pb) }
    } catch (e) {
      return { an: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [a, b, rules, goal, goalSpeciesId, takeza, kit, kappa, targetMode, makina])

  const owned = useMemo(() => {
    const m = new Map<number, number>()
    for (const x of mounts) m.set(x.speciesId, (m.get(x.speciesId) ?? 0) + 1)
    return m
  }, [mounts])

  const an = sim.an
  const r = an?.result
  const bd = r ? targetBreakdown(a.level, b.level, { makina: an?.makina, takeza, rules }, r) : null
  const makinaKind: MakinaKind | null = makina === 'none' ? null : makina
  const chosenCost = r && makinaKind ? kit.makina(makinaKind, r.family, r.makinaGenerationRequired) : null
  const optiCost = r ? kit.makina('optimakina', r.family, r.makinaGenerationRequired) : null

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="br-parents">
        <ParentPanel title="Parent A" state={a} onChange={setA} family={family} onFamilyChange={setFamily} mounts={mounts} />
        <div className="br-cross" aria-hidden>
          ×
        </div>
        <ParentPanel title="Parent B" state={b} onChange={setB} family={family} onFamilyChange={setFamily} mounts={mounts} />
      </div>

      <Card title="Options">
        <div className="grid grid-3" style={{ alignItems: 'start' }}>
          <div className="stack" style={{ gap: 6 }}>
            <SelectField<MakinaChoice> label="Makina (une seule par accouplement)" value={makina} onChange={setMakina} options={MAKINA_CHOICES} />
            {r && makinaKind && chosenCost && (
              <div className="br-subtle">
                {chosenCost.makina?.name ?? `${MAKINA_LABELS[makinaKind]} G${r.makinaGenerationRequired}`} (génération ≥ G{r.makinaGenerationRequired}, la cible) :{' '}
                <MakinaPriceView cost={chosenCost} />
              </div>
            )}
            {r && !makinaKind && (
              <div className="br-subtle">Génération minimale d'une makina pour ce couple : G{r.makinaGenerationRequired} (= génération cible ; une plus haute convient).</div>
            )}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <label className="br-check">
              <input type="checkbox" checked={takeza} onChange={(e) => setTakeza(e.target.checked)} />
              Jour Takeza (+{formatPercent(TAKEZA_BONUS, 0)} de génération cible)
            </label>
            <div className="br-subtle">
              {day.isTakeza
                ? "Aujourd'hui est un jour Takeza (Almanax) : bonus activé automatiquement."
                : day.nextTakeza
                  ? `Prochain Takeza : ${longDay(day.nextTakeza)}${day.daysToTakeza !== null ? ` (dans ${day.daysToTakeza} j)` : ''}.`
                  : 'Aucune date de Takeza connue à venir.'}
              {day.today?.babyAbility && !day.today.takeza && ` Aujourd'hui (${day.today.name}) : les bébés naissent avec la capacité ${ABILITY_LABELS[day.today.babyAbility]}.`}
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <div>
              <strong style={{ fontSize: '0.9rem' }}>Règles du jeu</strong>
              <div className="br-subtle">
                {rules.label} — Optimakina +{formatPercent(rules.optimakinaBonus, 0)}, XP {rules.matingXpPerGeneration} par génération et par parent.{' '}
                <a href={href('reglages')}>Changer</a>
              </div>
            </div>
            <details className="br-details">
              <summary>Hypothèses du modèle (avancé)</summary>
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                <NumberField label="κ (poids des croisements à enfant monocolore)" value={kappa} min={0} max={5} step={0.1} width={80} onChange={setKappa} />
                <SelectField<'exact' | 'max'>
                  label="Part de la génération cible"
                  value={targetMode}
                  onChange={setTargetMode}
                  options={[
                    { value: 'exact', label: 'Exactement B (validé en jeu)' },
                    { value: 'max', label: 'max(B, part naturelle) — hypothèse' },
                  ]}
                />
              </div>
            </details>
          </div>
        </div>
      </Card>

      {sim.error && <Callout tone="danger">{sim.error}</Callout>}
      {!r && !sim.error && (
        <Card>
          <Empty>Choisissez les deux parents (même famille) pour voir les probabilités du bébé, la génération cible, les génétons et l'XP.</Empty>
        </Card>
      )}
      {an && r && bd && (
        <>
          <Card
            title="Résultat de l'accouplement"
            actions={
              <span className="row" style={{ gap: 6 }}>
                <ConfidenceBadge level="high" />
                <span className="br-subtle">modèle validé sur captures en jeu</span>
              </span>
            }
          >
            <div className="grid grid-4">
              <Stat
                label="Génération cible"
                value={<GenBadge generation={r.targetGeneration} />}
                hint={r.targetSpecies.map((id) => getSpecies(id)?.name ?? `#${id}`).join(', ')}
              />
              <Stat label="Chance de génération cible (B)" value={formatPercent(r.targetChance, 2)} hint={bd.noAlternative ? 'aucune autre issue possible' : bd.capped ? 'plafonnée à 100 %' : undefined} />
              <Stat
                label="Génétons attendus"
                value={formatNumber(r.expectedGenetons, 1)}
                hint={
                  r.recordPossible
                    ? `${r.genetonsIfRecord} si le bébé est de la génération cible`
                    : `aucun : l'arbre contient déjà une G${r.maxTreeGeneration}`
                }
              />
              <Stat
                label="Valeur attendue"
                value={an.expectedValue !== undefined ? formatKamas(an.expectedValue, true) : '—'}
                tone={an.expectedValue !== undefined && an.expectedValue < 0 ? 'neg' : undefined}
                hint={
                  an.valueComplete ? (
                    'bébés + génétons − makina'
                  ) : (
                    <>
                      estimation incomplète · <PriceLink />
                    </>
                  )
                }
              />
              <Stat label="XP d'Éleveur" value={formatNumber(r.jobXp)} hint={`${rules.matingXpPerGeneration} × (G${getSpecies(a.speciesId ?? 0)?.generation} + G${getSpecies(b.speciesId ?? 0)?.generation})${r.babies === 2 ? ' × 2 bébés' : ''}`} />
              <Stat label="Bébés" value={r.babies} hint={r.babies === 2 ? 'un parent est Reproducteur' : 'Reproducteur sur un parent : 2 bébés'} />
            </div>

            <div className="divider" />
            <h3>Chance de génération cible : d'où vient B ?</h3>
            <BreakdownView bd={bd} rules={rules} />

            <div className="divider" />
            <h3>Issues possibles</h3>
            <OutcomesTable result={r} kit={kit} owned={owned} />
          </Card>

          <div className="grid grid-2">
            <Card title="Makina et capacités">
              <div className="stack" style={{ gap: 8 }}>
                <div>
                  Makina utilisable : <strong>génération ≥ G{r.makinaGenerationRequired}</strong> (même famille).
                </div>
                {optiCost && an.withOptimakina && (
                  <div>
                    Avec une Optimakina G{r.makinaGenerationRequired} : B passe de <strong>{formatPercent(an.base.targetChance, 1)}</strong> à{' '}
                    <strong>{formatPercent(an.withOptimakina.targetChance, 1)}</strong>, génétons attendus {formatNumber(an.base.expectedGenetons, 1)} →{' '}
                    {formatNumber(an.withOptimakina.expectedGenetons, 1)}. Prix : <MakinaPriceView cost={optiCost} />
                  </div>
                )}
                <div>
                  <Badge tone={an.makinaAdvice.use ? 'gold' : undefined}>{an.makinaAdvice.use ? 'Optimakina conseillée' : 'Optimakina non conseillée'}</Badge>{' '}
                  <span className="br-subtle">
                    {an.makinaAdvice.reason}
                    {` Conseil calculé pour l'objectif « ${OBJECTIVE_LABELS[objectiveFromGoal(goal)].toLowerCase()} » de vos réglages ; la makina du résultat est celle que vous choisissez ci-dessus.`}
                  </span>
                  <ThresholdLine advice={an.makinaAdvice} />
                  {sim.ceff && <CoupleCostView bd={sim.ceff} />}
                </div>
                <div>
                  <strong>Capacité du bébé</strong>
                  {Object.keys(r.abilityOdds).length === 0 ? (
                    <div className="br-subtle">
                      Aucune capacité possible{rules.animakina === 'capacite' ? ' sans Animakina ou Kromakina' : ''}.
                      {makinaKind === 'animakina' && rules.animakina === 'sexe' && ' En 3.7, l’Animakina permet de choisir le sexe du bébé.'}
                    </div>
                  ) : (
                    <ul className="br-notes">
                      {(Object.entries(r.abilityOdds) as [Ability, number][]).map(([ab, p]) => (
                        <li key={ab}>
                          {ABILITY_LABELS[ab]} : {formatPercent(p, 0)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {day.today?.babyAbility && (
                    <div className="br-subtle">Almanax du jour : capacité {ABILITY_LABELS[day.today.babyAbility]} offerte aux bébés nés aujourd'hui.</div>
                  )}
                </div>
              </div>
            </Card>
            <Card title="Conseils et points d'attention">
              {an.warnings.length === 0 && an.reasons.length === 0 && <div className="muted">Rien à signaler.</div>}
              {an.warnings.length > 0 && (
                <Callout tone="warn">
                  <strong>À vérifier</strong>
                  <Notes items={an.warnings} tone="warn" />
                </Callout>
              )}
              <Notes items={an.reasons} tone="ok" />
              <HundredPercentHint rules={rules} makina={an.makina} takeza={takeza} levelSum={bd.levelSum} />
            </Card>
          </div>
        </>
      )}

      <HowItWorks rules={rules} />
    </div>
  )
}

/** Seuil de la règle de prix de l'Optimakina, avec le critère réellement utilisé (C_eff, valeur des bébés ou génétons). */
function ThresholdLine({ advice }: { advice: MakinaAdvice }) {
  if (advice.threshold === null || advice.successBasis === null) return null
  const bound = advice.thresholdIsUpperBound ? '≤ ' : ''
  return (
    <div className="br-subtle">
      Prix maximal rentable : {bound}
      {formatKamas(advice.threshold)} ={' '}
      {advice.successBasis === 'c-eff' ? (
        <>
          C_eff {bound}
          {formatKamas(advice.coupleCost)} × Δ {formatPercent(advice.gain, 1)} / p {formatPercent(advice.baseChance, 1)}
        </>
      ) : (
        <>
          {SUCCESS_BASIS_LABELS[advice.successBasis]} (gain de {formatPercent(advice.gain, 1)} × {formatKamas(advice.successValue)})
        </>
      )}
      .{advice.thresholdIsUpperBound && ' Borne haute : une sortie des stériles n’est pas chiffrée, seul un refus est certain.'}
    </div>
  )
}

/** Détail de C_eff : remplacement de chaque parent − valeur résiduelle de la stérile. */
function CoupleCostView({ bd }: { bd: CoupleCostBreakdown }) {
  return (
    <details className="br-details" style={{ marginTop: 6 }}>
      <summary>
        C_eff du couple : {bd.value === null ? 'inconnu' : `${bd.complete ? '≈ ' : '≤ '}${formatKamas(Math.max(0, bd.value))}`} (coût net d'une tentative)
      </summary>
      <div className="table-wrap" style={{ marginTop: 6 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Parent</th>
              <th className="num">Obtention</th>
              <th className="num">XP</th>
              <th className="num">Fécondation</th>
              <th className="num">Valeur de la stérile</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {bd.parents.map((p, i) => (
              <tr key={i}>
                <td>
                  <SpeciesName id={p.speciesId} /> <span className="muted">niv. {p.level}</span>
                </td>
                <td className="num" title={p.acquisitionMethod ? ACQUISITION_METHOD_LABELS[p.acquisitionMethod] : undefined}>
                  {p.acquisition === null ? <span className="muted">inconnue</span> : formatKamas(p.acquisition)}
                  {p.acquisitionMethod && <div className="br-subtle">{ACQUISITION_METHOD_LABELS[p.acquisitionMethod]}</div>}
                </td>
                <td className="num">{p.leveling === null ? <span className="muted">inconnue</span> : formatKamas(p.leveling)}</td>
                <td className="num">{p.fertility === null ? <span className="muted">inconnue</span> : formatKamas(p.fertility)}</td>
                <td className="num">
                  {p.residual === null ? <span className="muted">inconnue</span> : `${p.residualComplete ? '' : '≥ '}${formatKamas(p.residual)}`}
                  {p.residualKind && <div className="br-subtle">{p.residualKind === 'clone' ? '½ clone' : p.residualKind}</div>}
                </td>
                <td className="num">{p.net === null ? '—' : `${p.residualComplete ? '' : '≤ '}${formatKamas(p.net)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="br-subtle">
        C_eff = Σ (obtention d'une monture fertile niv. 1 + XP jusqu'au niveau du parent + fécondation, lot typique de 10) − valeur résiduelle de chaque stérile
        (meilleure sortie nette, ou ½ clone − refécondation). Obtention : capture pour une G1, sinon la moins chère entre sa valeur actuelle et sa production estimée.
        {bd.missing.length > 0 && (
          <>
            {' '}
            À chiffrer : {bd.missing.join(' ; ')} — <PriceLink />.
          </>
        )}
      </div>
    </details>
  )
}

function BreakdownView({ bd, rules }: { bd: TargetBreakdown; rules: Ruleset }) {
  const scale = Math.max(1, bd.raw)
  const segs = [
    { key: 'base', cls: 'br-seg-base', label: `Base`, value: bd.base },
    { key: 'levels', cls: 'br-seg-levels', label: `Niveaux (${bd.levelSum} × ${formatPercent(TARGET_PER_LEVEL, 2)})`, value: bd.levels },
    { key: 'opti', cls: 'br-seg-opti', label: `Optimakina (+${formatPercent(rules.optimakinaBonus, 0)} en ${rules.id})`, value: bd.optimakina },
    { key: 'takeza', cls: 'br-seg-takeza', label: `Takeza (+${formatPercent(TAKEZA_BONUS, 0)})`, value: bd.takeza },
  ]
  return (
    <div>
      <div className="br-breakdown" role="img" aria-label={`B = ${formatPercent(bd.total, 2)}`}>
        {segs
          .filter((s) => s.value > 0)
          .map((s) => (
            <span key={s.key} className={s.cls} style={{ width: `${(s.value / scale) * 100}%` }} />
          ))}
      </div>
      <div className="br-legend">
        {segs.map((s) => (
          <div key={s.key} className={s.value > 0 ? undefined : 'muted'}>
            <span className={`br-swatch ${s.cls}`} aria-hidden />
            {s.label}
            <span className="num">{s.value > 0 ? `+${formatPercent(s.value, 2)}` : '—'}</span>
          </div>
        ))}
      </div>
      <div className="br-total">
        Total : {formatPercent(Math.min(1, bd.raw), 2)}
        {bd.capped && <Badge tone="warn">plafonné à 100 % ({formatPercent(bd.raw - 1, 0)} de bonus perdus)</Badge>}
        {bd.noAlternative && <Badge tone="ok">aucune autre issue : 100 % quel que soit le niveau</Badge>}
        <span className="br-subtle" style={{ fontWeight: 400 }}>
          B = min(100 %, {formatPercent(TARGET_BASE, 0)} + {formatPercent(TARGET_PER_LEVEL, 2)} × niveaux cumulés + makina + Takeza), partagé entre les issues de la génération cible.
        </span>
      </div>
    </div>
  )
}

function OutcomesTable({ result, kit, owned }: { result: BreedingResult; kit: EconomyKit; owned: Map<number, number> }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Bébé</th>
            <th>Probabilité</th>
            <th>Génération cible</th>
            <th className="num">Génétons</th>
            <th className="num">Valeur (niv. 1)</th>
            <th className="num">Possédées</th>
          </tr>
        </thead>
        <tbody>
          {result.outcomes.map((o) => {
            const v = kit.valuation(o.speciesId, 1)
            const s = getSpecies(o.speciesId)
            return (
              <tr key={o.speciesId} className={o.isTarget ? 'br-target-row' : undefined}>
                <td>
                  <a href={href('genetique', { id: o.speciesId })} style={{ color: 'inherit', textDecoration: 'none' }} title="Voir dans Génétique">
                    <SpeciesName id={o.speciesId} />
                  </a>
                </td>
                <td>
                  <ProbBar p={o.probability} target={o.isTarget} />
                </td>
                <td>{o.isTarget ? <Badge tone="gold">cible</Badge> : <span className="muted">non</span>}</td>
                <td className="num">{o.genetons > 0 ? `+${formatNumber(o.genetons)}` : <span className="muted">0</span>}</td>
                <td className="num">
                  {v.best === null ? (
                    <PriceLink name={s?.name}>prix manquant</PriceLink>
                  ) : (
                    <span title={v.bestKind ? `Meilleure option : ${v.bestKind}` : undefined}>
                      {formatKamas(v.best, true)}
                      {!v.complete && ' *'}
                    </span>
                  )}
                </td>
                <td className="num">{owned.get(o.speciesId) ?? 0}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="br-subtle" style={{ marginTop: 6 }}>
        Valeur = meilleure option nette (vente, extraction, brisage) d'un bébé fertile niveau 1 ; souvent un plancher calculé faute de cours relevés.
        {result.outcomes.some((o) => !kit.valuation(o.speciesId, 1).complete) && ' * = estimation partielle (un prix manque).'}
        {result.babies === 2 && ' Avec 2 bébés, chaque bébé est un tirage indépendant (hypothèse).'}
      </div>
    </div>
  )
}

function HundredPercentHint({ rules, makina, takeza, levelSum }: { rules: Ruleset; makina: MakinaKind | null; takeza: boolean; levelSum: number }) {
  const bonus = (makina === 'optimakina' ? rules.optimakinaBonus : 0) + (takeza ? TAKEZA_BONUS : 0)
  const needed = Math.max(2, Math.ceil(Math.round(((1 - TARGET_BASE - bonus) / TARGET_PER_LEVEL) * 1000) / 1000))
  const withOpti = Math.ceil(Math.round(((1 - TARGET_BASE - rules.optimakinaBonus - (takeza ? TAKEZA_BONUS : 0)) / TARGET_PER_LEVEL) * 1000) / 1000)
  return (
    <div className="br-subtle" style={{ marginTop: 10 }}>
      <strong>Seuils de 100 % (M-100PCT)</strong> : avec ces bonus, il faut {needed > 400 ? 'plus de 400 niveaux cumulés (impossible)' : `${needed} niveaux cumulés`} pour une
      génération cible certaine (vous en avez {levelSum})
      {makina !== 'optimakina' && withOpti <= 400 ? ` ; ${withOpti} avec une Optimakina` : ''}.
    </div>
  )
}

function HowItWorks({ rules }: { rules: Ruleset }) {
  return (
    <Card title="Comment c'est calculé" className="br-explain">
      <p>
        Modèle de naissance du système 3.5+ reconstitué par la recherche ; il reproduit à 0,01 % près les 24 pourcentages de 5 captures d'écran en jeu (guide
        DPLN), dont un cas de cible G10 partagée. <ConfidenceBadge level="high" />
      </p>
      <ol>
        <li>
          Arbre d'un parent = lui-même (poids {POSITION_WEIGHT_SELF}) + ses deux parents (poids {POSITION_WEIGHT_PARENT} chacun), multipliés par le poids génétique du
          client (90 pour les monocolores Dragodinde et Muldo, 20 pour les bicolores, la Dorée et les Muldos G9, 1 pour tous les Volkornes). Les doublons s'additionnent ;
          chaque arbre est ramené à 1. Les parents de ceux-ci (arrière-grands-parents du bébé) ne comptent pas.
        </li>
        <li>
          Masse naturelle : chaque membre garde son poids, et chaque paire (membre de A, membre de B) qui possède un croisement ajoute pA × pB × κ à l'enfant.
        </li>
        <li>
          La génération cible est la plus haute des issues possibles. Ses issues se partagent B = min(100 %, 30 % + 0,15 % × niveaux cumulés + Optimakina{' '}
          {formatPercent(rules.optimakinaBonus, 0)} + Takeza 20 %), au prorata de leur masse ; les autres issues se partagent le reste. S'il n'y a pas d'autre issue, B = 100 %.
        </li>
        <li>
          Génétons : barème(parent A) + barème(parent B), seulement si le bébé dépasse toutes les générations des deux arbres (les 2 parents et leurs 4 parents,
          soit les parents et grands-parents du bébé).
        </li>
        <li>
          XP d'Éleveur = {rules.matingXpPerGeneration} × (génération A + génération B) × nombre de bébés. Makina : une seule, même famille, génération ≥ génération cible.
        </li>
      </ol>
      <p className="br-subtle" style={{ marginTop: 8 }}>
        Points encore ouverts (réglables dans « Hypothèses du modèle ») : κ n'est validé que pour des enfants bicolores ; on ignore si le jeu impose B ou max(B, part
        naturelle) quand la part naturelle de la cible dépasse B ; avec Reproducteur, deux tirages indépendants et génétons comptés par bébé sont supposés ; sexe du bébé
        supposé 50/50. Vos naissances enregistrées (onglet Historique) servent à vérifier le modèle.
      </p>
    </Card>
  )
}

// ---------- Onglet Mes couples ----------

interface PlanTotals {
  genetons: number
  jobXp: number
  value: number
  valueComplete: boolean
  makinas: { label: string; count: number; cost: MakinaCost }[]
  makinaTotal: number
  makinaComplete: boolean
}

function planTotals(plan: PairSuggestion[], kit: EconomyKit): PlanTotals {
  const byMakina = new Map<string, { label: string; count: number; cost: MakinaCost }>()
  let genetons = 0
  let jobXp = 0
  let value = 0
  let valueComplete = true
  for (const s of plan) {
    genetons += s.result.expectedGenetons
    jobXp += s.result.jobXp
    if (s.expectedValue !== undefined) value += s.expectedValue
    if (!s.valueComplete) valueComplete = false
    if (s.makina) {
      const gen = s.result.makinaGenerationRequired
      const k = `${s.makina}|${s.result.family}|${gen}`
      const cost = kit.makina(s.makina, s.result.family, gen)
      const prev = byMakina.get(k)
      byMakina.set(k, { label: cost.makina?.name ?? `${MAKINA_LABELS[s.makina]} G${gen}`, count: (prev?.count ?? 0) + 1, cost })
    }
  }
  const makinas = [...byMakina.values()].sort((x, y) => y.count - x.count)
  let makinaTotal = 0
  let makinaComplete = true
  for (const m of makinas) {
    if (m.cost.price !== null) makinaTotal += m.cost.price * m.count
    if (m.cost.price === null || !m.cost.complete) makinaComplete = false
  }
  return { genetons, jobXp, value, valueComplete, makinas, makinaTotal, makinaComplete }
}

function scoreLabel(objective: PairingObjective, score: number): string {
  if (objective === 'profit') return formatKamas(score, true)
  if (objective === 'genetons') return `${formatNumber(score, 1)} gén.`
  return `${formatNumber(score, 2)} pts`
}

function CouplesTab({ mounts, rules, kit, day, onSimulate }: { mounts: Mount[]; rules: Ruleset; kit: EconomyKit; day: DayInfo; onSimulate: (a: Mount, b: Mount) => void }) {
  const settingsGoal = useSettings((s) => s.goal)
  const settingsGoalSpecies = useSettings((s) => s.goalSpeciesId)
  const useOptimakina = useSettings((s) => s.useOptimakina)
  const update = useInventory((s) => s.update)
  const addMany = useInventory((s) => s.addMany)
  const log = useJournal((s) => s.log)

  const [objective, setObjective] = useState<PairingObjective>(() => objectiveFromGoal(settingsGoal))
  const [policy, setPolicy] = useState<MakinaPolicy>(useOptimakina ? 'auto' : 'jamais')
  const [takeza, setTakeza] = useTakezaToggle(day)
  const [familyFilter, setFamilyFilter] = useState<FamilyId | 'toutes'>('toutes')
  const [includeFertile, setIncludeFertile] = useState(false)
  const [goalId, setGoalId] = useState<number | null>(settingsGoalSpecies)
  const [showAllPlan, setShowAllPlan] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<PairSuggestion | null>(null)
  const [done, setDone] = useState<{ record: MatingRecord; a: Mount; b: Mount } | null>(null)

  const familyOf = (m: Mount) => getSpecies(m.speciesId)?.family
  const pool = useMemo(() => mounts.filter((m) => familyFilter === 'toutes' || familyOf(m) === familyFilter), [mounts, familyFilter])
  const fecund = pool.filter((m) => effectiveFertility(m) === 'feconde')
  const fertile = pool.filter((m) => effectiveFertility(m) === 'fertile')

  const suggestions = useMemo(
    () =>
      rankPairs(pool, {
        rules,
        objective,
        goalSpeciesId: goalId,
        makinaPolicy: policy,
        takeza,
        mountValue: kit.valueOf,
        makinaCost: kit.makina,
        genetonValue: kit.genetonValue,
        coupleCost: kit.coupleCost.cost,
        includeFertile,
      }),
    [pool, rules, objective, goalId, policy, takeza, kit, includeFertile],
  )
  const plan = useMemo(() => bestDisjointPairs(suggestions), [suggestions])
  const takezaPairs = plan.filter((s) => s.result.targetGeneration >= TAKEZA_PRIORITY_GENERATION).length
  const totals = useMemo(() => planTotals(plan, kit), [plan, kit])
  const inPlan = new Set(plan.flatMap((s) => [s.a.id, s.b.id]))
  const planKeys = new Set(plan.map((s) => s.key))
  const idle = [...fecund, ...(includeFertile ? fertile : [])].filter((m) => !inPlan.has(m.id))
  const clonePairs = useMemo(() => sterileClonePairs(mounts), [mounts])

  const familiesPresent = FAMILY_IDS.filter((f) => mounts.some((m) => familyOf(m) === f))
  const goalSpecies = goalId !== null ? getSpecies(goalId) : undefined

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return suggestions
    return suggestions.filter((s) => `${mountName(s.a)} ${mountName(s.b)} ${s.result.targetSpecies.map((id) => getSpecies(id)?.name ?? '').join(' ')}`.toLowerCase().includes(q))
  }, [suggestions, query])

  const genderCount = (f: FamilyId) => {
    const list = fecund.filter((m) => familyOf(m) === f)
    return { male: list.filter((m) => m.gender === 'male').length, femelle: list.filter((m) => m.gender === 'femelle').length }
  }

  const confirmMating = (s: PairSuggestion, choices: BabyChoice[], makina: MakinaKind | null, useTakeza: boolean): string[] => {
    const record = recordMating(s.a, s.b, choices, { rules, makina, takeza: useTakeza })
    if (record.errors.length || !record.log) return record.errors.length ? record.errors : ['Enregistrement impossible.']
    addMany(record.babies)
    for (const u of record.parentUpdates) update(u.id, u.patch)
    log({ kind: 'accouplement', ...record.log })
    setDone({ record, a: s.a, b: s.b })
    setDialog(null)
    return []
  }

  const afterClone = done ? sterileClonePairs(mounts, { involving: [done.a.id, done.b.id] }) : []

  return (
    <div className="stack" style={{ gap: 16 }}>
      {done && (
        <Callout tone="ok">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>
              Naissance enregistrée : {done.record.babies.map((b) => getSpecies(b.speciesId)?.name ?? `#${b.speciesId}`).join(' + ')}
            </strong>
            <button className="btn small ghost" onClick={() => setDone(null)} aria-label="Fermer">
              ✕
            </button>
          </div>
          <div>
            {done.record.targetBirths > 0 ? `${done.record.targetBirths} bébé${done.record.targetBirths > 1 ? 's' : ''} de la génération cible` : 'Pas de bébé de la génération cible cette fois'} · +
            {formatNumber(done.record.genetons)} génétons · +{formatNumber(done.record.jobXp)} XP d'Éleveur. {mountName(done.a)} et {mountName(done.b)} sont maintenant stériles ;
            le{done.record.babies.length > 1 ? 's' : ''} bébé{done.record.babies.length > 1 ? 's sont' : ' est'} dans l'étable.
          </div>
          {afterClone.length > 0 ? (
            <div style={{ marginTop: 6 }}>
              <strong>Cloner ensuite (« 2 pour 2 »)</strong>
              <ul className="br-notes ok">
                {afterClone.map((p) => (
                  <li key={`${p.a.id}-${p.b.id}`}>
                    {mountName(p.a)} + {mountName(p.b)} (G{p.generation}) : {clonePairSummary(p)}
                  </li>
                ))}
              </ul>
              <a href={href('montures')}>Ouvrir Mes montures pour cloner →</a>
            </div>
          ) : (
            <div className="br-subtle" style={{ marginTop: 4 }}>
              Pas encore d'autre stérile de même génération pour cloner ces parents : gardez-les en attente d'une partenaire (M-CLONE-01).
            </div>
          )}
        </Callout>
      )}

      <Card title="Réglages du classement">
        <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
          <SelectField<PairingObjective>
            label="Objectif"
            value={objective}
            onChange={setObjective}
            options={(Object.keys(OBJECTIVE_LABELS) as PairingObjective[]).map((o) => ({ value: o, label: OBJECTIVE_LABELS[o] }))}
          />
          <SelectField<MakinaPolicy>
            label="Optimakina"
            value={policy}
            onChange={setPolicy}
            options={(Object.keys(MAKINA_POLICY_LABELS) as MakinaPolicy[]).map((p) => ({ value: p, label: MAKINA_POLICY_LABELS[p] }))}
          />
          <SelectField<FamilyId | 'toutes'>
            label="Famille"
            value={familyFilter}
            onChange={setFamilyFilter}
            options={[{ value: 'toutes', label: 'Toutes' }, ...FAMILY_IDS.map((f) => ({ value: f, label: FAMILIES[f].plural }))]}
          />
          <label className="field" style={{ minWidth: 200 }}>
            Monture visée (objectif)
            <select value={goalId ?? ''} onChange={(e) => setGoalId(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">— Aucune —</option>
              {(familiesPresent.length ? familiesPresent : FAMILY_IDS).map((f) => (
                <optgroup key={f} label={FAMILIES[f].plural}>
                  {speciesOfFamily(f, { breedableOnly: true })
                    .filter((s) => s.generation >= 2)
                    .sort((x, y) => y.generation - x.generation || x.name.localeCompare(y.name, 'fr'))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        G{s.generation} {shortName(s)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="stack" style={{ gap: 4 }}>
            <label className="br-check">
              <input type="checkbox" checked={takeza} onChange={(e) => setTakeza(e.target.checked)} />
              Jour Takeza (+20 %)
            </label>
            <label className="br-check">
              <input type="checkbox" checked={includeFertile} onChange={(e) => setIncludeFertile(e.target.checked)} />
              Inclure les montures pas encore fécondes (prévision)
            </label>
          </div>
        </div>
        <div className="br-subtle" style={{ marginTop: 8 }}>
          {objective === 'progression' &&
            'Score de progression = Σ P(bébé nouveau, absent des deux arbres) × génération × pertinence (×3 objectif, ×2 recette la moins chère, ×1,5 autre ascendance, ×0,5 hors objectif).'}
          {objective === 'genetons' && `Score = génétons attendus par accouplement (1 généton ≈ ${formatKamas(kit.genetonValue)}${kit.genetonFromPlayer ? ', votre valeur' : ', valeur par défaut'}).`}
          {objective === 'profit' && 'Score = valeur attendue des bébés (niveau 1) + génétons − makina. Les parents deviennent stériles quel que soit le couple : leur valeur résiduelle ne change pas le classement.'}{' '}
          {policy === 'auto' &&
            `Optimakina automatique (M-OPTI-01) : achetée si son prix < C_eff × Δ / p (C_eff = remplacement des deux parents − valeur de leurs stériles, calculé avec vos prix ; à défaut, écart de valeur des bébés ou de génétons). Si le prix ou cette valeur manque : dès la cible G${OPTIMAKINA_SYSTEMATIC_GENERATION}, et sur une étape G4–G5 de votre objectif ; jamais en G2–G3 sans prix.`}
        </div>
        {!day.isTakeza && day.nextTakeza && day.daysToTakeza !== null && day.daysToTakeza <= 21 && (
          <Callout>
            <strong>Takeza le {longDay(day.nextTakeza)}</strong> (dans {day.daysToTakeza} j) : +20 % de génération cible. Gardez pour ce jour-là les couples dont la cible est ≥ G
            {TAKEZA_PRIORITY_GENERATION} (fort enjeu) et préparez-les féconds la veille (M-TAKEZA-01).
            {takezaPairs > 0 && ` ${takezaPairs} couple${takezaPairs > 1 ? 's' : ''} du plan ${takezaPairs > 1 ? 'sont concernés' : 'est concerné'}.`}
          </Callout>
        )}
      </Card>

      {mounts.length === 0 ? (
        <Card>
          <Empty>
            Aucune monture enregistrée. Ajoutez vos montures dans <a href={href('montures')}>Mes montures</a> pour obtenir les couples recommandés, ou utilisez le simulateur.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-4">
            <Stat
              label="Montures fécondes"
              value={fecund.length}
              hint={FAMILY_IDS.filter((f) => fecund.some((m) => familyOf(m) === f))
                .map((f) => {
                  const g = genderCount(f)
                  return `${FAMILIES[f].plural} ♂ ${g.male} / ♀ ${g.femelle}`
                })
                .join(' · ') || `${fertile.length} fertile${fertile.length > 1 ? 's' : ''} en préparation`}
            />
            <Stat label="Couples possibles" value={suggestions.length} hint={`plan : ${plan.length} couple${plan.length > 1 ? 's' : ''} disjoint${plan.length > 1 ? 's' : ''}`} />
            <Stat label="Génétons attendus (plan)" value={formatNumber(totals.genetons, 1)} hint={`≈ ${formatKamas(totals.genetons * kit.genetonValue, true)}`} />
            <Stat label="XP d'Éleveur (plan)" value={formatNumber(totals.jobXp)} />
            <Stat
              label="Valeur attendue (plan)"
              value={formatKamas(totals.value, true)}
              hint={
                totals.valueComplete ? (
                  'bébés + génétons − makinas'
                ) : (
                  <>
                    estimation incomplète · <PriceLink />
                  </>
                )
              }
            />
            <Stat
              label="Optimakinas (plan)"
              value={totals.makinas.reduce((s, m) => s + m.count, 0)}
              hint={
                totals.makinas.length === 0 ? (
                  'aucune'
                ) : totals.makinaComplete ? (
                  formatKamas(totals.makinaTotal)
                ) : (
                  <>
                    ≥ {formatKamas(totals.makinaTotal)} · coût incomplet · <PriceLink />
                  </>
                )
              }
            />
          </div>

          <Card
            title="Plan d'accouplement recommandé"
            actions={plan.length > 0 && <span className="br-subtle">chaque monture une seule fois · {OBJECTIVE_LABELS[objective].toLowerCase()}</span>}
          >
            {plan.length === 0 ? (
              <>
                <NoPlanExplanation fecund={fecund} fertile={fertile} includeFertile={includeFertile} suggestions={suggestions} objective={objective} />
                <WaitingList suggestions={suggestions} plan={plan} mounts={mounts} />
              </>
            ) : (
              <>
                <p className="br-subtle">
                  Ordre d'une session (M-ORDER-01) : accoupler tous ces couples → cloner les stériles de même génération → capturer → extraire → ranger. Les deux montures doivent être
                  dans l'étable.
                </p>
                <ol className="br-plan">
                  {(showAllPlan ? plan : plan.slice(0, PLAN_PAGE)).map((s, i) => (
                    <PairItem key={s.key} rank={i + 1} s={s} kit={kit} objective={objective} goal={goalSpecies} onMate={() => setDialog(s)} onSimulate={() => onSimulate(s.a, s.b)} />
                  ))}
                </ol>
                {plan.length > PLAN_PAGE && (
                  <button className="btn small" style={{ marginTop: 10 }} onClick={() => setShowAllPlan((v) => !v)}>
                    {showAllPlan ? 'Réduire' : `Afficher les ${plan.length} couples`}
                  </button>
                )}
                {totals.makinas.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <strong>Makinas à prévoir</strong>
                    <ul className="br-notes">
                      {totals.makinas.map((m) => (
                        <li key={m.label}>
                          {m.count} × {m.label} — <MakinaPriceView cost={m.cost} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <WaitingList suggestions={suggestions} plan={plan} mounts={mounts} />
                {idle.length > 0 && (
                  <div className="br-subtle" style={{ marginTop: 10 }}>
                    Sans couple dans ce plan ({idle.length}) : {idle.slice(0, 12).map((m) => `${GENDER_ICONS[m.gender]} ${mountName(m)}`).join(', ')}
                    {idle.length > 12 ? '…' : ''} — pas de partenaire de sexe opposé de la même famille, ou aucun bébé utile selon l'objectif.
                  </div>
                )}
              </>
            )}
          </Card>

          {clonePairs.length > 0 && (
            <Callout>
              <strong>{clonePairs.length} clonage{clonePairs.length > 1 ? 's' : ''} possible{clonePairs.length > 1 ? 's' : ''}</strong> parmi vos stériles de même génération (
              {clonePairs.filter((p) => p.sameSpecies).length} de même couleur, dont {clonePairs.filter((p) => p.certain).length} au résultat certain : même couleur, même sexe et
              même arbre ; sinon le clone garde le sexe et la généalogie de la monture conservée, 50/50). Clonez juste après les accouplements :{' '}
              <a href={href('montures')}>Mes montures</a>.
            </Callout>
          )}

          {suggestions.length > 0 && (
            <Card
              title={`Toutes les combinaisons (${suggestions.length})`}
              actions={
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrer (nom, cible…)" aria-label="Filtrer les combinaisons" style={{ minWidth: 180 }} />
              }
            >
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Mâle</th>
                      <th>Femelle</th>
                      <th>Génération cible</th>
                      <th className="num">B</th>
                      <th>Makina</th>
                      <th className="num">Génétons</th>
                      <th className="num">Valeur</th>
                      <th className="num">Score</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {(showAll ? filtered : filtered.slice(0, TABLE_PAGE)).map((s) => (
                      <tr key={s.key}>
                        <td>
                          <MountLabel m={s.a} />
                        </td>
                        <td>
                          <MountLabel m={s.b} />
                        </td>
                        <td>
                          <span className="row" style={{ gap: 4 }}>
                            <GenBadge generation={s.result.targetGeneration} />
                            <span className="br-subtle">{s.result.targetSpecies.map((id) => (getSpecies(id) ? shortName(getSpecies(id) as Species) : `#${id}`)).join(', ')}</span>
                            {!s.result.recordPossible && (
                              <Badge tone="warn" title="Arbre déjà ≥ génération cible : aucun généton">
                                arbre
                              </Badge>
                            )}
                            {planKeys.has(s.key) && <Badge tone="accent">plan</Badge>}
                          </span>
                        </td>
                        <td className="num">{formatPercent(s.result.targetChance, 1)}</td>
                        <td title={s.makinaAdvice.reason}>
                          {s.makina ? <Badge tone="gold">{MAKINA_LABELS[s.makina]} G{s.result.makinaGenerationRequired}</Badge> : <span className="muted">—</span>}
                        </td>
                        <td className="num">{formatNumber(s.result.expectedGenetons, 1)}</td>
                        <td className="num">
                          {s.expectedValue !== undefined ? formatKamas(s.expectedValue, true) : '—'}
                          {!s.valueComplete && ' *'}
                        </td>
                        <td className="num">{scoreLabel(objective, s.score)}</td>
                        <td>
                          <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                            <button className="btn small" onClick={() => onSimulate(s.a, s.b)} title="Ouvrir dans le simulateur">
                              Simuler
                            </button>
                            <button className="btn small primary" onClick={() => setDialog(s)}>
                              Accoupler
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > TABLE_PAGE && (
                <button className="btn small" style={{ marginTop: 10 }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Réduire' : `Afficher les ${filtered.length} combinaisons`}
                </button>
              )}
              {filtered.some((s) => !s.valueComplete) && (
                <div className="br-subtle" style={{ marginTop: 6 }}>
                  * valeur incomplète : un prix de monture ou de makina manque (<PriceLink />).
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {dialog && <MatingDialog pair={dialog} rules={rules} defaultTakeza={takeza} day={day} onClose={() => setDialog(null)} onConfirm={confirmMating} />}
    </div>
  )
}

/** Montures utiles à l'objectif gardées hors du plan : leur partenaire du plan est encore en préparation. */
function WaitingList({ suggestions, plan, mounts }: { suggestions: PairSuggestion[]; plan: PairSuggestion[]; mounts: Mount[] }) {
  const inPlan = new Set(plan.flatMap((s) => [s.a.id, s.b.id]))
  const byId = new Map(mounts.map((m) => [m.id, m]))
  const seen = new Set<string>()
  const items: { m: Mount; partner: Mount; targets: number[] }[] = []
  for (const s of suggestions)
    for (const w of s.waitFor) {
      if (inPlan.has(w.mountId) || seen.has(w.mountId)) continue
      const m = byId.get(w.mountId)
      const partner = byId.get(w.partnerId)
      if (!m || !partner) continue
      seen.add(w.mountId)
      items.push({ m, partner, targets: w.targetSpecies })
    }
  if (!items.length) return null
  return (
    <Callout>
      <strong>En attente d'une partenaire de l'objectif</strong>
      <ul className="br-notes">
        {items.map(({ m, partner, targets }) => (
          <li key={m.id}>
            {GENDER_ICONS[m.gender]} {mountName(m)} : ne l'accouplez pas ailleurs — attendez que {GENDER_ICONS[partner.gender]} {mountName(partner)} soit féconde (
            {targets.map((id) => getSpecies(id)?.name ?? `#${id}`).join(', ')}). Suivez ses jauges dans <a href={href('enclos')}>Enclos</a>.
          </li>
        ))}
      </ul>
    </Callout>
  )
}

function NoPlanExplanation({
  fecund,
  fertile,
  includeFertile,
  suggestions,
  objective,
}: {
  fecund: Mount[]
  fertile: Mount[]
  includeFertile: boolean
  suggestions: PairSuggestion[]
  objective: PairingObjective
}) {
  if (fecund.length === 0 && !includeFertile)
    return (
      <Empty>
        Aucune monture féconde pour l'instant (endurance, maturité et amour à 20 000).{' '}
        {fertile.length > 0 ? (
          <>
            {fertile.length} monture{fertile.length > 1 ? 's sont' : ' est'} en préparation : cochez « Inclure les montures pas encore fécondes » pour anticiper les couples, et suivez
            leurs jauges dans <a href={href('enclos')}>Enclos</a>.
          </>
        ) : (
          <>
            Placez vos montures dans les <a href={href('enclos')}>enclos</a> pour les rendre fécondes.
          </>
        )}
      </Empty>
    )
  if (suggestions.length === 0)
    return (
      <Empty>
        Aucun couple possible : il faut un mâle et une femelle de la même famille, tous deux féconds. Vérifiez le sexe et le statut de vos montures dans{' '}
        <a href={href('montures')}>Mes montures</a>.
      </Empty>
    )
  const consuming = suggestions.filter((s) => s.consumesGoalParents.length > 0).length
  if (consuming === suggestions.length)
    return (
      <Empty>
        {suggestions.length} couple{suggestions.length > 1 ? 's' : ''} possible{suggestions.length > 1 ? 's' : ''}, mais aucun n'est conseillé : {suggestions.length > 1 ? 'chacun consommerait' : 'il consommerait'}{' '}
        une monture utile à votre objectif sur un croisement hors objectif. Gardez-la pour son croisement du plan (détail dans la liste ci-dessous).
      </Empty>
    )
  return (
    <Empty>
      {suggestions.length} couple{suggestions.length > 1 ? 's' : ''} possible{suggestions.length > 1 ? 's' : ''}, mais aucun ne rapporte{' '}
      {objective === 'genetons' ? 'de généton' : objective === 'profit' ? 'de valeur positive' : 'de bébé nouveau'} selon l'objectif choisi
      {consuming > 0 ? ' (ou il consommerait une monture utile à votre objectif hors objectif)' : ''}. Essayez un autre objectif ou consultez la liste complète ci-dessous.
    </Empty>
  )
}

function PairItem({
  rank,
  s,
  kit,
  objective,
  goal,
  onMate,
  onSimulate,
}: {
  rank: number
  s: PairSuggestion
  kit: EconomyKit
  objective: PairingObjective
  goal: Species | undefined
  onMate: () => void
  onSimulate: () => void
}) {
  const r = s.result
  const targets = r.outcomes.filter((o) => o.isTarget)
  const cost = s.makina ? kit.makina(s.makina, r.family, r.makinaGenerationRequired) : null
  return (
    <li className={`br-pair${s.ready ? '' : ' not-ready'}`}>
      <div className="br-pair-head">
        <span className="br-rank">{rank}</span>
        <MountLabel m={s.a} />
        <span className="br-times">×</span>
        <MountLabel m={s.b} />
        <span className="spacer" />
        {!s.ready && <Badge tone="warn">à préparer</Badge>}
        {s.stackAttempts !== null && s.stackAttempts < STACK_MIN_ATTEMPTS && (
          <Badge tone="warn" title={`Accumuler avant de tenter (M-STACK-01) : produisez des parents pour au moins ${STACK_MIN_ATTEMPTS} tentatives.`}>
            {s.stackAttempts} tentative{s.stackAttempts > 1 ? 's' : ''} possible{s.stackAttempts > 1 ? 's' : ''}
          </Badge>
        )}
        {s.goalChance > 0 && goal && <Badge tone="gold">🎯 {shortName(goal)}</Badge>}
        <Badge tone="info" title="Score selon l'objectif">
          {scoreLabel(objective, s.score)}
        </Badge>
      </div>
      <div className="br-pair-body">
        <div className="stack" style={{ gap: 6 }}>
          <div className="br-targets">
            {targets.map((o) => (
              <div key={o.speciesId} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                <SpeciesName id={o.speciesId} />
                <ProbBar p={o.probability} target />
              </div>
            ))}
          </div>
          <div className="br-subtle">
            Génération cible G{r.targetGeneration} : {formatPercent(r.targetChance, 1)} par bébé
            {r.babies === 2 ? ' (2 bébés, Reproducteur)' : ''}. Autres issues : {formatPercent(1 - targets.reduce((x, o) => x + o.probability, 0), 1)}.
          </div>
        </div>
        <dl className="br-kv">
          <dt>Makina</dt>
          <dd>
            {s.makina && cost ? (
              <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
                <Badge tone="gold">
                  {MAKINA_LABELS[s.makina]} G{r.makinaGenerationRequired}
                </Badge>
                <MakinaPriceView cost={cost} />
              </span>
            ) : (
              <span className="muted">aucune</span>
            )}
            <div className="br-subtle">{s.makinaAdvice.reason}</div>
          </dd>
          <dt>Génétons</dt>
          <dd>
            {formatNumber(r.expectedGenetons, 1)} attendus{r.recordPossible ? ` (${r.genetonsIfRecord} si réussite)` : ' (arbre ≥ cible)'}
          </dd>
          <dt>Valeur</dt>
          <dd>
            {s.expectedValue !== undefined ? formatKamas(s.expectedValue, true) : '—'}
            {!s.valueComplete && <span className="muted"> · incomplète</span>}
          </dd>
          <dt>XP</dt>
          <dd>{formatNumber(r.jobXp)}</dd>
        </dl>
      </div>
      {(s.reasons.length > 0 || s.warnings.length > 0) && (
        <details className="br-details">
          <summary>
            Pourquoi ce couple ? {s.warnings.length > 0 && `(${s.warnings.length} point${s.warnings.length > 1 ? 's' : ''} d'attention)`}
          </summary>
          <Notes items={s.reasons} tone="ok" />
          <Notes items={s.warnings} tone="warn" />
        </details>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8, gap: 6 }}>
        <button className="btn small" onClick={onSimulate}>
          Simuler
        </button>
        <button className="btn small primary" onClick={onMate} disabled={!s.ready} title={s.ready ? 'Enregistrer le résultat réel de cet accouplement' : 'Les deux montures doivent être fécondes'}>
          Accoupler
        </button>
      </div>
    </li>
  )
}

// ---------- Boîte de dialogue « Accoupler » ----------

interface BabyDraft {
  speciesId: number
  gender: Gender
  ability: Ability | null
  serenity: number
  name: string
}

function defaultAbility(makina: MakinaKind | null, day: DayInfo): Ability | null {
  if (makina === 'kromakina') return 'cameleone'
  return day.today?.babyAbility ?? null
}

function MatingDialog({
  pair,
  rules,
  defaultTakeza,
  day,
  onClose,
  onConfirm,
}: {
  pair: PairSuggestion
  rules: Ruleset
  defaultTakeza: boolean
  day: DayInfo
  onClose: () => void
  onConfirm: (s: PairSuggestion, babies: BabyChoice[], makina: MakinaKind | null, takeza: boolean) => string[]
}) {
  const [makina, setMakina] = useState<MakinaChoice>(pair.makina ?? 'none')
  const [takeza, setTakeza] = useState(defaultTakeza)
  const kind: MakinaKind | null = makina === 'none' ? null : makina
  const firstTarget = pair.result.outcomes.find((o) => o.isTarget)?.speciesId ?? pair.result.outcomes[0]?.speciesId ?? pair.a.speciesId
  const [babies, setBabies] = useState<BabyDraft[]>(() =>
    Array.from({ length: pair.result.babies }, (_, i) => ({ speciesId: firstTarget, gender: i === 0 ? 'femelle' : 'male', ability: defaultAbility(pair.makina, day), serenity: 0, name: '' })),
  )
  const [errors, setErrors] = useState<string[]>([])
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    dialogRef.current?.querySelector<HTMLElement>('select, input, button')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const changeMakina = (v: MakinaChoice) => {
    const before = defaultAbility(kind, day)
    const after = defaultAbility(v === 'none' ? null : v, day)
    setMakina(v)
    setBabies((list) => list.map((b) => (b.ability === before ? { ...b, ability: after } : b)))
  }

  const choices = useMemo<BabyChoice[]>(
    () => babies.map((b) => ({ speciesId: b.speciesId, gender: b.gender, ability: b.ability, serenity: b.serenity, name: b.name })),
    [babies],
  )
  const preview = useMemo(() => recordMating(pair.a, pair.b, choices, { rules, makina: kind, takeza }), [pair, rules, kind, takeza, choices])
  const softWarnings = preview.warnings.filter((w) => !w.includes('Reproducteur'))
  const outcomes = preview.result?.outcomes ?? pair.result.outcomes
  const expectedBabies = preview.result?.babies ?? pair.result.babies

  const setBaby = (i: number, patch: Partial<BabyDraft>) => setBabies((list) => list.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  const setCount = (n: number) =>
    setBabies((list) =>
      n <= list.length
        ? list.slice(0, n)
        : [...list, { speciesId: firstTarget, gender: list[0]?.gender === 'male' ? 'femelle' : 'male', ability: defaultAbility(kind, day), serenity: 0, name: '' }],
    )

  return (
    <div
      className="br-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="br-modal" role="dialog" aria-modal="true" aria-labelledby="br-mating-title" ref={dialogRef}>
        <h2 id="br-mating-title">Enregistrer un accouplement</h2>
        <p className="br-subtle">Faites l'accouplement en jeu (les deux montures dans l'étable), puis indiquez le résultat réel. Les parents deviendront stériles.</p>
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <MountLabel m={pair.a} />
          <span className="br-times">×</span>
          <MountLabel m={pair.b} />
        </div>
        <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
          <SelectField<MakinaChoice> label="Makina utilisée" value={makina} onChange={changeMakina} options={MAKINA_CHOICES} />
          <label className="br-check">
            <input type="checkbox" checked={takeza} onChange={(e) => setTakeza(e.target.checked)} />
            Jour Takeza
          </label>
          <SelectField<number>
            label="Bébés obtenus"
            value={babies.length}
            onChange={setCount}
            options={[
              { value: 1, label: '1 bébé' },
              { value: 2, label: '2 bébés (Reproducteur)' },
            ]}
          />
        </div>
        {preview.result && (
          <div className="br-subtle" style={{ margin: '6px 0 10px' }}>
            Génération cible G{preview.result.targetGeneration} à {formatPercent(preview.result.targetChance, 1)} par bébé
            {kind ? ` (${MAKINA_LABELS[kind]} G${preview.result.makinaGenerationRequired} ou plus)` : ''}.
          </div>
        )}
        {babies.map((b, i) => (
          <div key={i} className="br-baby">
            <label className="field">
              Bébé {babies.length > 1 ? i + 1 : ''} — espèce obtenue
              <select value={b.speciesId} onChange={(e) => setBaby(i, { speciesId: Number(e.target.value) })}>
                {outcomes.map((o) => (
                  <option key={o.speciesId} value={o.speciesId}>
                    {getSpecies(o.speciesId)?.name ?? `#${o.speciesId}`} — {formatPercent(o.probability, 1)}
                    {o.isTarget ? ' (cible)' : ''}
                  </option>
                ))}
                {!outcomes.some((o) => o.speciesId === b.speciesId) && <option value={b.speciesId}>{getSpecies(b.speciesId)?.name ?? `#${b.speciesId}`}</option>}
              </select>
            </label>
            <div className="field">
              <span>Sexe</span>
              <div className="br-radio" role="radiogroup" aria-label={`Sexe du bébé ${i + 1}`}>
                {(['male', 'femelle'] as Gender[]).map((g) => (
                  <label key={g} className={b.gender === g ? 'checked' : undefined}>
                    <input type="radio" name={`br-gender-${i}`} checked={b.gender === g} onChange={() => setBaby(i, { gender: g })} />
                    {GENDER_ICONS[g]} {GENDER_LABELS[g]}
                  </label>
                ))}
              </div>
            </div>
            <SelectField<Ability | ''>
              label="Capacité"
              value={b.ability ?? ''}
              onChange={(v) => setBaby(i, { ability: v === '' ? null : v })}
              options={[{ value: '', label: 'Aucune' }, ...ABILITY_IDS.map((id) => ({ value: id, label: ABILITY_LABELS[id] }))]}
            />
            <div className="br-baby-extra">
              <NumberField label="Sérénité (si connue)" value={b.serenity} min={-5000} max={5000} step={100} width={100} onChange={(v) => setBaby(i, { serenity: Math.round(v) })} />
              <label className="field" style={{ flex: 1, minWidth: 160 }}>
                Nom (facultatif)
                <input value={b.name} onChange={(e) => setBaby(i, { name: e.target.value })} placeholder={getSpecies(b.speciesId)?.name} />
              </label>
            </div>
          </div>
        ))}
        <div className="grid grid-3" style={{ marginTop: 12 }}>
          <Stat label="Génétons gagnés" value={`+${formatNumber(preview.genetons)}`} hint={preview.result?.recordPossible ? 'naissance record' : 'arbre ≥ génération cible'} />
          <Stat label="XP d'Éleveur" value={`+${formatNumber(preview.jobXp)}`} />
          <Stat label="Génération cible obtenue" value={`${preview.targetBirths} / ${babies.length}`} />
        </div>
        {expectedBabies !== babies.length && (
          <Callout tone="warn">{expectedBabies === 2 ? 'Un parent est Reproducteur : le jeu donne normalement 2 bébés.' : 'Aucun parent n’est Reproducteur : le jeu donne normalement 1 bébé.'}</Callout>
        )}
        {softWarnings.length > 0 && <Notes items={softWarnings} tone="warn" />}
        {(errors.length > 0 || preview.errors.length > 0) && (
          <Callout tone="danger">
            <Notes items={errors.length ? errors : preview.errors} />
          </Callout>
        )}
        {kind && rules.animakina === 'sexe' && kind === 'animakina' && <div className="br-subtle">3.7 : l'Animakina vous a laissé choisir le sexe du bébé.</div>}
        <div className="br-modal-actions">
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn primary"
            disabled={preview.errors.length > 0}
            onClick={() => {
              const errs = onConfirm(pair, choices, kind, takeza)
              if (errs.length) setErrors(errs)
            }}
          >
            Enregistrer la naissance
          </button>
        </div>
        <p className="br-subtle" style={{ marginTop: 8 }}>
          {kind ? `${capitalize(theMakina(kind))} est notée dans le journal. ` : ''}Le journal sert à comparer vos naissances au modèle (onglet Historique).
        </p>
      </div>
    </div>
  )
}

// ---------- Onglet Historique ----------

function verdictView(c: MatingCalibration): { tone: 'ok' | 'warn' | 'info' | undefined; label: string; text: string } {
  const z = c.z === null ? '' : `${c.z >= 0 ? '+' : ''}${formatNumber(c.z, 1)} écart-type`
  if (c.verdict === 'insuffisant')
    return { tone: undefined, label: 'trop peu de naissances', text: `Il faut au moins ${CALIBRATION_MIN_BIRTHS} naissances pour juger le modèle.` }
  if (c.verdict === 'conforme') return { tone: 'ok', label: 'conforme au modèle', text: `Écart de ${z} : dans la marge normale du hasard (±2).` }
  if (c.verdict === 'au-dessus') return { tone: 'info', label: 'au-dessus du modèle', text: `Écart de ${z} : plus de réussites que prévu (chance, ou modèle prudent).` }
  return { tone: 'warn', label: 'en dessous du modèle', text: `Écart de ${z} : moins de réussites que prévu. Vérifiez les arbres et niveaux saisis.` }
}

function CalibrationTable({ title, rows }: { title: string; rows: MatingCalibration['byGeneration'] }) {
  if (!rows.length) return null
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{title}</th>
            <th className="num">Naissances</th>
            <th className="num">Génération cible obtenue</th>
            <th className="num">Attendu (Σ B)</th>
            <th className="num">Taux observé</th>
            <th className="num">Taux prévu</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.key}>
              <td>{b.label}</td>
              <td className="num">{b.births}</td>
              <td className="num">{b.successes}</td>
              <td className="num">{formatNumber(b.expected, 1)}</td>
              <td className="num">{formatPercent(b.births ? b.successes / b.births : 0, 1)}</td>
              <td className="num">{formatPercent(b.births ? b.expected / b.births : 0, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HistoryTab({ entries, rules }: { entries: MatingEntry[]; rules: Ruleset }) {
  const remove = useJournal((s) => s.remove)
  const [showAll, setShowAll] = useState(false)
  const calib = useMemo(() => matingCalibration(entries), [entries])
  const sorted = useMemo(() => [...entries].sort((x, y) => y.at - x.at), [entries])
  if (entries.length === 0)
    return (
      <Card>
        <Empty>
          Aucun accouplement enregistré. Dans « Mes couples », le bouton « Accoupler » enregistre le résultat réel : bébés ajoutés à l'étable, parents stériles, génétons et XP
          journalisés. L'historique compare ensuite vos naissances au modèle.
        </Empty>
      </Card>
    )
  const v = verdictView(calib)
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid grid-4">
        <Stat label="Accouplements" value={calib.matings} hint={`${calib.births} naissance${calib.births > 1 ? 's' : ''}`} />
        <Stat
          label="Génération cible obtenue"
          value={`${calib.successes} / ${calib.births}`}
          hint={`attendu ≈ ${formatNumber(calib.expected, 1)} (± ${formatNumber(calib.sd, 1)})`}
        />
        <Stat label="Génétons gagnés" value={formatNumber(calib.genetons)} />
        <Stat label="XP d'Éleveur" value={formatNumber(calib.jobXp)} />
      </div>
      <Card
        title="Le modèle colle-t-il à vos naissances ?"
        actions={
          <Badge tone={v.tone} title="Comparaison des réussites observées à Σ B">
            {v.label}
          </Badge>
        }
      >
        <p>
          {v.text} Chaque bébé compte comme un tirage indépendant de probabilité B (la chance de génération cible notée au moment de l'accouplement) : on compare le nombre de
          bébés de la génération cible obtenus à la somme des B.
        </p>
        <div className="grid grid-2">
          <CalibrationTable title="Génération cible" rows={calib.byGeneration} />
          <CalibrationTable title="Chance prévue" rows={calib.byChance} />
        </div>
      </Card>
      <Card title="Journal des accouplements">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Parents</th>
                <th>Cible</th>
                <th>Bébé(s)</th>
                <th>Makina</th>
                <th className="num">Génétons</th>
                <th className="num">XP</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {(showAll ? sorted : sorted.slice(0, TABLE_PAGE)).map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.at)}</td>
                  <td>
                    <span className="row" style={{ gap: 4 }}>
                      <SpeciesName id={e.parentA} />
                      <span className="br-times">×</span>
                      <SpeciesName id={e.parentB} />
                    </span>
                  </td>
                  <td>
                    <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      <GenBadge generation={e.targetGeneration} />
                      <span className="br-subtle">{formatPercent(e.targetChance, 1)}</span>
                    </span>
                  </td>
                  <td>
                    <span className="stack" style={{ gap: 2 }}>
                      {e.babies.map((id, i) => (
                        <span key={i} className="row" style={{ gap: 4 }}>
                          <SpeciesName id={id} />
                          {getSpecies(id)?.generation === e.targetGeneration ? <Badge tone="ok">cible</Badge> : null}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>{e.makina ? (MAKINA_LABELS[e.makina as MakinaKind] ?? e.makina) : <span className="muted">—</span>}</td>
                  <td className="num">{formatNumber(e.genetons)}</td>
                  <td className="num">{formatNumber(e.jobXp)}</td>
                  <td>
                    <button
                      className="btn small ghost"
                      title="Supprimer cette entrée du journal (ne modifie pas vos montures)"
                      aria-label="Supprimer l'entrée"
                      onClick={() => {
                        if (window.confirm('Supprimer cette entrée du journal ? Vos montures ne sont pas modifiées.')) remove(e.id)
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sorted.length > TABLE_PAGE && (
          <button className="btn small" style={{ marginTop: 10 }} onClick={() => setShowAll((x) => !x)}>
            {showAll ? 'Réduire' : `Afficher les ${sorted.length} accouplements`}
          </button>
        )}
        <p className="br-subtle" style={{ marginTop: 8 }}>
          XP calculée avec le barème {rules.id} au moment de l'enregistrement ({rules.matingXpPerGeneration} par génération et par parent actuellement).
        </p>
      </Card>
    </div>
  )
}
