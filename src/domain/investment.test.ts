// Tests de l'estimateur d'investissement (investment.ts) et de son worker.
import tylezia from '../data/market/tylezia-2026-10-02.json'
import { FUELS } from '../data'
import {
  allowedTiers,
  cashFlowOf,
  craftDaysFor,
  craftsByDay,
  investmentModeFamilies,
  investmentPriceContext,
  investmentShoppingText,
  jobTimeline,
  planInvestment,
  planInvestmentAsync,
  resaleSchedule,
  UNAVAILABLE_PRICE,
  type InvestmentInput,
} from './investment'
import { handleInvestmentRequest, type InvestmentWorkerMessage } from './investment.worker'
import { levelingPlan, paddocksAt } from './job'
import { buildSnapshot, marketSourceOf, parseHdvCsv, sanitizeSnapshot, type MarketSource } from './market'
import type { PriceContext } from './pricing'
import { runProduction } from './production'
import { RULESETS } from './rules'
import { jobXpForLevel } from './xp'

const rules = RULESETS['3.6']
const tyleziaMarket: MarketSource = marketSourceOf(sanitizeSnapshot(tylezia).snapshot!, 'auto', 'Tylezia')
const ctxAt = (jobLevel: number, market: MarketSource | null = tyleziaMarket): PriceContext => ({ overrides: {}, useDefaults: true, market, jobLevel })

/** Extrait réel de l'export HDV de Tylezia (02/10/2026) : objets fabriqués en montant le métier, ingrédient, ressource. */
const CSV_FIXTURE = [
  'gid;nom;niveau;type;categorie;vendus_24h;vendus_7j;vendus_30j;median_30j;moyen_30j;median_24h;kamas_par_jour',
  '19975;Corne de volkorne;60;Os;Ressource;10744;38301;127342;30205;32111;26497;128212170',
  "33331;Extrait de Mangeoire;25;Carburant d'enclos;Ressource;4093;25041;91971;1296;1284;1251;3973147",
  '32521;Filet de capture universel;1;Filet de capture;Consommables de combat;1187;20520;78731;1305;1317;1399;3424798',
  '33176;Volkorne Indigo;60;Volkorne;Familier;178;784;2750;16729;19334;6999;1533491',
  '11309;Pince du Fancrôme;140;Os;Ressource;1174;14072;70333;471;615;333;1104228',
  "33452;Gigantesque Potion de Baffeur;145;Carburant d'enclos;Ressource;128;450;1607;2161;2545;1222;115757",
  "33336;Grand Extrait de Baffeur;35;Carburant d'enclos;Ressource;301;2779;42446;36;36;58;50935",
].join('\n')

function fixtureMarket(): MarketSource {
  return marketSourceOf(buildSnapshot(parseHdvCsv(CSV_FIXTURE), { serverName: 'Tylezia', exportDate: '2026-10-02' }), 'auto', 'Tylezia')
}

function input(over: Partial<InvestmentInput> = {}, opts: InvestmentInput['options'] = {}): InvestmentInput {
  return {
    budget: 20_000_000,
    horizonDays: 60,
    mode: 'rush-corne',
    profile: { jobLevel: 1, hoursPerDay: 3, characters: 1, rules, family: 'volkorne' },
    safetyReserve: 2_000_000,
    prices: { ctx: ctxAt(1), saleTax: 0.02, maxMarketShare: 0.15 },
    today: '2026-10-02',
    ...over,
    options: { quick: true, runs: 2, sensitivity: false, ...opts },
  }
}

describe('modes et leviers', () => {
  it('« auto » évalue chaque mode comparé et chaque famille de la vente', () => {
    const all = investmentModeFamilies('auto')
    expect(all.map((m) => `${m.modeId}|${m.family}`)).toEqual([
      'rush-corne|volkorne',
      'rush-ambre|muldo',
      'rush-neurone|dragodinde',
      'brisage-pa|volkorne',
      'brisage-pm|muldo',
      'vente-montures|dragodinde',
      'vente-montures|muldo',
      'vente-montures|volkorne',
    ])
    expect(investmentModeFamilies('auto', { family: 'muldo', onlyFamily: true }).map((m) => m.modeId)).toEqual(['rush-ambre', 'brisage-pm', 'vente-montures'])
    expect(investmentModeFamilies('rush-ambre')).toHaveLength(1)
  })

  it('paliers : tous si l’achat est permis, sinon ceux dont un carburant est fabricable', () => {
    expect(allowedTiers(1, true)).toEqual([1, 2, 3, 4])
    expect(allowedTiers(1, false)).toEqual([])
    expect(allowedTiers(50, false)).toEqual([1])
    expect(allowedTiers(120, false)).toEqual([1, 2, 3])
  })

  it('carburants fabriqués seulement : coût des ingrédients à portée, indisponible au-delà', () => {
    const base = ctxAt(80)
    const ctx = investmentPriceContext(base, 80, { buyFuels: false, buyGear: true }, rules)
    expect(ctx.jobLevel).toBe(80)
    const low = FUELS.find((f) => f.level <= 80 && f.tier === 1)!
    const high = FUELS.find((f) => f.level > 80)!
    expect(ctx.overrides[String(high.id)]).toBe(UNAVAILABLE_PRICE)
    expect(ctx.overrides[String(low.id)]).toBeGreaterThan(0)
    expect(ctx.overrides[String(low.id)]).toBeLessThan(UNAVAILABLE_PRICE)
    // Achats permis : aucun prix forcé, seulement le niveau visé.
    const free = investmentPriceContext(base, 120, { buyFuels: true, buyGear: true }, rules)
    expect(free.overrides).toEqual({})
    expect(free.jobLevel).toBe(120)
  })
})

describe('montée du métier : crafts par jour, revente, calendrier des enclos', () => {
  const plan = levelingPlan(1, 80, ctxAt(1), { rules, metric: 'kamas' })

  it('répartit les crafts par jour sans dépasser le rythme et sans en perdre', () => {
    const per = craftsByDay(plan.segments, 2000)
    const days = craftDaysFor(plan.totals.crafts, 2000)
    expect(per.reduce((t, x) => t + x.crafts, 0)).toBe(plan.totals.crafts)
    for (let d = 0; d < days; d++) expect(per.filter((x) => x.day === d).reduce((t, x) => t + x.crafts, 0)).toBeLessThanOrEqual(2000)
    expect(Math.max(...per.map((x) => x.day))).toBe(days - 1)
  })

  it('revend les objets fabriqués à partir du lendemain, au plus la part du volume quotidien (CSV réel)', () => {
    const market = fixtureMarket()
    const ctx: PriceContext = { overrides: {}, useDefaults: false, market }
    const rs = resaleSchedule(plan.segments, 2000, 30, { ctx, saleTax: 0.02, share: 0.15 })
    expect(rs.byDay[0]).toBe(0)
    const mangeoire = rs.lines.find((l) => l.id === 33331)!
    // 91 971 vendus en 30 j → ≈ 3 066/jour × 15 % ≈ 460/jour : les 386 crafts partent le lendemain.
    expect(mangeoire.perDayCap).toBeCloseTo((91971 / 30) * 0.15, 3)
    expect(mangeoire.soldBySimEnd).toBe(mangeoire.qty)
    expect(mangeoire.unitNet).toBeCloseTo(1251 * 0.98, 6)
    const baffeur = rs.lines.find((l) => l.id === 33336)!
    const cap = (42446 / 30) * 0.15
    expect(baffeur.soldBySimEnd).toBeLessThanOrEqual(Math.floor(cap * 30) + 1)
    // Objets absents de l'export : liquidité inconnue → rien de vendu, jamais un revenu inventé.
    const unknown = rs.lines.filter((l) => l.perDayCap === null)
    expect(unknown.length).toBeGreaterThan(0)
    for (const l of unknown) expect(l.revenue).toBe(0)
    expect(rs.total).toBeLessThanOrEqual(rs.potential + 1e-6)
    expect(rs.byDay.reduce((t, x) => t + x, 0)).toBeCloseTo(rs.total, 3)
  })

  it('un niveau atteint en fin de journée débloque son enclos le lendemain ; l’XP d’élevage compte aussi', () => {
    const curve: [number, number][] = [[0, 0], ...plan.progress.map((p) => [p.crafts, p.xp] as [number, number])]
    const crafted = jobTimeline({ from: 1, target: 80, curve, crafts: plan.totals.crafts, craftsPerDay: 2000, naturalXp: [], days: 30 })
    // 1 579 crafts pour le niveau 40 : atteint le jour 0 → 2 enclos dès le jour 1.
    expect(crafted.initialPaddocks).toBe(2)
    const at80 = crafted.levelDays.find((l) => l.level === 80 && l.kind === 'enclos')!
    expect(at80.source).toBe('craft')
    expect(crafted.schedule).toContainEqual({ day: at80.day + 1, paddocks: 3 })
    // Sans crafts : 1 000 XP d'élevage par jour → niveau 40 (15 600 XP) le jour 16, enclos le jour 17.
    const natural = jobTimeline({ from: 1, target: 1, curve: null, crafts: 0, craftsPerDay: 2000, naturalXp: Array.from({ length: 31 }, (_, i) => (i === 0 ? 0 : 1000)), days: 30 })
    expect(jobXpForLevel(40)).toBe(15_600)
    expect(natural.initialPaddocks).toBe(1)
    expect(natural.levelDays.find((l) => l.level === 40)).toMatchObject({ day: 16, source: 'elevage' })
    expect(natural.schedule[0]).toEqual({ day: 17, paddocks: 2 })
    expect(paddocksAt(natural.levels[30])).toBe(2)
  })
})

describe('trésorerie', () => {
  it('cumule achats du jour 0, socle, coûts, revenus et revente ; point mort = cumul positif pour de bon', () => {
    const summary = runProduction(
      { family: 'volkorne', mode: 'extraction', targetGeneration: 3, paddocks: 2, hoursPerDay: 3, characters: 1, jobLevel: 40, rules, prices: { ctx: ctxAt(40) }, horizonDays: 30, tier: 2 },
      { runs: 2 },
    )
    const resale = Array.from({ length: 31 }, (_, d) => (d === 1 ? 100_000 : 0))
    const cash = cashFlowOf(summary, { day0Fixed: 1_000_000, socle: [{ day: 0, amount: 50_000 }, { day: 5, amount: 50_000 }], resale })
    expect(cash.points).toHaveLength(31)
    expect(cash.day0).toBe(1_050_000)
    expect(cash.points[0].cumulative).toBe(-1_050_000)
    expect(cash.points[5].investment).toBe(50_000)
    expect(cash.points[1].resale).toBe(100_000)
    let cum = 0
    for (const p of cash.points) {
      cum += p.net
      expect(p.cumulative).toBeCloseTo(cum, 3)
      expect(p.cumulativeLow).toBeLessThanOrEqual(p.cumulativeHigh + 1e-6)
    }
    expect(cash.peakOutlay).toBeGreaterThanOrEqual(1_050_000)
    if (cash.breakEvenDay !== null && !cash.breakEvenEstimated) {
      expect(cash.points[cash.breakEvenDay].cumulative).toBeGreaterThanOrEqual(0)
      expect(cash.points[cash.breakEvenDay - 1].cumulative).toBeLessThan(0)
      for (const p of cash.points.slice(cash.breakEvenDay)) expect(p.cumulative).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('planInvestment — Tylezia 02/10/2026', () => {
  it('20 M en Rush Volkorne : plan daté dans le budget, point mort, bénéfice par jour', () => {
    const r = planInvestment(input({}, { sensitivity: true }))
    const p = r.plan!
    expect(r.feasible).toBe(true)
    expect(r.available).toBe(18_000_000)
    // Le budget n'est jamais dépassé : jour 0 + fonds de roulement (10e centile) ≤ budget − réserve.
    expect(p.peakOutlay).toBeLessThanOrEqual(r.available)
    expect(p.day0).toBeLessThanOrEqual(p.peakOutlay + 1e-6)
    for (const pt of p.cashflow) expect(-pt.cumulativeLow).toBeLessThanOrEqual(r.available + 1)
    expect(p.allocation.modeId).toBe('rush-corne')
    expect(p.allocation.jobTo).toBeGreaterThan(1)
    expect(p.leveling).not.toBeNull()
    expect(p.complete).toBe(true)
    expect(p.profitStatus).toBe('exact')
    expect(p.breakEvenDay).not.toBeNull()
    expect(p.breakEvenDay!).toBeLessThanOrEqual(60)
    expect(p.steadyNetPerDay).toBeGreaterThan(100_000)
    expect(p.profitAtHorizon).toBeGreaterThan(0)
    expect(p.projections.map((x) => x.day)).toEqual([30, 60, 90])
    expect(p.projections[2].cumulative).toBeGreaterThan(p.projections[0].cumulative)
    // Liste de courses du jour 0 : ingrédients du métier = coût de la montée.
    const metier = r.shopping.filter((x) => x.category === 'metier')
    expect(metier.reduce((t, x) => t + (x.total ?? 0), 0)).toBeCloseTo(p.leveling!.cost, -2)
    expect(investmentShoppingText(r.shopping)).toContain(' × ')
    // Plan d'action chronologique, en français, avec achats, crafts, enclos, ventes et point mort.
    expect(r.actions[0]).toMatchObject({ day: 0, kind: 'achat' })
    for (let i = 1; i < r.actions.length; i++) expect(r.actions[i].day).toBeGreaterThanOrEqual(r.actions[i - 1].day)
    const kinds = new Set(r.actions.map((a) => a.kind))
    for (const k of ['achat', 'craft', 'enclos', 'production', 'vente', 'jalon'] as const) expect(kinds.has(k)).toBe(true)
    expect(r.actions.some((a) => /Point mort/.test(a.title))).toBe(true)
    expect(r.actions.find((a) => a.kind === 'production' && /Régime|Routine/.test(a.title))!.details.some((d) => /Corne de volkorne/.test(d))).toBe(true)
    // Feuille de route, alternatives, sensibilité, risques.
    expect(r.roadmap[0].kind).toBe('depart')
    expect(r.roadmap.some((m) => m.kind === 'point-mort')).toBe(true)
    expect(r.alternatives.length).toBeGreaterThanOrEqual(2)
    expect(r.alternatives.filter((a) => a.chosen)).toHaveLength(1)
    expect(r.alternatives.some((a) => a.allocation.jobTo === 1)).toBe(true)
    const sens = Object.fromEntries(r.sensitivity.map((x) => [x.id, x]))
    expect(Object.keys(sens)).toEqual(expect.arrayContaining(['reference', 'prix-bas', 'prix-haut', 'couts', 'duree', 'liquidite']))
    expect(sens['prix-bas'].delta).toBeLessThan(0)
    expect(sens['prix-haut'].delta).toBeGreaterThan(0)
    expect(sens.couts.delta).toBeLessThan(0)
    expect(sens.duree.delta).toBeLessThan(0)
    expect(sens.liquidite.delta).toBeLessThanOrEqual(1)
    expect(r.risks.some((x) => x.code === 'prix-dates')).toBe(true)
    expect(r.risks.some((x) => x.code === 'volume' && /Corne de volkorne/.test(x.text))).toBe(true)
    expect(r.marketDate).toBe('2026-10-02')
    expect(r.assumptions.some((a) => /crafts\/jour/.test(a))).toBe(true)
  })

  it('le budget n’est jamais dépassé, quel que soit le budget', () => {
    for (const budget of [1_000_000, 5_000_000]) {
      const r = planInvestment(input({ budget, safetyReserve: 0 }, { runs: 1 }))
      expect(r.feasible).toBe(true)
      expect(r.plan!.peakOutlay).toBeLessThanOrEqual(budget)
      for (const a of r.alternatives.filter((x) => x.chosen)) expect(a.peakOutlay).toBeLessThanOrEqual(budget)
    }
  })

  it('budget insuffisant : le dit et donne le minimum utile', () => {
    const r = planInvestment(input({ budget: 20_000, safetyReserve: 0 }, { runs: 1 }))
    expect(r.feasible).toBe(false)
    expect(r.minimumBudget).not.toBeNull()
    expect(r.minimumBudget!).toBeGreaterThan(20_000)
    expect(r.notes[0]).toMatch(/Budget insuffisant/)
    expect(r.plan!.peakOutlay).toBeGreaterThan(20_000)
    // Le plan proposé est celui du minimum : avec ce budget, un plan tient.
    expect(r.minimumBudget!).toBeGreaterThanOrEqual(r.plan!.peakOutlay + r.reserve)
    const again = planInvestment(input({ budget: r.minimumBudget!, safetyReserve: 0 }, { runs: 1 }))
    expect(again.feasible).toBe(true)
    expect(again.plan!.peakOutlay).toBeLessThanOrEqual(r.minimumBudget!)
  })

  it('sans montée du métier ni achat de G1 : niveau actuel, captures seulement', () => {
    const r = planInvestment(input({ levers: { levelJob: false, buyG1: false } }, { runs: 1 }))
    const p = r.plan!
    expect(p.allocation.jobTo).toBe(1)
    expect(p.leveling).toBeNull()
    expect(p.allocation.g1Stock).toBe(0)
    expect(p.summary.totals.bought).toBe(0)
    expect(r.shopping.some((x) => x.category === 'metier' || x.category === 'montures')).toBe(false)
  })

  it('carburants fabriqués seulement : jamais un carburant hors de portée ni un prix sentinelle', () => {
    const r = planInvestment(input({ profile: { jobLevel: 60, hoursPerDay: 3, characters: 1, rules }, prices: { ctx: ctxAt(60) }, levers: { buyFuels: false, levelJob: false } }, { runs: 1 }))
    const p = r.plan!
    expect(p.allocation.tier).toBeLessThanOrEqual(2)
    for (const l of p.summary.prices) if (l.value !== null) expect(l.value).toBeLessThan(UNAVAILABLE_PRICE / 1e5)
    expect(p.summary.steady.costKnown).toBeLessThan(10_000_000)
  })

  it('« auto » compare les modes et retient le plus rentable dans le budget', () => {
    const r = planInvestment(input({ mode: 'auto' }, { runs: 1 }))
    expect(r.plan!.feasible).toBe(true)
    const others = r.alternatives.filter((a) => !a.chosen && a.feasible)
    for (const a of others) expect(a.profitAtHorizon).toBeLessThanOrEqual(r.plan!.profitAtHorizon + 1)
  })

  it('un prix inconnu n’est jamais compté 0 : sans marché ni défauts, montants incomplets et niveaux écartés', () => {
    const ctx: PriceContext = { overrides: {}, useDefaults: false, market: null, jobLevel: 1 }
    const r = planInvestment(input({ prices: { ctx } }, { runs: 1 }))
    const p = r.plan!
    expect(p.complete).toBe(false)
    expect(p.profitStatus).not.toBe('exact')
    expect(p.missing.length).toBeGreaterThan(0)
    // La montée du métier, au coût inconnu, n'est jamais choisie comme si elle était gratuite.
    expect(p.leveling).toBeNull()
    expect(r.notes.some((x) => /coût de la montée inconnu/.test(x))).toBe(true)
    expect(r.risks.some((x) => x.code === 'pas-de-marche')).toBe(true)
  })

  it('reproductible : même entrée, même plan', () => {
    const a = planInvestment(input({ budget: 3_000_000, safetyReserve: 0 }, { runs: 1 }))
    const b = planInvestment(input({ budget: 3_000_000, safetyReserve: 0 }, { runs: 1 }))
    expect(b.plan!.allocation).toEqual(a.plan!.allocation)
    expect(b.plan!.profitAtHorizon).toBe(a.plan!.profitAtHorizon)
  })

  it('version asynchrone (repli sans Worker) : même résultat, et arrêt possible', async () => {
    const sync = planInvestment(input({ budget: 3_000_000, safetyReserve: 0 }, { runs: 1 }))
    const asyncRes = await planInvestmentAsync(input({ budget: 3_000_000, safetyReserve: 0 }, { runs: 1 }))
    expect(asyncRes!.plan!.allocation).toEqual(sync.plan!.allocation)
    expect(await planInvestmentAsync(input(), { shouldStop: () => true })).toBeNull()
  })
})

describe('worker', () => {
  it('publie la progression puis le résultat ; erreur lisible sur une requête invalide', () => {
    const msgs: InvestmentWorkerMessage[] = []
    handleInvestmentRequest({ type: 'plan', requestId: 7, input: input({ budget: 2_000_000, safetyReserve: 0 }, { runs: 1 }) }, (m) => msgs.push(m))
    const last = msgs[msgs.length - 1]
    expect(last.type).toBe('result')
    expect(last.requestId).toBe(7)
    expect(msgs.some((m) => m.type === 'progress')).toBe(true)
    const progress = msgs.filter((m) => m.type === 'progress')
    for (const m of progress) if (m.type === 'progress') expect(m.done).toBeLessThanOrEqual(m.total)
    const errs: InvestmentWorkerMessage[] = []
    handleInvestmentRequest({ type: 'plan', requestId: 8, input: null as unknown as InvestmentInput }, (m) => errs.push(m))
    expect(errs).toEqual([{ type: 'error', requestId: 8, message: expect.stringMatching(/invalide/) }])
  })
})
