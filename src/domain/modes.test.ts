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
  familySwitchText,
  genetonWhy,
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
  routineSessionAt,
  modeTimeline,
  sanitizePinnedModePlan,
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

// ---------- Revue économique v2 ----------

describe('ECO-V2 : classement, sensibilité, montée naturelle du métier', () => {
  it('ECO-V2-05 : sensibilité « sans génétons » pour tous les modes (−revenu des génétons)', () => {
    for (const o of outcomes) {
      const gen = o.digest!.steady.revenueByCategory.genetons
      const point = modeSensitivity(o).find((x) => x.id === 'sans-genetons')
      if (gen > 0) {
        expect(point).toBeDefined()
        expect(point!.delta).toBeCloseTo(-gen, 6)
        expect(point!.netMean).toBeCloseTo(o.digest!.steady.netPerDay.mean - gen, 6)
      }
    }
  })

  it('ECO-V2-02 : vente au prix « HDV mixte » hors classement, jamais « auto » ; scénario « prix des montures −50 % »', () => {
    const base = corne()
    const mounts = 2_000_000
    const vente: ModeOutcome = {
      ...base,
      modeId: 'vente-montures',
      family: 'muldo',
      strategy: { ...base.strategy!, steadyNet: 5e6, score: 5e6, speculative: true },
      digest: { ...base.digest!, mode: 'vente', speculative: true, steady: { ...base.digest!.steady, revenueByCategory: { ...base.digest!.steady.revenueByCategory, montures: mounts } } },
    }
    const { rows, bestModeId } = rankModes([vente, ...outcomes])
    expect(bestModeId).not.toBe('vente-montures')
    const v = rows.find((r) => r.modeId === 'vente-montures')!
    expect(v.speculative).toBe(true)
    expect(v.rank).toBeNull()
    expect(v.risks.map((r) => r.code)).toContain('hdv-mixte')
    const half = modeSensitivity(vente).find((x) => x.id === 'prix-montures-50')!
    expect(half.delta).toBeCloseTo(-0.5 * mounts, 6)
  })

  it('ECO-V2-01 : deux modes à égalité statistique → le moins gourmand en capital passe devant', () => {
    const a = corne()
    const b = brisage()
    const sa = { ...a.strategy!, steadyNet: 1_000_000, score: 1_000_000, scoreSe: 40_000, capital: 6_000_000, stable: true }
    const sb = { ...b.strategy!, steadyNet: 960_000, score: 960_000, scoreSe: 40_000, capital: 500_000, stable: true }
    const { rows, bestModeId } = rankModes([{ ...a, strategy: sa }, { ...b, strategy: sb }])
    expect(bestModeId).toBe('brisage-pa')
    expect(rows[1].tieWithBest).toBe(true)
    // Hors du bruit des tirages : le plus rentable reste premier.
    expect(rankModes([{ ...a, strategy: { ...sa, scoreSe: 1_000 } }, { ...b, strategy: { ...sb, scoreSe: 1_000 } }]).bestModeId).toBe('rush-corne')
  })

  it('ECO-V2-08 : niveau 1 → enclos débloqués en route par l’XP d’élevage, comme « Sans investissement » de l’estimateur (±20 %)', async () => {
    const { planInvestment } = await import('./investment')
    const ctx1 = { ...ctxWith(csvMarket()), jobLevel: 1 }
    const prices = { ctx: ctx1, saleTax: 0.02, maxMarketShare: 0.15 }
    const inv = planInvestment({
      budget: 20_000_000,
      horizonDays: 60,
      mode: 'rush-corne',
      profile: { jobLevel: 1, hoursPerDay: 3, characters: 1, rules, family: 'volkorne' },
      safetyReserve: 2_000_000,
      prices,
      levers: { levelJob: false, buyG1: false },
      today: '2026-10-02',
      options: { quick: true, runs: 3, sensitivity: false },
    })
    const plan = inv.plan!
    expect(plan.schedule.length).toBeGreaterThan(0)
    const g = plan.allocation.strategy.targetGeneration ?? 2
    const p1 = profile({ jobLevel: 1, paddocks: undefined, horizonDays: plan.simDays }, ctx1)
    const ctx = { ...modeProfileContext(p1, { modes: ['rush-corne'], runs: 3 }), grid: { extraction: { targetGeneration: [g], tier: [2 as const], mateBeforeExtract: [true], parentLevel: [40], optimakina: ['auto' as const] } } }
    expect(ctx.naturalLeveling).toBe(true)
    const row = compareModes(ctx).rows[0]
    const o = outcomesFromComparison({ rows: [row], bestMode: null, horizonDays: plan.simDays, notes: [] })[0]
    expect(o.digest!.paddockSchedule.length).toBeGreaterThan(0)
    expect(o.digest!.config.paddocks).toBe(1)
    expect(Math.abs(row.best!.steadyNet - plan.steadyNetPerDay) / plan.steadyNetPerDay).toBeLessThan(0.2)
    // Enclos figés (option) : pas de calendrier.
    expect(modeProfileContext({ ...p1, fixedPaddocks: true }).naturalLeveling).toBe(false)
  })

  it('clé des hypothèses : nouvelle version du modèle, prix « HDV mixte » comptés ou non, prix de montures du joueur', () => {
    const p = profile()
    const k0 = modeContextKey(p)
    expect(k0).toContain('"montee-naturelle"')
    expect(modeContextKey({ ...p, prices: { ...p.prices, trustMixedMountPrices: true } })).not.toBe(k0)
    expect(modeContextKey({ ...p, prices: { ...p.prices, mountPrices: { mountOverrides: { '217|1': 50_000 }, generationOverrides: {}, useDefaults: true } } })).not.toBe(k0)
  })

  it('MKT-01 : la clé suit les prix saisis (Corne, montures), les défauts et un nouvel import du même jour', () => {
    const p = profile()
    const k0 = modeContextKey(p, { serverId: 'tylezia' })
    const withCtx = (ctx: Partial<PriceContext>) => ({ ...p, prices: { ...p.prices, ctx: { ...p.prices.ctx, ...ctx } } })
    // Prix du joueur pour la Corne de volkorne (page Prix) : la comparaison enregistrée est périmée.
    const corne = withCtx({ overrides: { '19975': 8000 } })
    expect(modeContextKey(corne, { serverId: 'tylezia' })).not.toBe(k0)
    // Même prix saisi, ordre d'insertion différent : même clé (empreinte à clés triées).
    expect(modeContextKey(withCtx({ overrides: { '1': 2, '19975': 8000 } }))).toBe(modeContextKey(withCtx({ overrides: { '19975': 8000, '1': 2 } })))
    expect(modeContextKey(withCtx({ useDefaults: false }), { serverId: 'tylezia' })).not.toBe(k0)
    const mp = { mountOverrides: {}, generationOverrides: {}, useDefaults: true }
    const k1 = modeContextKey({ ...p, prices: { ...p.prices, mountPrices: mp } })
    expect(modeContextKey({ ...p, prices: { ...p.prices, mountPrices: { ...mp, generationOverrides: { 'volkorne|6|1': 300_000 } } } })).not.toBe(k1)
    expect(modeContextKey({ ...p, prices: { ...p.prices, mountPrices: { ...mp, useDefaults: false } } })).not.toBe(k1)
    // Export corrigé importé le même jour (même date d'export, autre instant d'import).
    const m = p.prices.ctx.market!
    const reimport = withCtx({ market: { ...m, importedAt: (m.importedAt ?? 0) + 60_000 } })
    expect(modeContextKey(reimport, { serverId: 'tylezia' })).not.toBe(k0)
    // Le mode actif résolu avec la nouvelle clé est « à recalculer ».
    const outcome = outcomesFromComparison(cmp)[0]
    const rec = storeModeResults([outcome], p, { computedAt: 1, quick: true, serverId: 'tylezia' })
    expect(resolveActiveMode(outcome.modeId, rec, { contextKey: k0 }).stale).toBe(false)
    expect(resolveActiveMode(outcome.modeId, rec, { contextKey: modeContextKey(corne, { serverId: 'tylezia' }) }).stale).toBe(true)
  })
})

// ---------- Revue « parcours » v2 (UX2) : chaque test reproduit un défaut corrigé ----------

describe('UX2 : changement de famille, plan suivi, poids des génétons, achats', () => {
  /** Rush Ambre fictif (Muldos) plus rentable que la Rush Corne : le mode automatique change de famille. */
  const ambre = (): ModeOutcome => {
    const c = corne()
    return { ...c, modeId: 'rush-ambre', family: 'muldo', strategy: { ...c.strategy!, id: 'ambre', steadyNet: c.strategy!.steadyNet * 3, score: c.strategy!.steadyNet * 3, scoreSe: 1 }, digest: { ...c.digest!, family: 'muldo' } }
  }

  it('UX2-01 : le mode automatique qui passe aux Muldos signale le changement de famille d’un éleveur de Volkornes', () => {
    const p = profile()
    const rec = storeModeResults([ambre(), corne()], p, { computedAt: 1, quick: true })
    expect(rec.bestModeId).toBe('rush-ambre')
    const auto = resolveActiveMode('auto', rec, { family: 'volkorne' })
    expect(auto.id).toBe('rush-ambre')
    expect(auto.familySwitch).toEqual({ from: 'volkorne', to: 'muldo' })
    expect(resolveActiveMode('rush-corne', rec, { family: 'volkorne' }).familySwitch).toBeNull()
    expect(resolveActiveMode('progression', rec, { family: 'volkorne' }).familySwitch).toBeNull()
    expect(familySwitchText('Le mode automatique (Rush Muldo)', 'volkorne', 'muldo', 12)).toMatch(/travaille les Muldos : vos 12 Volkornes ne servent plus la stratégie/)
  })

  it('UX2-04 : un plan d’investissement suivi impose sa stratégie au mode actif (et seulement à son mode)', () => {
    const p = profile()
    const rec = storeModeResults([corne(), brisage()], p, { computedAt: 1, quick: true })
    const raw = JSON.parse(
      JSON.stringify({
        version: 1,
        modeId: 'rush-corne',
        family: 'volkorne',
        params: { targetGeneration: 4, tier: 1, parentLevel: 40, optimakina: 'none', mateBeforeExtract: true },
        label: 'Métier 120 → 160 · Rush Corne · G4',
        source: 'investissement',
        pinnedAt: 5,
        budget: 20_000_000,
        horizonDays: 60,
        outcome: corne(),
        contextKey: modeContextKey(p),
      }),
    )
    const pinned = sanitizePinnedModePlan(raw)!
    expect(pinned).not.toBeNull()
    const act = resolveActiveMode('rush-corne', rec, { pinned, contextKey: modeContextKey(p) })
    expect(act.params).toMatchObject({ targetGeneration: 4, tier: 1, optimakina: 'none' })
    expect(act.plan).toMatchObject({ label: 'Métier 120 → 160 · Rush Corne · G4', budget: 20_000_000 })
    expect(act.strategyLabel).toMatch(/plan d’investissement suivi/)
    expect(act.stale).toBe(false)
    expect(act.routine).not.toBeNull()
    expect(resolveActiveMode('rush-corne', rec, { pinned, contextKey: 'autre' }).stale).toBe(true)
    // Mode automatique ou autre mode : le plan n'est pas appliqué.
    expect(resolveActiveMode('auto', rec, { pinned }).plan).toBeNull()
    expect(resolveActiveMode('brisage-pa', rec, { pinned }).plan).toBeNull()
    expect(sanitizePinnedModePlan({ ...raw, modeId: 'auto' })).toBeNull()
    expect(sanitizePinnedModePlan({ ...raw, params: { tier: 9 } })?.params.tier).toBeUndefined()
  })

  it('UX2-07 : part des génétons dans le classement, « Génétons ÷ 2 », et stratégie retenue sans eux', () => {
    const c = corne()
    const gen = c.digest!.steady.revenueByCategory.genetons
    const row = rankModes([c]).rows[0]
    expect(row.genetonsPerDay).toBeCloseTo(gen, 6)
    if (gen > 0) expect(modeSensitivity(c).find((x) => x.id === 'genetons-50')!.delta).toBeCloseTo(-0.5 * gen, 6)
    // La G10 vit de ses génétons (50 % du net) ; la G4 en a peu : sans eux, la G4 l'emporte.
    const g10 = { ...c.strategy!, id: 'g10', label: 'G10 · palier 2', steadyNet: 800_000, genetonShareOfNet: 0.5, comparable: true, scoreBasis: 'kamas' as const }
    const g4 = { ...c.strategy!, id: 'g4', label: 'G4 · palier 2', steadyNet: 630_000, genetonShareOfNet: 0.05, rampUpDays: 11, capital: 1_200_000, comparable: true, scoreBasis: 'kamas' as const }
    const o: ModeOutcome = { ...c, strategy: g10, alternatives: [g4] }
    const why = genetonWhy(o)
    expect(why[0]).toMatch(/Génétons : ≈ .* soit 50 % du bénéfice net/)
    expect(why[1]).toMatch(/Sans les génétons, G4 · palier 2 serait retenue/)
    expect(strategyWhy(o).join(' ')).toMatch(/Sans les génétons/)
    // Peu de génétons : rien à signaler.
    expect(genetonWhy({ ...o, strategy: { ...g10, genetonShareOfNet: 0.02 } })).toEqual([])
    // Option « sans génétons » : autre clé des hypothèses (sans périmer les calculs avec génétons).
    const p = profile()
    expect(modeContextKey({ ...p, prices: { ...p.prices, includeGenetons: false } })).not.toBe(modeContextKey(p))
    expect(modeContextKey({ ...p, prices: { ...p.prices, includeGenetons: true } })).toBe(modeContextKey(p))
  })

  it('UX2-03 : passage de la routine selon l’heure (jamais « matin » le soir) ; calendrier de montée en charge', () => {
    const r = dailyRoutine('rush-corne', corne(), { sessionsPerDay: 2 })!
    expect(routineSessionAt(r, 8)?.label).toBe('Matin')
    expect(routineSessionAt(r, 20 + 43 / 60)?.label).toBe('Soir')
    const r3 = dailyRoutine('rush-corne', corne(), { sessionsPerDay: 3 })!
    expect(routineSessionAt(r3, 14)?.label).toBe('Après-midi')
    const tl = modeTimeline(corne(), { freeSlots: 20 })
    expect(tl.map((m) => m.id)).toEqual(expect.arrayContaining(['remplir', 'premiere-cible', 'premieres-ventes', 'regime', 'point-mort']))
    expect(tl[0].text).toMatch(/^Semaine 1 : remplir 20 places/)
    // Ordre chronologique, jalons non atteints à la fin.
    const days = tl.map((m) => m.day ?? Infinity)
    expect([...days].sort((a, b) => a - b)).toEqual(days)
  })

  it('enclos débloqués en route : affichés dans la stratégie et le calendrier (la routine du régime les suppose en service)', () => {
    const c = corne()
    const o: ModeOutcome = { ...c, digest: { ...c.digest!, config: { ...c.digest!.config, paddocks: 3 }, paddockSchedule: [{ day: 30, paddocks: 5 }, { day: 12, paddocks: 4 }] } }
    expect(strategyParamLines(o).find((l) => l.label === 'Enclos')?.value).toBe('3 × 10 places au départ, puis 4 (jour 12), 5 (jour 30) par l’XP d’élevage')
    const tl = modeTimeline(o)
    expect(tl.filter((m) => m.id === 'enclos').map((m) => m.text)).toEqual(['4e enclos (XP d’élevage) ≈ jour 12', '5e enclos (XP d’élevage) ≈ jour 30'])
    const days = tl.map((m) => m.day ?? Infinity)
    expect([...days].sort((a, b) => a - b)).toEqual(days)
    // Sans déblocage : nombre fixe, aucun jalon d'enclos.
    const fixed: ModeOutcome = { ...c, digest: { ...c.digest!, paddockSchedule: [] } }
    expect(strategyParamLines(fixed).find((l) => l.label === 'Enclos')?.value).toMatch(/^\d × 10 places$/)
    expect(modeTimeline(fixed).some((m) => m.id === 'enclos')).toBe(false)
  })

  it('UX2-02 : achats au marché du régime permanent conservés dans le résumé du mode', () => {
    const c = corne()
    expect(Array.isArray(c.digest!.purchases)).toBe(true)
    expect(c.digest!.purchases!.some((x) => x.kind === 'carburant')).toBe(true)
  })
})
