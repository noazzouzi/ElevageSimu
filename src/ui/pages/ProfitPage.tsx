// Page « Rentabilité » : rentabilité d'un cycle de production (dépenses, parents engagés, socle,
// durée, revenus, bénéfice en intervalle, kamas/heure, ROI), classement des croisements, valeur des
// montures possédées, et hypothèses/sources. Logique : src/domain/economy.ts et fuel.ts ; prix : page Prix.
//
// Paramètres : les champs issus des Réglages (famille, niveau des parents, palier, enclos, Optimakina,
// taxe) suivent les Réglages en direct ; seule une modification faite ICI est mémorisée comme écart
// (« différent de vos réglages », avec retour possible). Les autres champs sont propres à la page.
import { useMemo, useState, type ReactNode } from 'react'
import { FAMILIES, FAMILY_IDS, PRICES_DEFAULT, STRATEGY, getSpecies, itemName, speciesOfFamily } from '../../data'
import { FUEL_TIER_NAMES, GAUGE_LABELS } from '../../domain/constants'
import {
  CASH_CATEGORIES,
  COST_CATEGORY_LABELS,
  DEFAULT_MOUNTS_PER_CAST,
  FATE_LABELS,
  FERTILITY_POINT_COST_HINTS,
  NET_KIND_LABELS,
  OPTIMAKINA_MODE_LABELS,
  BRISAGE_RISK_NOTE,
  batchProfile,
  batchProfileFromPlans,
  crossingRanking,
  cycleProfit,
  cyclesComparable,
  genetonKamasValue,
  mountValuation,
  unlockedPaddockCount,
  type BatchModel,
  type BatchProfile,
  type CostCategory,
  type CrossingRank,
  type CycleConfig,
  type CycleResult,
  type FateKind,
  type MaterialLine,
  type MountPriceContext,
  type MountState,
  type NetKind,
  type OptimakinaMode,
  type ParentValueMode,
  type Range,
  type SterileFate,
} from '../../domain/economy'
import { defaultMangeoirePointCost } from '../../domain/fuel'
import { effectiveFertility, FERTILITY_LABELS, mountName } from '../../domain/mounts'
import { assignPaddocks } from '../../domain/paddockAssign'
import { goalContext } from '../../domain/pairing'
import type { PriceContext } from '../../domain/pricing'
import type { Ruleset } from '../../domain/rules'
import type { FamilyId, FuelTier, Mount } from '../../domain/types'
import { formatDuration, formatKamas, formatNumber, formatPercent } from '../../lib/format'
import { useInventory } from '../../store/inventory'
import { usePriceContext, usePrices } from '../../store/prices'
import { useRules, useSettings } from '../../store/settings'
import { Badge, Callout, Card, Empty, NumberField, PageHeader, SelectField, Stat, Tabs } from '../components'
import { href } from '../router'
import { ConfidenceBadge, SpeciesName, SpeciesPicker } from '../species'
import './ProfitPage.css'

type TabId = 'cycle' | 'classement' | 'inventaire' | 'hypotheses'

const TABS: { id: TabId; label: string }[] = [
  { id: 'cycle', label: 'Cycle de production' },
  { id: 'classement', label: 'Classement des croisements' },
  { id: 'inventaire', label: 'Valeur de mes montures' },
  { id: 'hypotheses', label: 'Hypothèses & sources' },
]

const TIERS: FuelTier[] = [1, 2, 3, 4]
const STORAGE_KEY = 'elevagesimu:rentabilite'
const OPTI_MODES: OptimakinaMode[] = ['auto', 'toujours', 'jamais']

// ---------- Paramètres : réglages (en direct) + écarts propres à la page ----------

/** Champs issus des Réglages : suivis en direct, sauf écart saisi sur cette page. */
interface SettingsBacked {
  family: FamilyId
  parentLevel: number
  tier: FuelTier
  xpTier: FuelTier
  paddocks: number
  optimakina: OptimakinaMode
  saleTaxPct: number
}

type PageBatchModel = BatchModel | 'mes-lots'

/** Champs propres à la page (mémorisés tels quels). */
interface PageParams {
  mode: 'croisement' | 'libre'
  crossingKey: string | null
  parentA: number | null
  parentB: number | null
  pairs: number | null
  parentStartLevel: number
  batchSize: number
  includeCapture: boolean
  netKind: NetKind
  mountsPerCast: number
  /** null : sérénité du modèle de lot. */
  serenity: number | null
  sterileFate: SterileFate
  sage: boolean
  takeza: boolean
  includeSteriles: boolean
  batchModel: PageBatchModel
  parentValue: ParentValueMode
}

interface Params extends SettingsBacked, Omit<PageParams, 'crossingKey' | 'pairs'> {
  crossingKey: string
  pairs: number
}

const SETTINGS_KEYS: (keyof SettingsBacked)[] = ['family', 'parentLevel', 'tier', 'xpTier', 'paddocks', 'optimakina', 'saleTaxPct']

const SETTINGS_FIELD_LABELS: Record<keyof SettingsBacked, string> = {
  family: 'Famille',
  parentLevel: 'Niveau des parents',
  tier: 'Palier des jauges',
  xpTier: 'Palier de la Mangeoire',
  paddocks: 'Enclos en parallèle',
  optimakina: 'Optimakina',
  saleTaxPct: 'Taxe d’HDV',
}

const PAGE_DEFAULTS: PageParams = {
  mode: 'croisement',
  crossingKey: null,
  parentA: null,
  parentB: null,
  pairs: null,
  parentStartLevel: 1,
  batchSize: 10,
  includeCapture: true,
  netKind: 'universel',
  mountsPerCast: DEFAULT_MOUNTS_PER_CAST.universel.value,
  serenity: null,
  sterileFate: 'meilleur',
  sage: false,
  takeza: false,
  includeSteriles: true,
  batchModel: 'typique',
  parentValue: 'opportunite',
}

interface Stored {
  v: 2
  page: Partial<PageParams>
  overrides: Partial<SettingsBacked>
}

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const isTier = (v: unknown): v is FuelTier => TIERS.includes(v as FuelTier)

/** Champs de page valides seulement (une saisie corrompue ou ancienne retombe sur le défaut). */
function cleanPage(raw: Record<string, unknown>): Partial<PageParams> {
  const out: Partial<PageParams> = {}
  if (raw.mode === 'croisement' || raw.mode === 'libre') out.mode = raw.mode
  if (typeof raw.crossingKey === 'string') out.crossingKey = raw.crossingKey
  if (raw.parentA === null || (typeof raw.parentA === 'number' && getSpecies(raw.parentA))) out.parentA = raw.parentA as number | null
  if (raw.parentB === null || (typeof raw.parentB === 'number' && getSpecies(raw.parentB))) out.parentB = raw.parentB as number | null
  if (isNum(raw.pairs, 1, 1000)) out.pairs = Math.round(raw.pairs)
  if (isNum(raw.parentStartLevel, 1, 200)) out.parentStartLevel = Math.round(raw.parentStartLevel)
  if (isNum(raw.batchSize, 1, 10)) out.batchSize = Math.round(raw.batchSize)
  if (typeof raw.includeCapture === 'boolean') out.includeCapture = raw.includeCapture
  if (typeof raw.netKind === 'string' && raw.netKind in NET_KIND_LABELS) out.netKind = raw.netKind as NetKind
  if (isNum(raw.mountsPerCast, 1, 20)) out.mountsPerCast = Math.round(raw.mountsPerCast)
  if (raw.serenity === null || isNum(raw.serenity, 0, 20_000)) out.serenity = raw.serenity as number | null
  if (raw.sterileFate === 'meilleur' || raw.sterileFate === 'cloner') out.sterileFate = raw.sterileFate
  if (typeof raw.sage === 'boolean') out.sage = raw.sage
  if (typeof raw.takeza === 'boolean') out.takeza = raw.takeza
  if (typeof raw.includeSteriles === 'boolean') out.includeSteriles = raw.includeSteriles
  if (raw.batchModel === 'typique' || raw.batchModel === 'ideal' || raw.batchModel === 'mes-lots') out.batchModel = raw.batchModel
  if (raw.parentValue === 'opportunite' || raw.parentValue === 'hors') out.parentValue = raw.parentValue
  return out
}

function cleanOverrides(raw: Record<string, unknown>): Partial<SettingsBacked> {
  const out: Partial<SettingsBacked> = {}
  if (FAMILY_IDS.includes(raw.family as FamilyId)) out.family = raw.family as FamilyId
  if (isNum(raw.parentLevel, 1, 200)) out.parentLevel = Math.round(raw.parentLevel)
  if (isTier(raw.tier)) out.tier = raw.tier
  if (isTier(raw.xpTier)) out.xpTier = raw.xpTier
  if (isNum(raw.paddocks, 1, 6)) out.paddocks = Math.round(raw.paddocks)
  if (OPTI_MODES.includes(raw.optimakina as OptimakinaMode)) out.optimakina = raw.optimakina as OptimakinaMode
  if (isNum(raw.saleTaxPct, 0, 20)) out.saleTaxPct = raw.saleTaxPct
  return out
}

function loadStored(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const o = raw ? (JSON.parse(raw) as unknown) : null
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { v: 2, page: {}, overrides: {} }
    const rec = o as Record<string, unknown>
    if (rec.v === 2) {
      const page = rec.page && typeof rec.page === 'object' ? cleanPage(rec.page as Record<string, unknown>) : {}
      const overrides = rec.overrides && typeof rec.overrides === 'object' ? cleanOverrides(rec.overrides as Record<string, unknown>) : {}
      return { v: 2, page, overrides }
    }
    // Ancien format (copie complète, réglages figés compris) : on ne garde que les champs de la page ;
    // les champs issus des Réglages suivent de nouveau les Réglages.
    return { v: 2, page: cleanPage(rec), overrides: {} }
  } catch {
    return { v: 2, page: {}, overrides: {} }
  }
}

function saveStored(s: Stored) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // Stockage indisponible (navigation privée) : les paramètres ne sont simplement pas mémorisés.
  }
}

interface LiveSettings {
  family: FamilyId
  parentTargetLevel: number
  preferredTier: FuelTier
  jobLevel: number
  useOptimakina: boolean
  saleTax: number
}

function fromSettings(s: LiveSettings): SettingsBacked {
  return {
    family: s.family,
    parentLevel: s.parentTargetLevel,
    tier: s.preferredTier,
    xpTier: s.preferredTier,
    paddocks: unlockedPaddockCount(s.jobLevel),
    optimakina: s.useOptimakina ? 'auto' : 'jamais',
    saleTaxPct: Math.round(s.saleTax * 1000) / 10,
  }
}

function settingValueLabel(k: keyof SettingsBacked, v: SettingsBacked[keyof SettingsBacked]): string {
  switch (k) {
    case 'family':
      return FAMILIES[v as FamilyId].label
    case 'tier':
    case 'xpTier':
      return `palier ${v}`
    case 'optimakina':
      return v === 'auto' ? 'auto' : v === 'toujours' ? 'toujours' : 'jamais'
    case 'saleTaxPct':
      return `${formatNumber(v as number, 1)} %`
    default:
      return formatNumber(v as number)
  }
}

// ---------- Utilitaires ----------

function crossingsOf(family: FamilyId): { key: string; a: number; b: number; child: number; gen: number }[] {
  return speciesOfFamily(family, { breedableOnly: true })
    .flatMap((s) => s.crossings.map(([a, b]) => ({ key: `${a}-${b}`, a, b, child: s.id, gen: s.generation })))
    .sort((x, y) => x.gen - y.gen || (getSpecies(x.child)?.name ?? '').localeCompare(getSpecies(y.child)?.name ?? '', 'fr'))
}

function defaultCrossingKey(family: FamilyId, goal: number | null): string {
  const list = crossingsOf(family)
  const g = goal !== null ? list.find((c) => c.child === goal) : undefined
  return (g ?? list[0])?.key ?? ''
}

const speciesName = (id: number) => getSpecies(id)?.name ?? `#${id}`

/**
 * Intervalle affiché : exact, « X à Y », « ≤ Y », « ≥ X » ou « inconnu ». `cost` : montant positif
 * (coût) — une borne basse nulle n'apprend rien (« ≤ Y » ou « à chiffrer »).
 */
function rangeText(r: Range, compact = false, cost = false): string {
  const f = (x: number) => formatKamas(x, compact)
  if (cost && r.low !== null && r.low <= 0 && (r.high === null || r.high > 0.5)) return r.high === null ? 'à chiffrer' : `≤ ${f(r.high)}`
  if (r.low !== null && r.high !== null) return Math.abs(r.high - r.low) < 0.5 ? f(r.low) : `${f(r.low)} à ${f(r.high)}`
  if (r.high !== null) return `≤ ${f(r.high)}`
  if (r.low !== null) return `≥ ${f(r.low)}`
  return 'inconnu'
}

function rangeTone(r: Range): 'pos' | 'neg' | undefined {
  if (r.low !== null && r.low >= 0 && r.high !== null) return 'pos'
  if (r.high !== null && r.high < 0) return 'neg'
  return undefined
}

function RangeMoney({ r, compact }: { r: Range; compact?: boolean }) {
  const tone = rangeTone(r)
  return <span className={tone}>{rangeText(r, compact)}</span>
}

/** Montant d'une ligne : exact, borne basse (« ≥ ») si incomplet, ou « — ». */
function Money({ value, complete = true }: { value: number | null; complete?: boolean }) {
  if (value === null) return <span className="muted">—</span>
  return (
    <span className={value < 0 ? 'neg' : undefined}>
      {!complete ? '≥ ' : ''}
      {formatKamas(value)}
    </span>
  )
}

const sumLines = (ls: { low: number; high: number | null }[]): Range => {
  let low = 0
  let high: number | null = 0
  for (const l of ls) {
    low += l.low
    high = high === null || l.high === null ? null : high + l.high
  }
  return { low, high }
}

const ORIGIN_LABELS: Record<string, { label: string; tone: 'accent' | 'info' | 'ok' | 'warn' | 'danger' }> = {
  joueur: { label: 'votre prix', tone: 'accent' },
  defaut: { label: 'défaut', tone: 'info' },
  craft: { label: 'craft', tone: 'ok' },
  estimation: { label: 'estimation', tone: 'warn' },
  manquant: { label: 'prix à saisir', tone: 'danger' },
}

function OriginBadge({ line }: { line: MaterialLine }) {
  if (line.category === 'parents')
    return (
      <Badge tone={line.complete ? 'info' : 'warn'} title={line.note}>
        {line.complete ? 'valeur actuelle' : 'valeur minimale'}
      </Badge>
    )
  if (!line.complete)
    return (
      <Badge tone="warn" title={line.note}>
        {line.upperBound !== undefined && line.upperBound !== null ? 'prix à saisir (borne haute)' : 'coût incomplet'}
      </Badge>
    )
  if (line.conflict)
    return (
      <Badge tone="warn" title={line.conflict}>
        défaut · à vérifier
      </Badge>
    )
  if (line.craftLocked)
    return (
      <Badge tone="warn" title={line.note}>
        craft · niv. {line.craftLocked} requis
      </Badge>
    )
  const o = ORIGIN_LABELS[line.origin] ?? { label: line.origin, tone: 'info' as const }
  return (
    <Badge tone={line.estimated ? 'warn' : o.tone} title={line.note}>
      {line.estimated && line.origin !== 'estimation' ? `${o.label} · estimation` : o.label}
    </Badge>
  )
}

function linkify(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s),;]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

/** Libellé d'un bénéfice / kamas-h / ROI selon le statut du cycle. */
function ProfitValue({ r, range, percent }: { r: CycleResult; range: Range; percent?: boolean }) {
  if (r.profitStatus === 'inconnu') return <span className="muted">inconnu</span>
  if (percent) {
    const f = (x: number) => formatPercent(x)
    if (range.low !== null && range.high !== null) return <span className={rangeTone(range)}>{Math.abs(range.high - range.low) < 1e-4 ? f(range.low) : `${f(range.low)} à ${f(range.high)}`}</span>
    if (range.high !== null) return <span>≤ {f(range.high)}</span>
    if (range.low !== null) return <span>≥ {f(range.low)}</span>
    return <span className="muted">inconnu</span>
  }
  return <RangeMoney r={range} compact={range.low !== null && range.high !== null && Math.abs(range.high - range.low) >= 0.5} />
}

function unpricedHint(r: CycleResult): string {
  const u = r.unpricedFertility
  return `${formatNumber(u.points)} pts de jauge non chiffrés (${formatPercent(u.share, 0)} : ${u.gauges.map((g) => GAUGE_LABELS[g]).join(', ')})`
}

function unboundedHint(r: CycleResult): string {
  const u = r.unpricedFertility
  return `${formatNumber(u.unboundedPoints)} pts de ${u.unboundedGauges.map((g) => GAUGE_LABELS[g]).join(', ')}`
}

// ---------- Barres empilées ----------

interface Segment {
  key: string
  label: string
  value: number
  color: string
}

function BreakdownBar({ title, total, segments, scaleMax, incomplete }: { title: string; total: Range; segments: Segment[]; scaleMax: number; incomplete: boolean }) {
  const [hover, setHover] = useState<string | null>(null)
  const shown = segments.filter((s) => s.value > 0)
  const known = segments.reduce((s, x) => s + x.value, 0)
  const width = scaleMax > 0 ? Math.max(1, (known / scaleMax) * 100) : 0
  const h = shown.find((s) => s.key === hover)
  return (
    <div className="bar-block">
      <h3>
        <span>{title}</span>
        <span>
          {rangeText(total)} {incomplete && <Badge tone="warn">incomplet</Badge>}
        </span>
      </h3>
      <div className="bar-area">
        {h && (
          <div className="bar-tip" role="status">
            <strong>{formatKamas(h.value)}</strong> · {h.label} ({formatPercent(known > 0 ? h.value / known : 0)})
          </div>
        )}
        <div className="bar-track" style={{ width: `${width}%` }} role="img" aria-label={`${title} : ${shown.map((s) => `${s.label} ${formatKamas(s.value)}`).join(', ')}`}>
          {shown.map((s) => (
            <div
              key={s.key}
              className="bar-seg"
              tabIndex={0}
              style={{ flexGrow: s.value, flexBasis: 0, background: s.color }}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(s.key)}
              onBlur={() => setHover(null)}
            />
          ))}
        </div>
      </div>
      <div className="legend">
        {segments.map((s) => (
          <span key={s.key}>
            <span className="sw" style={{ background: s.color }} />
            {s.label} <b>{formatKamas(s.value, true)}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

const COST_COLORS: Record<CostCategory, string> = {
  fecondite: 'var(--series-1)',
  xp: 'var(--series-2)',
  makina: 'var(--series-3)',
  capture: 'var(--series-4)',
  parents: 'var(--series-8)',
}

// ---------- Onglet 1 : cycle ----------

interface MyBatches {
  profile: BatchProfile | null
  lots: number
  mounts: number
}

function OverridesNotice({ overrides, live, onReset, onResetAll }: { overrides: Partial<SettingsBacked>; live: SettingsBacked; onReset: (k: keyof SettingsBacked) => void; onResetAll: () => void }) {
  const keys = SETTINGS_KEYS.filter((k) => overrides[k] !== undefined)
  if (!keys.length) return <small className="muted">Famille, niveau des parents, palier, enclos, Optimakina et taxe suivent vos <a href={href('reglages')}>Réglages</a>.</small>
  return (
    <div className="overrides" role="status">
      <strong>Différent de vos réglages :</strong>
      <ul>
        {keys.map((k) => (
          <li key={k}>
            {SETTINGS_FIELD_LABELS[k]} : {settingValueLabel(k, overrides[k] as SettingsBacked[typeof k])} <span className="muted">(réglages : {settingValueLabel(k, live[k])})</span>{' '}
            <button className="btn small ghost" onClick={() => onReset(k)}>
              Revenir à mes réglages
            </button>
          </li>
        ))}
      </ul>
      {keys.length > 1 && (
        <button className="btn small" onClick={onResetAll}>
          Tout revenir à mes réglages
        </button>
      )}
    </div>
  )
}

function CycleParamsCard({
  p,
  set,
  rules,
  overrides,
  live,
  onReset,
  onResetAll,
  myBatches,
  canUseMine,
}: {
  p: Params
  set: (patch: Partial<Params>) => void
  rules: Ruleset
  overrides: Partial<SettingsBacked>
  live: SettingsBacked
  onReset: (k: keyof SettingsBacked) => void
  onResetAll: () => void
  myBatches: MyBatches | null
  canUseMine: boolean
}) {
  const list = useMemo(() => crossingsOf(p.family), [p.family])
  const byGen = useMemo(() => {
    const m = new Map<number, typeof list>()
    for (const c of list) m.set(c.gen, [...(m.get(c.gen) ?? []), c])
    return [...m.entries()]
  }, [list])
  const jobLevel = useSettings((s) => s.jobLevel)
  const unlocked = unlockedPaddockCount(jobLevel)
  const netDefault = DEFAULT_MOUNTS_PER_CAST[p.netKind]
  const modelSerenity = batchProfile(p.batchModel === 'ideal' ? 'ideal' : 'typique', p.tier, rules).serenityPoints
  return (
    <Card title="Paramètres du cycle">
      <div className="params">
        <SelectField
          label="Famille"
          value={p.family}
          onChange={(f) => set({ family: f, crossingKey: defaultCrossingKey(f, null), parentA: null, parentB: null })}
          options={FAMILY_IDS.map((f) => ({ value: f, label: FAMILIES[f].label }))}
        />
        <SelectField
          label="Choix des parents"
          value={p.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'croisement', label: 'Par croisement (monture visée)' },
            { value: 'libre', label: 'Deux parents au choix' },
          ]}
        />
        {p.mode === 'croisement' ? (
          <label className="field wide">
            Croisement (bébé visé ← parents)
            <select value={p.crossingKey} onChange={(e) => set({ crossingKey: e.target.value })}>
              {byGen.map(([gen, cs]) => (
                <optgroup key={gen} label={`Génération ${gen}`}>
                  {cs.map((c) => (
                    <option key={c.key} value={c.key}>
                      {speciesName(c.child)} ← {speciesName(c.a)} × {speciesName(c.b)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        ) : (
          <div className="wide grid grid-2">
            <SpeciesPicker label="Parent A" family={p.family} value={p.parentA} onChange={(id) => set({ parentA: id })} />
            <SpeciesPicker label="Parent B" family={p.family} value={p.parentB} onChange={(id) => set({ parentB: id })} />
          </div>
        )}
        <NumberField label="Couples accouplés" value={p.pairs} min={1} max={1000} onChange={(v) => set({ pairs: Math.round(v) })} />
        <NumberField label="Niveau des parents" value={p.parentLevel} min={1} max={200} onChange={(v) => set({ parentLevel: Math.round(v) })} />
        <SelectField
          label="Palier des jauges de fécondité"
          value={p.tier}
          onChange={(tier) => set({ tier })}
          options={TIERS.map((t) => ({ value: t, label: `${t} — ${FUEL_TIER_NAMES[t]} (${rules.gaugeRatePerTick[t]} pts / 10 s)` }))}
        />
        <NumberField label="Montures par enclos" value={p.batchSize} min={1} max={10} onChange={(v) => set({ batchSize: Math.round(v) })} />
        <NumberField label={`Enclos en parallèle (${unlocked} débloqué${unlocked > 1 ? 's' : ''})`} value={p.paddocks} min={1} max={6} onChange={(v) => set({ paddocks: Math.round(v) })} />
        <NumberField label="Taxe d’HDV" value={p.saleTaxPct} min={0} max={20} step={0.5} suffix="%" onChange={(v) => set({ saleTaxPct: v })} />
        <SelectField
          label="Optimakina"
          value={p.optimakina}
          onChange={(optimakina) => set({ optimakina })}
          options={OPTI_MODES.map((m) => ({ value: m, label: m === 'auto' ? 'Auto (même règle que l’Accouplement)' : OPTIMAKINA_MODE_LABELS[m] }))}
        />
        <SelectField
          label="Modèle de lot"
          value={p.batchModel}
          onChange={(batchModel) => set({ batchModel })}
          options={[
            { value: 'typique', label: 'Typique (planificateur d’enclos)' },
            { value: 'ideal', label: 'Idéal (minimum théorique)' },
            { value: 'mes-lots', label: canUseMine ? 'Mes lots (montures fertiles)' : 'Mes lots (aucune monture à féconder)' },
          ]}
        />
        <SelectField
          label="Parents engagés"
          value={p.parentValue}
          onChange={(parentValue) => set({ parentValue })}
          options={[
            { value: 'opportunite', label: 'Comptés (capture ou valeur actuelle)' },
            { value: 'hors', label: 'Hors valeur des parents' },
          ]}
        />
        <SelectField
          label="Parents stériles après l’accouplement"
          value={p.sterileFate}
          onChange={(sterileFate) => set({ sterileFate })}
          options={[
            { value: 'meilleur', label: 'Le meilleur (vente, extraction, brisage ou clonage)' },
            { value: 'cloner', label: 'Garder pour cloner' },
          ]}
        />
        <label className="check">
          <input type="checkbox" checked={p.includeCapture} disabled={p.parentValue === 'hors'} onChange={(e) => set({ includeCapture: e.target.checked })} />
          Parents G1 capturés (prix du filet)
        </label>
      </div>
      {p.paddocks > unlocked && (
        <Callout tone="warn">
          Vous n’avez que {unlocked} enclos débloqué{unlocked > 1 ? 's' : ''} (Éleveur niveau {jobLevel}) : la durée et les kamas/heure supposent {p.paddocks} enclos.{' '}
          {overrides.paddocks !== undefined && (
            <button className="btn small" onClick={() => onReset('paddocks')}>
              Revenir à {live.paddocks} enclos
            </button>
          )}
        </Callout>
      )}
      {p.batchModel === 'mes-lots' && myBatches && (
        <small className="muted">
          {myBatches.profile
            ? `Mes lots : ${myBatches.lots} lot${myBatches.lots > 1 ? 's' : ''} planifié${myBatches.lots > 1 ? 's' : ''} (${myBatches.mounts} montures), moyenne utilisée pour la consommation et la durée.`
            : 'Mes lots : aucun lot planifiable avec vos montures fertiles — le lot typique est utilisé.'}
        </small>
      )}
      <OverridesNotice overrides={overrides} live={live} onReset={onReset} onResetAll={onResetAll} />
      <details className="advanced">
        <summary>Réglages avancés : capture, XP, sérénité, Takeza</summary>
        <div className="params">
          <SelectField label="Filet" value={p.netKind} onChange={(netKind) => set({ netKind, mountsPerCast: DEFAULT_MOUNTS_PER_CAST[netKind].value })} options={(Object.keys(NET_KIND_LABELS) as NetKind[]).map((k) => ({ value: k, label: NET_KIND_LABELS[k] }))} />
          <NumberField label={`Montures par lancer (défaut ${netDefault.value})`} value={p.mountsPerCast} min={1} max={20} onChange={(v) => set({ mountsPerCast: Math.round(v) })} />
          <NumberField label="Niveau de départ des parents" value={p.parentStartLevel} min={1} max={200} onChange={(v) => set({ parentStartLevel: Math.round(v) })} />
          <SelectField label="Palier de la Mangeoire" value={p.xpTier} onChange={(xpTier) => set({ xpTier })} options={TIERS.map((t) => ({ value: t, label: `${t} — ${FUEL_TIER_NAMES[t]}` }))} />
          <NumberField label="Points de sérénité par lot" value={p.serenity ?? Math.round(modelSerenity)} min={0} max={20_000} step={100} onChange={(v) => set({ serenity: Math.round(v) })} />
          <label className="check">
            <input type="checkbox" checked={p.sage} onChange={(e) => set({ sage: e.target.checked })} />
            Parents Sage (XP ×2)
          </label>
          <label className="check">
            <input type="checkbox" checked={p.takeza} onChange={(e) => set({ takeza: e.target.checked })} />
            Jour Takeza (+20 % de génération cible)
          </label>
          {p.serenity !== null && (
            <button className="btn small ghost" onClick={() => set({ serenity: null })}>
              Sérénité du modèle de lot
            </button>
          )}
        </div>
        <small className="muted">
          Sérénité : {p.serenity === null ? `${formatNumber(modelSerenity)} points par lot, ceux du modèle de lot (moyenne du planificateur, ESTIMATION : sérénité de départ inconnue)` : `${formatNumber(p.serenity)} points par lot (votre valeur)`}. Montures par lancer : {netDefault.note}
        </small>
      </details>
    </Card>
  )
}

function MissingPricesCallout({ r }: { r: CycleResult }) {
  const toPrice = new Map<string, { name: string }>()
  for (const l of r.materials)
    if (!l.complete && l.category !== 'parents') {
      const name = l.toPrice?.name ?? l.itemName
      toPrice.set(name, { name })
    }
  for (const l of r.initial.lines)
    if (!l.complete) for (const it of l.items) if (!it.complete) toPrice.set(it.name, { name: it.name })
  const species = [...new Set([...r.missingSpecies, ...r.revenue.filter((l) => !l.complete && l.speciesId !== undefined).map((l) => l.speciesId as number), ...r.materials.filter((l) => l.category === 'parents' && !l.complete).map((l) => l.speciesId as number)])].map(speciesName)
  if (!toPrice.size && !species.length && r.complete) return null
  return (
    <Callout tone="warn">
      <strong>Résultat incomplet</strong> : des prix manquent ; les totaux ne comptent que les montants connus (jamais 0 pour un prix inconnu) et le bénéfice est donné en fourchette.
      {toPrice.size > 0 && (
        <div style={{ marginTop: 6 }}>
          À chiffrer sur la page Prix (le carburant, ou ses ingrédients) :{' '}
          {[...toPrice.values()].map((t, i) => (
            <span key={t.name}>
              {i > 0 && ', '}
              <a href={href('prix', { q: t.name })}>{t.name}</a>
            </span>
          ))}
          .
        </div>
      )}
      {species.length > 0 && (
        <div style={{ marginTop: 6 }}>
          Montures sans prix de vente fiable (planchers et relevés anciens non comptés) : {species.join(', ')} — <a href={href('prix', { onglet: 'montures' })}>saisir les prix des montures</a>.
        </div>
      )}
    </Callout>
  )
}

function MaterialsTable({ r }: { r: CycleResult }) {
  const cats: CostCategory[] = ['fecondite', 'xp', 'makina', 'capture', 'parents']
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Poste</th>
            <th>Objet à acheter ou fabriquer</th>
            <th className="num">Quantité</th>
            <th className="num">Prix unitaire</th>
            <th className="num">Sous-total</th>
            <th>Prix</th>
          </tr>
        </thead>
        <tbody>
          {cats.map((cat) => {
            const lines = r.materials.filter((l) => l.category === cat)
            if (!lines.length) return null
            const tot = r.costByCategory[cat]
            return [
              <tr key={`${cat}-h`} className="group-row">
                <td colSpan={4}>{COST_CATEGORY_LABELS[cat]}</td>
                <td className="num">{rangeText({ low: tot.value, high: tot.complete ? tot.value : tot.high }, false, true)}</td>
                <td>{!tot.complete && <Badge tone="warn">incomplet</Badge>}</td>
              </tr>,
              ...lines.map((l) => (
                <tr key={l.key}>
                  <td>
                    {l.gauge ? GAUGE_LABELS[l.gauge] : l.category === 'parents' && l.speciesId !== undefined ? <SpeciesName id={l.speciesId} /> : l.label}
                    {l.tier !== undefined && <small className="muted">palier {l.tier}</small>}
                  </td>
                  <td>
                    {l.itemName}
                    <small className="muted">
                      {l.gauge ? `${formatNumber(l.points ?? 0)} points de jauge` : l.label}
                      {l.note ? ` — ${l.note}` : ''}
                    </small>
                    {(!l.complete || l.craftLocked) && l.category !== 'parents' && (
                      <small>
                        <a href={href('prix', { q: l.toPrice?.name ?? l.itemName })}>Saisir le prix{l.toPrice ? ` : ${l.toPrice.name}` : ''}</a>
                        {l.missing.length > 0 && <span className="muted"> · ingrédients sans prix : {l.missing.slice(0, 4).map(itemName).join(', ')}{l.missing.length > 4 ? '…' : ''}</span>}
                      </small>
                    )}
                    {l.category === 'parents' && !l.complete && (
                      <small>
                        <a href={href('prix', { onglet: 'montures', q: speciesName(l.speciesId ?? 0) })}>Saisir le prix de vente</a>
                      </small>
                    )}
                  </td>
                  <td className="num">{l.unit === 'point' ? `${formatNumber(l.qty)} pts` : formatNumber(l.qty)}</td>
                  <td className="num">
                    {l.unitPrice === null || (!l.complete && l.unitPrice <= 0) ? '—' : `${!l.complete && l.subtotal !== null ? '≥ ' : ''}${l.unit === 'point' ? `${formatNumber(l.unitPrice, 2)} K/pt` : formatKamas(l.unitPrice)}`}
                  </td>
                  <td className="num">
                    {l.subtotal === null ? (
                      l.upperBound ? (
                        <span className="muted" title="Avec un carburant de palier supérieur : borne haute, non comptée">
                          ≤ {formatKamas(l.upperBound)}
                        </span>
                      ) : (
                        '—'
                      )
                    ) : (
                      <Money value={l.subtotal} complete={l.complete} />
                    )}
                  </td>
                  <td>
                    <OriginBadge line={l} />
                  </td>
                </tr>
              )),
            ]
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>Total des coûts (parents engagés compris)</td>
            <td className="num">{rangeText(r.ranges.cost)}</td>
            <td>{!r.costComplete && <Badge tone="warn">incomplet</Badge>}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function SocleTable({ r }: { r: CycleResult }) {
  const inv = r.initial
  if (!inv.lines.length) return <p className="muted">Aucun socle : toutes les jauges tournent au palier 1 (rien à déposer d’avance).</p>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Jauge</th>
            <th className="num">Socle par enclos</th>
            <th>Carburants (tous enclos)</th>
            <th className="num">Coût</th>
            <th>Prix</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.gauge}>
              <td>
                {GAUGE_LABELS[l.gauge]} <small className="muted">palier {l.tier}</small>
              </td>
              <td className="num">
                {formatNumber(l.pointsPerPaddock)} pts × {l.paddocks}
              </td>
              <td>
                {l.items.map((it) => (
                  <small key={it.fuelId}>
                    {it.complete ? (
                      `${it.name} × ${formatNumber(it.count)}`
                    ) : (
                      <a href={href('prix', { q: it.name })}>
                        {it.name} × {formatNumber(it.count)} (prix à saisir)
                      </a>
                    )}
                  </small>
                ))}
              </td>
              <td className="num">{rangeText({ low: l.cost ?? 0, high: l.complete ? l.cost : l.upperBound }, false, true)}</td>
              <td>{l.complete ? <Badge tone="ok">chiffré</Badge> : <Badge tone="warn">incomplet</Badge>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Investissement initial (une fois)</td>
            <td className="num">{rangeText({ low: inv.low, high: inv.high }, false, true)}</td>
            <td>{!inv.complete && <Badge tone="warn">incomplet</Badge>}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function RevenueTable({ r, taxPct }: { r: CycleResult; taxPct: number }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Revenu</th>
            <th className="num">Probabilité</th>
            <th className="num">Quantité attendue</th>
            <th>Devenir</th>
            <th className="num">Valeur unitaire nette</th>
            <th className="num">Sous-total</th>
          </tr>
        </thead>
        <tbody>
          {r.revenue.map((l) => (
            <tr key={l.key}>
              <td>
                {l.kind === 'genetons' ? (
                  'Génétons'
                ) : l.speciesId !== undefined ? (
                  <>
                    <SpeciesName id={l.speciesId} />
                    <small className="muted">{l.kind === 'bebe' ? `Bébé niv. 1${l.target ? ' · génération cible' : ''}` : l.label}</small>
                  </>
                ) : (
                  l.label
                )}
                {l.note && (l.kind === 'genetons' || l.fate === 'clone') && <small className="muted">{l.note}</small>}
              </td>
              <td className="num">{l.probability !== undefined ? formatPercent(l.probability, 2) : '—'}</td>
              <td className="num">{formatNumber(l.qty, 2)}</td>
              <td>
                {l.fate === 'clone' ? (
                  <Badge tone="info">clonage</Badge>
                ) : l.kind === 'genetons' ? (
                  <Badge tone="gold">boutique</Badge>
                ) : l.fate && (l.complete || (l.unitValue ?? 0) > 0) ? (
                  <Badge>{FATE_LABELS[l.fate]}</Badge>
                ) : (
                  <Badge tone="danger">prix à saisir</Badge>
                )}
                {l.confidence && <ConfidenceBadge level={l.confidence === 'joueur' ? 'high' : l.confidence} />}
                {l.estimated && <Badge tone="warn">estimation</Badge>}
              </td>
              <td className="num">
                {l.unitValue === null ? <Badge tone="danger">à saisir</Badge> : `${l.complete ? '' : '≥ '}${formatKamas(l.unitValue)}`}
                {!l.complete && l.reference && (
                  <small className="muted" title={l.reference.reason}>
                    vente : à saisir (référence ≈ {formatKamas(l.reference.net)}, non comptée)
                  </small>
                )}
              </td>
              <td className="num">
                <Money value={l.subtotal} complete={l.complete} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Revenu attendu (net de la taxe de {formatNumber(taxPct, 1)} %)</td>
            <td className="num">{rangeText(r.ranges.revenue)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function Variants({ base, run, result }: { base: CycleConfig; run: (c: CycleConfig) => CycleResult | null; result: CycleResult }) {
  const mode = typeof base.optimakina === 'string' ? base.optimakina : base.optimakina ? 'auto' : 'jamais'
  const variants: { label: string; cfg: CycleConfig }[] = [
    { label: 'Configuration actuelle', cfg: base },
    ...OPTI_MODES.filter((m) => m !== mode).map((m) => ({ label: `Optimakina : ${m === 'auto' ? 'auto' : m}`, cfg: { ...base, optimakina: m } })),
    ...TIERS.filter((t) => t !== base.tier).map((t) => ({ label: `Palier ${t} (${FUEL_TIER_NAMES[t]})`, cfg: { ...base, tier: t, xpTier: t, batchProfile: undefined } })),
    ...(base.batchProfile || base.batchModel !== 'ideal' ? [{ label: 'Lot idéal (minimum théorique)', cfg: { ...base, batchModel: 'ideal' as const, batchProfile: undefined } }] : []),
    ...(base.batchModel === 'ideal' && !base.batchProfile ? [{ label: 'Lot typique (planificateur)', cfg: { ...base, batchModel: 'typique' as const } }] : []),
  ]
  const rows = variants.map((v, i) => ({ ...v, r: i === 0 ? result : run(v.cfg) }))
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Variante</th>
              <th className="num">Coûts</th>
              <th className="num">Bénéfice</th>
              <th className="num">Durée</th>
              <th className="num">Kamas / h</th>
              <th>Prix</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, r }, i) => {
              const comparable = !r || i === 0 || cyclesComparable(result, r)
              return (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="num">{r ? rangeText(r.ranges.cost, true) : '—'}</td>
                  <td className="num">{r ? <ProfitValue r={r} range={r.ranges.profit} /> : '—'}</td>
                  <td className="num">{r ? formatDuration(r.seconds.total) : '—'}</td>
                  <td className="num">{r ? <ProfitValue r={r} range={r.ranges.kamasPerHour} /> : '—'}</td>
                  <td>
                    {r && (r.complete ? <Badge tone="ok">complet</Badge> : <Badge tone="warn">incomplet</Badge>)}
                    {!comparable && (
                      <Badge tone="danger" title="Cette variante ne chiffre pas les mêmes postes que la configuration actuelle : l’écart vient surtout des prix manquants.">
                        non comparable
                      </Badge>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <small className="muted">« Non comparable » : les deux calculs n’ont pas les mêmes prix manquants (ex. une jauge chiffrée à un palier et pas à l’autre) — complétez les prix avant de choisir.</small>
    </>
  )
}

function CycleTab(props: {
  p: Params
  set: (patch: Partial<Params>) => void
  cfg: CycleConfig | null
  result: CycleResult | null
  error: string | null
  run: (c: CycleConfig) => CycleResult | null
  overrides: Partial<SettingsBacked>
  live: SettingsBacked
  onReset: (k: keyof SettingsBacked) => void
  onResetAll: () => void
  myBatches: MyBatches | null
  canUseMine: boolean
}) {
  const rules = useRules()
  const { p, cfg, result, error } = props
  return (
    <div className="stack" style={{ gap: 16 }}>
      <CycleParamsCard p={p} set={props.set} rules={rules} overrides={props.overrides} live={props.live} onReset={props.onReset} onResetAll={props.onResetAll} myBatches={props.myBatches} canUseMine={props.canUseMine} />
      {error && <Callout tone="danger">{error}</Callout>}
      {!result || !cfg ? !error && <Empty>Choisissez un croisement ou deux parents de la même famille.</Empty> : <CycleResultView r={result} cfg={cfg} p={p} run={props.run} />}
    </div>
  )
}

function CycleResultView({ r, cfg, p, run }: { r: CycleResult; cfg: CycleConfig; p: Params; run: (c: CycleConfig) => CycleResult | null }) {
  const hours = r.seconds.total / 3600
  const sumRev = (k: string) => r.revenue.filter((l) => l.kind === k).reduce((s, l) => s + (l.subtotal ?? 0), 0)
  const revSegments: Segment[] = [
    { key: 'bebe', label: 'Bébés', value: sumRev('bebe'), color: 'var(--series-5)' },
    { key: 'sterile', label: 'Stériles', value: sumRev('sterile'), color: 'var(--series-6)' },
    { key: 'genetons', label: 'Génétons', value: sumRev('genetons'), color: 'var(--series-7)' },
  ]
  const costSegments: Segment[] = (Object.keys(COST_CATEGORY_LABELS) as CostCategory[]).map((c) => ({ key: c, label: COST_CATEGORY_LABELS[c], value: r.costByCategory[c].value, color: COST_COLORS[c] }))
  const scaleMax = Math.max(r.totalCost, r.totalRevenue)
  const cash = sumLines(r.materials.filter((l) => CASH_CATEGORIES.includes(l.category)))
  const parents = r.materials.filter((l) => l.category === 'parents')
  const b = r.breed
  const inconnu = r.profitStatus === 'inconnu'
  const profitHint = inconnu
    ? `${r.unpricedFertility.unboundedPoints > 0 ? unpricedHint(r) : 'prix manquants des deux côtés'}${r.ranges.profit.high !== null ? ` — au plus ${formatKamas(r.ranges.profit.high, true)}` : ''}`
    : r.profitStatus === 'exact'
      ? `${formatKamas(r.profitPerPair, true)} par couple${r.estimated ? ' (estimation)' : ''}`
      : r.profitStatus === 'intervalle'
        ? 'fourchette : des prix manquent'
        : r.profitStatus === 'borne-haute'
          ? 'au plus : des coûts manquent'
          : 'au moins : des revenus manquent'
  return (
    <>
      <Card
        title={
          <h2>
            {speciesName(cfg.parentA)} × {speciesName(cfg.parentB)} — {p.pairs} couple{p.pairs > 1 ? 's' : ''}
          </h2>
        }
        actions={r.complete ? <Badge tone={r.estimated ? 'warn' : 'ok'}>{r.estimated ? 'chiffré, avec estimations' : 'tous les prix sont connus'}</Badge> : <Badge tone="warn">prix incomplets</Badge>}
      >
        <div className="kpis">
          <Stat label="Dépenses (matériel)" value={rangeText(cash)} hint={`${formatKamas((cash.low ?? 0) / p.pairs, true)} par couple${cash.high === cash.low ? '' : ' au moins'} ; socle à part`} />
          {parents.length > 0 && (
            <Stat
              label="Parents engagés"
              value={rangeText({ low: r.costByCategory.parents.value, high: r.costByCategory.parents.complete ? r.costByCategory.parents.value : r.costByCategory.parents.high })}
              hint="valeur actuelle (coût d’opportunité), récupérée en partie par les stériles"
            />
          )}
          <Stat label="Revenu attendu" value={rangeText(r.ranges.revenue)} hint="bébés, stériles, génétons (nets de taxe)" />
          <Stat label="Bénéfice attendu" tone={inconnu ? undefined : rangeTone(r.ranges.profit)} value={<ProfitValue r={r} range={r.ranges.profit} />} hint={profitHint} />
          <Stat label="Kamas par heure" tone={inconnu ? undefined : rangeTone(r.ranges.kamasPerHour)} value={<ProfitValue r={r} range={r.ranges.kamasPerHour} />} hint={`sur ${formatNumber(hours, 1)} h d’enclos`} />
          <Stat label="Retour sur investissement" value={<ProfitValue r={r} range={r.ranges.roi} percent />} hint={`bénéfice / coûts (parents compris), socle non compté${r.complete ? '' : ' ; prix incomplets'}`} />
          <Stat label="Durée totale" value={formatDuration(r.seconds.total)} hint={`${r.rounds} tour${r.rounds > 1 ? 's' : ''} de ${formatDuration(r.seconds.perRound)} (${r.batch.label.toLowerCase()})`} />
          <Stat label={`Bébés G${b.targetGeneration} attendus`} value={formatNumber(r.expectedTargetBabies, 1)} hint={`chance cible ${formatPercent(b.targetChance)} par accouplement`} />
          <Stat label="Coût brut par bébé cible" value={r.costPerTargetBaby === null ? '—' : <Money value={r.costPerTargetBaby} complete={r.costComplete} />} hint="dépenses ÷ bébés cibles" />
          <Stat
            label="Coût net par bébé cible"
            value={r.netCostPerTargetBaby === null ? '—' : r.netCostComplete ? formatKamas(r.netCostPerTargetBaby) : 'inconnu'}
            hint={
              r.netCostComplete || r.netCostPerTargetBaby === null
                ? '(coûts − bébés ratés − stériles) ÷ bébés cibles'
                : `prix incomplets (coûts et valeurs résiduelles sont des minimums : ni borne haute ni borne basse) ; partie connue ${formatKamas(r.netCostPerTargetBaby)}`
            }
          />
          <Stat
            label="Investissement initial (socle)"
            value={r.initial.lines.length ? rangeText({ low: r.initial.low, high: r.initial.high }, false, true) : '0 K'}
            hint={r.initial.lines.length ? `reste dans les jauges ; trésorerie du 1er cycle : ${rangeText(r.firstCycleCash, true)}` : 'aucun : jauges au palier 1'}
          />
        </div>
        <Callout tone={r.optimakina.use ? 'ok' : undefined}>
          {r.optimakina.reason} <small className="muted">(mode {r.optimakina.mode === 'auto' ? 'auto, même règle que l’Accouplement' : r.optimakina.mode})</small>
        </Callout>
        {inconnu && r.unpricedFertility.unboundedPoints > 0 && (
          <Callout tone="warn">
            <strong>Bénéfice inconnu</strong> : {unboundedHint(r)} n’ont aucun prix, même approché ({unpricedHint(r)} au total). Saisissez au moins un carburant de chaque jauge au palier entretenu sur la page{' '}
            <a href={href('prix', { onglet: 'carburants' })}>Prix</a> ; la partie connue n’est pas un bénéfice.
          </Callout>
        )}
        <MissingPricesCallout r={r} />
        {r.estimates.length > 0 && (
          <Callout>
            <Badge tone="warn">estimations</Badge> Ce calcul repose sur : {r.estimates.join(' ; ')}.
          </Callout>
        )}
        {r.warnings
          .filter((w) => !w.startsWith('Coût incomplet') && !w.startsWith('Revenu incomplet'))
          .map((w) => (
            <Callout key={w} tone="warn">
              {w}
            </Callout>
          ))}
      </Card>

      <Card title="Coûts et revenus (montants connus)">
        <div className="breakdown">
          <BreakdownBar title="Coûts" total={r.ranges.cost} segments={costSegments} scaleMax={scaleMax} incomplete={!r.costComplete} />
          <BreakdownBar title="Revenus attendus" total={r.ranges.revenue} segments={revSegments} scaleMax={scaleMax} incomplete={!r.revenueComplete} />
        </div>
        <small className="muted">Les deux barres partagent la même échelle et ne montrent que les montants connus. Détail dans les tableaux ci-dessous.</small>
      </Card>

      <Card title="Matériel à prévoir (chaque cycle)">
        <p className="muted">
          Carburant le moins cher au point pour chaque jauge, au palier qu’elle entretient (sérénité au palier 1, comme la page Enclos), quantités arrondies à l’objet entier. {r.batches} lot{r.batches > 1 ? 's' : ''} de{' '}
          {cfg.batchSize} : la consommation d’une jauge ne dépend pas du nombre de montures, remplissez les enclos.
        </p>
        <MaterialsTable r={r} />
      </Card>

      <Card title="Investissement initial — socle (reste dans la jauge)">
        <p className="muted">
          Au palier {cfg.tier}, une jauge sous le bas de son palier tourne au palier inférieur : déposez d’abord ce socle dans chaque enclos utilisé ({r.paddocksUsed}). Ces points ne sont pas consommés par le cycle (même calcul
          que la page Enclos) : comptez-les dans la trésorerie du premier cycle, pas dans le bénéfice récurrent.
        </p>
        <SocleTable r={r} />
      </Card>

      <Card title="Revenus attendus">
        <p className="muted">
          Génération cible G{b.targetGeneration} à {formatPercent(b.targetChance)}
          {b.recordPossible ? `, génétons si G${b.targetGeneration} (record) : ${b.genetonsIfRecord} par naissance` : ', aucun généton possible (l’arbre contient déjà cette génération)'}. Valeurs nettes de la taxe de{' '}
          {formatNumber(p.saleTaxPct, 1)} %. Un prix de vente ne vient que de vos prix ou d’un relevé fiable : planchers de la recherche et relevés anciens sont affichés pour information, jamais comptés.
        </p>
        <RevenueTable r={r} taxPct={p.saleTaxPct} />
      </Card>

      <div className="grid grid-2">
        <Card title="Durée">
          <table className="table">
            <tbody>
              <tr>
                <td>
                  Fécondité d’un lot (palier {cfg.tier}) <small className="muted">{r.batch.label}</small>
                </td>
                <td className="num">{formatDuration(r.seconds.fertility)}</td>
              </tr>
              {r.batch.model !== 'ideal' && (
                <tr>
                  <td>
                    <span className="muted">Lot idéal (minimum théorique)</span>
                  </td>
                  <td className="num muted">{formatDuration(r.seconds.idealFertility)}</td>
                </tr>
              )}
              <tr>
                <td>XP restante après la phase d’amour (Mangeoire palier {cfg.xpTier ?? cfg.tier})</td>
                <td className="num">{formatDuration(r.seconds.leveling)}</td>
              </tr>
              <tr>
                <td>Par tour ({r.paddocksUsed} enclos en parallèle)</td>
                <td className="num">{formatDuration(r.seconds.perRound)}</td>
              </tr>
              <tr>
                <td>
                  <strong>Total ({r.rounds} tour{r.rounds > 1 ? 's' : ''})</strong>
                </td>
                <td className="num">
                  <strong>{formatDuration(r.seconds.total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <small className="muted">{r.batch.note} Captures, déplacements et ventes non comptés. Un palier plus haut va plus vite mais coûte plus cher au point.</small>
        </Card>
        <Card title="Variantes">
          <Variants base={cfg} run={run} result={r} />
        </Card>
      </div>

      <Card title="Hypothèses de ce calcul">
        <ul className="plain">
          {r.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </Card>
    </>
  )
}

// ---------- Onglet 2 : classement ----------

type SortKey = 'margin' | 'chance' | 'babies' | 'genetons' | 'gen' | 'cost' | 'parents'

function RankingTab({
  p,
  onSimulate,
  onToggleSteriles,
  ctx,
  mctx,
  rules,
  jobLevel,
  genetonValue,
  goalPath,
  profile,
}: {
  p: Params
  onSimulate: (key: string) => void
  onToggleSteriles: (v: boolean) => void
  ctx: PriceContext
  mctx: MountPriceContext
  rules: Ruleset
  jobLevel: number
  genetonValue: number
  goalPath: number[]
  profile: BatchProfile | null
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'margin', dir: -1 })
  const [genFilter, setGenFilter] = useState<number | 'toutes'>('toutes')
  const [onlyComplete, setOnlyComplete] = useState(false)
  const rows = useMemo(
    () =>
      crossingRanking(p.family, {
        tier: p.tier,
        xpTier: p.xpTier,
        batchSize: p.batchSize,
        parentLevel: p.parentLevel,
        parentStartLevel: p.parentStartLevel,
        optimakina: p.optimakina,
        takeza: p.takeza,
        saleTax: p.saleTaxPct / 100,
        serenityPointsPerMount: p.serenity ?? undefined,
        includeSteriles: p.includeSteriles,
        batchModel: p.batchModel === 'mes-lots' ? 'typique' : p.batchModel,
        batchProfile: profile ?? undefined,
        goalPath,
        ctx,
        mountPrices: mctx,
        rules,
        jobLevel,
        genetonValue,
      }),
    [p, ctx, mctx, rules, jobLevel, genetonValue, goalPath, profile],
  )
  const value = (r: CrossingRank): number => {
    switch (sort.key) {
      case 'chance':
        return r.targetChance
      case 'babies':
        return r.expectedBabyValue
      case 'genetons':
        return r.genetonsValue
      case 'gen':
        return r.targetGeneration
      case 'parents':
        return r.parentDelta
      case 'cost':
        return (r.fertilityCost ?? 0) + (r.levelingCost ?? 0) + (r.makinaCost ?? 0)
      default:
        return r.margin
    }
  }
  const gens = [...new Set(rows.map((r) => r.targetGeneration))].sort((a, b) => a - b)
  const shown = rows.filter((r) => (genFilter === 'toutes' || r.targetGeneration === genFilter) && (!onlyComplete || r.complete)).sort((a, b) => sort.dir * (value(a) - value(b)) || b.margin - a.margin)
  const completeCount = rows.filter((r) => r.complete).length
  const unbounded = rows.filter((r) => r.marginRange.low === null).length
  const sortHeader = (k: SortKey, label: string) => (
    <th key={k} className="num" aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort((st) => ({ key: k, dir: st.key === k ? ((-st.dir) as 1 | -1) : -1 }))}>
        {label}
        {sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card title={`Croisements ${FAMILIES[p.family].plural} : marge attendue par accouplement`}>
        <p className="muted">
          Marge = valeur attendue des bébés + génétons (nets){p.includeSteriles ? ' + valeur ajoutée aux parents (stériles − valeur des parents avant l’accouplement)' : ''} − fécondité des 2 parents − XP jusqu’au niveau{' '}
          {p.parentLevel} − Optimakina ({p.optimakina === 'auto' ? 'règle de l’Accouplement' : p.optimakina}). Parents supposés à arbre « propre », palier {p.tier}, lots de {p.batchSize} ({p.batchModel === 'ideal' ? 'idéal' : profile ? 'vos lots' : 'typiques'}), taxe{' '}
          {formatNumber(p.saleTaxPct, 1)} %, socle non compté. Ces paramètres viennent de l’onglet « Cycle de production ».
        </p>
        <div className="filters">
          <label className="field">
            Génération cible
            <select value={String(genFilter)} onChange={(e) => setGenFilter(e.target.value === 'toutes' ? 'toutes' : Number(e.target.value))}>
              <option value="toutes">Toutes</option>
              {gens.map((g) => (
                <option key={g} value={g}>
                  G{g}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={onlyComplete} onChange={(e) => setOnlyComplete(e.target.checked)} />
            Seulement les calculs complets ({completeCount}/{rows.length})
          </label>
          <label className="check">
            <input type="checkbox" checked={p.includeSteriles} onChange={(e) => onToggleSteriles(e.target.checked)} />
            Compter la valeur ajoutée aux parents (stériles − valeur de départ)
          </label>
        </div>
        {completeCount < rows.length && (
          <Callout tone="warn">
            {rows.length - completeCount} croisement{rows.length - completeCount > 1 ? 's ont' : ' a'} des prix manquants (carburants de fécondité, makinas ou montures) : leur marge est une fourchette, une borne (« ≤ » = au plus,
            des coûts manquent) ou « inconnue »{unbounded > 0 ? ` (${unbounded} sans borne basse)` : ''} ; le tri utilise alors la partie connue. <a href={href('prix', { onglet: 'carburants' })}>Compléter les prix</a>.
          </Callout>
        )}
        {shown.length === 0 ? (
          <Empty>Aucun croisement ne correspond à ces filtres.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table sortable">
              <thead>
                <tr>
                  <th>Croisement</th>
                  {sortHeader('gen', 'Cible')}
                  {sortHeader('chance', 'Chance')}
                  {sortHeader('babies', 'Bébés')}
                  {sortHeader('genetons', 'Génétons')}
                  {sortHeader('parents', 'Parents (±)')}
                  {sortHeader('cost', 'Coûts')}
                  {sortHeader('margin', 'Marge')}
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const costs = (r.fertilityCost ?? 0) + (r.levelingCost ?? 0) + (r.makinaCost ?? 0)
                  const tone = rangeTone(r.marginRange)
                  return (
                    <tr key={r.key}>
                      <td>
                        <SpeciesName id={r.child} />
                        <small className="muted">
                          {speciesName(r.parentA)} × {speciesName(r.parentB)}
                          {r.usesOptimakina ? ' · Optimakina' : ''}
                        </small>
                      </td>
                      <td className="num">G{r.targetGeneration}</td>
                      <td className="num">{formatPercent(r.targetChance)}</td>
                      <td className="num">
                        <Money value={r.expectedBabyValue} complete={r.babyComplete} />
                      </td>
                      <td className="num" title={`${formatNumber(r.expectedGenetons, 2)} génétons attendus`}>
                        {formatKamas(r.genetonsValue)}
                      </td>
                      <td className="num" title={`Stériles ${formatKamas(r.sterileValue)} − parents ${formatKamas(r.parentStartValue)}`}>
                        {p.includeSteriles ? `${r.parentComplete ? '' : '≈ '}${formatKamas(r.parentDelta)}` : <span className="muted">—</span>}
                      </td>
                      <td className="num" title={`Fécondité ${formatKamas(r.fertilityCost)} · XP ${formatKamas(r.levelingCost)} · ${r.optimakina.reason}`}>
                        <Money value={costs} complete={r.costComplete} />
                      </td>
                      <td className="num">
                        {r.marginRange.low === null && r.marginRange.high === null ? (
                          <>
                            <strong className="muted">inconnue</strong>
                            <small className="muted" title="Montants connus seulement (bébés et génétons connus − coûts connus) : ni un minimum ni un maximum, sert seulement à trier.">
                              partie connue {formatKamas(r.margin, true)}
                            </small>
                          </>
                        ) : (
                          <strong className={tone}>{rangeText(r.marginRange, true)}</strong>
                        )}
                        {!r.complete && (
                          <small>
                            <Badge tone="warn">incomplet</Badge>
                          </small>
                        )}
                      </td>
                      <td>
                        <button className="btn small" onClick={() => onSimulate(r.key)}>
                          Simuler
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------- Onglet 3 : inventaire ----------

function mountState(m: Mount): { state: MountState; senile: boolean } {
  const f = effectiveFertility(m)
  if (f === 'senile') return { state: 'sterile', senile: true }
  return { state: f === 'sterile' ? 'sterile' : f === 'feconde' ? 'feconde' : 'fertile', senile: false }
}

function InventoryTab({ ctx, mctx, saleTax }: { ctx: PriceContext; mctx: MountPriceContext; saleTax: number }) {
  const mounts = useInventory((s) => s.mounts)
  const [family, setFamily] = useState<FamilyId | 'toutes'>('toutes')
  const [onlySterile, setOnlySterile] = useState(false)
  const rows = useMemo(
    () =>
      mounts
        .filter((m) => getSpecies(m.speciesId))
        .map((m) => {
          const st = mountState(m)
          return { m, st, v: mountValuation(m.speciesId, m.level, { ctx, mountPrices: mctx, saleTax, state: st.state, senile: st.senile }) }
        })
        .sort((a, b) => (b.v.best ?? -1) - (a.v.best ?? -1)),
    [mounts, ctx, mctx, saleTax],
  )
  if (!mounts.length)
    return (
      <Card>
        <Empty>
          Aucune monture enregistrée. Ajoutez vos montures dans <a href={href('montures')}>Mes montures</a> pour estimer leur valeur.
        </Empty>
      </Card>
    )
  const shown = rows.filter((r) => (family === 'toutes' || getSpecies(r.m.speciesId)?.family === family) && (!onlySterile || r.st.state === 'sterile'))
  const total = shown.reduce((s, r) => s + (r.v.best ?? 0), 0)
  const incomplete = shown.filter((r) => !r.v.complete).length
  const byKind = (k: FateKind) => shown.filter((r) => r.v.bestKind === k)
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card title="Valeur de réalisation de vos montures">
        <p className="muted">
          Pour chaque monture : le meilleur entre la vente, l’extraction et le brisage, net de la taxe d’HDV ({formatNumber(saleTax * 100, 1)} %). Une vente sans prix fiable (plancher de la recherche, relevé ancien) n’est pas
          comptée : la valeur est alors un <strong>minimum</strong>. Une monture féconde utile à votre plan vaut davantage (voir <a href={href('montures')}>Mes montures</a> pour le sort conseillé). {BRISAGE_RISK_NOTE}
        </p>
        <div className="kpis">
          <Stat label="Valeur totale" value={<Money value={total} complete={incomplete === 0} />} hint={`${shown.length} monture${shown.length > 1 ? 's' : ''}`} />
          {(['vente', 'extraction', 'brisage'] as FateKind[]).map((k) => (
            <Stat key={k} label={`Meilleur : ${FATE_LABELS[k].toLowerCase()}`} value={byKind(k).length} hint={formatKamas(byKind(k).reduce((s, r) => s + (r.v.best ?? 0), 0), true)} />
          ))}
        </div>
        {incomplete > 0 && (
          <Callout tone="warn">
            {incomplete} monture{incomplete > 1 ? 's ont' : ' a'} une option sans prix (souvent la vente) : la valeur affichée est un minimum. <a href={href('prix', { onglet: 'montures' })}>Saisir les prix des montures</a>.
          </Callout>
        )}
        <div className="filters">
          <label className="field">
            Famille
            <select value={family} onChange={(e) => setFamily(e.target.value as FamilyId | 'toutes')}>
              <option value="toutes">Toutes</option>
              {FAMILY_IDS.map((f) => (
                <option key={f} value={f}>
                  {FAMILIES[f].label}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={onlySterile} onChange={(e) => setOnlySterile(e.target.checked)} />
            Seulement les stériles et séniles
          </label>
        </div>
        {shown.length === 0 ? (
          <Empty>Aucune monture ne correspond.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Monture</th>
                  <th className="num">Niv.</th>
                  <th>Statut</th>
                  <th className="num">Vente</th>
                  <th className="num">Extraction</th>
                  <th className="num">Brisage</th>
                  <th className="num">Meilleur</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ m, v }) => (
                  <tr key={m.id}>
                    <td>
                      <SpeciesName id={m.speciesId} />
                      {m.name && <small className="muted">{mountName(m)}</small>}
                    </td>
                    <td className="num">{m.level}</td>
                    <td>{FERTILITY_LABELS[effectiveFertility(m)]}</td>
                    <td className="num" title={v.sale.note ?? v.sale.origin}>
                      {v.sale.net === null ? <Badge tone="danger">à saisir</Badge> : formatKamas(v.sale.net)}
                      <small className="muted">
                        {v.sale.net === null && v.sale.reference ? `référence ≈ ${formatKamas(v.sale.reference.net)} (non comptée)` : v.sale.origin}
                        {v.sale.estimated ? ' · estimation' : ''}
                      </small>
                    </td>
                    <td className="num" title={v.extraction.origin}>
                      {!v.extraction.possible ? <span className="muted">—</span> : v.extraction.net === null ? <Badge tone="danger">sans prix</Badge> : formatKamas(v.extraction.net)}
                      {v.extraction.possible && <small className="muted">{v.extraction.origin}</small>}
                    </td>
                    <td className="num" title={v.brisage.note}>
                      {!v.brisage.possible ? <span className="muted">—</span> : v.brisage.net === null ? <Badge tone="danger">sans prix</Badge> : formatKamas(v.brisage.net)}
                    </td>
                    <td className="num">
                      {!v.complete && (v.best ?? 0) <= 0 ? (
                        <Badge tone="danger">à chiffrer</Badge>
                      ) : (
                        <strong>
                          {v.complete ? '' : '≥ '}
                          {formatKamas(v.best)}
                        </strong>
                      )}
                      {v.bestKind && (v.complete || (v.best ?? 0) > 0) && (
                        <small>
                          <Badge tone="accent">{FATE_LABELS[v.bestKind]}</Badge> <ConfidenceBadge level={v.confidence === 'joueur' ? 'high' : v.confidence} />
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------- Onglet 4 : hypothèses ----------

interface ObservedYield {
  lot: string
  gaPerMount?: number
  valuePerMount?: number | number[]
  costPerMount?: number
  date?: string
  server?: string
  note?: string
}

function AssumptionsTab({ result, rules, taxPct, ctx }: { result: CycleResult | null; rules: Ruleset; taxPct: number; ctx: PriceContext }) {
  const settings = useSettings()
  const genetonOverride = usePrices((s) => s.genetonValue)
  const g = genetonKamasValue(genetonOverride)
  const brisage = PRICES_DEFAULT.valuation.brisage as { observedYields?: ObservedYield[]; defaultValuePerMountByLevel?: Record<string, Record<string, number> | null>; defaultValueBasis?: string } | undefined
  const fees = PRICES_DEFAULT.marketFees
  const keyItems = [17864, 33515, 19975, 1558, 1557, 33331, 32521, 14635]
  const settingsTax = Math.round(settings.saleTax * 1000) / 10
  const dragoHint = FERTILITY_POINT_COST_HINTS.dragofesse?.[1]
  const formulas: [string, string][] = [
    ['mountPointCost', 'Coût d’un point pour une monture'],
    ['fecundityCostPerMount', 'Coût de fécondité par monture'],
    ['xpCostToLevel', 'Coût d’XP'],
    ['captureCostPerMount', 'Coût de capture'],
    ['expectedCostPerTargetBaby', 'Coût d’un bébé de la génération cible (« coût net par bébé cible »)'],
    ['optimakinaWorthIt', 'Optimakina rentable si'],
    ['levelWorthIt', 'Monter les parents de ΔL niveaux si'],
    ['sterileValue', 'Valeur d’une stérile'],
    ['genetonValue', 'Valeur d’un généton'],
  ]
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid grid-2">
        <Card title="Règles et réglages actifs">
          <ul className="plain">
            <li>Règles du jeu : {rules.label}.</li>
            <li>
              Paliers de jauge : {TIERS.map((t) => formatNumber(rules.gaugeTierMax[t])).join(' / ')} ; débit {TIERS.map((t) => rules.gaugeRatePerTick[t]).join(' / ')} points par tick de 10 s ; durabilité des carburants ×{rules.fuelDurabilityFactor}.
            </li>
            <li>Optimakina : +{Math.round(rules.optimakinaBonus * 100)} points ; génétons par parent G1→G9 : {rules.genetonsByGeneration.slice(1, 10).join(' / ')}.</li>
            <li>
              Taxe d’HDV retenue dans ces calculs : {formatNumber(taxPct, 1)} %{taxPct !== settingsTax ? ` (différente de vos réglages : ${formatNumber(settingsTax, 1)} %)` : ''} (recherche : {fees.hdvListingTaxPct} % à la mise en vente, +
              {fees.priceChangeFeePct} % par modification de prix, <ConfidenceBadge level="medium" />).
            </li>
            <li>
              Prix par défaut : {settings.useDefaultPrices ? 'utilisés quand vous n’avez rien saisi (planchers et relevés anciens affichés, jamais comptés comme prix de vente)' : 'désactivés'} ; serveur : {settings.server || 'non renseigné'} ; niveau
              d’Éleveur : {settings.jobLevel} (une recette de niveau supérieur est payée au prix HDV).
            </li>
            <li>
              Généton : {formatKamas(g.value)} brut ({g.origin === 'joueur' ? 'votre valeur' : g.basis}) — fourchette {formatKamas(g.range[0])} → {formatKamas(g.range[1])} ; compté net de la taxe (parchemin revendu).
            </li>
          </ul>
        </Card>
        <Card title="Hypothèses du cycle simulé">
          {result ? (
            <ul className="plain">
              {result.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : (
            <Empty>Aucun cycle simulé.</Empty>
          )}
        </Card>
      </div>

      <Card title="Prix de référence utilisés">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Objet</th>
                <th className="num">Défaut</th>
                <th>Confiance</th>
                <th>Date</th>
                <th>Votre prix</th>
              </tr>
            </thead>
            <tbody>
              {keyItems.map((id) => {
                const d = PRICES_DEFAULT.items.find((i) => i.id === id)
                const own = ctx.overrides[String(id)]
                return (
                  <tr key={id}>
                    <td title={d?.notes ?? undefined}>
                      {itemName(id)}
                      {d?.source && <small className="muted">{linkify(d.source)}</small>}
                    </td>
                    <td className="num">{d?.price ? formatKamas(d.price) : '—'}</td>
                    <td>{d && (d.priceType === 'estimate' ? <Badge tone="warn">estimation</Badge> : <ConfidenceBadge level={d.confidence} />)}</td>
                    <td>{d?.date ?? '—'}</td>
                    <td>{own !== undefined ? <Badge tone="accent">{formatKamas(own)}</Badge> : <a href={href('prix', { q: itemName(id) })}>saisir</a>}</td>
                  </tr>
                )
              })}
              {TIERS.map((t) => {
                const d = defaultMangeoirePointCost(t, rules)
                if (!d) return null
                return (
                  <tr key={`pt-${t}`}>
                    <td>
                      Coût au point Mangeoire palier {t} (repli si aucun carburant chiffré)
                      <small className="muted">{d.basis}</small>
                    </td>
                    <td className="num">{formatNumber(d.scaled, 2)} K/pt</td>
                    <td>
                      <ConfidenceBadge level={d.confidence} />
                    </td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                )
              })}
              {dragoHint && (
                <tr>
                  <td>
                    Coût au point Dragofesse palier 1 (repli « estimation » si aucun carburant chiffré)
                    <small className="muted">{dragoHint.basis}</small>
                  </td>
                  <td className="num">{formatNumber(dragoHint.value / rules.fuelDurabilityFactor, 2)} K/pt</td>
                  <td>
                    <ConfidenceBadge level={dragoHint.confidence} />
                  </td>
                  <td>—</td>
                  <td>—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Callout tone="warn">
          Aucun coût au point n’est connu pour les autres jauges de fécondité (Foudroyeur, Abreuvoir, Baffeur, Caresseur, et la Dragofesse aux paliers 2 à 4) : sans vos prix, le bénéfice reste « inconnu ». Saisissez les prix de vos
          carburants sur la page <a href={href('prix', { onglet: 'carburants' })}>Prix</a>.
        </Callout>
      </Card>

      <Card title="Brisage : rendements observés">
        <Callout tone="warn">{BRISAGE_RISK_NOTE}</Callout>
        {brisage?.observedYields && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Lot</th>
                  <th className="num">Runes Ga / monture</th>
                  <th className="num">Valeur / monture</th>
                  <th className="num">Coût / monture</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {brisage.observedYields.map((y) => (
                  <tr key={y.lot}>
                    <td>
                      {y.lot}
                      {y.server && <small className="muted">{y.server}</small>}
                    </td>
                    <td className="num">{y.gaPerMount !== undefined ? formatNumber(y.gaPerMount, 2) : '—'}</td>
                    <td className="num">{Array.isArray(y.valuePerMount) ? y.valuePerMount.map((v) => formatKamas(v, true)).join(' / ') : y.valuePerMount !== undefined ? formatKamas(y.valuePerMount) : '—'}</td>
                    <td className="num">{y.costPerMount !== undefined ? formatKamas(y.costPerMount) : '—'}</td>
                    <td>{y.date ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ marginTop: 8 }}>
          Valeurs retenues (Muldos et Volkornes) :{' '}
          {Object.entries(brisage?.defaultValuePerMountByLevel?.Muldo ?? {})
            .map(([l, v]) => `niv. ${l} ≈ ${formatKamas(v)}`)
            .join(' · ')}{' '}
          ; interpolées entre ces niveaux, extrapolées sous le niveau 45 (runes Ga dès ≈ niv. 35), mises à l’échelle du prix de la rune Ga (Ga PM pour les Muldos, Ga PA pour les Volkornes). Aucune donnée pour les Dragodindes.{' '}
          <ConfidenceBadge level="low" />
        </p>
      </Card>

      <Card title="Formules (recherche, strategy.json)">
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {formulas.map(([k, label]) =>
                STRATEGY.formulas[k] ? (
                  <tr key={k}>
                    <td>{label}</td>
                    <td>
                      <code>{STRATEGY.formulas[k]}</code>
                    </td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        </div>
        <small className="muted">« Coût brut par bébé cible » = dépenses ÷ bébés cibles ; « coût net » applique la formule ci-dessus (parents engagés compris, résidu = bébés ratés + stériles ; génétons non déduits).</small>
      </Card>

      <Card title="Sources des prix">
        <p className="muted">
          {PRICES_DEFAULT.asOf}. {PRICES_DEFAULT.server}. Analyse complète : <code>research/economy.md</code> (§3.3 valorisation, §5 brisage, §6 carburants, §8 génétons, §9 rentabilité) et <code>research/README.md</code> §2.9.
        </p>
        <ul className="plain sources">
          {Object.entries(PRICES_DEFAULT.sources).map(([code, text]) => (
            <li key={code}>
              <strong>[{code}]</strong> {linkify(text)}
            </li>
          ))}
        </ul>
        <ul className="plain" style={{ marginTop: 10 }}>
          {PRICES_DEFAULT.notes.map((n) => (
            <li key={n} className="muted">
              {n}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

// ---------- Page ----------

export default function ProfitPage() {
  const family = useSettings((s) => s.family)
  const parentTargetLevel = useSettings((s) => s.parentTargetLevel)
  const preferredTier = useSettings((s) => s.preferredTier)
  const jobLevel = useSettings((s) => s.jobLevel)
  const useOptimakina = useSettings((s) => s.useOptimakina)
  const saleTax = useSettings((s) => s.saleTax)
  const goalSpeciesId = useSettings((s) => s.goalSpeciesId)
  const useDefaultPrices = useSettings((s) => s.useDefaultPrices)
  const rules = useRules()
  const baseCtx = usePriceContext()
  const ctx = useMemo<PriceContext>(() => ({ ...baseCtx, jobLevel }), [baseCtx, jobLevel])
  const pMounts = usePrices((s) => s.mounts)
  const pGenerations = usePrices((s) => s.generations)
  const genetonOverride = usePrices((s) => s.genetonValue)
  const inventory = useInventory((s) => s.mounts)
  const mctx = useMemo<MountPriceContext>(() => ({ mountOverrides: pMounts, generationOverrides: pGenerations, useDefaults: useDefaultPrices }), [pMounts, pGenerations, useDefaultPrices])
  const geneton = genetonKamasValue(genetonOverride)
  const [tab, setTab] = useState<TabId>('cycle')

  // Réglages en direct + écarts saisis ici + champs de la page.
  const live = useMemo(
    () => fromSettings({ family, parentTargetLevel, preferredTier, jobLevel, useOptimakina, saleTax }),
    [family, parentTargetLevel, preferredTier, jobLevel, useOptimakina, saleTax],
  )
  const [stored, setStored] = useState<Stored>(() => loadStored())
  const params = useMemo<Params>(() => {
    const o = stored.overrides
    const fam = o.family ?? live.family
    const tier = o.tier ?? live.tier
    const page = { ...PAGE_DEFAULTS, ...stored.page }
    const goal = goalSpeciesId !== null && getSpecies(goalSpeciesId)?.family === fam ? goalSpeciesId : null
    const crossingKey = page.crossingKey && crossingsOf(fam).some((c) => c.key === page.crossingKey) ? page.crossingKey : defaultCrossingKey(fam, goal)
    return {
      ...page,
      family: fam,
      parentLevel: o.parentLevel ?? live.parentLevel,
      tier,
      xpTier: o.xpTier ?? tier,
      paddocks: o.paddocks ?? live.paddocks,
      optimakina: o.optimakina ?? live.optimakina,
      saleTaxPct: o.saleTaxPct ?? live.saleTaxPct,
      crossingKey,
      pairs: page.pairs ?? 5 * live.paddocks,
    }
  }, [stored, live, goalSpeciesId])

  const update = (fn: (s: Stored) => Stored) =>
    setStored((s) => {
      const next = fn(s)
      saveStored(next)
      return next
    })
  const set = (patch: Partial<Params>) =>
    update((s) => {
      const overrides: Partial<SettingsBacked> = { ...s.overrides }
      const page: Partial<PageParams> = { ...s.page }
      for (const [k, v] of Object.entries(patch) as [keyof Params, Params[keyof Params]][]) {
        if ((SETTINGS_KEYS as string[]).includes(k)) {
          const key = k as keyof SettingsBacked
          const liveValue = key === 'xpTier' ? (patch.tier ?? overrides.tier ?? live.tier) : live[key]
          if (v === liveValue) delete overrides[key]
          else (overrides as Record<string, unknown>)[key] = v
          // Le palier de la Mangeoire suit le palier des jauges, sauf choix explicite.
          if (key === 'tier' && patch.xpTier === undefined) delete overrides.xpTier
        } else (page as Record<string, unknown>)[k] = v
      }
      return { v: 2, page, overrides }
    })
  const resetOverride = (k: keyof SettingsBacked) =>
    update((s) => {
      const overrides = { ...s.overrides }
      delete overrides[k]
      if (k === 'tier') delete overrides.xpTier
      return { ...s, overrides }
    })
  const resetAll = () => update((s) => ({ ...s, overrides: {} }))

  const parents = useMemo((): [number, number] | null => {
    if (params.mode === 'libre') return params.parentA !== null && params.parentB !== null ? [params.parentA, params.parentB] : null
    const c = crossingsOf(params.family).find((x) => x.key === params.crossingKey)
    return c ? [c.a, c.b] : null
  }, [params.mode, params.parentA, params.parentB, params.family, params.crossingKey])

  const goalPath = useMemo(() => {
    const g = goalContext(goalSpeciesId)
    return g ? [g.goalId, ...g.recipe, ...g.ancestors] : []
  }, [goalSpeciesId])

  // « Mes lots » : plans de fécondité de vos montures (répartition automatique de la page Enclos).
  const canUseMine = useMemo(() => inventory.some((m) => effectiveFertility(m) === 'fertile'), [inventory])
  const myBatches = useMemo<MyBatches | null>(() => {
    if (params.batchModel !== 'mes-lots') return null
    try {
      const res = assignPaddocks(inventory, { paddocksAvailable: unlockedPaddockCount(jobLevel), rules, tier: params.tier, withXp: false, includeLeveling: false, keepCurrent: false })
      const planned = res.paddocks.filter((pd) => pd.plan && pd.plan.converges && pd.plan.totalSeconds > 0)
      const profile = batchProfileFromPlans(
        planned.map((pd) => ({ consumed: pd.plan!.consumed, totalSeconds: pd.plan!.totalSeconds, tiers: pd.plan!.tiers })),
        params.tier,
      )
      return { profile, lots: planned.length, mounts: planned.reduce((s, pd) => s + pd.mountIds.length - pd.fillerIds.length, 0) }
    } catch {
      return { profile: null, lots: 0, mounts: 0 }
    }
  }, [params.batchModel, params.tier, inventory, jobLevel, rules])

  const cfg = useMemo<CycleConfig | null>(
    () =>
      parents && {
        family: params.family,
        parentA: parents[0],
        parentB: parents[1],
        pairs: params.pairs,
        parentLevel: params.parentLevel,
        parentStartLevel: params.parentStartLevel,
        tier: params.tier,
        xpTier: params.xpTier,
        batchSize: params.batchSize,
        paddocks: params.paddocks,
        optimakina: params.optimakina,
        takeza: params.takeza,
        includeCapture: params.includeCapture,
        netKind: params.netKind,
        mountsPerCast: params.mountsPerCast,
        saleTax: params.saleTaxPct / 100,
        serenityPointsPerMount: params.serenity ?? undefined,
        sterileFate: params.sterileFate,
        sage: params.sage,
        batchModel: params.batchModel === 'mes-lots' ? 'typique' : params.batchModel,
        batchProfile: myBatches?.profile ?? undefined,
        parentValue: params.parentValue,
        genetonOrigin: geneton.origin,
        goalPath,
        ctx,
        mountPrices: mctx,
        rules,
        jobLevel,
        genetonValue: geneton.value,
      },
    [parents, params, ctx, mctx, rules, jobLevel, geneton.value, geneton.origin, goalPath, myBatches],
  )

  const run = (c: CycleConfig): CycleResult | null => {
    try {
      return cycleProfit(c)
    } catch {
      return null
    }
  }
  const { result, error } = useMemo(() => {
    if (!cfg) return { result: null, error: null }
    try {
      return { result: cycleProfit(cfg), error: null }
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : 'Calcul impossible.' }
    }
  }, [cfg])

  return (
    <div className="profit-page">
      <PageHeader
        title="Rentabilité"
        subtitle="Combien coûte un cycle d’élevage, combien il rapporte et en combien de temps — avec vos prix (page Prix) et les règles actives."
        actions={
          <>
            <Badge tone="info">Règles {rules.id}</Badge>
            <a className="btn small" href={href('prix')}>
              Mes prix
            </a>
          </>
        }
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'cycle' && (
        <CycleTab
          p={params}
          set={set}
          cfg={cfg}
          result={result}
          error={error}
          run={run}
          overrides={stored.overrides}
          live={live}
          onReset={resetOverride}
          onResetAll={resetAll}
          myBatches={myBatches}
          canUseMine={canUseMine}
        />
      )}
      {tab === 'classement' && (
        <RankingTab
          p={params}
          ctx={ctx}
          mctx={mctx}
          rules={rules}
          jobLevel={jobLevel}
          genetonValue={geneton.value}
          goalPath={goalPath}
          profile={myBatches?.profile ?? null}
          onToggleSteriles={(v) => set({ includeSteriles: v })}
          onSimulate={(key) => {
            set({ mode: 'croisement', crossingKey: key })
            setTab('cycle')
          }}
        />
      )}
      {tab === 'inventaire' && <InventoryTab ctx={ctx} mctx={mctx} saleTax={params.saleTaxPct / 100} />}
      {tab === 'hypotheses' && <AssumptionsTab result={result} rules={rules} taxPct={params.saleTaxPct} ctx={ctx} />}
    </div>
  )
}
