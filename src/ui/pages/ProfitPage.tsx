// Page « Rentabilité » : rentabilité d'un cycle de production (coûts matériels, durée, revenus,
// bénéfice, kamas/heure, ROI), classement des croisements, valeur des montures possédées, et
// hypothèses/sources. Logique : src/domain/economy.ts et fuel.ts ; prix : page Prix.
import { useMemo, useState, type ReactNode } from 'react'
import { FAMILIES, FAMILY_IDS, PRICES_DEFAULT, STRATEGY, getSpecies, itemName, speciesOfFamily } from '../../data'
import { FUEL_TIER_NAMES, GAUGE_LABELS, PADDOCK_UNLOCK_LEVELS } from '../../domain/constants'
import {
  COST_CATEGORY_LABELS,
  DEFAULT_MOUNTS_PER_CAST,
  DEFAULT_SERENITY_POINTS,
  FATE_LABELS,
  NET_KIND_LABELS,
  BRISAGE_RISK_NOTE,
  crossingRanking,
  cycleProfit,
  genetonKamasValue,
  mountValuation,
  type CostCategory,
  type CrossingRank,
  type CycleConfig,
  type CycleResult,
  type FateKind,
  type MaterialLine,
  type MountPriceContext,
  type MountState,
  type NetKind,
  type SterileFate,
} from '../../domain/economy'
import { defaultMangeoirePointCost } from '../../domain/fuel'
import { effectiveFertility, FERTILITY_LABELS, mountName } from '../../domain/mounts'
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

interface Params {
  family: FamilyId
  mode: 'croisement' | 'libre'
  crossingKey: string
  parentA: number | null
  parentB: number | null
  pairs: number
  parentLevel: number
  parentStartLevel: number
  tier: FuelTier
  xpTier: FuelTier
  batchSize: number
  paddocks: number
  optimakina: boolean
  takeza: boolean
  includeCapture: boolean
  netKind: NetKind
  mountsPerCast: number
  saleTaxPct: number
  serenity: number
  sterileFate: SterileFate
  sage: boolean
  includeSteriles: boolean
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

function loadStored(): Partial<Params> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<Params>) : {}
  } catch {
    return {}
  }
}

function saveStored(p: Params) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // Stockage indisponible (navigation privée) : les paramètres ne sont simplement pas mémorisés.
  }
}

const speciesName = (id: number) => getSpecies(id)?.name ?? `#${id}`

/**
 * Sens d'un bénéfice incomplet : coûts incomplets seuls → bénéfice surestimé (≤) ; revenus
 * incomplets seuls → sous-estimé (≥) ; les deux → indéterminé (≈).
 */
function profitBound(r: { costComplete: boolean; revenueComplete: boolean }): '≥' | '≤' | '≈' {
  if (!r.costComplete && r.revenueComplete) return '≤'
  if (r.costComplete && !r.revenueComplete) return '≥'
  return '≈'
}

/** Montant signé, avec mention d'une valeur incomplète. */
function Money({ value, complete = true, bound }: { value: number | null; complete?: boolean; bound?: '≥' | '≤' | '≈' }) {
  if (value === null) return <span className="muted">—</span>
  return (
    <span className={value < 0 ? 'neg' : undefined}>
      {!complete && bound ? `${bound} ` : ''}
      {formatKamas(value)}
    </span>
  )
}

const ORIGIN_LABELS: Record<string, { label: string; tone: 'accent' | 'info' | 'ok' | 'warn' | 'danger' }> = {
  joueur: { label: 'votre prix', tone: 'accent' },
  defaut: { label: 'défaut', tone: 'info' },
  craft: { label: 'craft', tone: 'ok' },
  estimation: { label: 'estimation', tone: 'warn' },
  manquant: { label: 'manquant', tone: 'danger' },
}

function OriginBadge({ line }: { line: MaterialLine }) {
  if (!line.complete)
    return (
      <Badge tone="warn" title={line.note}>
        coût incomplet
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

// ---------- Barres empilées ----------

interface Segment {
  key: string
  label: string
  value: number
  color: string
}

function BreakdownBar({ title, total, segments, scaleMax, incomplete }: { title: string; total: number; segments: Segment[]; scaleMax: number; incomplete: boolean }) {
  const [hover, setHover] = useState<string | null>(null)
  const shown = segments.filter((s) => s.value > 0)
  const width = scaleMax > 0 ? Math.max(1, (total / scaleMax) * 100) : 0
  const h = shown.find((s) => s.key === hover)
  return (
    <div className="bar-block">
      <h3>
        <span>{title}</span>
        <span>
          {incomplete ? '≥ ' : ''}
          {formatKamas(total)} {incomplete && <Badge tone="warn">incomplet</Badge>}
        </span>
      </h3>
      <div className="bar-area">
        {h && (
          <div className="bar-tip" role="status">
            <strong>{formatKamas(h.value)}</strong> · {h.label} ({formatPercent(total > 0 ? h.value / total : 0)})
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
}

// ---------- Onglet 1 : cycle ----------

function CycleParamsCard({ p, set, rules }: { p: Params; set: (patch: Partial<Params>) => void; rules: Ruleset }) {
  const list = useMemo(() => crossingsOf(p.family), [p.family])
  const byGen = useMemo(() => {
    const m = new Map<number, typeof list>()
    for (const c of list) m.set(c.gen, [...(m.get(c.gen) ?? []), c])
    return [...m.entries()]
  }, [list])
  const jobLevel = useSettings((s) => s.jobLevel)
  const unlocked = PADDOCK_UNLOCK_LEVELS.filter((x) => x.level <= jobLevel).length
  const netDefault = DEFAULT_MOUNTS_PER_CAST[p.netKind]
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
          onChange={(tier) => set({ tier, xpTier: tier })}
          options={TIERS.map((t) => ({ value: t, label: `${t} — ${FUEL_TIER_NAMES[t]} (${rules.gaugeRatePerTick[t]} pts / 10 s)` }))}
        />
        <NumberField label="Montures par enclos" value={p.batchSize} min={1} max={10} onChange={(v) => set({ batchSize: Math.round(v) })} />
        <NumberField label={`Enclos en parallèle (${unlocked} débloqué${unlocked > 1 ? 's' : ''})`} value={p.paddocks} min={1} max={6} onChange={(v) => set({ paddocks: Math.round(v) })} />
        <NumberField label="Taxe d’HDV" value={p.saleTaxPct} min={0} max={20} step={0.5} suffix="%" onChange={(v) => set({ saleTaxPct: v })} />
        <SelectField
          label="Parents stériles après l’accouplement"
          value={p.sterileFate}
          onChange={(sterileFate) => set({ sterileFate })}
          options={[
            { value: 'meilleur', label: 'Vendre / extraire / briser (le meilleur)' },
            { value: 'cloner', label: 'Garder pour cloner' },
          ]}
        />
        <label className="check">
          <input type="checkbox" checked={p.optimakina} onChange={(e) => set({ optimakina: e.target.checked })} />
          Optimakina (+{Math.round(rules.optimakinaBonus * 100)} points de génération cible)
        </label>
        <label className="check">
          <input type="checkbox" checked={p.includeCapture} onChange={(e) => set({ includeCapture: e.target.checked })} />
          Compter les captures (parents G1)
        </label>
      </div>
      <details className="advanced">
        <summary>Réglages avancés : capture, XP, sérénité, Takeza</summary>
        <div className="params">
          <SelectField label="Filet" value={p.netKind} onChange={(netKind) => set({ netKind, mountsPerCast: DEFAULT_MOUNTS_PER_CAST[netKind].value })} options={(Object.keys(NET_KIND_LABELS) as NetKind[]).map((k) => ({ value: k, label: NET_KIND_LABELS[k] }))} />
          <NumberField label={`Montures par lancer (défaut ${netDefault.value})`} value={p.mountsPerCast} min={1} max={20} onChange={(v) => set({ mountsPerCast: Math.round(v) })} />
          <NumberField label="Niveau de départ des parents" value={p.parentStartLevel} min={1} max={200} onChange={(v) => set({ parentStartLevel: Math.round(v) })} />
          <SelectField label="Palier de la Mangeoire" value={p.xpTier} onChange={(xpTier) => set({ xpTier })} options={TIERS.map((t) => ({ value: t, label: `${t} — ${FUEL_TIER_NAMES[t]}` }))} />
          <NumberField label="Points de sérénité par lot" value={p.serenity} min={0} max={20_000} step={100} onChange={(v) => set({ serenity: Math.round(v) })} />
          <label className="check">
            <input type="checkbox" checked={p.sage} onChange={(e) => set({ sage: e.target.checked })} />
            Parents Sage (XP ×2)
          </label>
          <label className="check">
            <input type="checkbox" checked={p.takeza} onChange={(e) => set({ takeza: e.target.checked })} />
            Jour Takeza (+20 % de génération cible)
          </label>
        </div>
        <small className="muted">
          Sérénité : {formatNumber(DEFAULT_SERENITY_POINTS)} points par défaut = moyenne du planificateur de fécondité pour une sérénité de départ uniforme (ESTIMATION). Montures par lancer : {netDefault.note}
        </small>
      </details>
    </Card>
  )
}

function MissingPricesCallout({ r }: { r: CycleResult }) {
  const toPrice = new Map<string, { name: string; tab?: string }>()
  for (const l of r.materials)
    if (!l.complete) {
      const name = l.toPrice?.name ?? l.itemName
      toPrice.set(name, { name })
    }
  const species = r.missingSpecies.map(speciesName)
  if (!toPrice.size && !species.length && r.complete) return null
  return (
    <Callout tone="warn">
      <strong>Résultat incomplet</strong> : des prix manquent, les totaux ne comptent que les montants connus (jamais 0 pour un prix inconnu).
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
          Montures sans prix : {species.join(', ')} — <a href={href('prix', { onglet: 'montures' })}>saisir les prix des montures</a>.
        </div>
      )}
    </Callout>
  )
}

function MaterialsTable({ r }: { r: CycleResult }) {
  const cats: CostCategory[] = ['fecondite', 'xp', 'makina', 'capture']
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
                <td className="num">
                  <Money value={tot.value} complete={tot.complete} bound="≥" />
                </td>
                <td>{!tot.complete && <Badge tone="warn">incomplet</Badge>}</td>
              </tr>,
              ...lines.map((l) => (
                <tr key={l.key}>
                  <td>{l.gauge ? GAUGE_LABELS[l.gauge] : l.label}</td>
                  <td>
                    {l.itemName}
                    <small className="muted">
                      {l.gauge ? `${formatNumber(l.points ?? 0)} points de jauge` : l.label}
                      {l.note ? ` — ${l.note}` : ''}
                    </small>
                    {!l.complete && (
                      <small>
                        <a href={href('prix', { q: l.toPrice?.name ?? l.itemName })}>Saisir le prix{l.toPrice ? ` : ${l.toPrice.name}` : ''}</a>
                        {l.missing.length > 0 && <span className="muted"> · ingrédients sans prix : {l.missing.slice(0, 4).map(itemName).join(', ')}{l.missing.length > 4 ? '…' : ''}</span>}
                      </small>
                    )}
                  </td>
                  <td className="num">
                    {l.unit === 'point' ? `${formatNumber(l.qty)} pts` : formatNumber(l.qty)}
                  </td>
                  <td className="num">
                    {l.unitPrice === null || (!l.complete && l.unitPrice <= 0) ? '—' : `${!l.complete && l.subtotal !== null ? '≥ ' : ''}${l.unit === 'point' ? `${formatNumber(l.unitPrice, 2)} K/pt` : formatKamas(l.unitPrice)}`}
                  </td>
                  <td className="num">
                    {l.subtotal === null ? (l.upperBound ? <span className="muted" title="Avec un carburant de palier supérieur : borne haute, non comptée">≤ {formatKamas(l.upperBound)}</span> : '—') : <Money value={l.subtotal} complete={l.complete} bound="≥" />}
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
            <td colSpan={4}>Total des coûts matériels</td>
            <td className="num">
              <Money value={r.totalCost} complete={r.costComplete} bound="≥" />
            </td>
            <td>{!r.costComplete && <Badge tone="warn">incomplet</Badge>}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function RevenueTable({ r }: { r: CycleResult }) {
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
                    <small className="muted">
                      {l.kind === 'bebe' ? `Bébé niv. 1${l.note ? ` · ${l.note}` : ''}` : l.label}
                    </small>
                  </>
                ) : (
                  l.label
                )}
                {l.kind === 'genetons' && l.note && <small className="muted">{l.note}</small>}
              </td>
              <td className="num">{l.probability !== undefined ? formatPercent(l.probability, 2) : '—'}</td>
              <td className="num">{formatNumber(l.qty, 2)}</td>
              <td>
                {l.fate === 'clone' ? <Badge tone="info">clonage</Badge> : l.fate ? <Badge>{FATE_LABELS[l.fate]}</Badge> : l.kind === 'genetons' ? <Badge tone="gold">boutique</Badge> : '—'}
                {l.confidence && l.kind !== 'genetons' && <ConfidenceBadge level={l.confidence === 'joueur' ? 'high' : l.confidence} />}
              </td>
              <td className="num">{l.unitValue === null ? <Badge tone="danger">sans prix</Badge> : formatKamas(l.unitValue)}</td>
              <td className="num">
                <Money value={l.subtotal} complete={l.complete} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Revenu attendu</td>
            <td className="num">
              <Money value={r.totalRevenue} complete={r.revenueComplete} bound="≥" />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function Variants({ base, run }: { base: CycleConfig; run: (c: CycleConfig) => CycleResult | null }) {
  const variants: { label: string; cfg: CycleConfig }[] = [
    { label: 'Configuration actuelle', cfg: base },
    { label: base.optimakina ? 'Sans Optimakina' : 'Avec Optimakina', cfg: { ...base, optimakina: !base.optimakina } },
    ...TIERS.filter((t) => t !== base.tier).map((t) => ({ label: `Palier ${t} (${FUEL_TIER_NAMES[t]})`, cfg: { ...base, tier: t, xpTier: t } })),
  ]
  const rows = variants.map((v) => ({ ...v, r: run(v.cfg) }))
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Variante</th>
            <th className="num">Coût</th>
            <th className="num">Bénéfice</th>
            <th className="num">Durée</th>
            <th className="num">Kamas / h</th>
            <th>Prix</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, r }) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">{r ? <Money value={r.totalCost} complete={r.costComplete} bound="≥" /> : '—'}</td>
              <td className="num">{r ? <Money value={r.profit} complete={r.complete} bound={profitBound(r)} /> : '—'}</td>
              <td className="num">{r ? formatDuration(r.seconds.total) : '—'}</td>
              <td className="num">{r && r.kamasPerHour !== null ? <Money value={r.kamasPerHour} complete={r.complete} bound={profitBound(r)} /> : '—'}</td>
              <td>{r && (r.complete ? <Badge tone="ok">complet</Badge> : <Badge tone="warn">incomplet</Badge>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CycleTab({ p, set, cfg, result, error, run }: { p: Params; set: (patch: Partial<Params>) => void; cfg: CycleConfig | null; result: CycleResult | null; error: string | null; run: (c: CycleConfig) => CycleResult | null }) {
  const rules = useRules()
  return (
    <div className="stack" style={{ gap: 16 }}>
      <CycleParamsCard p={p} set={set} rules={rules} />
      {error && <Callout tone="danger">{error}</Callout>}
      {!result || !cfg ? (
        !error && <Empty>Choisissez un croisement ou deux parents de la même famille.</Empty>
      ) : (
        <CycleResultView r={result} cfg={cfg} p={p} run={run} />
      )}
    </div>
  )
}

function CycleResultView({ r, cfg, p, run }: { r: CycleResult; cfg: CycleConfig; p: Params; run: (c: CycleConfig) => CycleResult | null }) {
  const hours = r.seconds.total / 3600
  const revSegments: Segment[] = [
    { key: 'bebe', label: 'Bébés', value: r.revenue.filter((l) => l.kind === 'bebe').reduce((s, l) => s + (l.subtotal ?? 0), 0), color: 'var(--series-5)' },
    { key: 'sterile', label: 'Stériles', value: r.revenue.filter((l) => l.kind === 'sterile').reduce((s, l) => s + (l.subtotal ?? 0), 0), color: 'var(--series-6)' },
    { key: 'genetons', label: 'Génétons', value: r.revenue.filter((l) => l.kind === 'genetons').reduce((s, l) => s + (l.subtotal ?? 0), 0), color: 'var(--series-7)' },
  ]
  const costSegments: Segment[] = (Object.keys(COST_CATEGORY_LABELS) as CostCategory[]).map((c) => ({ key: c, label: COST_CATEGORY_LABELS[c], value: r.costByCategory[c].value, color: COST_COLORS[c] }))
  const scaleMax = Math.max(r.totalCost, r.totalRevenue)
  const b = r.breed
  return (
    <>
      <Card
        title={
          <h2>
            {speciesName(cfg.parentA)} × {speciesName(cfg.parentB)} — {p.pairs} couple{p.pairs > 1 ? 's' : ''}
          </h2>
        }
        actions={r.complete ? <Badge tone="ok">tous les prix sont connus</Badge> : <Badge tone="warn">prix incomplets</Badge>}
      >
        <div className="kpis">
          <Stat label="Coût matériel" value={<Money value={r.totalCost} complete={r.costComplete} bound="≥" />} hint={`${formatKamas(r.totalCost / p.pairs, true)} par couple`} />
          <Stat label="Revenu attendu" value={<Money value={r.totalRevenue} complete={r.revenueComplete} bound="≥" />} hint="bébés, stériles, génétons (nets de taxe)" />
          <Stat
            label="Bénéfice attendu"
            tone={r.profit >= 0 ? 'pos' : 'neg'}
            value={<Money value={r.profit} complete={r.complete} bound={profitBound(r)} />}
            hint={r.complete ? `${formatKamas(r.profitPerPair, true)} par couple` : profitBound(r) === '≤' ? 'au plus : des coûts manquent' : 'incomplet : à confirmer avec vos prix'}
          />
          <Stat label="Kamas par heure" tone={(r.kamasPerHour ?? 0) >= 0 ? 'pos' : 'neg'} value={r.kamasPerHour === null ? '—' : <Money value={r.kamasPerHour} complete={r.complete} bound={profitBound(r)} />} hint={`sur ${formatNumber(hours, 1)} h d’enclos`} />
          <Stat label="Retour sur investissement" value={r.roi === null ? '—' : `${r.complete ? '' : '≈ '}${formatPercent(r.roi)}`} hint={r.complete ? 'bénéfice / coût' : 'bénéfice / coût, prix incomplets'} />
          <Stat label="Durée totale" value={formatDuration(r.seconds.total)} hint={`${r.rounds} tour${r.rounds > 1 ? 's' : ''} de ${formatDuration(r.seconds.perRound)}`} />
          <Stat label={`Bébés G${b.targetGeneration} attendus`} value={formatNumber(r.expectedTargetBabies, 1)} hint={`chance cible ${formatPercent(b.targetChance)} par accouplement`} />
          <Stat label="Coût par bébé cible" value={r.costPerTargetBaby === null ? '—' : <Money value={r.costPerTargetBaby} complete={r.costComplete} bound="≥" />} hint={`+${formatNumber(r.jobXp)} XP d’Éleveur au total`} />
        </div>
        <MissingPricesCallout r={r} />
        {r.warnings.filter((w) => !w.startsWith('Coût incomplet') && !w.startsWith('Revenu incomplet')).map((w) => (
          <Callout key={w} tone="warn">
            {w}
          </Callout>
        ))}
      </Card>

      <Card title="Coûts et revenus">
        <div className="breakdown">
          <BreakdownBar title="Coûts matériels" total={r.totalCost} segments={costSegments} scaleMax={scaleMax} incomplete={!r.costComplete} />
          <BreakdownBar title="Revenus attendus" total={r.totalRevenue} segments={revSegments} scaleMax={scaleMax} incomplete={!r.revenueComplete} />
        </div>
        <small className="muted">Les deux barres partagent la même échelle. Détail dans les tableaux ci-dessous.</small>
      </Card>

      <Card title="Matériel à prévoir">
        <p className="muted">
          Carburant le moins cher au point pour chaque jauge (paliers ≥ {cfg.tier}), quantités arrondies à l’objet entier. {r.batches} lot{r.batches > 1 ? 's' : ''} de {cfg.batchSize} : la consommation d’une jauge ne dépend pas du
          nombre de montures, remplissez les enclos.
        </p>
        <MaterialsTable r={r} />
      </Card>

      <Card title="Revenus attendus">
        <p className="muted">
          Génération cible G{b.targetGeneration} à {formatPercent(b.targetChance)}
          {b.recordPossible ? `, génétons si G${b.targetGeneration} (record) : ${b.genetonsIfRecord} par naissance` : ', aucun généton possible (l’arbre contient déjà cette génération)'}. Valeurs nettes de la taxe de {formatNumber(p.saleTaxPct, 1)} %.
        </p>
        <RevenueTable r={r} />
      </Card>

      <div className="grid grid-2">
        <Card title="Durée">
          <table className="table">
            <tbody>
              <tr>
                <td>Fécondité d’un lot (palier {cfg.tier})</td>
                <td className="num">{formatDuration(r.seconds.fertility)}</td>
              </tr>
              <tr>
                <td>XP restante après la phase d’amour (Mangeoire palier {cfg.xpTier ?? cfg.tier})</td>
                <td className="num">{formatDuration(r.seconds.leveling)}</td>
              </tr>
              <tr>
                <td>Par tour ({Math.min(r.batches, cfg.paddocks ?? 1)} enclos en parallèle)</td>
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
          <small className="muted">Temps d’enclos à palier entretenu ; captures, déplacements et ventes non comptés. Un palier plus haut va plus vite mais coûte plus cher au point.</small>
        </Card>
        <Card title="Variantes">
          <Variants base={cfg} run={run} />
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

type SortKey = 'margin' | 'chance' | 'babies' | 'genetons' | 'gen' | 'cost' | 'sterile'

function RankingTab({ p, onSimulate, onToggleSteriles, ctx, mctx, rules, jobLevel, genetonValue }: { p: Params; onSimulate: (key: string) => void; onToggleSteriles: (v: boolean) => void; ctx: PriceContext; mctx: MountPriceContext; rules: Ruleset; jobLevel: number; genetonValue: number }) {
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
        serenityPointsPerMount: p.serenity,
        includeSteriles: p.includeSteriles,
        ctx,
        mountPrices: mctx,
        rules,
        jobLevel,
        genetonValue,
      }),
    [p, ctx, mctx, rules, jobLevel, genetonValue],
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
      case 'sterile':
        return r.sterileValue
      case 'cost':
        return (r.fertilityCost ?? 0) + (r.levelingCost ?? 0) + (r.makinaCost ?? 0)
      default:
        return r.margin
    }
  }
  const gens = [...new Set(rows.map((r) => r.targetGeneration))].sort((a, b) => a - b)
  const shown = rows.filter((r) => (genFilter === 'toutes' || r.targetGeneration === genFilter) && (!onlyComplete || r.complete)).sort((a, b) => sort.dir * (value(a) - value(b)) || b.margin - a.margin)
  const completeCount = rows.filter((r) => r.complete).length
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
          Marge = valeur attendue des bébés + génétons{p.includeSteriles ? ' + valeur des 2 parents stériles' : ''} − fécondité des 2 parents − XP jusqu’au niveau {p.parentLevel} − Optimakina{p.optimakina ? '' : ' (désactivée)'}. Parents
          supposés à arbre « propre », palier {p.tier}, lots de {p.batchSize}, taxe {formatNumber(p.saleTaxPct, 1)} %. Ces paramètres viennent de l’onglet « Cycle de production ».
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
            Compter la valeur des parents stériles
          </label>
        </div>
        {completeCount < rows.length && (
          <Callout tone="warn">
            {rows.length - completeCount} croisement{rows.length - completeCount > 1 ? 's ont' : ' a'} des prix manquants (carburants de fécondité, makinas ou montures) : leur marge ne compte que les montants connus.{' '}
            <a href={href('prix', { onglet: 'carburants' })}>Compléter les prix</a>.
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
                  {sortHeader('sterile', 'Stériles')}
                  {sortHeader('cost', 'Coûts')}
                  {sortHeader('margin', 'Marge')}
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const costs = (r.fertilityCost ?? 0) + (r.levelingCost ?? 0) + (r.makinaCost ?? 0)
                  return (
                    <tr key={r.key}>
                      <td>
                        <SpeciesName id={r.child} />
                        <small className="muted">
                          {speciesName(r.parentA)} × {speciesName(r.parentB)}
                        </small>
                      </td>
                      <td className="num">G{r.targetGeneration}</td>
                      <td className="num">{formatPercent(r.targetChance)}</td>
                      <td className="num">
                        <Money value={r.expectedBabyValue} complete={r.babyComplete} bound="≥" />
                      </td>
                      <td className="num" title={`${formatNumber(r.expectedGenetons, 2)} génétons attendus`}>
                        {formatKamas(r.genetonsValue)}
                      </td>
                      <td className="num">{p.includeSteriles ? <Money value={r.sterileValue} complete={r.sterileComplete} bound="≥" /> : <span className="muted">—</span>}</td>
                      <td className="num" title={`Fécondité ${formatKamas(r.fertilityCost)} · XP ${formatKamas(r.levelingCost)} · Optimakina ${r.usesOptimakina ? formatKamas(r.makinaCost) : 'non'}`}>
                        <Money value={costs} complete={r.costComplete} bound="≥" />
                      </td>
                      <td className="num">
                        <strong className={r.margin >= 0 ? 'pos' : 'neg'}>
                          {!r.complete && `${profitBound({ costComplete: r.costComplete, revenueComplete: r.babyComplete && (!p.includeSteriles || r.sterileComplete) })} `}
                          {formatKamas(r.margin)}
                        </strong>
                        {!r.complete && <small><Badge tone="warn">incomplet</Badge></small>}
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
          Pour chaque monture : le meilleur entre la vente, l’extraction et le brisage, net de la taxe d’HDV. C’est une valeur <strong>plancher</strong> : une monture féconde utile à votre plan vaut davantage (voir{' '}
          <a href={href('montures')}>Mes montures</a> pour le sort conseillé). {BRISAGE_RISK_NOTE}
        </p>
        <div className="kpis">
          <Stat label="Valeur totale" value={<Money value={total} complete={incomplete === 0} bound="≥" />} hint={`${shown.length} monture${shown.length > 1 ? 's' : ''}`} />
          {(['vente', 'extraction', 'brisage'] as FateKind[]).map((k) => (
            <Stat key={k} label={`Meilleur : ${FATE_LABELS[k].toLowerCase()}`} value={byKind(k).length} hint={formatKamas(byKind(k).reduce((s, r) => s + (r.v.best ?? 0), 0), true)} />
          ))}
        </div>
        {incomplete > 0 && (
          <Callout tone="warn">
            {incomplete} monture{incomplete > 1 ? 's ont' : ' a'} une option sans prix : la valeur affichée est un minimum. <a href={href('prix', { onglet: 'montures' })}>Saisir les prix des montures</a>.
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
                      {v.sale.net === null ? <Badge tone="danger">sans prix</Badge> : formatKamas(v.sale.net)}
                      <small className="muted">{v.sale.origin}</small>
                    </td>
                    <td className="num" title={v.extraction.origin}>
                      {!v.extraction.possible ? <span className="muted">—</span> : v.extraction.net === null ? <Badge tone="danger">sans prix</Badge> : formatKamas(v.extraction.net)}
                      {v.extraction.possible && <small className="muted">{v.extraction.origin}</small>}
                    </td>
                    <td className="num" title={v.brisage.note}>
                      {!v.brisage.possible ? <span className="muted">—</span> : v.brisage.net === null ? <Badge tone="danger">sans prix</Badge> : formatKamas(v.brisage.net)}
                    </td>
                    <td className="num">
                      <strong>{formatKamas(v.best)}</strong>
                      {v.bestKind && (
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

function AssumptionsTab({ result, rules }: { result: CycleResult | null; rules: Ruleset }) {
  const settings = useSettings()
  const ctx = usePriceContext()
  const genetonOverride = usePrices((s) => s.genetonValue)
  const g = genetonKamasValue(genetonOverride)
  const brisage = PRICES_DEFAULT.valuation.brisage as { observedYields?: ObservedYield[]; defaultValuePerMountByLevel?: Record<string, Record<string, number> | null>; defaultValueBasis?: string } | undefined
  const fees = PRICES_DEFAULT.marketFees
  const keyItems = [17864, 33515, 19975, 1558, 1557, 33331, 32521, 14635]
  const formulas: [string, string][] = [
    ['mountPointCost', 'Coût d’un point pour une monture'],
    ['fecundityCostPerMount', 'Coût de fécondité par monture'],
    ['xpCostToLevel', 'Coût d’XP'],
    ['captureCostPerMount', 'Coût de capture'],
    ['expectedCostPerTargetBaby', 'Coût d’un bébé de la génération cible'],
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
              Taxe d’HDV retenue : {formatNumber(settings.saleTax * 100, 1)} % (recherche : {fees.hdvListingTaxPct} % à la mise en vente, +{fees.priceChangeFeePct} % par modification de prix, <ConfidenceBadge level="medium" />).
            </li>
            <li>
              Prix par défaut : {settings.useDefaultPrices ? 'utilisés quand vous n’avez rien saisi' : 'désactivés'} ; serveur : {settings.server || 'non renseigné'} ; niveau d’Éleveur : {settings.jobLevel}.
            </li>
            <li>
              Généton : {formatKamas(g.value)} ({g.origin === 'joueur' ? 'votre valeur' : g.basis}) — fourchette {formatKamas(g.range[0])} → {formatKamas(g.range[1])}.
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
            </tbody>
          </table>
        </div>
        <Callout tone="warn">
          Aucun coût au point n’est connu pour les jauges de fécondité (Foudroyeur, Abreuvoir, Dragofesse, Baffeur, Caresseur) : seul indice, ≈ 13 K/pt pour le Minuscule Extrait de Dragofesse (Herbe Folle). Saisissez les prix de
          vos carburants sur la page <a href={href('prix', { onglet: 'carburants' })}>Prix</a>.
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
  const settings = useSettings()
  const rules = useRules()
  const ctx = usePriceContext()
  const pMounts = usePrices((s) => s.mounts)
  const pGenerations = usePrices((s) => s.generations)
  const genetonOverride = usePrices((s) => s.genetonValue)
  const mctx = useMemo<MountPriceContext>(() => ({ mountOverrides: pMounts, generationOverrides: pGenerations, useDefaults: settings.useDefaultPrices }), [pMounts, pGenerations, settings.useDefaultPrices])
  const genetonValue = genetonKamasValue(genetonOverride).value
  const [tab, setTab] = useState<TabId>('cycle')

  const [params, setParams] = useState<Params>(() => {
    const unlocked = Math.max(1, PADDOCK_UNLOCK_LEVELS.filter((x) => x.level <= settings.jobLevel).length)
    const base: Params = {
      family: settings.family,
      mode: 'croisement',
      crossingKey: defaultCrossingKey(settings.family, settings.goalSpeciesId),
      parentA: null,
      parentB: null,
      pairs: 5 * unlocked,
      parentLevel: settings.parentTargetLevel,
      parentStartLevel: 1,
      tier: settings.preferredTier,
      xpTier: settings.preferredTier,
      batchSize: 10,
      paddocks: unlocked,
      optimakina: settings.useOptimakina,
      takeza: false,
      includeCapture: true,
      netKind: 'universel',
      mountsPerCast: DEFAULT_MOUNTS_PER_CAST.universel.value,
      saleTaxPct: Math.round(settings.saleTax * 1000) / 10,
      serenity: DEFAULT_SERENITY_POINTS,
      sterileFate: 'meilleur',
      sage: false,
      includeSteriles: true,
    }
    const merged = { ...base, ...loadStored() }
    // Paramètres mémorisés invalides (ancienne version, saisie corrompue) : retour aux valeurs par défaut.
    if (!FAMILY_IDS.includes(merged.family)) merged.family = base.family
    if (!TIERS.includes(merged.tier)) merged.tier = base.tier
    if (!TIERS.includes(merged.xpTier)) merged.xpTier = merged.tier
    if (!(merged.netKind in NET_KIND_LABELS)) merged.netKind = base.netKind
    for (const k of ['pairs', 'parentLevel', 'parentStartLevel', 'batchSize', 'paddocks', 'mountsPerCast', 'saleTaxPct', 'serenity'] as const)
      if (typeof merged[k] !== 'number' || !Number.isFinite(merged[k])) merged[k] = base[k]
    if (!crossingsOf(merged.family).some((c) => c.key === merged.crossingKey)) merged.crossingKey = defaultCrossingKey(merged.family, null)
    return merged
  })
  const set = (patch: Partial<Params>) =>
    setParams((p) => {
      const next = { ...p, ...patch }
      saveStored(next)
      return next
    })

  const parents = useMemo((): [number, number] | null => {
    if (params.mode === 'libre') return params.parentA !== null && params.parentB !== null ? [params.parentA, params.parentB] : null
    const c = crossingsOf(params.family).find((x) => x.key === params.crossingKey)
    return c ? [c.a, c.b] : null
  }, [params.mode, params.parentA, params.parentB, params.family, params.crossingKey])

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
        serenityPointsPerMount: params.serenity,
        sterileFate: params.sterileFate,
        sage: params.sage,
        ctx,
        mountPrices: mctx,
        rules,
        jobLevel: settings.jobLevel,
        genetonValue,
      },
    [parents, params, ctx, mctx, rules, settings.jobLevel, genetonValue],
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
      {tab === 'cycle' && <CycleTab p={params} set={set} cfg={cfg} result={result} error={error} run={run} />}
      {tab === 'classement' && (
        <RankingTab
          p={params}
          ctx={ctx}
          mctx={mctx}
          rules={rules}
          jobLevel={settings.jobLevel}
          genetonValue={genetonValue}
          onToggleSteriles={(v) => set({ includeSteriles: v })}
          onSimulate={(key) => {
            set({ mode: 'croisement', crossingKey: key })
            setTab('cycle')
          }}
        />
      )}
      {tab === 'inventaire' && <InventoryTab ctx={ctx} mctx={mctx} saleTax={params.saleTaxPct / 100} />}
      {tab === 'hypotheses' && <AssumptionsTab result={result} rules={rules} />}
    </div>
  )
}
