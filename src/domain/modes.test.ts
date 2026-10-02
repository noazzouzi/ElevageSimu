// Tests des modes de rentabilité (modes.ts) : définitions, configuration d'un mode pour un profil,
// classement, analyse (pourquoi, sensibilité, liquidité), routine quotidienne, résultats enregistrés et
// mode actif. Prix : préréglage de Tylezia (carburants, makinas, filets) + extrait réel du CSV de Tylezia
// (02/10/2026) pour les ressources et les runes.
import { beforeAll, describe, expect, it } from 'vitest'
import tylezia from '../data/market/tylezia-2026-10-02.json'
import { FAMILIES, getSpecies } from '../data'
import { PROFILE_MODES, sanitizeSettings } from '../store/schema'
import { buildSnapshot, marketSourceOf, parseHdvCsv, sanitizeSnapshot, type MarketSource } from './market'
import {
  DEFAULT_MODE,
  MODE_IDS,
  MODES,
  dailyRoutine,
  defaultModeParams,
  digestSummary,
  isModeId,
  liquidityCheck,
  mainMarketCheck,
  mergedSessions,
  modeConfig,
  modeContextKey,
  modeDef,
  modeProfileContext,
  modeSensitivity,
  outcomeFromSummary,
  outcomesFromComparison,
  pluralItemName,
  rankModes,
  resolveActiveMode,
  revenueCostBreakdown,
  sanitizeStoredModeResults,
  storeModeResults,
  strategyParamLines,
  strategyWhy,
  type ModeOutcome,
  type ModeProfile,
} from './modes'
import type { PriceContext } from './pricing'
import { compareModes, runProduction, type ModeComparison } from './production'
import { RULESETS } from './rules'

const rules = RULESETS['3.6']
const preset: MarketSource = marketSourceOf(sanitizeSnapshot(tylezia).snapshot!, 'auto', 'Tylezia')

/** Lignes réelles de l'export HDV de Tylezia (02/10/2026). */
const CSV = [
  'gid;nom;niveau;type;categorie;vendus_24h;vendus_7j;vendus_30j;median_30j;moyen_30j;median_24h;kamas_par_jour',
  '1557;Rune Ga Pa;100;Rune de forgemagie;Ressource;10673;85651;310552;29534;29646;28598;305728092',
  '1558;Rune Ga Pme;95;Rune de forgemagie;Ressource;10429;75498;239222;21460;21898;21509;171123470',
  '19975;Corne de volkorne;60;Os;Ressource;10744;38301;127342;30205;32111;26497;128212170',
  '17864;Ambre de muldo;60;Ressource diverse;Ressource;2410;18645;72027;33823;33930;31285;81205640',
  '33515;Neurone de dragodinde;60;Ressource diverse;Ressource;2203;17611;67939;26056;28517;28987;59007286',
  '809;Petit Parchemin de Chance;1;Parchemin de caractéristique;Consommable;1503;12301;45497;5393;5323;5079;8178844',
  '32526;Filet multiplicateur de Volkorne;100;Filet de capture;Consommables de combat;250;802;6207;3465;3692;4999;716908',
].join('\n')

function csvMarket(edit?: (csv: string) => string): MarketSource {
  const parsed = parseHdvCsv(edit ? edit(CSV) : CSV)
  return marketSourceOf(buildSnapshot(parsed, { serverName: 'Tylezia', exportDate: '2026-10-02' }), 'auto', 'Tylezia')
}

/** Carburants, makinas, filets du préréglage ; ressources et runes de l'extrait du CSV. */
function ctxWith(market: MarketSource, opts: { drop?: number[]; useDefaults?: boolean } = {}): PriceContext {
  const rows = { ...preset.rows, ...market.rows }
  for (const id of opts.drop ?? []) delete rows[String(id)]
  return { overrides: {}, useDefaults: opts.useDefaults ?? true, market: { ...preset, rows }, jobLevel: 120 }
}

function profile(over: Partial<ModeProfile> = {}, ctx: PriceContext = ctxWith(csvMarket())): ModeProfile {
  return { jobLevel: 120, hoursPerDay: 3, characters: 1, rules, prices: { ctx, saleTax: 0.02, maxMarketShare: 0.15 }, paddocks: 2, horizonDays: 30, ...over }
}

/** Grilles réduites (tests rapides). */
const GRID = {
  extraction: { targetGeneration: [2, 4], tier: [2 as const], mateBeforeExtract: [true], parentLevel: [40], optimakina: ['auto' as const] },
  brisage: { brisageLevel: [53, 80], tier: [1 as const], mateBeforeExtract: [false] },
}

let cmp: ModeComparison
let outcomes: ModeOutcome[]
const corne = () => outcomes.find((o) => o.modeId === 'rush-corne') as ModeOutcome
const brisage = () => outcomes.find((o) => o.modeId === 'brisage-pa') as ModeOutcome

beforeAll(() => {
  const ctx = { ...modeProfileContext(profile(), { modes: ['rush-corne', 'brisage-pa'], runs: 2 }), grid: GRID }
  cmp = compareModes(ctx)
  outcomes = outcomesFromComparison(cmp)
})

describe('définitions des modes', () => {
  it('liste les 8 modes de la spécification avec famille, produit et nature du revenu', () => {
    expect(MODE_IDS).toEqual(['auto', 'rush-corne', 'rush-ambre', 'rush-neurone', 'brisage-pa', 'brisage-pm', 'vente-montures', 'progression'])
    expect(MODES.map((m) => m.id)).toEqual(MODE_IDS)
    expect(modeDef('rush-corne')).toMatchObject({ kind: 'rush', family: 'volkorne', resourceItemId: 19975, revenueKind: 'ressource', mode: 'extraction' })
    expect(modeDef('rush-ambre')).toMatchObject({ kind: 'rush', family: 'muldo', resourceItemId: 17864 })
    expect(modeDef('rush-neurone')).toMatchObject({ kind: 'rush', family: 'dragodinde', resourceItemId: 33515 })
    expect(modeDef('brisage-pa')).toMatchObject({ kind: 'brisage', family: 'volkorne', resourceItemId: 1557, revenueKind: 'rune' })
    expect(modeDef('brisage-pm')).toMatchObject({ kind: 'brisage', family: 'muldo', resourceItemId: 1558 })
    expect(modeDef('vente-montures')).toMatchObject({ kind: 'vente', family: null, revenueKind: 'monture' })
    expect(modeDef('auto').mode).toBeNull()
    expect(modeDef('rush-corne').resourceName).toBe(FAMILIES.volkorne.extractionItemName)
    // Risques propres au mode : brisage corrigeable, prix des montures mélangés.
    expect(modeDef('brisage-pa').risks.map((r) => r.code)).toContain('brisage-correctif')
    expect(modeDef('vente-montures').risks.map((r) => r.code)).toContain('hdv-mixte')
    expect(modeDef('rush-corne').description).toMatch(/Cornes de volkorne/)
  })

  it('valide un identifiant de mode ; mode inconnu → progression (profils migrés)', () => {
    expect(isModeId('rush-corne')).toBe(true)
    expect(isModeId('rush-dofus')).toBe(false)
    expect(isModeId(3)).toBe(false)
    expect(modeDef('n’importe quoi').id).toBe('progression')
    expect(DEFAULT_MODE).toBe('progression')
    // Le réglage du profil accepte exactement ces modes.
    expect([...PROFILE_MODES].sort()).toEqual([...MODE_IDS].sort())
  })

  it('réglage du profil : absent → progression (profils migrés), valeur inconnue corrigée et signalée', () => {
    expect(sanitizeSettings({ jobLevel: 5 }, 0).state.mode).toBe('progression')
    expect(sanitizeSettings({ jobLevel: 5, mode: 'rush-corne' }, 0).state.mode).toBe('rush-corne')
    const bad = sanitizeSettings({ jobLevel: 5, mode: 'rush-dofus' }, 0)
    expect(bad.state.mode).toBe('progression')
    expect(bad.issues.join(' ')).toMatch(/mode de rentabilité/)
  })

  it('accorde les noms d’objets', () => {
    expect(pluralItemName('Corne de volkorne', 2)).toBe('Cornes de volkorne')
    expect(pluralItemName('Corne de volkorne', 1)).toBe('Corne de volkorne')
    expect(pluralItemName('Rune Ga Pa', 12)).toBe('Runes Ga Pa')
    expect(pluralItemName('Ambres de muldo', 3)).toBe('Ambres de muldo')
  })
})

describe('configuration d’un mode pour un profil', () => {
  it('donne la famille, le mode simulé et les contraintes du profil', () => {
    const p = profile({ paddocks: undefined, jobLevel: 80, hoursPerDay: 5, characters: 3 })
    const c = modeConfig('rush-corne', p)
    expect(c).toMatchObject({ family: 'volkorne', mode: 'extraction', targetGeneration: 'auto', paddocks: 3, hoursPerDay: 5, characters: 3, jobLevel: 80, horizonDays: 30 })
    expect(modeConfig('brisage-pm', p)).toMatchObject({ family: 'muldo', mode: 'brisage' })
    expect(modeConfig('auto', p)).toBeNull()
    // Vente : famille demandée, sinon celle du profil, sinon la première évaluée.
    expect(modeConfig('vente-montures', p, { family: 'volkorne' })?.family).toBe('volkorne')
    expect(modeConfig('vente-montures', { ...p, family: 'muldo' })?.family).toBe('muldo')
    // Stratégie retenue appliquée.
    expect(modeConfig('rush-ambre', p, { params: { targetGeneration: 6, tier: 3, mateBeforeExtract: false } })).toMatchObject({ targetGeneration: 6, tier: 3, mateBeforeExtract: false })
  })

  it('progression : famille, monture visée et réglages de la stratégie du profil', () => {
    const goal = 101 // Muldo Doré et Pourpre (G2)
    expect(getSpecies(goal)?.family).toBe('muldo')
    const c = modeConfig('progression', profile({ family: 'muldo', goalSpeciesId: goal, parentTargetLevel: 60, preferredTier: 3, useOptimakina: false }))
    expect(c).toMatchObject({ family: 'muldo', mode: 'progression', targetSpeciesIds: [goal], parentLevel: 60, tier: 3, optimakina: 'none' })
  })

  it('contexte de comparaison et clé des hypothèses', () => {
    const p = profile({ paddocks: undefined, jobLevel: 120 })
    const ctx = modeProfileContext(p, { modes: ['rush-corne', 'auto', 'progression'] })
    expect(ctx.paddocks).toBe(4)
    expect(ctx.modes).toEqual(['rush-corne', 'progression'])
    expect(ctx.quick).toBe(true)
    const key = modeContextKey(p)
    expect(modeContextKey(profile({ paddocks: undefined, jobLevel: 120 }))).toBe(key)
    expect(modeContextKey({ ...p, jobLevel: 121 })).not.toBe(key)
    expect(modeContextKey({ ...p, hoursPerDay: 4 })).not.toBe(key)
    const other = csvMarket()
    expect(modeContextKey(profile({ paddocks: undefined }, { ...ctxWith(other), market: { ...other, exportDate: '2026-10-09' } }))).not.toBe(key)
    expect(defaultModeParams('brisage-pa')).toMatchObject({ brisageLevel: 80, tier: 1 })
    expect(defaultModeParams('rush-corne')).toMatchObject({ targetGeneration: 6, tier: 2, mateBeforeExtract: true })
  })
})

describe('classement et analyse des modes (Tylezia)', () => {
  it('résume chaque mode (stratégie, alternatives, digest compact sérialisable)', () => {
    expect(outcomes.map((o) => o.modeId)).toEqual(['rush-corne', 'brisage-pa'])
    const o = corne()
    expect(o.available).toBe(true)
    expect(o.strategy?.label).toMatch(/^G[24] · parents niv. 40/)
    expect(o.alternatives.length).toBe(1)
    expect(o.digest?.family).toBe('volkorne')
    expect(o.digest?.market.find((m) => m.kind === 'ressource')?.name).toBe('Corne de volkorne')
    // Sérialisable et compact (le résumé complet n'est pas gardé).
    const json = JSON.stringify(o)
    expect(json.length).toBeLessThan(40_000)
    expect(JSON.parse(json)).toEqual(o)
  })

  it('classe par bénéfice net par jour (coûts chiffrés), désigne le meilleur et ses risques', () => {
    const { rows, bestModeId } = rankModes(outcomes)
    expect(rows.map((r) => r.rank)).toEqual([1, 2])
    expect(rows[0].netMean).toBeGreaterThanOrEqual(rows[1].netMean)
    expect(bestModeId).toBe(rows[0].modeId)
    expect(rows[0].best).toBe(true)
    const b = rows.find((r) => r.modeId === 'brisage-pa')
    expect(b?.risks.map((r) => r.code)).toContain('brisage-correctif')
    expect(b?.productName).toBe('Rune Ga Pa')
    const c = rows.find((r) => r.modeId === 'rush-corne')
    // Volume de la Corne : 127 342 ventes sur 30 jours → plafond 15 % ≈ 637 par jour.
    expect(c?.capPerDay).toBeCloseTo((127_342 / 30) * 0.15, 1)
    expect(c?.marketPerDay).toBeCloseTo(127_342 / 30, 1)
    expect(c?.shareOfMarket).toBeGreaterThan(0)
    expect(c?.saturated).toBe(false)
    expect(c?.status).toBe('exact')
  })

  it('un mode indisponible passe à la fin, sans rang', () => {
    const broken: ModeOutcome = { ...corne(), modeId: 'rush-neurone', available: false, strategy: null, digest: null, reason: 'Aucune stratégie simulable.' }
    const { rows } = rankModes([broken, ...outcomes])
    expect(rows[rows.length - 1].modeId).toBe('rush-neurone')
    expect(rows[rows.length - 1].rank).toBeNull()
    expect(rows[rows.length - 1].net).toEqual({ low: null, high: null })
  })

  it('explique la stratégie retenue et liste ses paramètres', () => {
    const why = strategyWhy(corne()).join(' ')
    expect(why).toMatch(/Retenue parmi 2 stratégies simulées/)
    expect(why).toMatch(/Palier 2/)
    expect(why).toMatch(/Corne de volkorne/)
    const lines = strategyParamLines(corne())
    expect(lines.find((l) => l.label === 'Famille')?.value).toBe('Volkornes')
    expect(lines.find((l) => l.label === 'Génération extraite')?.value).toMatch(/^G[24]$/)
    expect(strategyParamLines(brisage()).find((l) => l.label === 'Niveau de brisage')?.value).toMatch(/^niveau (53|80)$/)
    expect(strategyWhy({ ...corne(), strategy: null, reason: 'Trop peu de places.' })).toEqual(['Trop peu de places.'])
  })

  it('sensibilité : ±20 % du prix du produit à quantités vendues inchangées', () => {
    const o = corne()
    const rev = o.digest!.steady.revenueByCategory.ressources
    const [low, high] = modeSensitivity(o)
    expect(low.factor).toBe(0.8)
    expect(low.delta).toBeCloseTo(-0.2 * rev, 6)
    expect(high.delta).toBeCloseTo(0.2 * rev, 6)
    expect(high.net.low).toBeCloseTo((o.digest!.steady.net.low as number) + 0.2 * rev, 6)
    expect(low.label).toBe('−20 %')
    // Brisage : prix des runes.
    const b = brisage()
    expect(modeSensitivity(b)[1].delta).toBeCloseTo(0.2 * b.digest!.steady.revenueByCategory.runes, 6)
    const br = revenueCostBreakdown(o)
    expect(br.revenue.map((r) => r.key)).toContain('ressources')
    expect(br.cost.map((c) => c.key)).toContain('carburant')
  })

  it('liquidité : absorbé, proche du plafond, saturé ou inconnu', () => {
    const lines = liquidityCheck(corne())
    expect(lines[0]).toMatchObject({ kind: 'ressource', status: 'ok' })
    expect(lines[0].text).toMatch(/plafond 637\/jour/)
    const base = corne()
    const check = mainMarketCheck(base)!
    const make = (over: Partial<typeof check>): ModeOutcome => ({ ...base, digest: { ...base.digest!, market: [{ ...check, ...over }] } })
    expect(liquidityCheck(make({ producedPerDay: 600, capPerDay: 637 }))[0].status).toBe('limite')
    expect(liquidityCheck(make({ producedPerDay: 900, capPerDay: 637, saturated: true }))[0].status).toBe('sature')
    expect(liquidityCheck(make({ capPerDay: null, marketPerDay: null }))[0].status).toBe('inconnu')
  })
})

describe('routine quotidienne', () => {
  it('Rush Volkorne : accoupler, cloner, extraire, capturer, poser les lots ; vendre les Cornes sous le plafond ; carburant', () => {
    const r = dailyRoutine('rush-corne', corne(), { characters: 2 })!
    expect(r.sessionsPerDay).toBe(2)
    expect(r.sessions.map((s) => s.label)).toEqual(['Matin', 'Soir'])
    const kinds = r.sessions[0].items.map((i) => i.kind)
    expect(kinds[0]).toBe('accouplement')
    expect(kinds).toContain('extraction')
    expect(kinds.indexOf('capture')).toBeLessThan(kinds.indexOf('enclos'))
    const extract = r.sessions[0].items.find((i) => i.kind === 'extraction')!
    expect(extract.text).toMatch(/Cornes de volkorne/)
    const capture = r.sessions[0].items.find((i) => i.kind === 'capture')!
    expect(capture.text).toMatch(/Volkornes G1/)
    expect(capture.hint).toMatch(/2 personnages/)
    const sell = r.daily.find((i) => i.kind === 'vente')!
    expect(sell.text).toMatch(/jamais plus de 637/)
    expect(sell.kamas?.value).toBeCloseTo(corne().digest!.steady.revenueByCategory.ressources, 6)
    expect(sell.kamas?.complete).toBe(true)
    const fuel = r.daily.filter((i) => i.kind === 'carburant')
    expect(fuel.length).toBeGreaterThanOrEqual(3)
    expect(fuel.every((f) => /à fabriquer|à acheter à l’HDV/.test(f.text))).toBe(true)
    expect(fuel.every((f) => /par semaine/.test(f.text))).toBe(true)
    expect(r.daily[r.daily.length - 1].text).toMatch(/Bénéfice net attendu/)
    // Indicateurs : ceux du régime permanent de la simulation.
    const st = corne().digest!.steady
    expect(r.headline.resources).toBeCloseTo(st.resourcesPerDay, 6)
    expect(r.headline.net).toEqual(st.net)
    expect(r.summary).toMatch(/extractions/)
  })

  it('places libres du jour : capturées au premier passage seulement', () => {
    const r = dailyRoutine('rush-corne', corne(), { freeSlots: 7 })!
    const first = r.sessions[0].items.find((i) => i.kind === 'capture')!
    const second = r.sessions[1].items.find((i) => i.kind === 'capture')!
    expect(first.text).toMatch(/^Capturer 7 Volkornes G1 aujourd’hui/)
    expect(second.text).not.toMatch(/aujourd’hui/)
    // Affichage : le premier passage reste à part, pas de fusion.
    expect(mergedSessions(r).length).toBe(2)
    // Sans places libres connues : les passages identiques sont regroupés.
    const same = mergedSessions(dailyRoutine('rush-corne', corne())!)
    expect(same.length).toBe(1)
    expect(same[0].label).toBe('À chaque passage (matin et soir)')
  })

  it('brisage : briser au niveau visé, captures et lots de montée, runes vendues sous le plafond', () => {
    const r = dailyRoutine('brisage-pa', brisage())!
    const kinds = r.sessions[0].items.map((i) => i.kind)
    expect(kinds).toContain('brisage')
    expect(kinds).not.toContain('extraction')
    expect(r.sessions[0].items.find((i) => i.kind === 'brisage')?.text).toMatch(/Runes Ga Pa|Rune Ga Pa/)
    expect(r.sessions[0].items.find((i) => i.kind === 'enclos')?.text).toMatch(/Mangeoire seule/)
    expect(r.daily.find((i) => i.kind === 'vente')?.text).toMatch(/Ga Pa par jour, jamais plus de/)
    expect(dailyRoutine('brisage-pa', { ...brisage(), digest: null })).toBeNull()
  })

  it('prix de la ressource inconnu : jamais compté 0 (montant inconnu, classement par quantité)', () => {
    // Pas de Corne dans l'export ni de prix par défaut : prix et volume inconnus.
    const ctx = ctxWith(csvMarket((c) => c.replace(/^19975;.*$/m, '')), { drop: [19975], useDefaults: false })
    const res = compareModes({ ...modeProfileContext(profile({}, ctx), { modes: ['rush-corne'], runs: 1 }), grid: { extraction: { ...GRID.extraction, targetGeneration: [2] } } })
    const o = outcomesFromComparison(res)[0]
    expect(o.strategy?.scoreBasis).toBe('quantite')
    const { rows, bestModeId } = rankModes(o ? [o, ...outcomes] : outcomes)
    expect(rows[rows.length - 1].modeId).toBe('rush-corne')
    expect(rows[rows.length - 1].scoreBasis).toBe('quantite')
    expect(bestModeId).not.toBeNull()
    const r = dailyRoutine('rush-corne', o)!
    const sell = r.daily.find((i) => i.kind === 'vente')!
    expect(sell.kamas?.value).toBeNull()
    expect(sell.text).toMatch(/volume du marché inconnu/)
    expect(liquidityCheck(o)[0].status).toBe('inconnu')
    expect(strategyWhy(o)[0]).toMatch(/Prix du produit inconnu/)
  })
})

describe('résultats enregistrés et mode actif', () => {
  const p = profile()
  it('enregistre, relit (JSON) et refuse une donnée illisible', () => {
    const rec = storeModeResults(cmp, p, { computedAt: 1_800_000_000_000, quick: true, serverId: 'tylezia' })
    expect(rec.version).toBe(1)
    expect(rec.contextKey).toBe(modeContextKey(p, { serverId: 'tylezia' }))
    expect(rec.context).toMatchObject({ jobLevel: 120, paddocks: 2, marketDate: '2026-10-02', serverName: 'Tylezia' })
    expect(rec.bestModeId).toBe(rankModes(outcomes).bestModeId)
    const back = sanitizeStoredModeResults(JSON.parse(JSON.stringify(rec)))
    expect(back?.outcomes.length).toBe(2)
    expect(back?.bestModeId).toBe(rec.bestModeId)
    expect(sanitizeStoredModeResults(null)).toBeNull()
    expect(sanitizeStoredModeResults({ version: 99 })).toBeNull()
    expect(sanitizeStoredModeResults({ ...rec, outcomes: [{ modeId: 'rush-dofus' }, ...rec.outcomes] })?.outcomes.length).toBe(2)
  })

  it('progression simulée ajoutée, jamais désignée « auto »', () => {
    const cfg = modeConfig('progression', profile({ family: 'volkorne' }))!
    const s = runProduction({ ...cfg, targetGeneration: 3, horizonDays: 20 }, { runs: 1 })
    const prog = outcomeFromSummary('progression', s, 'G3 · progression')
    expect(prog.digest?.mode).toBe('progression')
    const rec = storeModeResults(cmp, p, { computedAt: 1, quick: true, extra: [{ ...prog, strategy: { ...prog.strategy!, steadyNet: 1e12, score: 1e12 } }] })
    expect(rec.outcomes.map((o) => o.modeId)).toContain('progression')
    expect(rec.bestModeId).not.toBe('progression')
  })

  it('résout le mode actif : auto → meilleur calculé, sinon progression ; stratégie calculée ou par défaut ; calcul périmé', () => {
    const rec = storeModeResults(cmp, p, { computedAt: 1, quick: true })
    const key = modeContextKey(p)
    const auto = resolveActiveMode('auto', rec, { contextKey: key })
    expect(auto.requested).toBe('auto')
    expect(auto.id).toBe(rec.bestModeId)
    expect(auto.source).toBe('calcul')
    expect(auto.stale).toBe(false)
    expect(auto.routine).not.toBeNull()
    const rush = resolveActiveMode('rush-corne', rec, { contextKey: key })
    expect(rush).toMatchObject({ kind: 'rush', family: 'volkorne', itemId: 19975, source: 'calcul' })
    expect(rush.params.targetGeneration).toBe(corne().strategy?.targetGeneration)
    expect(rush.params.targetSpeciesIds).toEqual(corne().digest?.plan.targets)
    expect(rush.sellCapPerDay).toBeCloseTo((127_342 / 30) * 0.15, 1)
    expect(resolveActiveMode('rush-corne', rec, { contextKey: 'autre' }).stale).toBe(true)
    // Sans calcul : auto → progression avec une note ; un mode → stratégie par défaut.
    const none = resolveActiveMode('auto', null)
    expect(none).toMatchObject({ id: 'progression', kind: 'progression', source: 'defaut' })
    expect(none.note).toMatch(/Mode automatique/)
    const def = resolveActiveMode('rush-ambre', null)
    expect(def).toMatchObject({ kind: 'rush', family: 'muldo', source: 'defaut', routine: null })
    expect(def.params).toMatchObject({ targetGeneration: 6, tier: 2, mateBeforeExtract: true })
    expect(def.strategyLabel).toMatch(/par défaut/)
    expect(resolveActiveMode('brisage-pm', null).params).toMatchObject({ brisageLevel: 80, tier: 1, mateBeforeExtract: false })
    // Vente sans calcul : famille du profil.
    expect(resolveActiveMode('vente-montures', null, { family: 'dragodinde' }).family).toBe('dragodinde')
    expect(resolveActiveMode('mode-inconnu', null).id).toBe('progression')
  })

  it('digest d’une simulation : quantités et prix utiles à la routine', () => {
    const s = runProduction({ ...modeConfig('rush-ambre', p)!, targetGeneration: 2, horizonDays: 15 }, { runs: 1 })
    const d = digestSummary(s)
    expect(d.family).toBe('muldo')
    expect(d.config.targetGeneration).toBe(2)
    expect(d.netByDay.length).toBe(15)
    expect(d.prices.some((l) => l.key === 'ressource')).toBe(true)
    expect(d.routine).toEqual(s.routine)
  })
})
