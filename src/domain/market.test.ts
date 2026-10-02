// Prix du marché importés (export CSV de l'HDV) : lecture tolérante, instantané compact, statistique de
// prix, liquidité, valeur du généton, évolution, préréglage de Tylezia et résolution des prix.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FUELS, INGREDIENTS, MAKINAS, NETS, SPECIES } from '../data'
import tylezia from '../data/market/tylezia-2026-10-02.json'
import {
  AUTO_MIN_SOLD_24H,
  GENETON_SHOP,
  KEY_MARKET_IDS,
  buildSnapshot,
  diffPrices,
  exportAgeDays,
  genetonValueFromMarket,
  historyEntryOf,
  isIsoDay,
  keyPrices,
  marketConfidence,
  marketDepth,
  marketMountReference,
  marketSourceOf,
  normalizeHeader,
  parseHdvCsv,
  parseNumberCell,
  priceDetail,
  priceFromRow,
  relevantItemIds,
  relevantItems,
  sanitizeHistory,
  sanitizeSnapshot,
  sellablePerDay,
  slugify,
  snapshotPrice,
  importCoverageDrop,
  importPriceChanges,
  marketItemName,
  marketOriginMismatch,
  marketWhere,
  mergeSnapshots,
  serverNameInFileName,
  TUPLE,
  volumeKnown,
  type MarketTuple,
} from './market'
import { marketPrice, resolvePrice, type PriceContext } from './pricing'

const HEADER = 'gid;nom;niveau;type;categorie;vendus_24h;vendus_7j;vendus_30j;median_30j;moyen_30j;median_24h;kamas_par_jour'
/** Lignes réelles de l'export de Tylezia (02/10/2026). */
const LINES = [
  '7754;Dofus Ocre;160;Dofus;Dofus / Trophée / Prysmaradite;31;259;876;32009336;32101440;32299996;934672611',
  '14635;Pépite;1;Pierre précieuse;Ressource;1289489;8644832;32010194;290;291;274;309431875',
  '1557;Rune Ga Pa;100;Rune de forgemagie;Ressource;10673;85651;310552;29534;29646;28598;305728092',
  '1558;Rune Ga Pme;95;Rune de forgemagie;Ressource;10429;75498;239222;21460;21898;21509;171123470',
  '19975;Corne de volkorne;60;Os;Ressource;10744;38301;127342;30205;32111;26497;128212170',
  '15271;Tourmaline;10;Pierre précieuse;Ressource;2281;21349;74269;44355;44826;43364;109806716',
  '17864;Ambre de muldo;60;Ressource diverse;Ressource;2410;18645;72027;33823;33930;31285;81205640',
  '814;Puissant Parchemin de Chance;1;Parchemin de caractéristique;Consommable;1245;8369;32905;68823;68405;70298;75487360',
  '33515;Neurone de dragodinde;60;Ressource diverse;Ressource;2203;17611;67939;26056;28517;28987;59007286',
  '809;Petit Parchemin de Chance;1;Parchemin de caractéristique;Consommable;1503;12301;45497;5393;5323;5079;8178844',
  '33000;Dragodinde à Plumes;60;Dragodinde;Familier;0;1;7;3100000;4249285;0;723333',
  '33331;Extrait de Mangeoire;25;Carburant d’enclos;Ressource;4093;25041;91971;1296;1284;1251;3973147',
  '6841;Œil de Pikdoa;26;Œil;Ressource;35133;229513;797050;805;846;799;21387508',
  '1844;Truite;20;Poisson;Ressource;39154;366066;1554575;17;18;28;880925',
]
const FIXTURE = [HEADER, ...LINES].join('\n')

const NEURONE = 33515
const CORNE = 19975
const EXTRAIT_MANGEOIRE = 33331
const TRUITE = 1844
const OEIL = 6841

const REAL_CSV = 'research/raw/hdv/tylezia-2026-10-02.csv'

describe('lecture du CSV (tolérante)', () => {
  it('lit l’export de référence : 14 lignes, colonnes reconnues, aucune ignorée', () => {
    const p = parseHdvCsv(FIXTURE)
    expect(p.error).toBeUndefined()
    expect(p.separator).toBe(';')
    expect(p.rows).toHaveLength(14)
    expect(p.missingColumns).toEqual([])
    expect(p.invalidCount).toBe(0)
    expect(p.rows.find((r) => r.id === NEURONE)).toMatchObject({ name: 'Neurone de dragodinde', level: 60, sold24: 2203, sold30: 67939, median30: 26056, mean30: 28517, median24: 28987 })
  })

  it('BOM, fins de ligne Windows, guillemets, séparateur « , » et en-têtes en majuscules / alias', () => {
    const csv =
      '﻿"ID","Name","Level","Sold_24h","Sold_7d","Sold_30d","Median_30d","Mean_30d","Median_24h","Kamas_per_day"\r\n' +
      '"33515","Neurone de dragodinde, ""extrait""","60","2203","17611","67939","26056","28517","28987","59007286"\r\n'
    const p = parseHdvCsv(csv)
    expect(p.separator).toBe(',')
    expect(p.rows).toEqual([expect.objectContaining({ id: NEURONE, name: 'Neurone de dragodinde, "extrait"', median24: 28987, kamasPerDay: 59007286 })])
    expect(p.missingColumns).toEqual([])
  })

  it('tabulation, en-têtes accentués (« Médiane 30j »), nombres avec espaces et virgules', () => {
    const csv = 'gid\tNom\tVendus 24h\tVendus 30j\tMédiane 30j\tMoyen 30j\tMédiane 24h\n33515\tNeurone\t2 203\t67 939\t26 056\t28 517,4\t28 987\n'
    const p = parseHdvCsv(csv)
    expect(p.separator).toBe('\t')
    expect(p.rows[0]).toMatchObject({ id: NEURONE, sold24: 2203, sold30: 67939, median30: 26056, mean30: 28517.4, median24: 28987, sold7: 0, kamasPerDay: 0 })
    expect(p.missingColumns).toEqual(expect.arrayContaining(['sold7', 'kamasPerDay']))
  })

  it('lignes vides ignorées, lignes invalides ou incomplètes comptées avec leur raison, doublons fusionnés', () => {
    const csv = [
      HEADER,
      LINES[8],
      '',
      'abc;Pas un id;1;x;y;1;1;1;1;1;1;1',
      '33515;Neurone;60;x;y;1;1;5;1;1;1;1', // doublon (moins de ventes sur 30 j : ignoré)
      '17864;Ambre;60;x;y;oups;1;1;1;1;1;1',
      '19975;Corne;60',
      '   ',
      '-3;Négatif;1;x;y;1;1;1;1;1;1;1',
    ].join('\n')
    const p = parseHdvCsv(csv)
    expect(p.rows.map((r) => r.id)).toEqual([NEURONE])
    expect(p.rows[0].sold30).toBe(67939)
    expect(p.duplicates).toBe(1)
    expect(p.empty).toBe(2)
    expect(p.invalidCount).toBe(4)
    expect(p.lines).toBe(6)
    expect(p.invalid.map((i) => i.line)).toEqual([4, 6, 7, 9])
    expect(p.invalid.map((i) => i.reason).join(' | ')).toMatch(/identifiant.*nombre illisible.*incomplète.*identifiant/)
  })

  it('refuse un fichier sans identifiant ni prix (message clair), ou vide', () => {
    expect(parseHdvCsv('').error).toMatch(/vide/)
    expect(parseHdvCsv('nom;prix\nTruite;12').error).toMatch(/identifiant/)
    expect(parseHdvCsv('gid;nom;vendus_24h\n1844;Truite;3').error).toMatch(/prix/)
  })

  it('nombres : espaces, apostrophes, milliers, décimales ; illisible = NaN ; vide = 0', () => {
    expect(parseNumberCell('12 000')).toBe(12000)
    expect(parseNumberCell("1'250")).toBe(1250)
    expect(parseNumberCell('1.234.567')).toBe(1234567)
    expect(parseNumberCell('29,534')).toBe(29534)
    expect(parseNumberCell('12,5')).toBe(12.5)
    expect(parseNumberCell('1.234,5')).toBe(1234.5)
    expect(parseNumberCell('1,234.5')).toBe(1234.5)
    expect(parseNumberCell('')).toBe(0)
    expect(parseNumberCell('-')).toBe(0)
    expect(parseNumberCell('-5')).toBeNaN()
    expect(parseNumberCell('12k')).toBeNaN()
    expect(normalizeHeader('﻿"Médiane 30j"')).toBe('mediane_30j')
  })
})

describe('statistique de prix', () => {
  // [médiane 30 j, moyenne 30 j, médiane 24 h, vendus 24 h, vendus 7 j, vendus 30 j, kamas/jour]
  const busy: MarketTuple = [30205, 32111, 26497, 10744, 38301, 127342, 128212170]
  const quiet: MarketTuple = [3100000, 4249285, 0, 0, 1, 7, 723333]
  const few24: MarketTuple = [1000, 1100, 900, AUTO_MIN_SOLD_24H - 1, 10, 40, 1]

  it('auto = médiane 24 h si ≥ 5 ventes en 24 h, sinon médiane 30 j, sinon moyenne 30 j', () => {
    expect(priceDetail(busy, 'auto')).toEqual({ price: 26497, stat: 'median24' })
    expect(priceDetail(few24, 'auto')).toEqual({ price: 1000, stat: 'median30' })
    expect(priceDetail([0, 500, 0, 0, 0, 1, 0], 'auto')).toEqual({ price: 500, stat: 'mean30' })
    expect(priceFromRow(quiet)).toBe(3100000)
  })

  it('statistique choisie, avec repli signalé quand elle n’a pas de vente ; 0 n’est jamais un prix', () => {
    expect(priceDetail(busy, 'median30')).toEqual({ price: 30205, stat: 'median30' })
    expect(priceDetail(busy, 'mean30')).toEqual({ price: 32111, stat: 'mean30' })
    expect(priceDetail(quiet, 'median24')).toEqual({ price: 3100000, stat: 'median30' })
    expect(priceFromRow([0, 0, 0, 0, 0, 0, 0], 'median24')).toBeNull()
    expect(priceFromRow([0, 0, 0, 3, 3, 3, 0])).toBeNull()
  })

  it('confiance selon le volume', () => {
    expect(marketConfidence(busy)).toBe('high')
    expect(marketConfidence(quiet)).toBe('medium')
    expect(marketConfidence([10, 10, 0, 0, 1, 2, 0])).toBe('low')
  })
})

describe('instantané compact', () => {
  const snap = buildSnapshot(parseHdvCsv(FIXTURE), { serverName: ' Tylezia ', exportDate: '2026-10-02', source: 'test.csv', importedAt: 5 })

  it('ne garde que les objets utiles (7 nombres), avec statistiques et noms des objets inconnus des données', () => {
    expect(snap.serverName).toBe('Tylezia')
    expect(snap.rows['7754']).toBeUndefined() // Dofus Ocre : inutile ici
    expect(snap.rows[String(NEURONE)]).toEqual([26056, 28517, 28987, 2203, 17611, 67939, 59007286])
    expect(Object.keys(snap.rows)).toHaveLength(13)
    expect(snap.stats).toMatchObject({ lines: 14, read: 14, ignored: 0, recognized: 13, useful: 13 })
    expect(snap.names['15271']).toBe('Tourmaline')
    expect(snap.names[String(TRUITE)]).toBeUndefined() // connu des données de l'application
    const extraction = snap.stats.coverage.find((c) => c.category === 'extraction')
    expect(extraction).toMatchObject({ total: 3, present: 3, priced: 3 })
    expect(snap.stats.missingCount).toBe(relevantItemIds().size - 13)
    expect(snap.stats.missing.length).toBeLessThanOrEqual(40)
  })

  it('objets utiles : ingrédients, carburants, makinas, filets, objets-montures, extraction, runes, boutique de génétons…', () => {
    const ids = relevantItemIds()
    for (const id of [...INGREDIENTS.map((i) => i.id), ...FUELS.map((f) => f.id), ...MAKINAS.map((m) => m.id), ...NETS.map((n) => n.id)]) expect(ids.has(id)).toBe(true)
    for (const s of SPECIES) if (s.itemId) expect(ids.has(s.itemId)).toBe(true)
    for (const id of [33515, 17864, 19975, 1557, 1558, 15271, 14635, 34203, 801, 797, 805, 810, 814, 817, 683, 686]) expect(ids.has(id), String(id)).toBe(true)
    expect(GENETON_SHOP).toHaveLength(25)
    expect(GENETON_SHOP.find((g) => g.id === 15271)?.cost).toBe(130)
    expect(relevantItems().get(19975)).toBe('extraction')
    expect(ids.size).toBeGreaterThan(1000)
    expect(ids.size).toBeLessThan(1200)
  })

  it('normalisation : lignes invalides retirées (jamais remplacées par 0), structure illisible refusée', () => {
    const r = sanitizeSnapshot({ ...snap, rows: { ...snap.rows, '1': [1, 2, 3], abc: [1, 1, 1, 1, 1, 1, 1], '2': [1, 1, 1, 1, 1, 1, -1] }, exportDate: '2026-13-45' })
    expect(Object.keys(r.snapshot?.rows ?? {})).toHaveLength(13)
    expect(r.issues.join(' ')).toMatch(/3 lignes de marché invalides retirées/)
    expect(r.issues.join(' ')).toMatch(/date/)
    expect(r.snapshot?.exportDate).toBe('')
    expect(sanitizeSnapshot('x').snapshot).toBeNull()
    expect(sanitizeSnapshot(null)).toEqual({ snapshot: null, issues: [] })
    expect(sanitizeSnapshot(JSON.parse(JSON.stringify(snap))).snapshot).toEqual(snap)
  })

  it('liquidité : ventes 24 h / 7 j / 30 j, moyenne par jour et quantité vendable (15 % par défaut)', () => {
    expect(marketDepth(snap, CORNE)).toEqual({ sold24: 10744, sold7: 38301, sold30: 127342, perDayAvg: 127342 / 30, kamasPerDay: 128212170 })
    expect(marketDepth(snap, 999_999)).toBeNull()
    expect(sellablePerDay(snap, CORNE)).toBe(Math.floor((127342 / 30) * 0.15))
    expect(sellablePerDay(snap, CORNE, 0.5)).toBe(Math.floor((127342 / 30) * 0.5))
    expect(sellablePerDay(snap, 999_999)).toBeNull()
  })

  it('objet-monture : indication « HDV mixte » seulement', () => {
    const plumes = SPECIES.find((s) => s.itemId === 33000)
    const ref = marketMountReference(snap, plumes?.id ?? -1)
    expect(ref).toMatchObject({ itemId: 33000, price: 3100000, mixed: true })
    expect(ref?.depth?.sold24).toBe(0)
  })

  it('valeur du généton : échanges reconfirmés seulement (Puissants, 160), valeur optimiste de la boutique à part', () => {
    const g = genetonValueFromMarket(snap, 0.02)
    // Seul le Puissant Parchemin (160) est reconfirmé après la 3.5 : 70 298 / 160 (médiane 24 h).
    expect(g?.confirmedOnly).toBe(true)
    expect(g?.best).toMatchObject({ id: 814, cost: 160, price: 70298, confirmed: true })
    expect(g?.value).toBeCloseTo(70298 / 160)
    expect(g?.net).toBeCloseTo((70298 / 160) * 0.98)
    expect(g?.lines.every((l) => l.confirmed)).toBe(true)
    // Valeur optimiste (capture de la bêta) : Petit Parchemin de Chance 5 079 / 10, jamais comptée par défaut.
    expect(g?.optimistic?.best).toMatchObject({ id: 809, cost: 10, confirmed: false })
    expect(g?.optimistic?.value).toBeCloseTo(507.9)
    // Toute la boutique (ancien calcul) : Petit > Tourmaline (43 364 / 130) > Puissant.
    const all = genetonValueFromMarket(snap, 0.02, undefined, { confirmedOnly: false })
    expect(all?.best.id).toBe(809)
    expect(all?.lines.find((l) => l.id === 15271)?.perGeneton).toBeCloseTo(43364 / 130)
    // Statistique médiane 30 j : 68 823 / 160.
    expect(genetonValueFromMarket(snap, 0, 'median30')?.value).toBeCloseTo(68823 / 160)
    expect(genetonValueFromMarket(null)).toBeNull()
  })

  it('évolution : prix clés d’un import et variations triées', () => {
    const before = keyPrices(snap)
    expect(before[String(CORNE)]).toBe(26497)
    const next = buildSnapshot(parseHdvCsv(FIXTURE.replace('10744;38301;127342;30205;32111;26497', '10744;38301;127342;30205;32111;31796')), { serverName: 'Tylezia', exportDate: '2026-10-09' })
    const d = diffPrices(before, next)
    expect(d[0]).toMatchObject({ id: CORNE, before: 26497, after: 31796 })
    expect(d[0].change).toBeCloseTo(31796 / 26497 - 1)
    expect(diffPrices(snap, next, { minChange: 0.05 }).map((x) => x.id)).toEqual([CORNE])
    expect(KEY_MARKET_IDS).toContain(19975)
  })

  it('historique : entrée d’un import, normalisation et plafond', () => {
    const e = historyEntryOf(snap)
    expect(e).toMatchObject({ exportDate: '2026-10-02', useful: 13, read: 14, serverName: 'Tylezia' })
    const entries = Array.from({ length: 40 }, (_, i) => ({ ...e, importedAt: 40 - i }))
    const h = sanitizeHistory({ entries: [...entries, { importedAt: 'x' }, null] })
    expect(h.dropped).toBe(2)
    expect(h.entries).toHaveLength(30)
    expect(h.entries[0].importedAt).toBe(11)
    expect(h.entries.at(-1)?.importedAt).toBe(40)
  })

  it('dates : AAAA-MM-JJ valides, âge d’un export ; identifiant de fichier', () => {
    expect(isIsoDay('2026-10-02')).toBe(true)
    expect(isIsoDay('2026-02-30')).toBe(false)
    expect(exportAgeDays('2026-10-02', '2026-10-20')).toBe(18)
    expect(exportAgeDays('?', '2026-10-20')).toBeNull()
    expect(slugify('Tylezia')).toBe('tylezia')
    expect(slugify('Ombre (Héroïque)')).toBe('ombre-heroique')
  })
})

describe('résolution des prix avec le marché', () => {
  const snap = buildSnapshot(parseHdvCsv(FIXTURE), { serverName: 'Tylezia', exportDate: '2026-10-02' })
  const market = marketSourceOf(snap, 'auto', 'Tylezia')

  it('ordre : prix saisi > marché > défaut de la recherche > craft', () => {
    const ctx: PriceContext = { overrides: {}, useDefaults: true, market }
    // Neurone : marché (médiane 24 h) plutôt que le défaut de la recherche (8 000).
    expect(marketPrice(NEURONE, { overrides: {}, useDefaults: true })).toMatchObject({ price: 8000, origin: 'defaut' })
    const m = marketPrice(NEURONE, ctx)
    expect(m).toMatchObject({ price: 28987, origin: 'marche', complete: true, confidence: 'high' })
    expect(m.market).toMatchObject({ exportDate: '2026-10-02', stat: 'median24', sold24: 2203, serverName: 'Tylezia' })
    expect(m.market?.perDayAvg).toBeCloseTo(67939 / 30)
    // Prix saisi : prioritaire.
    expect(resolvePrice(NEURONE, { ...ctx, overrides: { [NEURONE]: 25000 } })).toMatchObject({ price: 25000, origin: 'joueur' })
    // Statistique du serveur.
    expect(marketPrice(NEURONE, { ...ctx, market: { ...market, stat: 'median30' } })).toMatchObject({ price: 26056, origin: 'marche' })
    // Objet absent de l'export : défaut (si activé), sinon manquant.
    expect(marketPrice(33524, ctx)).toMatchObject({ origin: 'defaut' })
    expect(marketPrice(33524, { ...ctx, useDefaults: false })).toMatchObject({ origin: 'manquant', price: null })
    // Le marché vaut même sans les défauts de la recherche (ce sont les prix de votre serveur).
    expect(marketPrice(NEURONE, { ...ctx, useDefaults: false }).origin).toBe('marche')
  })

  it('garde la règle « le moins cher entre le prix connu et le craft complet », et le niveau du métier', () => {
    const ctx: PriceContext = { overrides: {}, useDefaults: true, market }
    // Extrait de Mangeoire : marché 1 251 ; ingrédients au marché 28 + 799 = 827.
    expect(resolvePrice(EXTRAIT_MANGEOIRE, { ...ctx, jobLevel: 30 })).toMatchObject({ price: 28 + 799, origin: 'craft', complete: true })
    // Recette hors de portée (niv. 25) : prix du marché, craft signalé.
    expect(resolvePrice(EXTRAIT_MANGEOIRE, { ...ctx, jobLevel: 1 })).toMatchObject({ price: 1251, origin: 'marche', craftLocked: 25 })
    // Ingrédient sans prix : le prix du marché est retenu (craft incomplet).
    const partial: PriceContext = { ...ctx, market: { ...market, rows: { ...market.rows, [TRUITE]: [0, 0, 0, 0, 0, 0, 0] } }, useDefaults: false }
    expect(resolvePrice(EXTRAIT_MANGEOIRE, { ...partial, jobLevel: 30 })).toMatchObject({ price: 1251, origin: 'marche' })
    // Un défaut (autre serveur) nettement sous des ingrédients chiffrés au marché est signalé.
    const cheapDefault: PriceContext = { overrides: {}, useDefaults: true, market: { ...market, rows: { [TRUITE]: [600, 600, 600, 9, 9, 9, 1], [OEIL]: [2400, 2400, 2400, 9, 9, 9, 1] } } }
    expect(resolvePrice(EXTRAIT_MANGEOIRE, cheapDefault).conflict).toMatchObject({ defaultPrice: 1000, craftCost: 3000 })
  })
})

describe('préréglage de Tylezia (src/data/market/tylezia-2026-10-02.json)', () => {
  const preset = sanitizeSnapshot(tylezia)

  it('est un instantané valide, couvrant ≥ 99 % des objets utiles', () => {
    const s = preset.snapshot
    expect(preset.issues).toEqual([])
    expect(s).toMatchObject({ serverName: 'Tylezia', exportDate: '2026-10-02' })
    const cov = Object.fromEntries((s?.stats.coverage ?? []).map((c) => [c.category, c]))
    expect(cov.ingredient).toMatchObject({ priced: 471, total: 471 })
    expect(cov.carburant).toMatchObject({ priced: 120, total: 120 })
    expect(cov.makina.priced).toBeGreaterThanOrEqual(74)
    expect(cov.makina.total).toBe(81)
    expect(cov.filet).toMatchObject({ priced: 10, total: 10 })
    expect(cov.monture.priced).toBeGreaterThanOrEqual(307)
    expect(cov.monture.total).toBe(308)
    expect((s?.stats.useful ?? 0) / (s?.stats.relevant ?? 1)).toBeGreaterThanOrEqual(0.99)
    // Seuls des objets utiles sont versionnés.
    const ids = relevantItemIds()
    expect(Object.keys(s?.rows ?? {}).every((k) => ids.has(Number(k)))).toBe(true)
    // Repères de la spécification (médiane 30 j).
    expect(priceFromRow(s?.rows['19975'] ?? [0, 0, 0, 0, 0, 0, 0], 'median30')).toBe(30205)
    expect(priceFromRow(s?.rows['33515'] ?? [0, 0, 0, 0, 0, 0, 0], 'median30')).toBe(26056)
    expect(priceFromRow(s?.rows['17864'] ?? [0, 0, 0, 0, 0, 0, 0], 'median30')).toBe(33823)
  })

  it.runIf(existsSync(REAL_CSV))('correspond exactement à l’export CSV réel (script scripts/import-hdv-csv.mjs)', () => {
    const parsed = parseHdvCsv(readFileSync(REAL_CSV, 'utf8'))
    expect(parsed.rows).toHaveLength(9745)
    expect(parsed.invalidCount).toBe(0)
    const s = buildSnapshot(parsed, { serverName: 'Tylezia', exportDate: '2026-10-02', source: 'tylezia-2026-10-02.csv', importedAt: Date.parse('2026-10-02T12:00:00Z') })
    expect(s.rows).toEqual(preset.snapshot?.rows)
    expect(s.stats).toEqual(preset.snapshot?.stats)
    expect(s.stats.missing.map((m) => m.name)).toContain('Volkorne Améthyste et Émeraude')
  })
})

describe('revue « marché » (MKT)', () => {
  it('MKT-13 : la médiane 24 h n’est retenue qu’avec ≥ 5 ventes en 24 h (sinon médiane 30 j, signalée)', () => {
    // Dragodinde Dorée et Pourpre (Tylezia) : 2 ventes en 24 h à 495 000 pour une médiane 30 j de 61 033.
    expect(priceDetail([61033, 138265, 495000, 2, 15, 88, 179030], 'median24')).toEqual({ price: 61033, stat: 'median30' })
    expect(priceDetail([61033, 138265, 0, 0, 15, 88, 179030], 'median24')).toEqual({ price: 61033, stat: 'median30' })
    expect(priceDetail([30205, 32111, 26497, 10744, 38301, 127342, 128212170], 'median24')).toEqual({ price: 26497, stat: 'median24' })
    expect(priceDetail([0, 500, 900, 2, 2, 2, 1], 'median24')).toEqual({ price: 500, stat: 'mean30' })
  })

  it('MKT-05 : export sans colonnes de ventes → liquidité inconnue (null), jamais « 0 vente »', () => {
    const csv = ['gid;nom;median_30j;moyen_30j', '19975;Corne de volkorne;30205;32111', '33515;Neurone de dragodinde;26056;28517'].join('\n')
    const parsed = parseHdvCsv(csv)
    expect(parsed.error).toBeUndefined()
    expect(parsed.missingColumns).toEqual(expect.arrayContaining(['sold24', 'sold7', 'sold30', 'median24', 'kamasPerDay']))
    const snap = buildSnapshot(parsed, { serverName: 'X', exportDate: '2026-10-02' })
    expect(snap.missingColumns).toEqual(expect.arrayContaining(['sold30']))
    expect(snap.missingColumns).not.toContain('name')
    expect(volumeKnown(snap)).toBe(false)
    const src = marketSourceOf(snap, 'auto', 'X')
    expect(src.volumeUnknown).toBe(true)
    expect(marketDepth(src, CORNE)).toBeNull()
    expect(marketDepth(snap, CORNE)).toBeNull()
    expect(sellablePerDay(src, CORNE)).toBeNull()
    // Le prix reste connu (médiane 30 j), confiance basse.
    expect(snapshotPrice(src, CORNE)).toBe(30205)
    expect(marketPrice(CORNE, { overrides: {}, useDefaults: false, market: src })).toMatchObject({ price: 30205, confidence: 'low', market: { volumeUnknown: true } })
    // Gardé à la normalisation (stockage, sauvegarde).
    const back = sanitizeSnapshot(JSON.parse(JSON.stringify(snap))).snapshot!
    expect(back.missingColumns).toEqual(snap.missingColumns)
    expect(marketDepth(marketSourceOf(back), CORNE)).toBeNull()
    // Export complet : volumes connus.
    const full = buildSnapshot(parseHdvCsv(FIXTURE), { serverName: 'Tylezia', exportDate: '2026-10-02' })
    expect(full.missingColumns).toBeUndefined()
    expect(marketDepth(marketSourceOf(full), CORNE)?.sold24).toBe(10744)
  })

  it('MKT-09 : un réimport identique ne montre aucune variation ; prix clés nommés sans les noms de l’export', () => {
    const snap = buildSnapshot(parseHdvCsv(FIXTURE), { serverName: 'Tylezia', exportDate: '2026-10-02', importedAt: 1 })
    // Historique (prix clés en statistique automatique) comparé au même export, serveur en médiane 30 j.
    const fromHistory = importPriceChanges(snap, { history: historyEntryOf(snap) }, 'median30')
    expect(fromHistory.stat).toBe('auto')
    expect(fromHistory.changes.filter((c) => c.change !== 0)).toEqual([])
    expect(diffPrices(historyEntryOf(snap).keyPrices, snap, { stat: 'auto' }).filter((c) => c.change !== 0)).toEqual([])
    // L'ancien calcul (historique « auto » comparé en médiane 30 j) inventait des variations.
    expect(diffPrices(historyEntryOf(snap).keyPrices, snap, { stat: 'median30' }).some((c) => (c.change ?? 0) !== 0)).toBe(true)
    // Instantané courant : même statistique des deux côtés.
    const fromCurrent = importPriceChanges(snap, { snapshot: snap }, 'median30')
    expect(fromCurrent.stat).toBe('median30')
    expect(fromCurrent.changes.every((c) => c.change === 0)).toBe(true)
    expect(importPriceChanges(snap, {}, 'auto')).toEqual({ changes: [], stat: 'auto', previousDate: null })
    // Noms connus sans les noms du fichier.
    expect(marketItemName(34203)).toBe("Parchemin d'Éleveur")
    expect(marketItemName(801)).toBe("Puissant Parchemin d'Agilité")
    expect(marketItemName(15271)).toBe('Tourmaline')
    for (const id of KEY_MARKET_IDS) expect(marketItemName(id), String(id)).not.toMatch(/^Objet #/)
  })

  it('MKT-10 : origine de l’export gardée ; libellé « HDV de Tylezia …, chargés pour Mon serveur »', () => {
    const snap = buildSnapshot(parseHdvCsv(FIXTURE), { serverName: 'Tylezia', exportDate: '2026-10-02' })
    const own = marketSourceOf(snap, 'auto', 'tylézia')
    expect(marketOriginMismatch(own)).toBeNull()
    const other = marketSourceOf(snap, 'auto', 'Mon serveur')
    expect(other).toMatchObject({ serverName: 'Mon serveur', originServer: 'Tylezia', importedAt: snap.importedAt })
    expect(marketOriginMismatch(other)).toBe('Tylezia')
    expect(marketWhere(other)).toBe('HDV de Tylezia du 02/10/2026, chargés pour Mon serveur')
    expect(marketWhere(own)).toBe('HDV de tylézia du 02/10/2026')
    expect(marketPrice(NEURONE, { overrides: {}, useDefaults: true, market: other }).market).toMatchObject({ serverName: 'Tylezia', loadedFor: 'Mon serveur' })
    // Nom de fichier → serveur.
    expect(serverNameInFileName('tylezia-2026-10-02.csv', ['Mon serveur', 'Tylezia'])).toBe('Tylezia')
    expect(serverNameInFileName('HDV Mon Serveur 02-10.csv', ['Mon serveur', 'Tylezia'])).toBe('Mon serveur')
    expect(serverNameInFileName('export.csv', ['Mon serveur', 'Tylezia'])).toBeNull()
    expect(serverNameInFileName('tylezianne.csv', ['Tylezia'])).toBeNull()
  })

  it('MKT-12 : fichier partiel détecté ; « compléter » garde les objets absents du nouveau fichier', () => {
    const full = buildSnapshot(parseHdvCsv(FIXTURE), { serverName: 'Tylezia', exportDate: '2026-10-02', importedAt: 1, source: 'complet.csv' })
    const partial = buildSnapshot(parseHdvCsv([HEADER, '19975;Corne de volkorne;60;Os;Ressource;9000;38301;127342;31000;32111;29000;1'].join('\n')), {
      serverName: 'Tylezia',
      exportDate: '2026-10-05',
      importedAt: 2,
      source: 'partiel.csv',
    })
    expect(importCoverageDrop(full, partial)).toMatchObject({ drop: true, currentUseful: 13, incomingUseful: 1 })
    expect(importCoverageDrop(full, full).drop).toBe(false)
    expect(importCoverageDrop(null, partial).drop).toBe(false)
    const merged = mergeSnapshots(full, partial, { importedAt: 3 })
    expect(Object.keys(merged.rows)).toHaveLength(13)
    expect(merged.rows['19975'][TUPLE.median24]).toBe(29000)
    expect(merged.rows[String(NEURONE)]).toEqual(full.rows[String(NEURONE)])
    // Date : la plus ancienne (12 objets datent encore du 02/10) — la fraîcheur ne rajeunit pas.
    expect(merged).toMatchObject({ exportDate: '2026-10-02', importedAt: 3, serverName: 'Tylezia' })
    expect(merged.stats.useful).toBe(13)
    expect(merged.source).toMatch(/^partiel\.csv \(05\/10\/2026\) — complété par 12 objets de l’export du 02\/10\/2026/)
    // Le nouvel export couvre tout : sa date.
    expect(mergeSnapshots(partial, { ...partial, importedAt: 4 }).exportDate).toBe('2026-10-05')
    expect(merged.names['15271']).toBe('Tourmaline')
  })
})
