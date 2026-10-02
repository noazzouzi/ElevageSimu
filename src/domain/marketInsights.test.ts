// Lecture du marché d'un serveur (tableau de bord, fabriquer ou acheter, montures, comparaison entre
// serveurs, fraîcheur) : petit extrait réel de l'export HDV de Tylezia (02/10/2026) et préréglage complet.
import { describe, expect, it } from 'vitest'
import { FUELS, MAKINAS, NETS, SPECIES, getRecipe } from '../data'
import tylezia from '../data/market/tylezia-2026-10-02.json'
import { fuelDurability } from './fuel'
import { buildSnapshot, marketSourceOf, parseHdvCsv, sanitizeSnapshot, type MarketSource } from './market'
import {
  COMPARE_ITEMS,
  MARKET_OLD_DAYS,
  compareServers,
  craftVsBuy,
  craftVsBuySummary,
  fuelPointCosts,
  generationCurves,
  keyPriceDashboard,
  makinaPriceCurves,
  marketInsights,
  marketLine,
  mountMarket,
  sellRatherThanExtract,
  snapshotFreshness,
} from './marketInsights'
import { craftCost } from './pricing'
import { RULESETS } from './rules'

const R36 = RULESETS['3.6']
const R37 = RULESETS['3.7']

/** Lignes réelles de l'export HDV de Tylezia (02/10/2026). */
const FIXTURE = [
  'gid;nom;niveau;type;categorie;vendus_24h;vendus_7j;vendus_30j;median_30j;moyen_30j;median_24h;kamas_par_jour',
  '19975;Corne de volkorne;60;Os;Ressource;10744;38301;127342;30205;32111;26497;128212170',
  '17864;Ambre de muldo;60;Ressource diverse;Ressource;2410;18645;72027;33823;33930;31285;81205640',
  '33515;Neurone de dragodinde;60;Ressource diverse;Ressource;2203;17611;67939;26056;28517;28987;59007286',
  '1557;Rune Ga Pa;100;Rune de forgemagie;Ressource;10673;85651;310552;29534;29646;28598;305728092',
  '1558;Rune Ga Pme;95;Rune de forgemagie;Ressource;10429;75498;239222;21460;21898;21509;171123470',
  '15271;Tourmaline;10;Pierre précieuse;Ressource;2281;21349;74269;44355;44826;43364;109806716',
  '14635;Pépite;1;Pierre précieuse;Ressource;1289489;8644832;32010194;290;291;274;309431875',
  '34203;Parchemin d’Éleveur;1;Parchemin d’expérience;Consommable;815;19895;63377;7160;7330;6494;15125977',
  '814;Puissant Parchemin de Chance;1;Parchemin de caractéristique;Consommable;1245;8369;32905;68823;68405;70298;75487360',
  '809;Petit Parchemin de Chance;1;Parchemin de caractéristique;Consommable;1503;12301;45497;5393;5323;5079;8178844',
  '33247;Volkorne Saphir et Prune;60;Volkorne;Familier;0;3;3;38000;38000;0;3800',
  '33144;Volkorne Améthyste et Amande;60;Volkorne;Familier;0;3;3;750000;1048888;0;75000',
  '33252;Volkorne Turquoise et Indigo;60;Volkorne;Familier;12;91;343;708999;806470;820000;8106221',
  '33072;Muldo Doré;60;Muldo;Familier;22;225;975;11847;21627;13831;385027',
  '33331;Extrait de Mangeoire;25;Carburant d’enclos;Ressource;4093;25041;91971;1296;1284;1251;3973147',
].join('\n')

const fixture: MarketSource = marketSourceOf(buildSnapshot(parseHdvCsv(FIXTURE), { serverName: 'Tylezia', exportDate: '2026-10-02', importedAt: 0 }), 'auto', 'Tylezia')
const ty: MarketSource = marketSourceOf(sanitizeSnapshot(tylezia).snapshot!, 'auto', 'Tylezia')
const byName = (name: string) => SPECIES.find((s) => s.name === name)!

describe('ligne de marché d’un objet', () => {
  it('prix (statistique du serveur), net de taxe, volumes et quantité vendable', () => {
    const l = marketLine(fixture, 19975, { saleTax: 0.02, share: 0.15 })
    expect(l).toMatchObject({ name: 'Corne de volkorne', price: 26_497, stat: 'median24', sold24: 10_744, sold7: 38_301, sold30: 127_342, kamasPerDay: 128_212_170, confidence: 'high', absent: false })
    expect(l.net).toBeCloseTo(26_497 * 0.98, 6)
    expect(l.perDayAvg).toBeCloseTo(127_342 / 30, 6)
    expect(l.sellablePerDay).toBeCloseTo((127_342 / 30) * 0.15, 6)
    // Aucune vente en 24 h : médiane 30 j.
    expect(marketLine(fixture, 33144)).toMatchObject({ price: 750_000, stat: 'median30', confidence: 'low' })
    // Absent : jamais 0.
    expect(marketLine(fixture, 999_999)).toMatchObject({ price: null, net: null, absent: true, confidence: null, sellablePerDay: 0 })
  })
})

describe('(a) prix clés de l’élevage', () => {
  const d = keyPriceDashboard({ market: fixture, rules: R36, saleTax: 0.02 })

  it('ressources d’extraction, runes de brisage (facteur sur les rendements), autres', () => {
    expect(d.extraction.map((l) => [l.family, l.price, l.sold24])).toEqual([
      ['dragodinde', 28_987, 2_203],
      ['muldo', 31_285, 2_410],
      ['volkorne', 26_497, 10_744],
    ])
    expect(d.extraction[2].perGenerationNet).toBeCloseTo(26_497 * 0.98, 6)
    const pa = d.runes.find((r) => r.id === 1557)!
    const pme = d.runes.find((r) => r.id === 1558)!
    expect(pa).toMatchObject({ family: 'volkorne', price: 28_598, defaultPrice: 30_000 })
    expect(pme).toMatchObject({ family: 'muldo', price: 21_509, defaultPrice: 18_000 })
    expect(pme.scale).toBeCloseTo(21_509 / 18_000, 10)
    expect(d.others.map((l) => [l.id, l.price])).toEqual([
      [14635, 274],
      [34203, 6_494],
      [15271, 43_364],
    ])
  })

  it('boutique de génétons : meilleur échange (prix ÷ coût), valeur brute et nette', () => {
    expect(d.genetons.best).toMatchObject({ id: 809, cost: 10 })
    expect(d.genetons.value).toBeCloseTo(507.9, 10)
    expect(d.genetons.net).toBeCloseTo(507.9 * 0.98, 10)
    const priced = d.genetons.lines.filter((l) => l.perGeneton !== null)
    expect(priced.map((l) => l.id)).toEqual([809, 814, 15271]) // 507,9 > 439,4 > 333,6
    expect(d.genetons.lines.at(-1)!.perGeneton).toBeNull() // objets sans prix en dernier, jamais 0
  })

  it('sans marché des ingrédients : carburants, makinas et filets « inconnus », jamais 0', () => {
    const mangeoireT1 = d.fuels.find((f) => f.gauge === 'mangeoire' && f.tier === 1)!
    expect(mangeoireT1.buy).toMatchObject({ price: 1_251 }) // Extrait de Mangeoire
    expect(mangeoireT1.buy!.perPoint).toBeCloseTo(1_251 / 3_000, 10)
    expect(mangeoireT1.best).toBe('achat')
    const foudroyeurT4 = d.fuels.find((f) => f.gauge === 'foudroyeur' && f.tier === 4)!
    expect(foudroyeurT4).toMatchObject({ buy: null, craft: null, best: null, bestPerPoint: null })
    expect(d.makinas.length).toBe(MAKINAS.length)
    expect(d.makinas.every((m) => m.line.price === null)).toBe(true)
    expect(d.nets.every((n) => n.perMount === null)).toBe(true)
  })
})

describe('(a) coût au point par jauge et palier — Tylezia', () => {
  it('le moins cher des 5 tailles, à l’achat et en fabriquant ; le craft ne compte que s’il est à votre portée', () => {
    for (const jobLevel of [1, 200]) {
      const rows = fuelPointCosts({ market: ty, rules: R36, jobLevel })
      expect(rows.length).toBe(24)
      for (const row of rows) {
        const fuels = FUELS.filter((f) => f.gauge === row.gauge && f.tier === row.tier)
        const buys = fuels.map((f) => (ty.rows[String(f.id)] ? marketLine(ty, f.id).price : null)).map((p, i) => (p === null ? Infinity : p / fuelDurability(fuels[i], R36)))
        if (row.buy) expect(row.buy.perPoint).toBeCloseTo(Math.min(...buys), 10)
        else expect(Math.min(...buys)).toBe(Infinity)
        if (row.best === 'craft') {
          expect(row.craft!.canCraft).toBe(true)
          expect(row.craft!.perPoint).toBeLessThan(row.buy?.perPoint ?? Infinity)
        }
        if (row.best === 'achat' && row.craft?.canCraft) expect(row.buy!.perPoint).toBeLessThanOrEqual(row.craft.perPoint)
      }
      // Au niveau 1, aucun carburant n'est fabricable (niv. 5 au minimum) : tout s'achète.
      if (jobLevel === 1) expect(rows.every((r) => r.best !== 'craft')).toBe(true)
    }
    // Règles 3.7 : durabilité ×2 → coût au point divisé par 2.
    const a = fuelPointCosts({ market: ty, rules: R36 }).find((r) => r.gauge === 'mangeoire' && r.tier === 1)!
    const b = fuelPointCosts({ market: ty, rules: R37 }).find((r) => r.gauge === 'mangeoire' && r.tier === 1)!
    expect(b.buy!.perPoint).toBeCloseTo(a.buy!.perPoint / 2, 10)
  })

  it('makinas par génération : séries triées, prix du serveur et coût de craft', () => {
    const curves = makinaPriceCurves(keyPriceDashboard({ market: ty, rules: R36 }).makinas)
    expect(curves.length).toBe(9) // 3 familles × 3 types
    for (const c of curves) {
      expect(c.points.map((p) => p.generation)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
      for (const p of c.points) if (p.price !== null) expect(p.price).toBeGreaterThan(0)
    }
    const priced = curves.flatMap((c) => c.points).filter((p) => p.price !== null).length
    expect(priced).toBe(74) // 74/81 makinas en vente sur Tylezia (SPEC-v2 §1)
  })
})

describe('(b) fabriquer ou acheter — Tylezia', () => {
  const rows = craftVsBuy({ market: ty, rules: R36, jobLevel: 200, saleTax: 0.02 })

  it('chaque carburant, makina et filet : moins cher, économie, marge et bénéfice plafonné par la liquidité', () => {
    expect(rows.length).toBe(FUELS.length + MAKINAS.length + NETS.length)
    for (const r of rows) {
      if (r.cheaper === 'craft') expect(r.saving!).toBeGreaterThan(0)
      if (r.saving !== null && r.cheaper === 'achat') expect(r.saving).toBeLessThan(0)
      if (r.margin !== null) expect(r.margin).toBeCloseTo(r.buy.net! - r.craft!.cost, 6)
      if (r.profitPerDay !== null) {
        expect(r.margin!).toBeGreaterThan(0)
        const volume = r.ingredientCapPerDay === null ? r.sellablePerDay : Math.min(r.sellablePerDay, r.ingredientCapPerDay)
        expect(r.profitPerDay).toBeCloseTo(r.margin! * volume, 6)
      }
      // Jamais un prix inconnu compté 0.
      if (r.buy.price === null) expect(r.margin).toBeNull()
    }
    // Trié par bénéfice journalier décroissant.
    const profits = rows.map((r) => r.profitPerDay ?? -1)
    expect(profits).toEqual([...profits].sort((a, b) => b - a))
  })

  it('Extrait de Mangeoire : coût des ingrédients au prix du serveur contre 1 251 à l’HDV', () => {
    const r = rows.find((x) => x.id === 33331)!
    const craft = craftCost(33331, { overrides: {}, useDefaults: false, market: ty })!
    expect(craft.complete).toBe(true)
    expect(r.craft!.cost).toBeCloseTo(craft.total, 6)
    expect(r.buy.price).toBe(1_251)
    expect(r.cheaper).toBe(craft.total < 1_251 ? 'craft' : 'achat')
    expect(r.xp).toBe(0) // niveau 200 : bien trop facile (J − L > 100)
    // Plafond des ingrédients : min sur les ingrédients de (15 % du volume moyen ÷ quantité).
    const caps = getRecipe(33331)!.ingredients.map((i) => (ty.rows[String(i.id)][5] / 30) * 0.15 / i.qty)
    expect(r.ingredientCapPerDay).toBeCloseTo(Math.min(...caps), 6)
  })

  it('résumé : décompte et crafts rentables à votre portée ; niveau 1 : rien de fabricable au-delà du niveau 1', () => {
    const s = craftVsBuySummary(rows)
    expect(s.craftCheaper + s.buyCheaper + s.equal + s.unknown).toBe(rows.length)
    expect(s.craftCheaper).toBeGreaterThan(0)
    expect(s.buyCheaper).toBeGreaterThan(0)
    expect(s.profitable.length).toBeGreaterThan(0)
    expect(s.profitable.every((r) => r.canCraft && (r.profitPerDay ?? 0) > 0)).toBe(true)
    const low = craftVsBuySummary(craftVsBuy({ market: ty, rules: R36, jobLevel: 1 }))
    expect(low.profitable.every((r) => r.level <= 1)).toBe(true)
    // Seulement les carburants.
    expect(craftVsBuy({ market: ty, rules: R36 }, { kinds: ['carburant'] }).length).toBe(FUELS.length)
  })
})

describe('(c) marché des montures', () => {
  const rows = mountMarket({ market: fixture, rules: R36, saleTax: 0.02 })

  it('prix (HDV mixte) et volume par espèce face à la valeur d’extraction ; séniles probables', () => {
    const saphir = rows.find((r) => r.speciesId === byName('Volkorne Saphir et Prune').id)!
    expect(saphir).toMatchObject({ generation: 10, possibleSenile: true, sellAboveExtraction: false })
    expect(saphir.extraction).toMatchObject({ qty: 10, unitPrice: 26_497, gross: 264_970 })
    const amethyste = rows.find((r) => r.speciesId === byName('Volkorne Améthyste et Amande').id)!
    expect(amethyste).toMatchObject({ possibleSenile: false, sellAboveExtraction: true })
    expect(amethyste.premium).toBeCloseTo(750_000 * 0.98 - 264_970 * 0.98, 6)
    expect(amethyste.ratio).toBeCloseTo(750_000 / 264_970, 10)
    expect(amethyste.extraPerDay).toBeCloseTo(amethyste.premium! * (3 / 30) * 0.15, 6)
    // Espèce sans ligne : prix inconnu, jamais 0.
    const unknown = rows.find((r) => r.line.absent)!
    expect(unknown).toMatchObject({ premium: null, ratio: null, sellAboveExtraction: false, possibleSenile: false, extraPerDay: null })
    expect(mountMarket({ market: fixture, rules: R36 }, 'muldo').every((r) => r.family === 'muldo')).toBe(true)
  })

  it('vendre plutôt qu’extraire : G2+, hors séniles, trié par gain journalier plafonné par la liquidité', () => {
    const list = sellRatherThanExtract(rows)
    expect(list.map((r) => r.name)).toEqual(['Volkorne Turquoise et Indigo', 'Volkorne Améthyste et Amande'])
    expect(list.every((r) => r.generation >= 2 && !r.possibleSenile)).toBe(true)
    expect(sellRatherThanExtract(rows, { minConfidence: 'high' }).map((r) => r.name)).toEqual(['Volkorne Turquoise et Indigo'])
  })

  it('courbes par génération (préréglage) : médiane, extrêmes, volume et valeur d’extraction', () => {
    const all = mountMarket({ market: ty, rules: R36 })
    const curves = generationCurves(all)
    const volk = curves.volkorne!
    expect(volk.map((p) => p.generation)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const g10 = volk.find((p) => p.generation === 10)!
    const prices = all.filter((r) => r.family === 'volkorne' && r.generation === 10 && r.line.price !== null).map((r) => r.line.price as number).sort((a, b) => a - b)
    expect(g10.priced).toBe(prices.length)
    expect(g10.min).toBe(prices[0])
    expect(g10.max).toBe(prices.at(-1))
    const mid = Math.floor(prices.length / 2)
    expect(g10.median).toBe(prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2)
    expect(g10.extractionGross).toBeCloseTo(10 * marketLine(ty, 19975).price!, 6)
    expect(volk[0].extractionGross).toBe(0) // G1 : rien à extraire
    expect(g10.senileSuspects).toBe(all.filter((r) => r.family === 'volkorne' && r.generation === 10 && r.possibleSenile).length)
  })
})

describe('(d) comparaison entre serveurs', () => {
  const other: MarketSource = {
    ...fixture,
    serverName: 'Draconiros',
    exportDate: '2026-09-20',
    rows: { ...fixture.rows, '19975': [60_000, 60_000, 60_000, 500, 3_000, 12_000, 30_000_000] },
  }

  it('moins de 2 serveurs : rien à comparer', () => {
    expect(compareServers([{ serverId: 'tylezia', serverName: 'Tylezia', market: fixture }])).toBeNull()
  })

  it('objets clés côte à côte, le moins cher et le plus cher, écart ; dates éloignées signalées', () => {
    const c = compareServers(
      [
        { serverId: 'tylezia', serverName: 'Tylezia', market: fixture },
        { serverId: 'draco', serverName: 'Draconiros', market: other },
      ],
      { today: '2026-10-10' },
    )!
    expect(c.servers.map((s) => [s.serverName, s.ageDays])).toEqual([
      ['Tylezia', 8],
      ['Draconiros', 20],
    ])
    expect(c.rows.length).toBe(COMPARE_ITEMS.length)
    const corne = c.rows.find((r) => r.id === 19975)!
    expect(corne.cells.map((x) => x.price)).toEqual([26_497, 60_000])
    expect(corne).toMatchObject({ cheapest: 0, priciest: 1, group: 'Ressources d’extraction' })
    expect(corne.spread).toBeCloseTo(60_000 / 26_497 - 1, 10)
    const ambre = c.rows.find((r) => r.id === 17864)!
    expect(ambre.spread).toBe(0)
    // Objet sans prix des deux côtés : pas d'extrêmes.
    const net = c.rows.find((r) => r.group === 'Filets')!
    expect(net).toMatchObject({ cheapest: null, priciest: null, spread: null })
    expect(c.genetonValue[0]).toBeCloseTo(507.9, 10)
    expect(c.warnings.some((w) => w.includes('12 jours'))).toBe(true) // 20/09 → 02/10
    expect(c.warnings.some((w) => w.startsWith('Draconiros'))).toBe(true) // plus de 14 jours
  })
})

describe('(e) fraîcheur de l’export', () => {
  it('frais ≤ 14 jours, à rafraîchir ≤ 30 jours, périmé au-delà ; date illisible ou future', () => {
    expect(snapshotFreshness('2026-10-02', '2026-10-02')).toMatchObject({ level: 'frais', tone: 'ok', ageDays: 0 })
    expect(snapshotFreshness('2026-10-02', '2026-10-02').message).toMatch(/aujourd’hui/)
    expect(snapshotFreshness('2026-09-18', '2026-10-02')).toMatchObject({ level: 'frais', ageDays: 14 })
    expect(snapshotFreshness('2026-09-17', '2026-10-02')).toMatchObject({ level: 'a-rafraichir', tone: 'warn', ageDays: 15 })
    expect(snapshotFreshness('2026-08-01', '2026-10-02')).toMatchObject({ level: 'perime', tone: 'danger' })
    expect(snapshotFreshness('2026-08-01', '2026-10-02').ageDays!).toBeGreaterThan(MARKET_OLD_DAYS)
    expect(snapshotFreshness('', '2026-10-02')).toMatchObject({ level: 'inconnu', ageDays: null })
    expect(snapshotFreshness('2026-10-05', '2026-10-02')).toMatchObject({ level: 'inconnu', ageDays: -3 })
  })
})

describe('lecture complète du marché (préréglage de Tylezia)', () => {
  it('tableau de bord, craft, montures, séniles probables et rappels, en un appel', () => {
    const t0 = Date.now()
    const ins = marketInsights({ market: ty, rules: R36, jobLevel: 100, saleTax: 0.02 }, { today: '2026-10-02' })
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(ins.freshness?.level).toBe('frais')
    expect(ins.keyPrices.extraction.every((l) => l.price !== null)).toBe(true)
    expect(ins.keyPrices.genetons.value).toBeGreaterThan(400)
    expect(ins.craft.length).toBe(FUELS.length + MAKINAS.length + NETS.length)
    expect(ins.mounts.length).toBe(SPECIES.filter((s) => s.breedable && s.itemId).length)
    expect(ins.senileSuspects.every((m) => m.generation >= 5)).toBe(true)
    expect(ins.senileSuspects.length).toBeGreaterThan(10) // G8–G10 « bradées » (SPEC-v2 §1)
    expect(ins.sellRatherThanExtract.length).toBeGreaterThan(0)
    expect(ins.notes.length).toBe(3)
    expect(marketInsights({ market: ty, rules: R36 }).freshness).toBeNull()
  })
})
