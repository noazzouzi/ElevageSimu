// Page Prix › « Marché » : lecture du marché du serveur ouvert pour l'élevage (export HDV importé) —
// fraîcheur de l'export, prix clés avec leurs volumes (ressources d'extraction, runes, génétons,
// carburants au point, makinas par génération, filets), fabriquer ou acheter, marché des montures
// (HDV mixte, séniles probables, vendre plutôt qu'extraire, courbes par génération) et comparaison
// entre serveurs. Logique : src/domain/marketInsights.ts (pur) ; documentation : docs/api/market.md.
import { useMemo, useState, type ReactNode } from 'react'
import { FAMILIES, FAMILY_IDS } from '../data'
import { GAUGE_IDS, GAUGE_LABELS } from '../domain/constants'
import { BRISAGE_RISK_NOTE, MOUNT_MARKET_BADGE, SENILE_PRICE_RATIO, genetonKamasValue } from '../domain/economy'
import { MOUNT_MARKET_NOTE, PRICE_STATS, PRICE_STAT_LABELS, PRICE_STAT_SHORT, frenchDay, marketSourceOf, type MarketSource, type PriceStat } from '../domain/market'
import {
  CRAFT_KIND_LABELS,
  compareServers,
  makinaPriceCurves,
  marketInsights,
  type CraftKind,
  type CraftVsBuyRow,
  type FuelPointRow,
  type GenerationPoint,
  type MarketLine,
  type MountMarketRow,
  type ServerMarket,
} from '../domain/marketInsights'
import type { PriceContext } from '../domain/pricing'
import type { FamilyId, FuelTier, MakinaKind } from '../domain/types'
import { formatKamas, formatNumber, formatPercent } from '../lib/format'
import { useMarket } from '../store/market'
import { usePrices } from '../store/prices'
import { ACTIVE_SERVER_ID, useActiveServer, useProfiles } from '../store/profiles'
import type { ServerEntry } from '../store/profileRegistry'
import { isPlainObject, sanitizeMarketState, serverStoreKey } from '../store/schema'
import { useRules, useSettings } from '../store/settings'
import { Badge, Callout, Card, Empty, Stat, Tabs } from './components'
import { href } from './router'
import { GenBadge } from './species'
import { useServerDay } from './useServerDay'
import './MarketInsightsPanel.css'

type Section = 'prix' | 'craft' | 'montures' | 'serveurs'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'prix', label: 'Prix clés' },
  { id: 'craft', label: 'Fabriquer ou acheter' },
  { id: 'montures', label: 'Montures' },
  { id: 'serveurs', label: 'Comparer les serveurs' },
]

const TIERS: FuelTier[] = [1, 2, 3, 4]
const KIND_LABELS: Record<MakinaKind, string> = { animakina: 'Animakina', kromakina: 'Kromakina', optimakina: 'Optimakina' }
/** Fiabilité du prix selon le nombre de ventes (≥ 5 en 24 h ou ≥ 30 en 30 j : fiable). */
const CONFIDENCE_LABELS: Record<'high' | 'medium' | 'low', string> = { high: 'prix fiable', medium: 'prix indicatif', low: 'peu de ventes' }

/** « < 0,1 » pour une vente occasionnelle, « 0,3 » sous 10, sinon entier. */
const perDay = (n: number) => (n > 0 && n < 0.05 ? '< 0,1' : formatNumber(n, n < 10 ? 1 : 0))

// ---------- Petits éléments ----------

/** Prix d'une ligne de marché : « — » si inconnu (jamais 0). */
function Price({ l, net }: { l: MarketLine; net?: boolean }) {
  const v = net ? l.net : l.price
  if (v === null) return <span className="muted">{l.absent ? '—' : 'sans vente'}</span>
  return <span title={l.stat ? `${PRICE_STAT_SHORT[l.stat]} · ${formatNumber(l.sold24)} vendus/24 h, ${formatNumber(l.sold30)} en 30 j` : undefined}>{formatKamas(v)}</span>
}

/** Volume quotidien moyen avec une barre proportionnelle (échelle commune au tableau). */
function Volume({ value, max, title }: { value: number; max: number; title?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <span className="mkt-vol" title={title}>
      <span className="mkt-vol-track" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span>{perDay(value)}</span>
    </span>
  )
}

function ConfBadge({ l }: { l: MarketLine }) {
  if (!l.confidence) return null
  return <Badge tone={l.confidence === 'high' ? 'ok' : l.confidence === 'medium' ? 'info' : 'warn'}>{CONFIDENCE_LABELS[l.confidence]}</Badge>
}

function MarketLineTable({ lines, extra }: { lines: MarketLine[]; extra?: { header: string; cell: (l: MarketLine) => ReactNode }[] }) {
  const max = Math.max(1, ...lines.map((l) => l.perDayAvg))
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Objet</th>
            <th className="num">Prix</th>
            <th className="num">Net de taxe</th>
            {extra?.map((c) => (
              <th key={c.header} className="num">
                {c.header}
              </th>
            ))}
            <th className="num">Vendus 24 h</th>
            <th>Vendus / jour (30 j)</th>
            <th className="num">Vendables / jour</th>
            <th className="num">Kamas / jour</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>
                <a href={href('prix', { q: l.name })}>{l.name}</a> <ConfBadge l={l} />
              </td>
              <td className="num">
                <Price l={l} />
              </td>
              <td className="num">
                <Price l={l} net />
              </td>
              {extra?.map((c) => (
                <td key={c.header} className="num">
                  {c.cell(l)}
                </td>
              ))}
              <td className="num">{formatNumber(l.sold24)}</td>
              <td>
                <Volume value={l.perDayAvg} max={max} />
              </td>
              <td className="num">{l.absent ? '—' : perDay(l.sellablePerDay)}</td>
              <td className="num">{l.absent ? '—' : formatKamas(l.kamasPerDay, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Section : prix clés ----------

function FuelGrid({ rows }: { rows: FuelPointRow[] }) {
  return (
    <div className="table-wrap">
      <table className="table mkt-fuels">
        <thead>
          <tr>
            <th>Jauge</th>
            {TIERS.map((t) => (
              <th key={t} className="num">
                Palier {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GAUGE_IDS.map((g) => (
            <tr key={g}>
              <td>{GAUGE_LABELS[g]}</td>
              {TIERS.map((t) => {
                const r = rows.find((x) => x.gauge === g && x.tier === t)
                if (!r || r.bestPerPoint === null)
                  return (
                    <td key={t} className="num">
                      <span className="muted" title={r?.craft && !r.craft.canCraft ? `Craft hors de portée (niv. ${r.craft.fuel.level})` : 'Aucun prix'}>
                        —
                      </span>
                    </td>
                  )
                const tip = [
                  r.buy ? `Achat : ${r.buy.fuel.name} ${formatKamas(r.buy.price)} → ${formatNumber(r.buy.perPoint, 3)} K/pt (${formatNumber(r.buy.sold24)} vendus/24 h)` : 'Achat : aucun prix à l’HDV',
                  r.craft
                    ? `Craft : ${r.craft.fuel.name} ${formatKamas(r.craft.cost)} → ${formatNumber(r.craft.perPoint, 3)} K/pt${r.craft.canCraft ? '' : ` (niv. ${r.craft.fuel.level} requis)`}`
                    : 'Craft : ingrédients incomplets',
                ].join('\n')
                return (
                  <td key={t} className="num" title={tip}>
                    <strong>{formatNumber(r.bestPerPoint, r.bestPerPoint < 1 ? 3 : 2)} K</strong>
                    <small>
                      <Badge tone={r.best === 'craft' ? 'ok' : 'info'}>{r.best === 'craft' ? 'craft' : 'achat'}</Badge>
                    </small>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KeyPricesSection({ ins, ctx }: { ins: ReturnType<typeof marketInsights>; ctx: PriceContext }) {
  const k = ins.keyPrices
  const defaultFamily = useSettings((s) => s.family)
  const [family, setFamily] = useState<FamilyId>(defaultFamily)
  const genetonOverride = usePrices((s) => s.genetonValue)
  const setGenetonValue = usePrices((s) => s.setGenetonValue)
  const saleTax = useSettings((s) => s.saleTax)
  const retained = genetonKamasValue(genetonOverride, { market: ctx.market, saleTax })
  const curves = makinaPriceCurves(k.makinas).filter((c) => c.family === family)
  const gens = [2, 3, 4, 5, 6, 7, 8, 9, 10]
  return (
    <div className="stack">
      <Card title="Ressources d’extraction" actions={<small className="muted">1 ressource par génération extraite (G1 = 0)</small>}>
        <MarketLineTable lines={k.extraction} />
      </Card>
      <Card title="Runes de brisage">
        <MarketLineTable
          lines={k.runes}
          extra={[
            {
              header: 'Brisage',
              cell: (l) => {
                const r = k.runes.find((x) => x.id === l.id)
                return r?.scale ? <span title={`Prix du serveur ÷ défaut de la recherche (${formatKamas(r.defaultPrice)}) : facteur appliqué aux rendements observés`}>× {formatNumber(r.scale, 2)}</span> : '—'
              },
            },
          ]}
        />
        <small className="muted">{BRISAGE_RISK_NOTE}</small>
      </Card>
      <Card title="Autres objets">
        <MarketLineTable lines={k.others} />
        <small className="muted">Pépite : 10 par makina (recyclage). Parchemin d’Éleveur : XP du métier. Tourmaline : aussi dans la boutique de génétons (130).</small>
      </Card>
      <Card title="Génétons : boutique d’Eugène Éton">
        <p className="muted">
          Valeur d’un généton sur ce serveur = meilleur prix ÷ coût parmi les échanges reconfirmés après la 3.5 :{' '}
          <strong>{k.genetons.value === null ? 'inconnue' : `${formatKamas(k.genetons.value)} brut, ${formatKamas(k.genetons.net)} net`}</strong>
          {k.genetons.best ? ` (${k.genetons.best.name})` : ''}. Retenu dans les calculs : {formatKamas(retained.value)} ({retained.origin === 'joueur' ? 'votre valeur' : retained.origin === 'marche' ? 'marché du serveur' : 'défaut de la recherche'}).
          {k.genetons.optimistic && k.genetons.optimistic.perGeneton !== null && (
            <> Valeur optimiste : {formatKamas(k.genetons.optimistic.perGeneton)} avec {k.genetons.optimistic.name} (boutique de la bêta 3.5, échange non reconfirmé : non comptée).</>
          )}
          {genetonOverride !== null && k.genetons.value !== null && Math.round(k.genetons.value) !== genetonOverride && (
            <>
              {' '}
              <button className="btn small" type="button" onClick={() => setGenetonValue(null)}>
                Effacer votre valeur ({formatKamas(genetonOverride)}) et suivre le marché
              </button>
            </>
          )}
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Objet</th>
                <th className="num">Coût (génétons)</th>
                <th className="num">Prix</th>
                <th className="num">K / généton</th>
                <th className="num">Net / généton</th>
                <th className="num">Vendus 24 h</th>
                <th className="num">Génétons écoulables / jour</th>
              </tr>
            </thead>
            <tbody>
              {k.genetons.lines.slice(0, 10).map((l) => (
                <tr key={l.id} className={k.genetons.best?.id === l.id ? 'mkt-best' : undefined}>
                  <td>
                    {l.name} <ConfBadge l={l} />
                    {!l.confirmed && (
                      <span className="badge" title="Échange relevé sur une capture de la bêta 3.5, pas reconfirmé depuis la sortie : non compté dans la valeur du généton.">
                        non reconfirmé
                      </span>
                    )}
                  </td>
                  <td className="num">{l.cost}</td>
                  <td className="num">
                    <Price l={l} />
                  </td>
                  <td className="num">{l.perGeneton === null ? '—' : formatNumber(l.perGeneton, 1)}</td>
                  <td className="num">{l.perGenetonNet === null ? '—' : formatNumber(l.perGenetonNet, 1)}</td>
                  <td className="num">{formatNumber(l.sold24)}</td>
                  <td className="num">{l.absent ? '—' : formatNumber(l.sellablePerDay * l.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <small className="muted">Génétons écoulables : part vendable du volume quotidien × coût de l’objet. Au-delà, le prix du parchemin baisse : variez les objets de la boutique.</small>
      </Card>
      <Card title="Carburants : coût au point le moins cher, par jauge et palier">
        <p className="muted">
          Le moins cher des 5 tailles du palier, à l’achat (prix HDV ÷ durabilité) ou en fabriquant (ingrédients au prix du serveur), le craft n’étant retenu que s’il est à votre portée. Survolez une case pour le détail.
        </p>
        <FuelGrid rows={k.fuels} />
      </Card>
      <Card
        title="Makinas par génération"
        actions={
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
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Génération</th>
                {curves.map((c) => (
                  <th key={c.kind} className="num">
                    {KIND_LABELS[c.kind]} (HDV · craft)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gens.map((g) => (
                <tr key={g}>
                  <td>
                    <GenBadge generation={g} />
                  </td>
                  {curves.map((c) => {
                    const p = c.points.find((x) => x.generation === g)
                    return (
                      <td key={c.kind} className="num">
                        {p?.price === null || !p ? <span className="muted">—</span> : formatKamas(p.price)}
                        <small className="muted">
                          {p?.craft !== null && p ? `craft ${formatKamas(p.craft)}` : 'craft incomplet'}
                          {p && p.sold30 > 0 ? ` · ${formatNumber(p.sold30)}/30 j` : ''}
                        </small>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Filets de capture">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Filet</th>
                <th className="num">Niv.</th>
                <th className="num">Prix HDV</th>
                <th className="num">Par monture</th>
                <th className="num">Craft</th>
                <th className="num">Vendus 24 h</th>
              </tr>
            </thead>
            <tbody>
              {k.nets.map((n) => (
                <tr key={n.id}>
                  <td>{n.name}</td>
                  <td className="num">{n.level}</td>
                  <td className="num">
                    <Price l={n.line} />
                  </td>
                  <td className="num" title={`${n.mountsPerCast} monture(s) par lancer`}>
                    {n.perMount === null ? '—' : formatKamas(n.perMount)}
                  </td>
                  <td className="num">{n.craft ? `${n.craft.complete ? '' : '≥ '}${formatKamas(n.craft.cost)}` : '—'}</td>
                  <td className="num">{formatNumber(n.line.sold24)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ---------- Section : fabriquer ou acheter ----------

const CHEAPER_LABELS: Record<CraftVsBuyRow['cheaper'], { label: string; tone: 'ok' | 'info' | 'warn' | undefined }> = {
  craft: { label: 'fabriquer', tone: 'ok' },
  achat: { label: 'acheter', tone: 'info' },
  egal: { label: 'équivalent', tone: undefined },
  inconnu: { label: 'inconnu', tone: 'warn' },
}

function CraftSection({ ins }: { ins: ReturnType<typeof marketInsights> }) {
  const [kind, setKind] = useState<CraftKind | 'tous'>('tous')
  const [onlyMine, setOnlyMine] = useState(false)
  const [onlyProfit, setOnlyProfit] = useState(false)
  const [limit, setLimit] = useState(40)
  const jobLevel = useSettings((s) => s.jobLevel)
  const s = ins.craftSummary
  const rows = ins.craft.filter((r) => (kind === 'tous' || r.kind === kind) && (!onlyMine || r.canCraft) && (!onlyProfit || (r.profitPerDay ?? 0) > 0))
  return (
    <div className="stack">
      <Card title="Fabriquer ou acheter, sur ce serveur">
        <div className="kpis">
          <Stat label="Moins cher à fabriquer" value={s.craftCheaper} hint={`sur ${s.total} carburants, makinas et filets`} />
          <Stat label="Moins cher à acheter" value={s.buyCheaper} hint={`${s.equal} équivalents (± 2 %)`} />
          <Stat label="Inconnus" value={s.unknown} hint="prix HDV ou ingrédient manquant" />
          <Stat label="Crafts rentables à revendre" value={s.profitable.length} hint={`à votre portée (Éleveur niv. ${jobLevel})`} />
          <Stat label="5 meilleurs : bénéfice / jour" value={formatKamas(s.topProfitPerDay, true)} hint="plafonné par le volume de l’objet et de ses ingrédients" />
        </div>
        <p className="muted">
          Coût du craft = ingrédients au prix du serveur (vos prix d’abord). Marge de revente = prix HDV net de taxe − craft. Le bénéfice par jour est plafonné par ce que le marché absorbe : objets revendables par jour et ingrédients
          achetables par jour (même part du volume moyen).
        </p>
        <div className="filters">
          <label className="field">
            Objets
            <select value={kind} onChange={(e) => setKind(e.target.value as CraftKind | 'tous')}>
              <option value="tous">Tous</option>
              {(Object.keys(CRAFT_KIND_LABELS) as CraftKind[]).map((k) => (
                <option key={k} value={k}>
                  {CRAFT_KIND_LABELS[k]}s
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
            Seulement à ma portée (niv. {jobLevel})
          </label>
          <label className="check">
            <input type="checkbox" checked={onlyProfit} onChange={(e) => setOnlyProfit(e.target.checked)} />
            Seulement rentables à revendre
          </label>
          <span className="muted">{rows.length} objets</span>
        </div>
        {rows.length === 0 ? (
          <Empty>Aucun objet ne correspond à ces filtres.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Objet</th>
                  <th className="num">Niv.</th>
                  <th className="num">Prix HDV</th>
                  <th className="num">Craft</th>
                  <th>Moins cher</th>
                  <th className="num">Marge de revente</th>
                  <th className="num">Revendables / jour</th>
                  <th className="num">Bénéfice / jour</th>
                  <th className="num">XP / craft</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r) => {
                  const c = CHEAPER_LABELS[r.cheaper]
                  return (
                    <tr key={r.id}>
                      <td>
                        <a href={href('prix', { q: r.name })}>{r.name}</a>
                        <small className="muted">{CRAFT_KIND_LABELS[r.kind]}</small>
                      </td>
                      <td className="num" title={r.canCraft ? 'Vous pouvez le fabriquer' : `Niveau d’Éleveur ${r.level} requis pour le fabriquer`}>
                        {r.level}
                        {r.canCraft ? ' ✓' : ''}
                      </td>
                      <td className="num">
                        <Price l={r.buy} />
                        <small className="muted">{formatNumber(r.buy.sold24)}/24 h</small>
                      </td>
                      <td className="num" title={r.craft && !r.craft.complete ? `Ingrédients sans prix : ${r.craft.missing.length}` : undefined}>
                        {r.craft ? `${r.craft.complete ? '' : '≥ '}${formatKamas(r.craft.cost)}` : '—'}
                      </td>
                      <td>
                        <Badge tone={c.tone}>{c.label}</Badge>
                        {r.saving !== null && r.cheaper !== 'egal' && <small className="muted">{formatKamas(Math.abs(r.saving))} d’écart</small>}
                      </td>
                      <td className="num">
                        {r.margin === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <span className={r.margin >= 0 ? 'pos' : 'neg'}>
                            {formatKamas(r.margin)}
                            {r.marginPct !== null && <small className="muted">{formatPercent(r.marginPct, 0)}</small>}
                          </span>
                        )}
                      </td>
                      <td className="num" title={r.ingredientCapPerDay !== null ? `Ingrédients achetables pour ≈ ${perDay(r.ingredientCapPerDay)} crafts par jour` : 'Ingrédients absents de l’export'}>
                        {perDay(r.sellablePerDay)}
                      </td>
                      <td className="num">{r.profitPerDay === null ? <span className="muted">—</span> : <strong>{formatKamas(r.profitPerDay, true)}</strong>}</td>
                      <td className="num">{r.canCraft ? formatNumber(r.xp) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > limit && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            <button className="btn" type="button" onClick={() => setLimit((l) => l + 60)}>
              Afficher 60 de plus ({rows.length - limit} restants)
            </button>
          </div>
        )}
        <small className="muted">La montée du métier (XP par kamas) se planifie sur la page <a href={href('metier')}>Métier Éleveur</a>.</small>
      </Card>
    </div>
  )
}

// ---------- Section : montures ----------

/** Graduation « ronde » au-dessus d'un maximum. */
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

/** Prix médian (HDV mixte) par génération, extrêmes et valeur d'extraction, sur une seule échelle en kamas. */
function GenerationChart({ points, label }: { points: GenerationPoint[]; label: string }) {
  const [focus, setFocus] = useState<number | null>(null)
  const W = 640
  const H = 220
  const L = 58
  const R = 10
  const T = 10
  const B = 26
  const top = niceMax(Math.max(1, ...points.map((p) => Math.max(p.median ?? 0, p.extractionGross ?? 0))))
  const y = (v: number) => T + (H - T - B) * (1 - Math.min(v, top) / top)
  const band = (W - L - R) / Math.max(1, points.length)
  const bw = Math.min(34, band * 0.55)
  const ticks = [0, top / 4, top / 2, (3 * top) / 4, top]
  const f = points.find((p) => p.generation === focus)
  return (
    <figure className="mkt-chart">
      <div className="mkt-legend">
        <span>
          <span className="mkt-sw bar" /> Médiane des couleurs (HDV mixte)
        </span>
        <span>
          <span className="mkt-sw tick" /> Valeur d’extraction
        </span>
        <span>
          <span className="mkt-sw whisker" /> Couleur la moins chère → la plus chère (écrêtée)
        </span>
      </div>
      <div className="mkt-tip" role="status">
        {f
          ? `G${f.generation} : médiane ${f.median === null ? 'inconnue' : formatKamas(f.median)} (${f.priced}/${f.species} couleurs en vente${f.min !== null ? `, ${formatKamas(f.min, true)} → ${formatKamas(f.max, true)}` : ''}) · ${formatNumber(f.sold30)} ventes en 30 j · extraction ${formatKamas(f.extractionGross)}${f.senileSuspects ? ` · ${f.senileSuspects} sénile(s) probable(s)` : ''}`
          : 'Survolez ou parcourez (Tab) une génération pour le détail.'}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} : prix médian de l’HDV et valeur d’extraction par génération`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="mkt-grid" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" className="mkt-axis">
              {formatKamas(t, true).replace(' K', '')}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = L + band * i + band / 2
          const active = focus === p.generation
          return (
            <g
              key={p.generation}
              tabIndex={0}
              className={`mkt-band${active ? ' active' : ''}`}
              onMouseEnter={() => setFocus(p.generation)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(p.generation)}
              onBlur={() => setFocus(null)}
            >
              <rect x={L + band * i} y={T} width={band} height={H - T - B} className="mkt-hit" />
              {p.min !== null && p.max !== null && <line x1={cx} x2={cx} y1={y(p.min)} y2={y(p.max)} className="mkt-whisker" />}
              {p.median !== null && <rect x={cx - bw / 2} y={y(p.median)} width={bw} height={Math.max(1, H - B - y(p.median))} rx={3} className="mkt-bar" />}
              {p.extractionGross !== null && p.extractionGross > 0 && <line x1={cx - bw / 2 - 5} x2={cx + bw / 2 + 5} y1={y(p.extractionGross)} y2={y(p.extractionGross)} className="mkt-tick" />}
              <text x={cx} y={H - 8} textAnchor="middle" className="mkt-axis">
                G{p.generation}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="muted">Échelle en kamas (k = milliers, M = millions) ; au-delà de {formatKamas(top, true)}, les couleurs les plus chères sont écrêtées.</figcaption>
    </figure>
  )
}

function MountTable({ rows, maxVol, empty }: { rows: MountMarketRow[]; maxVol: number; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Monture</th>
            <th className="num">Prix HDV (mixte)</th>
            <th className="num">Extraction</th>
            <th className="num">Prix ÷ extraction</th>
            <th>Vendues / jour (30 j)</th>
            <th className="num">Vendables / jour</th>
            <th className="num">Gain / jour à vendre</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.speciesId}>
              <td>
                <span className="row" style={{ gap: 6 }}>
                  <GenBadge generation={r.generation} />
                  <a href={href('prix', { onglet: 'montures', q: r.name })}>{r.name}</a>
                </span>
                <small>
                  <ConfBadge l={r.line} />
                  {r.possibleSenile && (
                    <Badge tone="warn" title={`Prix sous ${Math.round(SENILE_PRICE_RATIO * 100)} % de la valeur d’extraction : ventes probablement tirées par des montures séniles (extraction = 1 ressource).`}>
                      sénile probable
                    </Badge>
                  )}
                </small>
              </td>
              <td className="num">
                <Price l={r.line} />
              </td>
              <td className="num">{r.extraction.qty === 0 ? <span className="muted">non extractible</span> : r.extraction.gross === null ? '—' : formatKamas(r.extraction.gross)}</td>
              <td className="num">{r.ratio === null ? '—' : `× ${formatNumber(r.ratio, 2)}`}</td>
              <td>
                <Volume value={r.line.perDayAvg} max={maxVol} title={`${formatNumber(r.line.sold24)} vendues en 24 h, ${formatNumber(r.line.sold30)} en 30 jours`} />
              </td>
              <td className="num">{r.line.absent ? '—' : perDay(r.sellablePerDay)}</td>
              <td className="num">{r.extraPerDay === null ? <span className="muted">—</span> : formatKamas(r.extraPerDay, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MountsSection({ ins, serverName }: { ins: ReturnType<typeof marketInsights>; serverName: string }) {
  const defaultFamily = useSettings((s) => s.family)
  const [family, setFamily] = useState<FamilyId>(defaultFamily)
  const [showAll, setShowAll] = useState(false)
  const all = ins.mounts.filter((m) => m.family === family)
  const maxVol = Math.max(1, ...all.map((m) => m.line.perDayAvg))
  const sell = ins.sellRatherThanExtract.filter((m) => m.family === family)
  const senile = ins.senileSuspects.filter((m) => m.family === family)
  const points = ins.curves[family] ?? []
  const sorted = [...all].sort((a, b) => a.generation - b.generation || (b.line.price ?? -1) - (a.line.price ?? -1))
  return (
    <div className="stack">
      <Callout tone="warn">
        <strong>Prix des montures à l’HDV</strong> ({MOUNT_MARKET_BADGE.toLowerCase()}). {MOUNT_MARKET_NOTE} Dans les calculs (Rentabilité, sort des montures), ce prix n’est qu’un <strong>plafond de vente</strong> : il ramène un relevé par défaut plus cher à son
        niveau et borne la valeur d’une monture, mais il n’est jamais compté seul. Pour qu’une vente compte, saisissez le prix d’une monture du niveau et de l’état voulus (page <a href={href('prix', { onglet: 'montures' })}>Prix › Montures</a>).
      </Callout>
      <Card
        title={`${FAMILIES[family].plural} à l’HDV de ${serverName}`}
        actions={
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
        }
      >
        <GenerationChart points={points} label={FAMILIES[family].plural} />
      </Card>
      <Card title="Vendre plutôt qu’extraire" actions={<small className="muted">G2+, hors séniles probables, gain plafonné par le volume</small>}>
        <p className="muted">
          Couleurs dont le prix de l’HDV (net de taxe) dépasse la valeur d’extraction ({FAMILIES[family].extractionItemName} × génération). Le gain par jour tient compte du peu de ventes : au-delà des quantités vendables, le prix
          baisse.
        </p>
        <MountTable rows={sell.slice(0, 15)} maxVol={maxVol} empty="Aucune couleur ne se vend nettement mieux que son extraction sur ce serveur." />
      </Card>
      {senile.length > 0 && (
        <Card title={`Séniles probables (${senile.length})`}>
          <Callout tone="warn">
            Ces couleurs (G5 et plus) se vendent sous {Math.round(SENILE_PRICE_RATIO * 100)} % de leur valeur d’extraction : les ventes sont probablement des montures <strong>séniles</strong> (d’avant la 3.5, extraction = 1
            ressource). Ne les achetez pas pour les extraire sans vérifier leur état en jeu.
          </Callout>
          <MountTable rows={senile} maxVol={maxVol} empty="" />
        </Card>
      )}
      <Card
        title="Toutes les couleurs"
        actions={
          <button className="btn small" type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? 'Masquer' : `Afficher les ${all.length} couleurs`}
          </button>
        }
      >
        {showAll ? <MountTable rows={sorted} maxVol={maxVol} empty="Aucune couleur." /> : <small className="muted">Tableau complet : prix, volume, extraction et rapport prix ÷ extraction de chaque couleur.</small>}
      </Card>
    </div>
  )
}

// ---------- Section : comparaison entre serveurs ----------

/** Instantané de marché d'un autre serveur (lecture directe de son stockage, normalisé). */
function readServerMarket(server: ServerEntry): MarketSource | null {
  try {
    const raw = window.localStorage.getItem(serverStoreKey(server.id, 'market'))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    const snap = sanitizeMarketState(isPlainObject(parsed) ? parsed.state : undefined).state.snapshot
    return snap ? marketSourceOf(snap, server.priceStat, server.name) : null
  } catch {
    return null
  }
}

function ServersSection({ market, today, onImport }: { market: MarketSource; today: string; onImport: () => void }) {
  const servers = useProfiles((s) => s.registry.servers)
  const saleTax = useSettings((s) => s.saleTax)
  // Même statistique pour tous les serveurs (sinon l'écart mêle serveur et statistique) : celle du
  // serveur ouvert par défaut.
  const [stat, setStat] = useState<PriceStat>(market.stat)
  const list = useMemo<ServerMarket[]>(() => {
    const out: ServerMarket[] = []
    for (const s of servers) {
      const m = s.id === ACTIVE_SERVER_ID ? market : readServerMarket(s)
      if (m) out.push({ serverId: s.id, serverName: s.name, market: m })
    }
    return out
  }, [servers, market])
  const cmp = useMemo(() => compareServers(list, { today, saleTax, stat }), [list, today, saleTax, stat])
  if (!cmp)
    return (
      <Card>
        <Empty>
          Un seul serveur a des prix du marché ({list.map((s) => s.serverName).join(', ') || 'aucun'}). Importez l’export HDV d’un autre serveur pour comparer les économies côte à côte.{' '}
          <button className="btn small" type="button" onClick={onImport}>
            Importer un export HDV
          </button>
        </Empty>
      </Card>
    )
  const groups = [...new Set(cmp.rows.map((r) => r.group))]
  const ownStats = cmp.serverStats.some((x) => x !== cmp.stat)
  return (
    <Card
      title={`Comparaison de ${cmp.servers.length} serveurs`}
      actions={
        <label className="field">
          Statistique comparée
          <select value={stat} onChange={(e) => setStat(e.target.value as PriceStat)}>
            {PRICE_STATS.map((x) => (
              <option key={x} value={x}>
                {PRICE_STAT_LABELS[x]}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <small className="muted" style={{ display: 'block', marginBottom: 6 }}>
        Tous les serveurs sont comparés avec la même statistique : {PRICE_STAT_LABELS[cmp.stat].toLowerCase()}
        {ownStats ? '. Certains serveurs utilisent une autre statistique dans leurs propres calculs.' : '.'}
      </small>
      {cmp.warnings.map((w) => (
        <Callout key={w} tone="warn">
          {w}
        </Callout>
      ))}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Objet</th>
              {cmp.servers.map((s) => (
                <th key={s.serverId} className="num">
                  {s.serverName}
                  <small className="muted">
                    {frenchDay(s.exportDate)}
                    {s.ageDays !== null ? ` (${s.ageDays} j)` : ''}
                  </small>
                </th>
              ))}
              <th className="num">Écart</th>
            </tr>
          </thead>
          <tbody>
            <tr className="mkt-group">
              <td colSpan={cmp.servers.length + 2}>Valeurs dérivées</td>
            </tr>
            <tr>
              <td>Valeur d’un généton (brute)</td>
              {cmp.genetonValue.map((v, i) => (
                <td key={i} className="num">
                  {v === null ? '—' : formatKamas(v)}
                </td>
              ))}
              <td />
            </tr>
            {groups.map((g) => [
              <tr key={`g-${g}`} className="mkt-group">
                <td colSpan={cmp.servers.length + 2}>{g}</td>
              </tr>,
              ...cmp.rows
                .filter((r) => r.group === g)
                .map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    {r.cells.map((c, i) => (
                      <td key={i} className="num" title={`${formatNumber(c.sold24)} vendus/24 h, ≈ ${perDay(c.perDayAvg)}/jour`}>
                        {c.price === null ? <span className="muted">—</span> : formatKamas(c.price)}
                        {r.cheapest === i && r.spread !== null && r.spread > 0 && (
                          <small>
                            <Badge tone="ok">moins cher</Badge>
                          </small>
                        )}
                        {r.priciest === i && r.spread !== null && r.spread > 0 && (
                          <small>
                            <Badge tone="gold">plus cher</Badge>
                          </small>
                        )}
                      </td>
                    ))}
                    <td className="num">{r.spread === null ? '—' : formatPercent(r.spread, 0)}</td>
                  </tr>
                )),
            ])}
          </tbody>
        </table>
      </div>
      <small className="muted">Chaque serveur a sa propre économie : achetez là où c’est moins cher seulement si vous y jouez. Prix selon la statistique de chaque serveur.</small>
    </Card>
  )
}

// ---------- Panneau ----------

/** Onglet Prix › « Marché » (contexte de prix de la page : vos prix, marché du serveur, niveau d'Éleveur). */
export default function MarketInsightsPanel({ ctx, onImport }: { ctx: PriceContext; onImport: () => void }) {
  const [section, setSection] = useState<Section>('prix')
  const server = useActiveServer()
  const snapshot = useMarket((s) => s.snapshot)
  const rules = useRules()
  const jobLevel = useSettings((s) => s.jobLevel)
  const saleTax = useSettings((s) => s.saleTax)
  const today = useServerDay()
  const market = ctx.market ?? null
  const ins = useMemo(
    () => (market ? marketInsights({ market, ctx, rules, jobLevel, saleTax, share: server.maxMarketShare }, { today }) : null),
    [market, ctx, rules, jobLevel, saleTax, server.maxMarketShare, today],
  )
  if (!market || !ins)
    return (
      <Card>
        <Empty>
          Aucun prix du marché pour {server.name} : la lecture du marché (prix clés et volumes, fabriquer ou acheter, montures) s’appuie sur un export HDV.{' '}
          <button className="btn small primary" type="button" onClick={onImport}>
            Importer un export HDV (CSV)
          </button>
        </Empty>
      </Card>
    )
  const fr = ins.freshness
  const ex = ins.keyPrices.extraction
  return (
    <div className="stack mkt-panel">
      <Card
        title={`Marché de ${server.name}`}
        actions={
          <>
            <a className="btn small" href={href('rentabilite')}>
              Rentabilité →
            </a>
            <a className="btn small" href={href('modes')}>
              Modes de rentabilité →
            </a>
          </>
        }
      >
        {fr && <Callout tone={fr.tone}>{fr.message}</Callout>}
        <div className="kpis">
          {ex.map((l) => (
            <Stat key={l.id} label={l.name} value={l.price === null ? '—' : formatKamas(l.price)} hint={`${formatNumber(l.sold24)} vendus/24 h · ${perDay(l.sellablePerDay)} vendables/jour`} />
          ))}
          <Stat label="Généton (marché)" value={ins.keyPrices.genetons.value === null ? '—' : formatKamas(ins.keyPrices.genetons.value)} hint={ins.keyPrices.genetons.best?.name ?? 'boutique sans prix'} />
          <Stat label="Objets utiles chiffrés" value={snapshot ? formatNumber(snapshot.stats.useful) : '—'} hint={`${PRICE_STAT_LABELS[server.priceStat]} ; part vendable ${formatPercent(server.maxMarketShare, 0)}`} />
        </div>
        <ul className="plain mkt-notes">
          {ins.notes.map((n) => (
            <li key={n} className="muted">
              {n}
            </li>
          ))}
        </ul>
      </Card>
      <Tabs tabs={SECTIONS} value={section} onChange={setSection} />
      {section === 'prix' && <KeyPricesSection ins={ins} ctx={ctx} />}
      {section === 'craft' && <CraftSection ins={ins} />}
      {section === 'montures' && <MountsSection ins={ins} serverName={server.name} />}
      {section === 'serveurs' && <ServersSection market={market} today={today} onImport={onImport} />}
    </div>
  )
}
