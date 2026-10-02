// Page « Prix » : prix HDV du serveur du profil ouvert (ressources clés, carburants, makinas, filets,
// ingrédients, montures) : prix saisis, prix du marché importés (export CSV de l'HDV, onglet « Marché
// HDV » : src/ui/MarketImport.tsx), lecture du marché pour l'élevage (onglet « Marché » :
// src/ui/MarketInsightsPanel.tsx), prix par défaut sourcés, saisie rapide, collage en masse et
// import/export. Tous les calculs de rentabilité lisent ces prix (usePrices + usePriceContext).
import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  FAMILIES,
  FAMILY_IDS,
  FUELS,
  INGREDIENTS,
  MAKINAS,
  NETS,
  PRICES_DEFAULT,
  defaultItemPrice,
  itemName,
  speciesOfFamily,
  type DefaultItemPrice,
  type DefaultMountPrice,
  type IngredientInfo,
} from '../../data'
import { GAUGE_EFFECTS, GAUGE_IDS, GAUGE_LABELS } from '../../domain/constants'
import {
  DEFAULT_MOUNTS_PER_CAST,
  DEFAULT_PRICE_ISSUE_LABELS,
  MOUNT_BANDS,
  MOUNT_PRICE_STALE_DAYS,
  NET_KIND_LABELS,
  REFERENCE_KIND_LABELS,
  buildPriceExport,
  defaultGenerationPrice,
  defaultPriceIssue,
  genetonKamasValue,
  mountSalePrice,
  normalizeName,
  parseBulkPrices,
  parseKamas,
  parsePriceExport,
  priceCoverage,
  type BulkPriceEntry,
  type BulkPriceError,
  type DefaultPriceIssue,
  type MountBand,
  type MountPriceContext,
} from '../../domain/economy'
import { FUEL_SIZE_LABELS, FUEL_TIERS, bestFuel, dustOption, fillPlan, fuelOption, fuelsOf } from '../../domain/fuel'
import { MOUNT_MARKET_NOTE, PRICE_STAT_LABELS, PRICE_STAT_SHORT, frenchDay, marketMountReference, type MarketSource } from '../../domain/market'
import { snapshotFreshness } from '../../domain/marketInsights'
import { craftCost, marketQuote, resolvePrice, type PriceContext, type ResolvedPrice } from '../../domain/pricing'
import type { FamilyId, FuelTier, GaugeId, MakinaKind } from '../../domain/types'
import { formatDate, formatKamas, formatNumber } from '../../lib/format'
import { useMarket, useMarketGeneton } from '../../store/market'
import { usePriceContext, usePrices } from '../../store/prices'
import { useActiveProfile, useActiveServer } from '../../store/profiles'
import { useRules, useSettings } from '../../store/settings'
import { Badge, Callout, Card, Empty, GaugeChip, NumberField, PageHeader, Progress, Tabs } from '../components'
import MarketImport from '../MarketImport'
import MarketInsightsPanel from '../MarketInsightsPanel'
import { href, useRoute } from '../router'
import { ConfidenceBadge, GenBadge } from '../species'
import { useServerDay } from '../useServerDay'
import './PricesPage.css'

type TabId = 'ressources' | 'carburants' | 'makinas' | 'filets' | 'ingredients' | 'montures' | 'marche' | 'hdv' | 'masse'

const ITEM_TABS: TabId[] = ['ressources', 'carburants', 'makinas', 'filets', 'ingredients']

const TAB_LABELS: Record<TabId, string> = {
  ressources: 'Ressources clés',
  carburants: 'Carburants',
  makinas: 'Makinas',
  filets: 'Filets',
  ingredients: 'Ingrédients',
  montures: 'Montures',
  marche: 'Marché',
  hdv: 'Marché HDV (CSV)',
  masse: 'Saisie en masse & fichiers',
}

const BAND_LABELS: Record<MountBand, string> = { '1': 'Niv. 1', '100': 'Niv. 100', '200': 'Niv. 200' }

const KIND_LABELS: Record<MakinaKind, string> = { animakina: 'Animakina', kromakina: 'Kromakina', optimakina: 'Optimakina' }

const PEPITE = 14635

const TIER_PLURALS: Record<FuelTier, string> = { 1: 'Extraits', 2: 'Philtres', 3: 'Potions', 4: 'Élixirs' }

// ---------- Listes d'objets ----------

interface ItemRef {
  id: number
  name: string
  detail?: ReactNode
}

const matches = (q: string, ...names: (string | null | undefined)[]) => !q || names.some((n) => n && normalizeName(n).includes(q))

function keyResourceGroups(): { title: string; hint: string; items: ItemRef[] }[] {
  const extraction: ItemRef[] = FAMILY_IDS.map((f) => ({
    id: FAMILIES[f].extractionItemId,
    name: FAMILIES[f].extractionItemName,
    detail: `Extraction des ${FAMILIES[f].plural} : 1 par génération (G1 = 0)`,
  }))
  const runes: ItemRef[] = PRICES_DEFAULT.items
    .filter((i) => i.category === 'rune' && i.id !== null)
    .map((i) => ({ id: i.id as number, name: i.name, detail: i.id === 1558 ? 'Brisage des Muldos' : i.id === 1557 ? 'Brisage des Volkornes' : 'Rune secondaire de brisage' }))
  const seen = new Set<number>()
  const mountRes: ItemRef[] = []
  for (const i of INGREDIENTS.filter((x) => x.isMountResource)) {
    seen.add(i.id)
    mountRes.push({ id: i.id, name: i.name, detail: 'Droppée par les montures sauvages (makinas, filets)' })
  }
  for (const p of PRICES_DEFAULT.items.filter((x) => x.category === 'ressource-capture' && x.id !== null && !seen.has(x.id as number)))
    mountRes.push({ id: p.id as number, name: p.name, detail: 'Droppée par les montures sauvages' })
  return [
    { title: "Ressources d'extraction", hint: 'Valeur des stériles extraites (génération × prix).', items: extraction },
    { title: 'Ressources de montures sauvages', hint: 'Ingrédients des makinas et filets, revendables.', items: mountRes.sort((a, b) => a.name.localeCompare(b.name, 'fr')) },
    { title: 'Runes de brisage', hint: 'Le prix de la rune Ga met à l’échelle la valeur de brisage des montures.', items: runes },
    { title: 'Autres', hint: '', items: [{ id: PEPITE, name: itemName(PEPITE), detail: '×10 dans chaque makina (recyclage)' }] },
  ]
}

function ingredientSource(i: IngredientInfo): string {
  const s = i.source
  if (!s) return '—'
  if (s.kind === 'harvest') return s.job ? `Récolte : ${s.job} niv. ${s.jobLevel ?? '?'}` : s.details
  if (s.kind === 'drop') {
    const top = [...s.monsters].sort((a, b) => b.dropPct - a.dropPct).slice(0, 2)
    const txt = top.map((m) => `${m.name} (${formatNumber(m.dropPct, 2)} %)`).join(', ')
    return `Drop : ${txt || s.details}${s.monsters.length > 2 ? ` +${s.monsters.length - 2}` : ''}${s.requiresHunterJobLevel ? ` · Chasseur ≥ ${s.requiresHunterJobLevel}` : ''}`
  }
  return s.details
}

// ---------- Cellules ----------

function PriceInput({ value, placeholder, label, onCommit }: { value: number | undefined; placeholder?: string; label: string; onCommit: (v: number | null) => void }) {
  return <PriceInputInner key={value === undefined ? 'vide' : String(value)} value={value} placeholder={placeholder} label={label} onCommit={onCommit} />
}

function PriceInputInner({ value, placeholder, label, onCommit }: { value: number | undefined; placeholder?: string; label: string; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const [invalid, setInvalid] = useState(false)
  const commit = () => {
    const t = text.trim()
    if (t === '') {
      setInvalid(false)
      if (value !== undefined) onCommit(null)
      return
    }
    const v = parseKamas(t)
    if (v === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (v !== value) onCommit(v)
    else setText(String(v))
  }
  return (
    <span className="price-input">
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid}
        title={invalid ? 'Montant illisible (ex. 12000, 12k, 1,5M)' : 'Votre prix HDV (Entrée pour valider, vide pour effacer)'}
        className={invalid ? 'invalid' : value !== undefined ? 'set' : ''}
        value={text}
        placeholder={placeholder ?? 'à saisir'}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setText(value === undefined ? '' : String(value))
            setInvalid(false)
          }
        }}
      />
      {value !== undefined && (
        <button className="btn ghost small" aria-label={`Effacer votre prix : ${label}`} title="Effacer votre prix" onClick={() => onCommit(null)}>
          ✕
        </button>
      )}
    </span>
  )
}

const isMountRow = (d: DefaultItemPrice | DefaultMountPrice): d is DefaultMountPrice => 'state' in d && 'generation' in d

/** Lignes de montures non utilisées pour les décisions tant que le joueur ne les confirme pas. */
const CONFIRMABLE: DefaultPriceIssue[] = ['ancien', 'peu-fiable', 'a-verifier']

function DefaultCell({ d, onConfirm }: { d?: DefaultItemPrice | DefaultMountPrice | null; onConfirm?: (price: number) => void }) {
  if (!d || d.price === null) return <span className="muted">—</span>
  const issue = isMountRow(d) ? defaultPriceIssue(d) : null
  const tip = [
    d.source && `Source : ${d.source}`,
    d.notes,
    d.range && `Fourchette : ${formatKamas(d.range[0])} → ${formatKamas(d.range[1])}`,
    d.date && `Date : ${d.date}`,
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span className="default-cell" title={tip}>
      <span>{formatKamas(d.price)}</span>
      {issue ? (
        <Badge tone="warn" title={`${DEFAULT_PRICE_ISSUE_LABELS[issue]} : affiché pour information, non compté dans les calculs${CONFIRMABLE.includes(issue) ? ' tant que vous ne le confirmez pas' : ''}.`}>
          {issue === 'plancher' ? 'plancher' : DEFAULT_PRICE_ISSUE_LABELS[issue]} · non compté
        </Badge>
      ) : d.priceType === 'floor-estimate' ? (
        <Badge tone="warn" title="Plancher calculé (extraction, brisage, revente de base), pas un cours">
          plancher
        </Badge>
      ) : d.priceType === 'estimate' ? (
        <Badge tone="warn" title="Estimation sans relevé">
          estimation
        </Badge>
      ) : (
        <ConfidenceBadge level={d.confidence} />
      )}
      {d.date && <small className="muted">{d.date}</small>}
      {issue && CONFIRMABLE.includes(issue) && onConfirm && (
        <button className="btn ghost small" title="Utiliser ce relevé comme votre prix (vous le confirmez pour votre serveur)" onClick={() => onConfirm(d.price as number)}>
          Confirmer
        </button>
      )}
    </span>
  )
}

/** « 02/10 » d'une date AAAA-MM-JJ. */
const shortDay = (iso: string) => frenchDay(iso).slice(0, 5)

function marketTitle(r: NonNullable<ResolvedPrice['market']>): string {
  return `Prix du marché importé (export HDV${r.serverName ? ` de ${r.serverName}` : ''} du ${frenchDay(r.exportDate)}, ${PRICE_STAT_SHORT[r.stat]}) : ${formatNumber(r.sold24)} vendus en 24 h, ${formatNumber(r.sold30)} en 30 jours (≈ ${formatNumber(r.perDayAvg, 1)}/jour).`
}

function EffectiveCell({ r }: { r: ResolvedPrice }) {
  if (r.origin === 'marche' && r.market)
    return (
      <span className="effective-cell">
        {formatKamas(r.price)}
        <Badge tone="info" title={marketTitle(r.market)}>
          marché ({shortDay(r.market.exportDate)})
        </Badge>
        <small className="muted" title={marketTitle(r.market)}>
          {formatNumber(r.market.sold24)} vendus/24 h
        </small>
        {r.craftLocked !== undefined && <small className="muted">craft niv. {r.craftLocked} requis : prix HDV retenu</small>}
      </span>
    )
  if (r.origin === 'joueur')
    return (
      <span className="effective-cell">
        <strong>{formatKamas(r.price)}</strong>
        <Badge tone="accent">votre prix</Badge>
      </span>
    )
  if (r.origin === 'defaut')
    return (
      <span className="effective-cell">
        {formatKamas(r.price)}
        <Badge tone="info">défaut</Badge>
        {r.conflict && (
          <Badge tone="warn" title={r.conflict.message}>
            à vérifier
          </Badge>
        )}
        {r.conflict && <small className="conflict">{r.conflict.message}</small>}
        {r.craftLocked !== undefined && <small className="muted">craft niv. {r.craftLocked} requis : prix HDV retenu</small>}
      </span>
    )
  if (r.origin === 'craft')
    return r.complete ? (
      <span className="effective-cell">
        {formatKamas(r.price)}
        {r.craftLocked !== undefined ? (
          <Badge tone="warn" title={`Vous ne pouvez pas le fabriquer (niveau ${r.craftLocked} d'Éleveur requis) : coût des ingrédients = estimation du prix HDV. Saisissez son prix HDV.`}>
            craft · niv. {r.craftLocked} requis
          </Badge>
        ) : (
          <Badge tone="ok" title="Somme des prix des ingrédients">
            craft
          </Badge>
        )}
      </span>
    ) : (
      <span className="effective-cell" title={`Ingrédients sans prix : ${r.missing.map(itemName).join(', ')}`}>
        {r.price ? `≥ ${formatKamas(r.price)}` : ''}
        <Badge tone="warn">coût incomplet</Badge>
      </span>
    )
  return <Badge tone="danger">à saisir</Badge>
}

/** Prix du marché importé d'un objet (même s'il n'est pas retenu : prix saisi plus bas, craft moins cher). */
function MarketCell({ id, market }: { id: number; market: MarketSource }) {
  const q = marketQuote(id, market)
  if (!q) return <span className="muted">{market.rows[String(id)] ? 'sans vente' : '—'}</span>
  return (
    <span className="default-cell" title={marketTitle(q.info)}>
      <span>{formatKamas(q.price)}</span>
      <small className="muted">{formatNumber(q.info.sold24)}/24 h</small>
    </span>
  )
}

function CraftCell({ id, ctx }: { id: number; ctx: PriceContext }) {
  const c = craftCost(id, ctx)
  if (!c) return <span className="muted">—</span>
  if (c.complete) return <span>{formatKamas(c.total)}</span>
  return (
    <span className="effective-cell" title={`Ingrédients sans prix : ${c.missing.map(itemName).join(', ')}`}>
      {c.total > 0 && <span className="muted">≥ {formatKamas(c.total)}</span>}
      <Badge tone="warn">{c.missing.length} ingr. sans prix</Badge>
    </span>
  )
}

interface Column<T> {
  header: ReactNode
  cell: (row: T) => ReactNode
  num?: boolean
}

/** Tableau générique : colonnes propres + défaut, votre prix et prix retenu. */
function ItemPriceTable<T extends ItemRef>({ rows, before = [], after = [], ctx, groupBy, empty }: { rows: T[]; before?: Column<T>[]; after?: Column<T>[]; ctx: PriceContext; groupBy?: (row: T) => string; empty?: ReactNode }) {
  const items = usePrices((s) => s.items)
  const setItem = usePrices((s) => s.setItem)
  if (!rows.length) return <Empty>{empty ?? 'Aucun objet ne correspond.'}</Empty>
  const market = ctx.market ?? null
  const ncols = 4 + before.length + after.length + (market ? 1 : 0)
  // En-tête de groupe : calculé avant le rendu (pas de variable modifiée pendant le rendu).
  const groups = rows.map((row) => groupBy?.(row) ?? null)
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Objet</th>
            {before.map((c, i) => (
              <th key={i} className={c.num ? 'num' : undefined}>
                {c.header}
              </th>
            ))}
            {market && <th title={`Export HDV du ${frenchDay(market.exportDate)} (${PRICE_STAT_LABELS[market.stat]})`}>Marché HDV ({shortDay(market.exportDate)})</th>}
            <th>Prix par défaut</th>
            <th>Votre prix HDV</th>
            <th>Prix retenu</th>
            {after.map((c, i) => (
              <th key={i} className={c.num ? 'num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const group = groups[i]
            const header = group !== null && group !== (i > 0 ? groups[i - 1] : null)
            const own = items[String(row.id)]
            const d = defaultItemPrice(row.id)
            const quote = market ? marketQuote(row.id, market) : null
            return (
              <FragmentRows key={row.id} header={header ? group : null} ncols={ncols}>
                <tr>
                  <td>
                    <span className="item-name">
                      <span>{row.name}</span>
                      {row.detail && <small className="muted">{row.detail}</small>}
                    </span>
                  </td>
                  {before.map((c, i) => (
                    <td key={i} className={c.num ? 'num' : undefined}>
                      {c.cell(row)}
                    </td>
                  ))}
                  {market && (
                    <td>
                      <MarketCell id={row.id} market={market} />
                    </td>
                  )}
                  <td>
                    <DefaultCell d={d} />
                  </td>
                  <td>
                    <PriceInput value={own} label={row.name} placeholder={quote ? formatNumber(quote.price) : d?.price ? formatNumber(d.price) : undefined} onCommit={(v) => setItem(row.id, v)} />
                  </td>
                  <td>
                    <EffectiveCell r={resolvePrice(row.id, ctx)} />
                  </td>
                  {after.map((c, i) => (
                    <td key={i} className={c.num ? 'num' : undefined}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              </FragmentRows>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FragmentRows({ header, ncols, children }: { header: string | null; ncols: number; children: ReactNode }) {
  return (
    <>
      {header && (
        <tr className="tier-row">
          <td colSpan={ncols}>{header}</td>
        </tr>
      )}
      {children}
    </>
  )
}

// ---------- Onglets ----------

function KeyResourcesTab({ q, ctx }: { q: string; ctx: PriceContext }) {
  const groups = useMemo(() => keyResourceGroups(), [])
  const genetonOverride = usePrices((s) => s.genetonValue)
  const setGenetonValue = usePrices((s) => s.setGenetonValue)
  const rules = useRules()
  const saleTax = useSettings((s) => s.saleTax)
  const marketGeneton = useMarketGeneton(saleTax)
  const g = genetonKamasValue(genetonOverride, { market: ctx.market, saleTax })
  const dust = PRICES_DEFAULT.poussiere
  const showGeneton = matches(q, 'généton', 'geneton', 'génétons')
  const showDust = matches(q, 'poussière', "poussière d'élevage", 'adèle vage')
  if (q && !showGeneton && !showDust && !groups.some((grp) => grp.items.some((r) => matches(q, r.name))))
    return (
      <Card>
        <Empty>Aucune ressource clé ne correspond à « {q} ». Regardez les autres onglets (le nombre de résultats est indiqué à côté de chaque onglet).</Empty>
      </Card>
    )
  return (
    <div className="stack">
      {groups.map((grp) => {
        const rows = grp.items.filter((r) => matches(q, r.name))
        if (!rows.length) return null
        return (
          <Card key={grp.title} title={grp.title} actions={grp.hint ? <small className="muted">{grp.hint}</small> : undefined}>
            <ItemPriceTable rows={rows} ctx={ctx} />
          </Card>
        )
      })}
      <div className="grid grid-2">
        {showGeneton && (
          <Card title="Valeur d’un généton">
            <p className="muted">
              Les génétons s’échangent chez Eugène Éton [−18,1] contre des parchemins revendables. Défaut : <strong>{formatKamas(PRICES_DEFAULT.genetons.kamasPerGeneton)}</strong> ({PRICES_DEFAULT.genetons.basis}) —
              fourchette {formatKamas(g.range[0])} → {formatKamas(g.range[1])}. <ConfidenceBadge level={PRICES_DEFAULT.genetons.confidence} />
            </p>
            <div className="row">
              <label className="field">
                Votre valeur (kamas par généton, brute : prix du parchemin ÷ génétons)
                <PriceInput value={genetonOverride ?? undefined} label="Valeur d’un généton" placeholder={String(PRICES_DEFAULT.genetons.kamasPerGeneton)} onCommit={(v) => setGenetonValue(v)} />
              </label>
              <span className="effective-cell">
                Retenu : <strong>{formatKamas(g.value)}</strong>{' '}
                <Badge tone={g.origin === 'joueur' ? 'accent' : 'info'} title={g.basis}>
                  {g.origin === 'joueur' ? 'votre valeur' : g.origin === 'marche' ? 'marché du serveur' : 'défaut'}
                </Badge>
              </span>
            </div>
            {marketGeneton && (
              <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                <span className="effective-cell">
                  Marché du serveur : <strong>{formatKamas(marketGeneton.value)}</strong> par généton
                  <Badge tone="info" title={marketGeneton.lines.slice(0, 6).map((l) => `${l.name} : ${l.price === null ? 'sans prix' : `${formatKamas(l.price)} ÷ ${l.cost} = ${formatNumber(l.perGeneton ?? 0)} K`}`).join('\n')}>
                    marché
                  </Badge>
                  {genetonOverride !== null && genetonOverride !== Math.round(marketGeneton.value) && (
                    <button className="btn small" type="button" onClick={() => setGenetonValue(null)} title="Sans valeur saisie, les calculs suivent le marché du serveur">
                      Effacer votre valeur et suivre le marché
                    </button>
                  )}
                </span>
                <small className="muted">
                  Meilleur échange : {marketGeneton.best.name} ({formatKamas(marketGeneton.best.price)} ÷ {marketGeneton.best.cost} génétons, {formatNumber(marketGeneton.best.sold24)} vendus/24 h) ; net de taxe ≈{' '}
                  {formatKamas(marketGeneton.net)}.
                </small>
              </div>
            )}
            <small className="muted">
              Comptée nette de la taxe d’HDV (le parchemin est revendu). Liés au compte selon le guide DPLN (échangeables selon DofusDB, à vérifier). {rules.id === '3.7' ? 'En 3.7, les génétons par parent doublent : le prix des parchemins pourrait baisser.' : ''}
            </small>
          </Card>
        )}
        {showDust && (
          <Card title="Poussière d’élevage (héritage)">
            <Callout tone="warn">
              Non échangeable et <strong>sans nouvelle source depuis la 3.5</strong> : utile seulement si vous avez un stock d’avant la 3.5.
            </Callout>
            <p className="muted">
              Adèle Vage [−18,1] vend les Gigantesques contre de la poussière. Valeur estimée d’une poussière (coût évité) : ≈ {formatKamas(dust.kamasPerPoussiere)} ({formatKamas(dust.range[0])} → {formatKamas(dust.range[1])}),{' '}
              <ConfidenceBadge level={dust.confidence} />.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Gigantesque</th>
                    <th className="num">Poussière</th>
                    <th className="num">Points / poussière</th>
                    <th className="num">≈ K / point</th>
                  </tr>
                </thead>
                <tbody>
                  {FUEL_TIERS.map((t) => {
                    const o = dustOption('mangeoire', t, rules)
                    if (!o) return null
                    return (
                      <tr key={t}>
                        <td>{o.fuel.name.replace(' de Mangeoire', '')}</td>
                        <td className="num">{formatNumber(o.dustCost)}</td>
                        <td className="num">{formatNumber(o.pointsPerDust, 2)}</td>
                        <td className="num">{formatNumber(o.costPerPointEquivalent, 2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {rules.id === '3.7' && <small className="muted">Prix d’Adèle Vage en 3.7 inconnus.</small>}
          </Card>
        )}
      </div>
    </div>
  )
}

function FillPlanCard({ gauge, ctx }: { gauge: GaugeId; ctx: PriceContext }) {
  const rules = useRules()
  const jobLevel = useSettings((s) => s.jobLevel)
  const preferredTier = useSettings((s) => s.preferredTier)
  const max = rules.gaugeTierMax[4]
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState<number>(rules.gaugeTierMax[preferredTier])
  const plan = fillPlan(gauge, from, to, ctx, { jobLevel, rules })
  return (
    <div className="stack" style={{ marginBottom: 14 }}>
      <h3 style={{ margin: 0 }}>Plan de remplissage : {GAUGE_LABELS[gauge]}</h3>
      <div className="filters">
        <NumberField label="Jauge actuelle" value={from} min={0} max={max} step={1000} onChange={setFrom} />
        <NumberField label="Objectif" value={to} min={0} max={max} step={1000} onChange={setTo} />
        <span className="muted">
          Le moins cher en respectant les plafonds de palier ; les objets chiffrés passent d’abord, puis le moins de gaspillage.
        </span>
      </div>
      {plan.steps.length === 0 ? (
        <small className="muted">La jauge est déjà à l’objectif.</small>
      ) : (
        <>
          <ol className="steps">
            {plan.steps.map((st, i) => (
              <li key={i}>
                Déposer <strong>{st.count} × {st.option.fuel.name}</strong> : {formatNumber(st.from)} → {formatNumber(st.to)}
                {st.wasted > 0 && <span className="muted"> ({formatNumber(st.wasted)} points perdus au plafond)</span>}
                {' · '}
                {st.option.complete && st.option.unitPrice !== null ? (
                  formatKamas(st.option.unitPrice * st.count)
                ) : (
                  <Badge tone="warn">prix à saisir</Badge>
                )}
              </li>
            ))}
          </ol>
          <small className="muted">
            {plan.count} objet{plan.count > 1 ? 's' : ''} · coût {plan.cost === null ? 'inconnu' : `${plan.complete ? '' : '≥ '}${formatKamas(plan.cost)}`}
            {plan.waste > 0 ? ` · ${formatNumber(plan.waste)} points perdus` : ' · aucun point perdu'}
            {plan.overshoot > 0 ? ` · ${formatNumber(plan.overshoot)} points au-delà de l’objectif (gardés dans la jauge)` : ''}. L’excédent au-delà d’un plafond est supposé perdu (confiance moyenne).
          </small>
        </>
      )}
    </div>
  )
}

function FuelsTab({ q, ctx }: { q: string; ctx: PriceContext }) {
  const rules = useRules()
  const jobLevel = useSettings((s) => s.jobLevel)
  const [gauge, setGauge] = useState<GaugeId>('foudroyeur')
  const opts = { jobLevel, rules }
  const rows = q ? FUELS.filter((f) => matches(q, f.name)) : fuelsOf(gauge)
  const fuelRows = rows.map((f) => ({ id: f.id, name: f.name, fuel: f, opt: fuelOption(f, ctx, opts) }))
  const best = FUEL_TIERS.map((t) => bestFuel(gauge, t, ctx, opts))
  return (
    <Card>
      {!q && (
        <>
          <div className="gauge-select" role="group" aria-label="Jauge">
            {GAUGE_IDS.map((g) => (
              <button key={g} aria-pressed={g === gauge} onClick={() => setGauge(g)} title={GAUGE_EFFECTS[g]}>
                <GaugeChip gauge={g} />
              </button>
            ))}
          </div>
          <p className="muted">
            {GAUGE_EFFECTS[gauge]}. Un carburant ne se dépose que sous le plafond de son palier ({FUEL_TIERS.map((t) => formatNumber(rules.gaugeTierMax[t])).join(' / ')}) ; le coût au point ne dépend que du prix et de la
            durabilité{rules.fuelDurabilityFactor !== 1 ? ` (×${rules.fuelDurabilityFactor} en ${rules.id})` : ''}.
          </p>
          <div className="best-tiles">
            {best.map((b) => (
              <div className="stat" key={b.tier}>
                <div className="label">
                  Palier {b.tier} — meilleur coût au point
                </div>
                <div className="value">{b.value === null ? '—' : `${b.bound === 'min' ? '≥ ' : b.bound === 'max' ? '≤ ' : ''}${formatNumber(b.value, 2)} K`}</div>
                <small className="muted">
                  {b.estimated ? 'Estimation de la recherche (Mangeoire)' : b.fuel ? b.fuel.fuel.name : '—'}{' '}
                  {b.complete ? <Badge tone="ok">complet</Badge> : <Badge tone="warn">incomplet</Badge>}
                </small>
              </div>
            ))}
          </div>
          <FillPlanCard gauge={gauge} ctx={ctx} />
        </>
      )}
      <ItemPriceTable
        rows={fuelRows}
        ctx={ctx}
        groupBy={q ? undefined : (r) => `Palier ${r.fuel.tier} — ${TIER_PLURALS[r.fuel.tier]} (plafond ${formatNumber(rules.gaugeTierMax[r.fuel.tier])})`}
        before={[
          { header: 'Niv.', num: true, cell: (r) => <span title={r.opt.canCraft ? 'Vous pouvez le fabriquer' : `Niveau d’Éleveur ${r.fuel.level} requis pour le fabriquer (l’achat à l’HDV ne demande aucun niveau)`}>{r.fuel.level}{r.opt.canCraft ? ' ✓' : ''}</span> },
          { header: 'Points', num: true, cell: (r) => formatNumber(r.opt.durability) },
          { header: 'Coût de craft', cell: (r) => <CraftCell id={r.id} ctx={ctx} /> },
        ]}
        after={[
          {
            header: 'K / point',
            num: true,
            cell: (r) => (r.opt.costPerPoint === null ? '—' : r.opt.complete ? formatNumber(r.opt.costPerPoint, 3) : <span className="muted">≥ {formatNumber(r.opt.costPerPoint, 3)}</span>),
          },
        ]}
      />
      <small className="muted">
        Tailles : {Object.values(FUEL_SIZE_LABELS).join(', ')}. Prix retenu = votre prix, sinon le moins cher entre le défaut et le coût de craft complet. Un coût de craft incomplet n’est jamais compté comme 0.
      </small>
    </Card>
  )
}

function MakinasTab({ q, ctx }: { q: string; ctx: PriceContext }) {
  const rules = useRules()
  const defaultFamily = useSettings((s) => s.family)
  const [family, setFamily] = useState<FamilyId>(defaultFamily)
  const [kind, setKind] = useState<MakinaKind | 'toutes'>('optimakina')
  const rows = MAKINAS.filter((m) => (q ? matches(q, m.name) : m.family === family && (kind === 'toutes' || m.kind === kind)))
    .sort((a, b) => a.family.localeCompare(b.family) || a.kind.localeCompare(b.kind) || a.generation - b.generation)
    .map((m) => ({ id: m.id, name: m.name, m }))
  return (
    <Card>
      {!q && (
        <div className="filters">
          <label className="field">
            Famille
            <select value={family} onChange={(e) => setFamily(e.target.value as FamilyId)}>
              {FAMILY_IDS.map((f) => (
                <option key={f} value={f}>
                  {FAMILIES[f].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Type
            <select value={kind} onChange={(e) => setKind(e.target.value as MakinaKind | 'toutes')}>
              <option value="toutes">Toutes</option>
              {(Object.keys(KIND_LABELS) as MakinaKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <Callout>
        Aucun prix HDV de makina n’a été relevé (0/81). Le coût de craft = 1 ressource de boss + 10 Pépites + ressources de monture ; saisissez le prix de la makina ou de ses ingrédients.
        {rules.id === '3.7' && ' En 3.7, 74 recettes sur 81 changent : le calcul de rentabilité utilise la recette bêta.'}
      </Callout>
      <ItemPriceTable
        rows={rows}
        ctx={ctx}
        before={[
          { header: 'Gén.', cell: (r) => <GenBadge generation={r.m.generation} /> },
          { header: 'Niv.', num: true, cell: (r) => r.m.level },
          {
            header: 'Ingrédients',
            cell: (r) => (
              <small className="muted">
                {r.m.ingredients.map((i) => `${i.qty}× ${itemName(i.id)}`).join(', ')}
              </small>
            ),
          },
          { header: 'Coût de craft', cell: (r) => <CraftCell id={r.id} ctx={ctx} /> },
        ]}
      />
    </Card>
  )
}

function NetsTab({ q, ctx }: { q: string; ctx: PriceContext }) {
  const jobLevel = useSettings((s) => s.jobLevel)
  const rows = NETS.filter((n) => matches(q, n.name)).map((n) => ({ id: n.id, name: n.name, n }))
  return (
    <Card>
      <p className="muted">Le filet donne le sort « Apprivoisement de monture » (1 PA, une fois par combat) ; il est consommé au lancer. L’équiper demande le niveau d’Éleveur du filet.</p>
      <ItemPriceTable
        rows={rows}
        ctx={ctx}
        before={[
          { header: 'Niv. requis', num: true, cell: (r) => <span title={jobLevel >= r.n.level ? 'Vous pouvez l’équiper' : 'Niveau d’Éleveur insuffisant'}>{r.n.level}{jobLevel >= r.n.level ? ' ✓' : ''}</span> },
          { header: 'Montures / lancer', num: true, cell: (r) => <span title={DEFAULT_MOUNTS_PER_CAST[r.n.kind].note}>{DEFAULT_MOUNTS_PER_CAST[r.n.kind].value}</span> },
          { header: 'Coût de craft', cell: (r) => <CraftCell id={r.id} ctx={ctx} /> },
        ]}
        after={[
          {
            header: 'K / monture',
            num: true,
            cell: (r) => {
              const p = resolvePrice(r.id, ctx)
              return p.price !== null && p.complete ? formatKamas(p.price / DEFAULT_MOUNTS_PER_CAST[r.n.kind].value) : '—'
            },
          },
        ]}
      />
      <small className="muted">
        {Object.values(NET_KIND_LABELS).join(' · ')}. Montures par lancer : renforcé ≈ 6 (relevé Volkornes), multiplicateur renforcé = estimation.
      </small>
    </Card>
  )
}

function IngredientsTab({ q, ctx }: { q: string; ctx: PriceContext }) {
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [kind, setKind] = useState<'tous' | 'drop' | 'harvest'>('tous')
  const [limit, setLimit] = useState(60)
  const all = useMemo(
    () =>
      INGREDIENTS.filter((i) => matches(q, i.name, i.typeName) && (kind === 'tous' || i.source?.kind === kind) && (!onlyMissing || resolvePrice(i.id, ctx).price === null)).sort(
        (a, b) => b.usedIn - a.usedIn || a.name.localeCompare(b.name, 'fr'),
      ),
    [q, kind, onlyMissing, ctx],
  )
  const rows = all.slice(0, limit).map((i) => ({ id: i.id, name: i.name, i, detail: i.typeName ?? undefined }))
  return (
    <Card>
      <div className="filters">
        <label className="field">
          Provenance
          <select value={kind} onChange={(e) => setKind(e.target.value as 'tous' | 'drop' | 'harvest')}>
            <option value="tous">Toutes</option>
            <option value="harvest">Récolte</option>
            <option value="drop">Drop de monstres</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          Seulement sans prix
        </label>
        <span className="muted">
          {all.length} ingrédient{all.length > 1 ? 's' : ''} (triés par nombre de recettes)
        </span>
      </div>
      <ItemPriceTable
        rows={rows}
        ctx={ctx}
        before={[
          { header: 'Niv.', num: true, cell: (r) => r.i.level },
          { header: 'Provenance', cell: (r) => <small title={r.i.source?.details}>{ingredientSource(r.i)}{r.i.source?.bossOnly ? ' · boss' : ''}</small> },
          { header: 'Recettes', num: true, cell: (r) => r.i.usedIn },
        ]}
      />
      {all.length > limit && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
          <button className="btn" onClick={() => setLimit((l) => l + 100)}>
            Afficher 100 de plus ({all.length - limit} restants)
          </button>
        </div>
      )}
    </Card>
  )
}

function MountsTab({ q, mctx, market }: { q: string; mctx: MountPriceContext; market: MarketSource | null }) {
  const defaultFamily = useSettings((s) => s.family)
  const [family, setFamily] = useState<FamilyId>(defaultFamily)
  const [gen, setGen] = useState<number | 'toutes'>('toutes')
  const generations = usePrices((s) => s.generations)
  const mounts = usePrices((s) => s.mounts)
  const setGeneration = usePrices((s) => s.setGeneration)
  const setMount = usePrices((s) => s.setMount)
  const species = speciesOfFamily(family, { breedableOnly: true })
  const gens = [...new Set(species.map((s) => s.generation))].sort((a, b) => a - b)
  const list = species.filter((s) => (gen === 'toutes' || s.generation === gen) && matches(q, s.name)).sort((a, b) => a.generation - b.generation || a.name.localeCompare(b.name, 'fr'))
  return (
    <div className="stack">
      <Card title="Prix des montures">
        <div className="filters">
          <label className="field">
            Famille
            <select value={family} onChange={(e) => setFamily(e.target.value as FamilyId)}>
              {FAMILY_IDS.map((f) => (
                <option key={f} value={f}>
                  {FAMILIES[f].label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {market && (
          <Callout>
            <strong>HDV du serveur (export du {frenchDay(market.exportDate)})</strong> : la dernière colonne de « Par couleur » donne le prix de
            l’objet-monture à l’HDV. {MOUNT_MARKET_NOTE} Pour vos décisions, saisissez le prix d’une monture du niveau et de l’état voulus.
          </Callout>
        )}
        <Callout tone="warn">
          Presque aucun prix de monture n’a été relevé. Seuls vos prix et les relevés fiables (observés, confiance au moins moyenne, de moins de {MOUNT_PRICE_STALE_DAYS} jours avant le dernier relevé) entrent dans les calculs :
          les <strong>planchers calculés</strong> (extraction, brisage, revente de base), les relevés anciens ou peu fiables sont affichés pour information, « non comptés » tant que vous ne les confirmez pas. Saisissez les prix de
          l’HDV des créatures de votre serveur.
        </Callout>
        <p className="muted">
          Entre deux niveaux renseignés (1, 100, 200), le prix est interpolé ; au-dessus du dernier, son prix s’applique (estimation prudente) ; en dessous du premier, aucun prix n’est appliqué : renseignez au moins le niveau 1.
        </p>
      </Card>
      {!q && (
        <Card title="Par génération" actions={<small className="muted">S’applique à toutes les couleurs de la génération sans prix propre.</small>}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Génération</th>
                  {MOUNT_BANDS.map((b) => (
                    <th key={b}>{BAND_LABELS[b]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gens.map((g) => (
                  <tr key={g}>
                    <td>
                      <GenBadge generation={g} /> <small className="muted">{species.filter((s) => s.generation === g).length} couleurs</small>
                    </td>
                    {MOUNT_BANDS.map((b) => {
                      const key = `${family}|${g}|${b}`
                      const d = defaultGenerationPrice(family, g, b)
                      return (
                        <td key={b}>
                          <div className="mount-cell">
                            <PriceInput value={generations[key]} label={`${FAMILIES[family].label} G${g} ${BAND_LABELS[b]}`} placeholder={d?.price ? formatNumber(d.price) : undefined} onCommit={(v) => setGeneration(family, g, b, v)} />
                            <small>
                              Défaut : <DefaultCell d={d} onConfirm={generations[key] === undefined ? (price) => setGeneration(family, g, b, price) : undefined} />
                            </small>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card
        title="Par couleur"
        actions={
          <label className="field">
            Génération
            <select value={String(gen)} onChange={(e) => setGen(e.target.value === 'toutes' ? 'toutes' : Number(e.target.value))}>
              <option value="toutes">Toutes</option>
              {gens.map((g) => (
                <option key={g} value={g}>
                  G{g}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {list.length === 0 ? (
          <Empty>Aucune monture ne correspond.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Monture</th>
                  {MOUNT_BANDS.map((b) => (
                    <th key={b}>{BAND_LABELS[b]}</th>
                  ))}
                  {market && <th title={MOUNT_MARKET_NOTE}>HDV du serveur ({shortDay(market.exportDate)})</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <GenBadge generation={s.generation} />
                        {s.name}
                      </span>
                    </td>
                    {MOUNT_BANDS.map((b) => {
                      const eff = mountSalePrice(s.id, Number(b), mctx)
                      // Prix de l'HDV seul (mixte) : plafond de vente, jamais compté seul → « à saisir » (colonne HDV à droite).
                      const marketOnly = eff.origin === 'marche' && !eff.cappedFrom
                      const counted = marketOnly ? null : eff.price
                      const ref = counted === null ? eff.references.find((r) => r.level === Number(b)) ?? eff.references[0] : undefined
                      return (
                        <td key={b}>
                          <div className="mount-cell">
                            <PriceInput value={mounts[`${s.id}|${b}`]} label={`${s.name} ${BAND_LABELS[b]}`} placeholder={counted !== null ? formatNumber(counted) : undefined} onCommit={(v) => setMount(s.id, b, v)} />
                            <small className="muted">
                              {counted === null ? (
                                <>
                                  <Badge tone="danger">à saisir</Badge>
                                  {ref && (
                                    <span title={ref.reason}>
                                      {' '}
                                      réf. ≈ {formatKamas(ref.price)} ({ref.kind === 'niveau-superieur' ? `niv. ${ref.level} seulement` : REFERENCE_KIND_LABELS[ref.kind]}, non comptée)
                                    </span>
                                  )}
                                  {ref && CONFIRMABLE.includes(ref.kind as DefaultPriceIssue) && (
                                    <button
                                      className="btn ghost small"
                                      title="Utiliser ce relevé comme votre prix (vous le confirmez pour votre serveur)"
                                      onClick={() => (ref.origin === 'defaut-espece' ? setMount(s.id, b, ref.price) : setGeneration(family, s.generation, b, ref.price))}
                                    >
                                      Confirmer
                                    </button>
                                  )}
                                </>
                              ) : eff.origin === 'marche' && eff.cappedFrom ? (
                                <span title={eff.note}>
                                  {formatKamas(eff.price)} · défaut {formatKamas(eff.cappedFrom.price)} plafonné par l’HDV
                                </span>
                              ) : eff.origin === 'joueur-espece' ? (
                                'votre prix'
                              ) : (
                                <>
                                  {formatKamas(eff.price)} · {eff.origin === 'joueur-generation' ? 'votre prix (génération)' : eff.origin === 'defaut-espece' ? 'relevé (couleur)' : 'relevé (génération)'}
                                </>
                              )}
                            </small>
                          </div>
                        </td>
                      )
                    })}
                    {market && <MountMarketCell speciesId={s.id} market={market} />}
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

/** Prix de l'objet-monture à l'HDV du serveur : indication seulement (« HDV mixte »), jamais compté d'office. */
function MountMarketCell({ speciesId, market }: { speciesId: number; market: MarketSource }) {
  const ref = marketMountReference(market, speciesId)
  if (!ref || ref.price === null)
    return (
      <td>
        <small className="muted">{ref?.depth ? 'sans vente' : '—'}</small>
      </td>
    )
  return (
    <td>
      <span className="default-cell" title={MOUNT_MARKET_NOTE}>
        <span>{formatKamas(ref.price)}</span>
        <Badge tone="warn">HDV mixte</Badge>
        <small className="muted">
          {formatNumber(ref.depth?.sold24 ?? 0)}/24 h · {formatNumber(ref.depth?.sold30 ?? 0)}/30 j
        </small>
      </span>
    </td>
  )
}

function BulkTab() {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{ entries: BulkPriceEntry[]; errors: BulkPriceError[] } | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const state = usePrices()
  const server = useSettings((s) => s.server)

  const apply = () => {
    if (!preview?.entries.length) return
    const items = { ...state.items }
    for (const e of preview.entries) items[String(e.id)] = e.price
    state.replaceAll({ items, mounts: state.mounts, generations: state.generations, genetonValue: state.genetonValue })
    setMessage({ tone: 'ok', text: `${preview.entries.length} prix enregistrés.` })
    setPreview(null)
    setText('')
  }

  const exportJson = () => {
    const data = buildPriceExport(state, server)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `elevagesimu-prix${server ? `-${normalizeName(server).replace(/[^a-z0-9]+/g, '-')}` : ''}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async (file: File) => {
    try {
      const parsed = parsePriceExport(JSON.parse(await file.text()))
      if (!parsed.ok) {
        setMessage({ tone: 'danger', text: parsed.error })
        return
      }
      const s = parsed.snapshot
      state.replaceAll({
        items: { ...state.items, ...s.items },
        mounts: { ...state.mounts, ...s.mounts },
        generations: { ...state.generations, ...s.generations },
        genetonValue: s.genetonValue ?? state.genetonValue,
      })
      const n = Object.keys(s.items).length + Object.keys(s.mounts).length + Object.keys(s.generations).length
      setMessage({ tone: 'ok', text: `${n} prix importés${parsed.server ? ` (serveur ${parsed.server})` : ''}. Vos autres prix sont conservés.` })
    } catch {
      setMessage({ tone: 'danger', text: 'Fichier illisible : un JSON exporté par ElevageSimu est attendu.' })
    }
  }

  const clearAll = () => {
    if (!window.confirm(`Effacer tous vos prix saisis pour le serveur ${server} (objets, montures, généton) ? Ils sont partagés par tous les profils de ce serveur. Les prix du marché importés et les prix par défaut restent disponibles.`)) return
    state.replaceAll({ items: {}, mounts: {}, generations: {}, genetonValue: null })
    setMessage({ tone: 'warn', text: 'Tous vos prix ont été effacés.' })
  }

  const counts = Object.keys(state.items).length + Object.keys(state.mounts).length + Object.keys(state.generations).length
  return (
    <div className="grid grid-2">
      <Card title="Coller une liste de prix">
        <p className="muted">
          Une ligne par objet : <code>Nom;Prix</code> ou <code>id;prix</code> (séparateur « ; », tabulation ou « = »). Montants acceptés : <code>12000</code>, <code>12 000</code>, <code>12k</code>, <code>1,5M</code>. Les
          lignes commençant par # sont ignorées. Exemple : un copier-coller depuis un tableur.
        </p>
        <textarea
          className="bulk"
          aria-label="Liste de prix à coller"
          value={text}
          placeholder={'Truite;120\nŒil de Pikdoa;850\nGigantesque Extrait de Foudroyeur;4 500'}
          onChange={(e) => {
            setText(e.target.value)
            setPreview(null)
          }}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" disabled={!text.trim()} onClick={() => setPreview(parseBulkPrices(text))}>
            Analyser
          </button>
          <button className="btn primary" disabled={!preview?.entries.length} onClick={apply}>
            Enregistrer {preview?.entries.length ?? 0} prix
          </button>
        </div>
        {preview && (
          <div className="stack" style={{ marginTop: 10 }}>
            {preview.entries.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ligne</th>
                      <th>Objet reconnu</th>
                      <th className="num">Prix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.entries.map((e) => (
                      <tr key={`${e.line}-${e.id}`}>
                        <td>{e.line}</td>
                        <td>
                          {e.name} <small className="muted">#{e.id}</small>
                        </td>
                        <td className="num">{formatKamas(e.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.errors.length > 0 && (
              <Callout tone="warn">
                {preview.errors.length} ligne{preview.errors.length > 1 ? 's' : ''} ignorée{preview.errors.length > 1 ? 's' : ''} :
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {preview.errors.slice(0, 12).map((e) => (
                    <li key={e.line}>
                      Ligne {e.line} : {e.reason}
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
          </div>
        )}
      </Card>
      <Card title="Fichiers de prix">
        <p className="muted">
          Sauvegardez vos prix (objets, montures, généton) dans un fichier JSON, ou importez ceux d’un autre joueur de votre serveur. L’import complète vos prix sans effacer les autres.
        </p>
        <div className="row">
          <button className="btn primary" onClick={exportJson} disabled={counts === 0 && state.genetonValue === null}>
            Exporter mes prix ({counts})
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Importer un fichier…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importJson(f)
              e.target.value = ''
            }}
          />
          <button className="btn danger" onClick={clearAll} disabled={counts === 0 && state.genetonValue === null}>
            Effacer mes prix
          </button>
        </div>
        {message && <Callout tone={message.tone}>{message.text}</Callout>}
      </Card>
    </div>
  )
}

// ---------- Page ----------

function countMatches(tab: TabId, q: string): number {
  if (!q) return 0
  switch (tab) {
    case 'ressources':
      return keyResourceGroups().reduce((s, g) => s + g.items.filter((r) => matches(q, r.name)).length, 0) + (matches(q, 'généton', 'poussière') ? 1 : 0)
    case 'carburants':
      return FUELS.filter((f) => matches(q, f.name)).length
    case 'makinas':
      return MAKINAS.filter((m) => matches(q, m.name)).length
    case 'filets':
      return NETS.filter((n) => matches(q, n.name)).length
    case 'ingredients':
      return INGREDIENTS.filter((i) => matches(q, i.name, i.typeName)).length
    default:
      return 0
  }
}

/** Route : #/prix?q=nom (recherche) et &onglet=carburants|makinas|filets|ingredients|montures|marche|hdv|masse. */
export default function PricesPage() {
  const route = useRoute()
  const q = route.params.get('q') ?? ''
  const onglet = route.params.get('onglet') ?? ''
  const initialTab = (Object.keys(TAB_LABELS) as TabId[]).find((t) => t === onglet) ?? null
  return <PricesView key={`${q}|${onglet}`} initialQuery={q} initialTab={initialTab} />
}

function PricesView({ initialQuery, initialTab }: { initialQuery: string; initialTab: TabId | null }) {
  const [query, setQuery] = useState(initialQuery)
  const q = normalizeName(query)
  const [tab, setTab] = useState<TabId>(() => {
    if (initialTab) return initialTab
    const nq = normalizeName(initialQuery)
    if (!nq) return 'ressources'
    return ITEM_TABS.find((t) => countMatches(t, nq) > 0) ?? 'ressources'
  })
  const baseCtx = usePriceContext()
  const settings = useSettings()
  // Niveau d'Éleveur : une recette hors de portée est payée au prix HDV (comme la page Rentabilité).
  const ctx = useMemo<PriceContext>(() => ({ ...baseCtx, jobLevel: settings.jobLevel }), [baseCtx, settings.jobLevel])
  const updatedAt = usePrices((s) => s.updatedAt)
  const pMounts = usePrices((s) => s.mounts)
  const pGenerations = usePrices((s) => s.generations)
  // Marché du serveur : prix de l'objet-monture (HDV mixte), plafond de vente dans les décisions.
  const mctx = useMemo<MountPriceContext>(
    () => ({ mountOverrides: pMounts, generationOverrides: pGenerations, useDefaults: settings.useDefaultPrices, market: ctx.market }),
    [pMounts, pGenerations, settings.useDefaultPrices, ctx.market],
  )
  const coverage = useMemo(() => priceCoverage(ctx), [ctx])
  const profile = useActiveProfile()
  const server = useActiveServer()
  const snapshot = useMarket((st) => st.snapshot)
  const today = useServerDay()
  const freshness = snapshot ? snapshotFreshness(snapshot.exportDate, today) : null
  const counts = useMemo(() => Object.fromEntries(ITEM_TABS.map((t) => [t, countMatches(t, q)])) as Record<TabId, number>, [q])
  const ownCount = Object.keys(ctx.overrides).length + Object.keys(pMounts).length + Object.keys(pGenerations).length

  const tabs = (Object.keys(TAB_LABELS) as TabId[]).map((id) => ({
    id,
    label: (
      <>
        {TAB_LABELS[id]}
        {q && ITEM_TABS.includes(id) && <span className="tab-count">{counts[id]}</span>}
      </>
    ),
  }))

  return (
    <div className="prices-page">
      <PageHeader
        title="Prix"
        subtitle="Prix de l’HDV du serveur du profil ouvert (saisis, ou importés d’un export CSV de l’HDV) : ils alimentent tous les calculs de coûts et de rentabilité. Sans prix, un coût est affiché « incomplet », jamais compté comme 0."
      />
      <Card>
        <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
          <div className="field">
            Serveur{' '}
            <span>
              <strong>{server.name}</strong> <small className="muted">(profil {profile.name} · <a href={href('reglages', { s: 'profils' })}>gérer</a>)</small>
            </span>
          </div>
          <label className="check" title="Prix relevés par la recherche (vidéos, guides), datés et sourcés ; majoritairement Salar, mars → septembre 2026.">
            <input type="checkbox" checked={settings.useDefaultPrices} onChange={(e) => settings.update({ useDefaultPrices: e.target.checked })} />
            Utiliser les prix par défaut quand vous n’avez rien saisi
          </label>
          <div className="spacer" />
          <small className="muted">
            {ownCount} prix saisi{ownCount > 1 ? 's' : ''}
            {updatedAt ? ` · dernière saisie ${formatDate(updatedAt)}` : ''}
          </small>
        </div>
        {snapshot ? (
          <small className="muted" style={{ display: 'block', marginTop: 6 }}>
            Marché : export HDV de {server.name} du <strong>{frenchDay(snapshot.exportDate)}</strong> ({formatNumber(snapshot.stats.useful)} objets, {PRICE_STAT_LABELS[server.priceStat].toLowerCase()}) —{' '}
            <button className="btn ghost small" type="button" onClick={() => setTab('marche')}>
              lecture du marché
            </button>
            <button className="btn ghost small" type="button" onClick={() => setTab('hdv')}>
              détail et nouvel import
            </button>
          </small>
        ) : (
          <Callout>
            Aucun prix du marché pour {server.name}.{' '}
            <button className="btn small primary" type="button" onClick={() => setTab('hdv')}>
              Importer un export HDV (CSV)
            </button>{' '}
            pour chiffrer d’un coup ingrédients, carburants, makinas, filets et ressources.
          </Callout>
        )}
        {freshness && freshness.level !== 'frais' && <Callout tone={freshness.tone === 'ok' ? undefined : freshness.tone}>{freshness.message}</Callout>}
        {settings.useDefaultPrices && (
          <small className="muted" style={{ display: 'block', marginTop: 6 }}>
            Défauts (après vos prix et le marché) : {PRICES_DEFAULT.asOf}. {PRICES_DEFAULT.server}.
          </small>
        )}
        <div className="divider" />
        <div className="coverage" aria-label="Couverture des prix">
          {coverage.map((c) => (
            <div key={c.key}>
              <div className="label">
                <span>{c.label}</span>
                <span>
                  {c.priced}/{c.total}
                </span>
              </div>
              <Progress value={c.priced} max={c.total} color={c.priced === c.total ? 'var(--ok)' : c.priced / c.total < 0.25 ? 'var(--warn)' : undefined} />
            </div>
          ))}
        </div>
        <small className="muted" style={{ display: 'block', marginTop: 6 }}>
          Couverture : objets dont le prix est complet (saisi, marché importé, défaut ou coût de craft dont tous les ingrédients ont un prix).
        </small>
      </Card>

      <div className="search-bar">
        <label className="field" style={{ flex: 1 }}>
          Rechercher un objet
          <input type="search" value={query} placeholder="ex. Gigantesque Extrait de Foudroyeur, Ambre, Truite…" onChange={(e) => setQuery(e.target.value)} />
        </label>
        {query && (
          <button className="btn" onClick={() => setQuery('')}>
            Effacer la recherche
          </button>
        )}
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'ressources' && <KeyResourcesTab q={q} ctx={ctx} />}
      {tab === 'carburants' && <FuelsTab q={q} ctx={ctx} />}
      {tab === 'makinas' && <MakinasTab q={q} ctx={ctx} />}
      {tab === 'filets' && <NetsTab q={q} ctx={ctx} />}
      {tab === 'ingredients' && <IngredientsTab q={q} ctx={ctx} />}
      {tab === 'montures' && <MountsTab q={q} mctx={mctx} market={ctx.market ?? null} />}
      {tab === 'marche' && <MarketInsightsPanel ctx={ctx} onImport={() => setTab('hdv')} />}
      {tab === 'hdv' && <MarketImport />}
      {tab === 'masse' && <BulkTab />}
    </div>
  )
}
