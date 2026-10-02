import { beforeEach, describe, expect, it } from 'vitest'
import { FUELS, SPECIES, STRATEGY } from '../data'
import { serverDayStart } from './almanax'
import { formatClock, formatDuration } from '../lib/format'
import {
  adviceHorizon,
  adviseNow,
  analysisCacheStats,
  analyzeState,
  analyzeStateCached,
  capturesPerFight,
  clearAnalysisCache,
  goalProgramConfig,
  typicalBatchSeconds,
  jobStatus,
  largestRemainder,
  ownedRecipeSupply,
  remainingProgram,
  sessionsPerDayFor,
  bestNetKind,
  captureNeeds,
  captureSpot,
  checklistKey,
  currentPhase,
  daysBetween,
  deName,
  evaluateCriterion,
  goalStatus,
  groupAdvice,
  hashKey,
  isoWeekKey,
  levelSumForCertainty,
  nextTakeza,
  nextTimedAdvice,
  relativeTime,
  resolveRuleRefs,
  sortAdvice,
  startOfDay,
  strategyHighlights,
  type Advice,
  type AdvisorInput,
  type AdvisorPaddockPlan,
  type AdvisorSettings,
} from './advisor'
import { cheapestRecipe } from './breedingPath'
import { makinaCost, type MountPriceContext } from './economy'
import { breed } from './genetics'
import { TAKEZA_PRIORITY_GENERATION } from './pairing'
import { runProgram } from './programSim'
import type { FertilityStep } from './fertility'
import type { PriceContext } from './pricing'
import { RULESETS } from './rules'
import type { GaugeId, Mount, PaddockState } from './types'

const R36 = RULESETS['3.6']
const R37 = RULESETS['3.7']
const sid = (name: string): number => {
  const s = SPECIES.find((x) => x.name === name)
  if (!s) throw new Error(`introuvable : ${name}`)
  return s.id
}

// Muldos
const DORE = 94
const INDIGO = 92
const POURPRE = 93
const DORE_POURPRE = 101 // G2
const ROUX = 95 // G3 = Doré et Pourpre × Doré et Orchidée (ou Doré et Indigo)
const AIGUE_AMANDE = 345 // G10

/** Instant fixe, heure locale : vendredi 2 octobre 2026, 9 h 00. */
const NOW = new Date(2026, 9, 2, 9, 0, 0).getTime()

let seq = 0
function mk(speciesId: number, over: Partial<Mount> = {}): Mount {
  seq++
  return {
    id: `a${String(seq).padStart(3, '0')}`,
    speciesId,
    gender: seq % 2 ? 'male' : 'femelle',
    level: 1,
    ability: null,
    fertility: 'fertile',
    parents: [],
    location: { kind: 'etable' },
    serenity: 0,
    endurance: 0,
    maturity: 0,
    love: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}
const fecund = (speciesId: number, over: Partial<Mount> = {}) => mk(speciesId, { endurance: 20_000, maturity: 20_000, love: 20_000, ...over })

const zeroGauges = (): Record<GaugeId, number> => ({ baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 })
const paddocks = (over: Partial<PaddockState>[] = []): PaddockState[] =>
  Array.from({ length: 6 }, (_, i) => ({ id: i + 1, gauges: zeroGauges(), active: [], updatedAt: 0, ...over[i] }))

/** Prix complets : chaque carburant coûte sa durabilité (1 K par point). */
const fullCtx: PriceContext = { overrides: Object.fromEntries(FUELS.map((f) => [String(f.id), f.durability])), useDefaults: true }
const emptyCtx: PriceContext = { overrides: {}, useDefaults: false }
const defaultMountPrices: MountPriceContext = { mountOverrides: {}, generationOverrides: {}, useDefaults: true }

const SETTINGS: AdvisorSettings = {
  jobLevel: 1,
  family: 'muldo',
  goalSpeciesId: null,
  goal: 'succes',
  preferredTier: 2,
  xpFiller: true,
  parentTargetLevel: 40,
  useOptimakina: true,
  saleTax: 0.02,
  useDefaultPrices: true,
}

function input(over: Partial<Omit<AdvisorInput, 'settings'>> & { settings?: Partial<AdvisorSettings> } = {}): AdvisorInput {
  const { settings, ...rest } = over
  return {
    now: NOW,
    rules: R36,
    mounts: [],
    paddocks: paddocks(),
    paddockPlans: {},
    priceCtx: fullCtx,
    mountPrices: defaultMountPrices,
    pricedItems: 0,
    ...rest,
    settings: { ...SETTINGS, ...settings },
  }
}

const byCat = (list: Advice[], cat: Advice['category']) => list.filter((a) => a.category === cat)

function step(gauges: GaugeId[], startSeconds: number, durationSeconds: number, extra: Partial<FertilityStep> = {}): FertilityStep {
  return { gauges, startSeconds, durationSeconds, purpose: 'Monter endurance + maturité', consumed: {}, ...extra }
}

// ---------- Utilitaires ----------

describe('utilitaires', () => {
  it('dates, semaines et durées relatives', () => {
    expect(daysBetween('2026-10-02', '2026-10-12')).toBe(10)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(isoWeekKey(NOW)).toBe('2026-W40')
    expect(isoWeekKey(new Date(2027, 0, 1, 12).getTime())).toBe('2026-W53')
    expect(startOfDay(NOW)).toBe(new Date(2026, 9, 2).getTime())
    expect(relativeTime(NOW + 25 * 60_000, NOW)).toBe('dans 25 min')
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe('il y a 2 h 00')
    expect(relativeTime(NOW + 10_000, NOW)).toBe("dans moins d'une minute")
    expect(hashKey('abc')).toBe(hashKey('abc'))
    expect(hashKey('abc')).not.toBe(hashKey('abd'))
    expect(checklistKey('phase', 'P2', 'actions', 3)).toBe('phase:P2:actions:3')
    expect(deName('Abreuvoir')).toBe("d'Abreuvoir")
    expect(deName('Foudroyeur')).toBe('de Foudroyeur')
  })

  it('Takeza : prochaine date et seuils de 100 % de génération cible', () => {
    expect(nextTakeza('2026-10-02')).toEqual({ date: '2026-10-12', days: 10 })
    expect(nextTakeza('2026-10-13')?.date).toBe('2027-10-11')
    // research/README.md §2.5 : 400 avec Optimakina (3.6), 334 en 3.7, 267 avec Optimakina + Takeza (3.6).
    expect(levelSumForCertainty(R36, { optimakina: true, takeza: false })).toBe(400)
    expect(levelSumForCertainty(R37, { optimakina: true, takeza: false })).toBe(334)
    expect(levelSumForCertainty(R36, { optimakina: true, takeza: true })).toBe(267)
    expect(levelSumForCertainty(R37, { optimakina: true, takeza: true })).toBe(200)
  })

  it('filet conseillé selon le niveau et zone de capture', () => {
    expect(bestNetKind(1)).toBe('universel')
    expect(bestNetKind(100)).toBe('multiplicateur')
    expect(bestNetKind(150)).toBe('renforce')
    expect(bestNetKind(200)).toBe('multiplicateur_renforce')
    expect(captureSpot('dragodinde')?.subarea).toBe('Territoire des dragodindes sauvages')
    expect(captureSpot('muldo')?.subarea).toBe('Bassin des Muldos')
    // Note des données (R14) : la Dorée ne se capture que dans cette zone, archimonstres listés.
    expect(captureSpot('dragodinde')?.note).toMatch(/dorée sauvage : uniquement ici/i)
    expect(captureSpot('dragodinde')?.note).toMatch(/archimonstres/)
  })

  it('remplace les identifiants de règles par leur titre', () => {
    expect(resolveRuleRefs('E-FULL-01')).toContain('Enclos plein')
    expect(resolveRuleRefs('si son prix < seuil (matingRules M-OPTI-01).')).toBe('si son prix < seuil (règle « Optimakina »).')
    expect(resolveRuleRefs('X-UNKNOWN-01 et Z')).toBe('X-UNKNOWN-01 et Z')
    expect(resolveRuleRefs('alarme (E-SER-ALARM)')).toContain('Alarme obligatoire')
    expect(resolveRuleRefs('tables de groupes')).toBe('tables de groupes')
  })
})

// ---------- Phases et critères ----------

describe('phases du planificateur', () => {
  it('choisit la phase selon le niveau d’Éleveur', () => {
    expect(currentPhase(1, []).id).toBe('P0')
    expect(currentPhase(1, Array.from({ length: 25 }, () => mk(DORE))).id).toBe('P1')
    expect(currentPhase(39, []).id).toBe('P1')
    expect(currentPhase(40, []).id).toBe('P2')
    expect(currentPhase(119, []).id).toBe('P3')
    expect(currentPhase(120, []).id).toBe('P4')
    expect(currentPhase(199, []).id).toBe('P5')
    expect(currentPhase(200, []).id).toBe('P6')
  })

  it('détecte automatiquement les critères de sortie vérifiables', () => {
    const state = { jobLevel: 45, mounts: [mk(DORE), mk(DORE_POURPRE), mk(ROUX)] }
    expect(evaluateCriterion('Éleveur ≥ 40', state)).toBe(true)
    expect(evaluateCriterion('Éleveur ≥ 80', state)).toBe(false)
    expect(evaluateCriterion('Éleveur 200', state)).toBe(false)
    expect(evaluateCriterion('≥ 20 G1 capturées (équilibre de sexes par couleur)', state)).toBe(false)
    expect(evaluateCriterion('au moins une couleur G3 obtenue', state)).toBe(true)
    expect(evaluateCriterion('première monocolore G5', state)).toBe(false)
    expect(evaluateCriterion('carburants palier 1 pour 2 lots', state)).toBeNull()
    // Tous les critères des phases sont évaluables ou explicitement manuels (null), sans erreur.
    for (const p of STRATEGY.phases) for (const c of p.exitCriteria) expect([true, false, null]).toContain(evaluateCriterion(c, state))
  })

  it('repères de stratégie chiffrés avec le ruleset actif', () => {
    const h36 = strategyHighlights({ parentTargetLevel: 40, useOptimakina: true, preferredTier: 2, jobLevel: 80 }, R36)
    expect(h36.map((h) => h.id)).toEqual(['niveau', 'optimakina', 'clonage', 'palier', 'enclos', 'session'])
    expect(h36[0].text).toContain('42 %')
    expect(h36[1].text).toContain('+10 %')
    expect(h36[4].text).toContain('station')
    const h37 = strategyHighlights({ parentTargetLevel: 40, useOptimakina: true, preferredTier: 2, jobLevel: 80 }, R37)
    expect(h37[1].text).toContain('+20 %')
    expect(h37[2].text).toContain('3.7')
  })
})

// ---------- Objectif et captures ----------

describe('objectif et captures restantes', () => {
  it('une monture possédée couvre tout son sous-arbre de la recette idéale', () => {
    const tree = cheapestRecipe(ROUX)
    expect(tree).not.toBeNull()
    if (!tree) return
    const none = captureNeeds(tree, [], null)
    expect(none.reduce((n, c) => n + c.idealRemaining, 0)).toBe(4)
    const withG2 = captureNeeds(tree, [mk(DORE_POURPRE)], null)
    expect(withG2.reduce((n, c) => n + c.idealRemaining, 0)).toBe(2)
    expect(withG2.find((c) => c.speciesId === POURPRE)?.idealRemaining).toBe(0)
    // Une stérile ne couvre rien (elle ne peut plus être parent).
    const sterile = captureNeeds(tree, [mk(DORE_POURPRE, { fertility: 'sterile' })], null)
    expect(sterile.reduce((n, c) => n + c.idealRemaining, 0)).toBe(4)
  })

  it('répartit les captures pour équilibrer les sexes', () => {
    const tree = cheapestRecipe(ROUX)
    if (!tree) throw new Error('recette')
    const owned = [mk(DORE, { gender: 'male' }), mk(DORE, { gender: 'male' }), mk(DORE, { gender: 'male' })]
    const status = goalStatus(ROUX, owned, { parentLevel: 40, useOptimakina: true, rules: R36 })
    expect(status?.reached).toBe(false)
    const dore = status?.captures.find((c) => c.speciesId === DORE)
    expect(dore).toBeDefined()
    if (dore && dore.expected > 0) expect(dore.females).toBeGreaterThanOrEqual(dore.males)
    expect(status?.effort?.captures).toBeGreaterThan(0)
  })

  it('objectif atteint dès qu’un exemplaire est possédé', () => {
    const status = goalStatus(ROUX, [mk(ROUX, { fertility: 'sterile' })], { parentLevel: 40, useOptimakina: false, rules: R36 })
    expect(status?.reached).toBe(true)
    expect(status?.captures).toEqual([])
    const list = adviseNow(input({ mounts: [mk(ROUX)], settings: { goalSpeciesId: ROUX, jobLevel: 30 } }))
    expect(list.some((a) => a.id === `objectif:atteint:${ROUX}`)).toBe(true)
  })
})

// ---------- Conseils ----------

describe('adviseNow', () => {
  it('premiers pas quand aucune monture n’est enregistrée', () => {
    const list = adviseNow(input())
    expect(list[0].id).toBe('onboarding:premiers-pas')
    expect(list[0].priority).toBe(1)
    expect(list[0].items?.map((i) => i.id)).toEqual(['niveau', 'objectif', 'captures', 'prix'])
    expect(list[0].items?.find((i) => i.id === 'captures')?.hint).toContain('Bassin des Muldos')
    // Pas de conseils de capture/placement sans montures, mais le métier reste conseillé.
    expect(byCat(list, 'capture')).toHaveLength(0)
    expect(byCat(list, 'metier')).toHaveLength(1)
    expect(byCat(list, 'metier')[0].title).toContain('niveau 40')
  })

  it('alarme de changement de jauges minutée, puis urgente quand elle est due', () => {
    const plan: AdvisorPaddockPlan = {
      paddockId: 1,
      tier: 2,
      mountIds: [],
      startedAt: NOW - 3_600_000,
      offsetMs: 0,
      steps: [
        step(['foudroyeur', 'abreuvoir'], 0, 2 * 3_600),
        step(['caresseur', 'mangeoire'], 2 * 3_600, 1_800, { switchWindow: { earliestSeconds: 2 * 3_600 + 1_200, latestSeconds: 2 * 3_600 + 1_700 } }),
        step(['dragofesse', 'mangeoire'], 2 * 3_600 + 1_800, 3_600),
      ],
      totalSeconds: 2 * 3_600 + 1_800 + 3_600,
      acknowledgedStepIndex: 0,
    }
    const soon = adviseNow(input({ paddockPlans: { '1': plan }, settings: { jobLevel: 10 } }))
    const alarm = byCat(soon, 'alarme')[0]
    expect(alarm).toBeDefined()
    expect(alarm.dueAt).toBe(NOW + 3_600_000)
    expect(alarm.priority).toBe(2)
    expect(alarm.title).toContain(formatClock(NOW + 3_600_000, NOW))
    expect(alarm.items?.map((i) => i.text)).toEqual(['Désactiver Foudroyeur', 'Désactiver Abreuvoir', 'Activer Caresseur', 'Activer Mangeoire'])
    expect(alarm.action).toEqual({ kind: 'advance-plan', paddockId: 1, to: ['caresseur', 'mangeoire'] })
    expect(adviceHorizon(alarm, NOW)).toBe('heures')

    const late = adviseNow(input({ now: NOW + 2 * 3_600_000, paddockPlans: { '1': plan }, settings: { jobLevel: 10 } }))
    const due = byCat(late, 'alarme')[0]
    expect(due.priority).toBe(1)
    expect(late[0].id).toBe(due.id)
    expect(adviceHorizon(due, NOW + 2 * 3_600_000)).toBe('maintenant')

    // Étape de sérénité dépassée : fenêtre fermée → retard signalé.
    const ack = { ...plan, acknowledgedStepIndex: 1 }
    const tooLate = adviseNow(input({ now: plan.startedAt + (2 * 3_600 + 1_750) * 1000, paddockPlans: { '1': ack }, settings: { jobLevel: 10 } }))
    const w = byCat(tooLate, 'alarme')[0]
    expect(w.window).toBeDefined()
    expect(w.detail).toContain('Une jauge de sérénité')
  })

  it('plan terminé : sortir les fécondes', () => {
    const plan: AdvisorPaddockPlan = {
      paddockId: 1,
      tier: 2,
      mountIds: [],
      startedAt: NOW - 7_200_000,
      steps: [step(['foudroyeur', 'abreuvoir'], 0, 3_600)],
      totalSeconds: 3_600,
      acknowledgedStepIndex: 1,
    }
    const inside = fecund(DORE, { location: { kind: 'enclos', paddock: 1 } })
    const list = adviseNow(input({ mounts: [inside], paddockPlans: { '1': plan }, settings: { jobLevel: 10 } }))
    const done = list.find((a) => a.id.startsWith('plan-fini:1:'))
    expect(done?.priority).toBe(2)
  })

  it('jauge qui va se vider : quel carburant et combien', () => {
    const lot = Array.from({ length: 10 }, () => mk(DORE, { serenity: -1_000, location: { kind: 'enclos', paddock: 1 } }))
    const g = { ...zeroGauges(), foudroyeur: 3_000, abreuvoir: 30_000 }
    const list = adviseNow(input({ mounts: lot, paddocks: paddocks([{ gauges: g, active: ['foudroyeur', 'abreuvoir'], updatedAt: NOW }]) }))
    const fuel = byCat(list, 'carburant')
    const f = fuel.find((a) => a.id.startsWith('recharge:1:foudroyeur'))
    expect(f).toBeDefined()
    if (!f) return
    // 3 000 points à 10 par tick de 10 s : vide en 50 min.
    expect(f.dueAt).toBe(NOW + 3_000_000)
    expect(f.priority).toBe(2)
    expect(f.title).toContain('vide vers')
    expect(f.items?.length).toBeGreaterThan(0)
    expect(f.amount?.complete).toBe(true)
    expect(f.confidence).toBe('medium')
    // L'Abreuvoir (30 000) tient plus longtemps : conseil moins prioritaire.
    const ab = fuel.find((a) => a.id.startsWith('recharge:1:abreuvoir'))
    expect(ab === undefined || ab.priority > f.priority).toBe(true)
  })

  it('niveaux saisis sous une autre version des règles (R9) : « à vérifier », ni recharge ni « jauge vide »', () => {
    const lot = Array.from({ length: 10 }, () => mk(DORE, { serenity: -1_000, location: { kind: 'enclos', paddock: 1 } }))
    const g = { ...zeroGauges(), foudroyeur: 150_000, abreuvoir: 30_000 }
    const p1 = { gauges: g, active: ['foudroyeur', 'abreuvoir'] as GaugeId[], updatedAt: NOW, gaugeRulesets: { foudroyeur: '3.7', abreuvoir: '3.7' } } as Partial<PaddockState>
    const list = adviseNow(input({ mounts: lot, paddocks: paddocks([p1]) }))
    expect(list.find((a) => a.id === 'jauges-version:1:3.6')?.title).toBe('Enclos 1 : niveaux de jauges à vérifier')
    expect(list.some((a) => a.id.startsWith('recharge:1:') || a.id.startsWith('jauge-vide:1:'))).toBe(false)
    // Mêmes niveaux saisis en 3.6 : conseil de recharge normal.
    const same = adviseNow(input({ mounts: lot, paddocks: paddocks([{ ...p1, gauges: { ...g, foudroyeur: 3_000 }, gaugeRulesets: { foudroyeur: '3.6', abreuvoir: '3.6' } } as Partial<PaddockState>]) }))
    expect(same.some((a) => a.id.startsWith('jauges-version:1'))).toBe(false)
    expect(same.some((a) => a.id.startsWith('recharge:1:foudroyeur'))).toBe(true)
  })

  it('jauge vide et jauge inutile', () => {
    const lot = Array.from({ length: 10 }, () => mk(DORE, { serenity: -3_000, location: { kind: 'enclos', paddock: 1 } }))
    const g = { ...zeroGauges(), foudroyeur: 0, dragofesse: 5_000 }
    const list = adviseNow(input({ mounts: lot, paddocks: paddocks([{ gauges: g, active: ['foudroyeur', 'dragofesse'], updatedAt: NOW }]) }))
    const empty = list.find((a) => a.id.startsWith('jauge-vide:1:foudroyeur'))
    expect(empty?.priority).toBe(1)
    expect(empty?.items?.length).toBeGreaterThan(0)
    const useless = list.find((a) => a.id.startsWith('jauge-inutile:1:dragofesse'))
    expect(useless?.category).toBe('enclos')
    expect(useless?.priority).toBe(2)
  })

  it('recharge incomplète sans prix : coût incomplet et prix à saisir', () => {
    const lot = Array.from({ length: 10 }, () => mk(DORE, { serenity: -1_000, location: { kind: 'enclos', paddock: 1 } }))
    const g = { ...zeroGauges(), foudroyeur: 0 }
    const list = adviseNow(
      input({
        mounts: lot,
        priceCtx: emptyCtx,
        mountPrices: { ...defaultMountPrices, useDefaults: false },
        settings: { useDefaultPrices: false },
        paddocks: paddocks([{ gauges: g, active: ['foudroyeur'], updatedAt: NOW }]),
      }),
    )
    const empty = list.find((a) => a.id.startsWith('jauge-vide:1:foudroyeur'))
    expect(empty?.amount?.complete).toBe(false)
    expect(empty?.missing?.length).toBeGreaterThan(0)
    const prices = byCat(list, 'prix')
    expect(prices.some((a) => a.id === 'prix:aucun')).toBe(true)
    const missing = prices.find((a) => a.id !== 'prix:aucun')
    expect(missing?.items?.[0].link?.page).toBe('prix')
    expect(missing?.items?.[0].link?.params?.q).toBeTruthy()
  })

  it('pas de recharge pour une jauge que la répartition propose de couper', () => {
    // Lot rouge (sérénité −3 000) dans un enclos réglé sur Foudroyeur + Abreuvoir : la répartition
    // conseille Caresseur + Foudroyeur ; l'Abreuvoir vide ne doit pas être « rechargé ».
    const lot = Array.from({ length: 10 }, () => mk(DORE, { serenity: -3_000, location: { kind: 'enclos', paddock: 1 } }))
    const g = { ...zeroGauges(), foudroyeur: 30_000, abreuvoir: 0 }
    const list = adviseNow(input({ mounts: lot, settings: { jobLevel: 10 }, paddocks: paddocks([{ gauges: g, active: ['foudroyeur', 'abreuvoir'], updatedAt: NOW }]) }))
    expect(list.some((a) => a.id.startsWith('jauge-vide:1:abreuvoir'))).toBe(false)
    const place = list.find((a) => a.category === 'enclos' && a.items?.some((i) => i.id === 'demarrer-1'))
    expect(place?.items?.find((i) => i.id === 'demarrer-1')?.text).toContain('désactiver Abreuvoir')
  })

  it('accoupler avant de sortir deux fécondes condamnées', () => {
    const mounts = [fecund(AIGUE_AMANDE, { gender: 'male' }), fecund(340, { gender: 'femelle' })] // deux G10 hors objectif
    const a = analyzeState(input({ mounts, settings: { jobLevel: 10 } }))
    const fate = a.fates.get(mounts[0].id)
    const list = adviseNow(input({ mounts, settings: { jobLevel: 10 } }), a)
    if (fate?.action === 'accoupler') {
      const adv = list.find((x) => x.id.startsWith('accoupler-avant:'))
      expect(adv?.items).toHaveLength(1)
      expect(adv?.detail).toContain('bébé gratuit')
    } else expect(['vente', 'extraction', 'brisage', 'a-chiffrer']).toContain(fate?.action)
  })

  it('niveaux de jauges trop anciens : demande une mise à jour', () => {
    const lot = [mk(DORE, { serenity: -1_000, location: { kind: 'enclos', paddock: 1 } })]
    const list = adviseNow(input({ mounts: lot, paddocks: paddocks([{ gauges: { ...zeroGauges(), foudroyeur: 5_000 }, active: ['foudroyeur'], updatedAt: NOW - 5 * 86_400_000 }]) }))
    expect(list.some((a) => a.id.startsWith('jauges-anciennes:1:'))).toBe(true)
  })

  it('Almanax : Takeza à préparer, jour Takeza, bébés Sage, jauge doublée', () => {
    const mounts = [fecund(DORE, { gender: 'male' }), fecund(INDIGO, { gender: 'femelle' })]
    const prep = adviseNow(input({ mounts }))
    const t = prep.find((a) => a.id === 'almanax:2026-10-12:takeza-prep')
    expect(t?.priority).toBe(3)
    // Début du jour de jeu (minuit à Paris), pas minuit local du navigateur (R7).
    expect(t?.dueAt).toBe(serverDayStart('2026-10-12'))
    // Durée d'un lot typique du planificateur (comme Rentabilité / Enclos), pas le minimum théorique,
    // et heure limite de démarrage (ux F8).
    expect(t?.detail).toContain(formatDuration(typicalBatchSeconds(2, R36)))
    expect(t?.detail).toMatch(/démarrez-le au plus tard/)
    expect(t && adviceHorizon(t, NOW)).toBe('semaine')
    expect(t?.allDay).toBe(true)

    const takeza = adviseNow(input({ now: new Date(2026, 9, 12, 10).getTime(), mounts }))
    const day = takeza.find((a) => a.id === 'almanax:2026-10-12:takeza')
    expect(day?.priority).toBe(1)
    expect(day?.detail).toContain('267')

    const sage = adviseNow(input({ now: new Date(2026, 9, 10, 10).getTime(), mounts }))
    expect(sage.some((a) => a.id === 'almanax:2026-10-10:bebes-sage')).toBe(true)
    // Takeza dans 2 jours : préparation prioritaire (« aujourd'hui »).
    const soon = sage.find((a) => a.id === 'almanax:2026-10-12:takeza-prep')
    expect(soon?.priority).toBe(2)
    expect(soon && adviceHorizon(soon, new Date(2026, 9, 10, 10).getTime())).toBe('aujourdhui')

    const foya = adviseNow(input({ now: new Date(2026, 11, 10, 10).getTime(), mounts }))
    const dbl = foya.find((a) => a.id === 'almanax:2026-12-10:jauge-dragofesse')
    expect(dbl?.confidence).toBe('low')
  })

  it('Takeza à préparer avec une étable de G1 : les G1 fertiles comptent (pas « aucune monture fertile »)', () => {
    const mounts = [mk(DORE), mk(INDIGO), fecund(POURPRE)]
    const t = adviseNow(input({ mounts })).find((a) => a.id === 'almanax:2026-10-12:takeza-prep')
    expect(t?.items?.some((i) => i.id === 'aucune')).toBe(false)
    expect(t?.items?.find((i) => i.id === 'fecondes')?.text).toContain('1 féconde de G1')
    expect(t?.items?.find((i) => i.id === 'fertiles')?.text).toContain('2 fertiles de G1')

    const none = adviseNow(input({ mounts: [] })).find((a) => a.id === 'almanax:2026-10-12:takeza-prep')
    expect(none?.items?.map((i) => i.id)).toEqual(['aucune'])
  })

  it('plan d’accouplement : couples disjoints, depuis l’étable', () => {
    const mounts = [
      fecund(DORE, { gender: 'male' }),
      fecund(POURPRE, { gender: 'male' }),
      fecund(INDIGO, { gender: 'femelle' }),
      fecund(DORE, { gender: 'femelle', location: { kind: 'enclos', paddock: 1 } }),
    ]
    const a = analyzeState(input({ mounts, settings: { jobLevel: 10 } }))
    expect(a.pairs.length).toBe(2)
    const used = a.pairs.flatMap((p) => [p.a.id, p.b.id])
    expect(new Set(used).size).toBe(4)
    const list = adviseNow(input({ mounts, settings: { jobLevel: 10 } }), a)
    const mating = byCat(list, 'accouplement')[0]
    expect(mating.priority).toBe(2)
    expect(mating.title).toBe('Accoupler 2 couples féconds')
    expect(mating.items?.some((i) => i.id === 'sortir')).toBe(true)
    expect(mating.items?.filter((i) => i.text.includes('→'))).toHaveLength(2)
    expect(mating.link).toEqual({ page: 'accouplement', params: { onglet: 'couples' }, label: 'Plan d’accouplement' })
    // Même situation → même identifiant ; autre situation → autre identifiant.
    expect(adviseNow(input({ mounts, settings: { jobLevel: 10 } }), a).find((x) => x.category === 'accouplement')?.id).toBe(mating.id)
    const other = adviseNow(input({ mounts: mounts.slice(0, 3), settings: { jobLevel: 10 } }))
    expect(byCat(other, 'accouplement')[0]?.id).not.toBe(mating.id)
  })

  it('clonage des stériles et sortie des montures sans usage', () => {
    const mounts = [mk(DORE, { fertility: 'sterile', gender: 'male' }), mk(DORE, { fertility: 'sterile', gender: 'femelle' }), mk(AIGUE_AMANDE, { fertility: 'sterile' })]
    const list = adviseNow(input({ mounts, settings: { jobLevel: 10 } }))
    const clone = byCat(list, 'clonage')[0]
    expect(clone).toBeDefined()
    expect(clone.items?.[0].hint).toContain('même couleur')
    expect(clone.link.params?.sort).toBe('cloner')
    const exit = byCat(list, 'vente')[0]
    expect(exit).toBeDefined()
    expect(exit.items?.[0].text).toContain('Aigue-marine')
    expect(exit.amount?.value).toBeGreaterThan(0)
  })

  it('placement en enclos des montures à rendre fécondes', () => {
    const mounts = Array.from({ length: 10 }, (_, i) => mk(DORE, { serenity: -1_500 + i * 100 }))
    const list = adviseNow(input({ mounts, settings: { jobLevel: 10 } }))
    const place = list.find((a) => a.category === 'enclos' && a.title.startsWith('Placer'))
    expect(place?.title).toBe('Placer 10 montures en enclos')
    expect(place?.items?.[0].text).toContain('Enclos 1')
    expect(place?.items?.[0].text).toContain('activer')
    expect(place?.link).toEqual({ page: 'enclos', params: { onglet: 'repartition' }, label: 'Répartition automatique' })
  })

  it('captures vers l’objectif : couleurs, sexes, zone et filet', () => {
    const mounts = [mk(DORE_POURPRE, { location: { kind: 'enclos', paddock: 1 } })]
    const list = adviseNow(input({ mounts, settings: { goalSpeciesId: ROUX, jobLevel: 10 } }))
    const cap = byCat(list, 'capture')[0]
    expect(cap).toBeDefined()
    expect(cap.title).toContain('pour Muldo Roux')
    expect(cap.items?.some((i) => i.id === `g1-${DORE}`)).toBe(true)
    // La Doré et Pourpre possédée couvre la recette idéale de son côté (Pourpre : « encore 0 sur 1 »),
    // mais pas toute la demande attendue (l'accouplement du haut peut rater) : moins de Pourpre que de Doré.
    const status = goalStatus(ROUX, mounts, { parentLevel: 40, useOptimakina: true, rules: R36 })
    const need = (id: number) => status?.captures.find((c) => c.speciesId === id)
    expect(need(POURPRE)?.idealRemaining).toBe(0)
    expect(need(POURPRE)!.expectedRaw).toBeLessThan(need(DORE)!.expectedRaw)
    expect(cap.items?.find((i) => i.id === 'zone')?.text).toContain('Bassin des Muldos')
    expect(cap.items?.find((i) => i.id === 'filet')?.text).toContain('Filet de capture universel')
    // Sans simulation : modèle analytique annoncé comme borne haute (estimation grossière).
    expect(cap.title).toContain('jusqu’à')
    expect(cap.confidence).toBe('low')
  })

  it('métier : rien à conseiller au niveau 200', () => {
    const list = adviseNow(input({ mounts: [mk(DORE)], settings: { jobLevel: 200 } }))
    expect(byCat(list, 'metier')).toHaveLength(0)
  })

  it('analyse d’un gros inventaire en un temps raisonnable', () => {
    const species = [DORE, INDIGO, POURPRE, DORE_POURPRE, 108, 105, ROUX]
    const mounts: Mount[] = []
    for (let i = 0; i < 150; i++) {
      const sp = species[i % species.length]
      const f = i % 5 === 0 ? 'sterile' : 'fertile'
      const full = i % 3 === 0
      mounts.push(
        mk(sp, {
          fertility: f,
          gender: i % 2 ? 'male' : 'femelle',
          serenity: ((i * 397) % 10_000) - 5_000,
          endurance: full ? 20_000 : 0,
          maturity: full ? 20_000 : 0,
          love: full ? 20_000 : 0,
          location: i < 30 ? { kind: 'enclos', paddock: 1 + (i % 3) } : { kind: 'etable' },
        }),
      )
    }
    const t0 = performance.now()
    const inp = input({ mounts, settings: { jobLevel: 90, goalSpeciesId: ROUX } })
    const a = analyzeState(inp)
    const list = adviseNow(inp, a)
    const ms = performance.now() - t0
    expect(list.length).toBeGreaterThan(3)
    expect(ms).toBeLessThan(8_000)
  })
})

// ---------- Revue C2 : plan d'accouplement, sorts, captures, plans d'enclos, métier, cache ----------

describe('conseiller : génétons, Optimakina, partenaires, sorties (revue)', () => {
  it('génétons d’un couple Reproducteur comptés une seule fois (F5/ECO-09)', () => {
    const mounts = [fecund(DORE, { gender: 'male', ability: 'reproducteur' }), fecund(INDIGO, { gender: 'femelle' })]
    const inp = input({ mounts, settings: { jobLevel: 10 } })
    const a = analyzeState(inp)
    const r = breed({ speciesId: DORE, level: 1, parents: [], ability: 'reproducteur' }, { speciesId: INDIGO, level: 1, parents: [] }, { rules: R36 })
    expect(r.babies).toBe(2)
    expect(a.pairs).toHaveLength(1)
    expect(a.expectedGenetons).toBeCloseTo(r.expectedGenetons, 6)
    expect(a.expectedGenetons).toBeCloseTo(a.pairs.reduce((n, p) => n + p.result.expectedGenetons, 0), 9)
    const item = byCat(adviseNow(inp, a), 'accouplement')[0].items?.find((i) => i.id === a.pairs[0].key)
    expect(item?.hint).toContain(`≈ ${r.expectedGenetons.toFixed(1).replace('.', ',')} généton`)
  })

  it('Optimakina : la règle de prix décide aussi en « succès » (C_eff branché, F1/ECO-08)', () => {
    const AMANDE = sid('Dragodinde Amande')
    const DOREE = sid('Dragodinde Dorée')
    const opti2 = makinaCost('optimakina', 'dragodinde', 2, fullCtx, R36).makina!.id
    const mounts = [fecund(AMANDE, { gender: 'male', level: 40 }), fecund(DOREE, { gender: 'femelle', level: 40 })]
    for (const goal of ['succes', 'mixte', 'profit'] as const) {
      const inp = input({
        mounts,
        priceCtx: { ...fullCtx, overrides: { ...fullCtx.overrides, [String(opti2)]: 2_000_000 } },
        settings: { goal, jobLevel: 200, family: 'dragodinde', goalSpeciesId: sid('Dragodinde Émeraude') },
      })
      const a = analyzeState(inp)
      expect(a.pairs[0].makina, goal).toBeNull()
      expect(a.pairs[0].makinaAdvice.basis, goal).toBe('regle-prix')
      const hint = byCat(adviseNow(inp, a), 'accouplement')[0].items?.find((i) => i.id === a.pairs[0].key)?.hint ?? ''
      expect(hint).not.toContain('Optimakina G2 conseillée')
      expect(hint).toContain('≥ seuil')
    }
    // Bon marché mais C_eff seulement borné (vente des stériles non chiffrée) : seul un refus est certain,
    // donc heuristique — jamais une cible G2 sans prix décisif.
    const cheapCtx = { ...fullCtx, overrides: { ...fullCtx.overrides, [String(opti2)]: 1 } }
    const settings = { jobLevel: 200, family: 'dragodinde' as const, goalSpeciesId: sid('Dragodinde Émeraude') }
    const bounded = analyzeState(input({ mounts, priceCtx: cheapCtx, settings }))
    expect(bounded.pairs[0].makinaAdvice.thresholdIsUpperBound).toBe(true)
    expect(bounded.pairs[0].makina).toBeNull()
    // Prix des montures saisis (C_eff complet) : la règle de prix la conseille, seuil chiffré à l'appui.
    const priced: MountPriceContext = { mountOverrides: Object.fromEntries([AMANDE, DOREE].flatMap((id) => [[`${id}|1`, 100], [`${id}|100`, 100]])), generationOverrides: {}, useDefaults: true }
    const cheap = input({ mounts, priceCtx: cheapCtx, mountPrices: priced, settings })
    const ac = analyzeState(cheap)
    expect(ac.pairs[0].makinaAdvice.basis).toBe('regle-prix')
    expect(ac.pairs[0].makina).toBe('optimakina')
    expect(byCat(adviseNow(cheap, ac), 'accouplement')[0].items?.find((i) => i.id === ac.pairs[0].key)?.hint).toContain('< seuil')
  })

  it('partenaire de l’objectif en préparation : pas de croisement hors objectif, « attendre » (F2)', () => {
    const CORAIL = sid('Muldo Corail')
    const tree = cheapestRecipe(CORAIL)!
    const [l, r] = tree.crossing!
    const OFF = sid('Muldo Roux et Émeraude')
    const topA = fecund(l, { gender: 'male', level: 40, name: 'TOP-A' })
    const topB = mk(r, { gender: 'femelle', level: 40, name: 'TOP-B' })
    const off = fecund(OFF, { gender: 'femelle', level: 40, name: 'OFF' })
    for (const goal of ['succes', 'mixte'] as const) {
      const inp = input({ mounts: [topA, topB, off], settings: { goal, jobLevel: 200, goalSpeciesId: CORAIL } })
      const a = analyzeState(inp)
      expect(a.pairs.some((p) => p.a.id === topA.id && p.b.id === off.id), goal).toBe(false)
      expect(a.waiting).toEqual([expect.objectContaining({ mountId: topA.id, partnerId: topB.id })])
      const wait = adviseNow(inp, a)
        .flatMap((x) => x.items ?? [])
        .find((i) => i.id === `attendre-${topA.id}`)
      expect(wait?.text).toContain('Attendre que TOP-B soit féconde')
    }
  })

  it('monture prévue au plan : jamais en sortie immédiate, sa sortie arrive « ensuite » (F3)', () => {
    // Objectif « kamas » sans monture visée : deux G10 fécondes (sans usage) sont accouplées pour leur bébé.
    const mounts = [fecund(AIGUE_AMANDE, { gender: 'male', level: 40 }), fecund(340, { gender: 'femelle', level: 40 })]
    const inp = input({ mounts, settings: { goal: 'profit', jobLevel: 10 } })
    const a = analyzeState(inp)
    expect(a.pairs).toHaveLength(1)
    for (const m of mounts) expect(a.fates.get(m.id)?.action).toBe('accoupler')
    const list = adviseNow(inp, a)
    const exitIds = byCat(list, 'vente').flatMap((x) => x.items?.map((i) => i.id) ?? [])
    for (const m of mounts) expect(exitIds).not.toContain(m.id)
    const item = byCat(list, 'accouplement')[0].items?.find((i) => i.id === a.pairs[0].key)
    expect(item?.hint).toMatch(/ensuite : (vendre|extraire|briser) /)
  })

  it('M-STACK-01 : un seul couple G8 × G8 de l’objectif est signalé, trois couples non (F10)', () => {
    const EMERAUDE = sid('Dragodinde Émeraude')
    const [l, r] = cheapestRecipe(EMERAUDE)!.crossing!
    const one = [fecund(l, { gender: 'male', level: 40 }), fecund(r, { gender: 'femelle', level: 40 })]
    const settings = { jobLevel: 200, family: 'dragodinde' as const, goalSpeciesId: EMERAUDE }
    const a1 = analyzeState(input({ mounts: one, settings }))
    const hint1 = byCat(adviseNow(input({ mounts: one, settings }), a1), 'accouplement')[0].items?.find((i) => i.id === a1.pairs[0].key)
    expect(hint1?.hint).toContain('Accumuler avant de tenter')
    expect(hint1?.tone).toBe('warn')
    const three = [...[1, 2, 3].map(() => fecund(l, { gender: 'male', level: 40 })), ...[1, 2, 3].map(() => fecund(r, { gender: 'femelle', level: 40 }))]
    const a3 = analyzeState(input({ mounts: three, settings }))
    const items3 = byCat(adviseNow(input({ mounts: three, settings }), a3), 'accouplement')[0].items ?? []
    expect(a3.pairs.length).toBe(3)
    expect(items3.some((i) => i.hint?.includes('Accumuler avant de tenter'))).toBe(false)
  })

  it('montée de niveau d’une monture de surplus : coût du lot réel (ECO-10)', () => {
    const VOLK = sid('Volkorne Indigo')
    const mountPrices: MountPriceContext = { mountOverrides: { [`${VOLK}|1`]: 1500 }, generationOverrides: {}, useDefaults: true }
    const lone = [mk(VOLK, { gender: 'male', level: 10, fertility: 'sterile' })]
    const settings = { goal: 'profit' as const, goalSpeciesId: sid('Muldo Doré et Ébène'), jobLevel: 10, preferredTier: 1 as const }
    const a1 = analyzeState(input({ mounts: lone, mountPrices, priceCtx: { overrides: {}, useDefaults: true }, settings }))
    expect(a1.fates.get(lone[0].id)?.action).not.toBe('monter')
    const ten = Array.from({ length: 10 }, (_, i) => mk(VOLK, { gender: i % 2 ? 'male' : 'femelle', level: 10, fertility: 'sterile' }))
    const a10 = analyzeState(input({ mounts: ten, mountPrices, priceCtx: { overrides: {}, useDefaults: true }, settings }))
    const monter = [...a10.fates.values()].filter((f) => f.action === 'monter')
    if (monter.length) expect(monter[0].reason).toContain('si vous montez')
  })
})

describe('captures vers l’objectif : couverture probabiliste, sexes, porteuses, simulation (revue)', () => {
  const EMERAUDE = sid('Dragodinde Émeraude')
  const opts = { parentLevel: 40, useOptimakina: true, rules: R36 }

  it('arrondi au plus fort reste : jamais plus de captures restantes que l’effort (F4)', () => {
    // 405,57 → 406 au total : le plus fort reste (0,38) prend l'unité restante.
    expect(largestRemainder([148.06, 142.38, 115.13])).toEqual([148, 143, 115])
    expect(largestRemainder([0.4, 0.4, 0.4]).reduce((a, b) => a + b, 0)).toBe(1)
    const g = goalStatus(EMERAUDE, [], opts)!
    expect(g.capturesRemaining).toBeLessThanOrEqual(Math.round(g.effort!.captures))
    expect(g.captureBasis).toBe('analytique')
  })

  it('captures calibrées par la simulation Monte-Carlo quand elle est fournie (F4, F17)', () => {
    const cfg = goalProgramConfig({ ...SETTINGS, goalSpeciesId: EMERAUDE, jobLevel: 200 }, R36, { runs: 8 })!
    const sim = runProgram(cfg)
    const g = goalStatus(EMERAUDE, [], { ...opts, sim })!
    expect(g.captureBasis).toBe('simulation')
    expect(Math.abs(g.capturesRemaining - sim.metrics.captures.mean) / sim.metrics.captures.mean).toBeLessThan(0.2)
    // Une simulation d'un autre objectif est ignorée.
    expect(goalStatus(sid('Dragodinde Turquoise'), [], { ...opts, sim })!.captureBasis).toBe('analytique')
    // Conseil de capture : « ≈ N » (simulation), et non « jusqu'à » (borne haute).
    const mounts = [mk(sid('Dragodinde Dorée'), { gender: 'male' })]
    const list = adviseNow(input({ mounts, goalSim: sim, settings: { jobLevel: 200, family: 'dragodinde', goalSpeciesId: EMERAUDE } }))
    const cap = byCat(list, 'capture')[0]
    expect(cap.title).toMatch(/^Capturer ≈ /)
    expect(cap.confidence).toBe('medium')
  })

  it('parents du haut possédés : il reste des captures ; deux mâles en laissent plus qu’un couple (F6)', () => {
    const [l, r] = cheapestRecipe(EMERAUDE)!.crossing!
    const pair = goalStatus(EMERAUDE, [mk(l, { gender: 'male', level: 40 }), mk(r, { gender: 'femelle', level: 40 })], opts)!
    const males = goalStatus(EMERAUDE, [mk(l, { gender: 'male', level: 40 }), mk(r, { gender: 'male', level: 40 })], opts)!
    const none = goalStatus(EMERAUDE, [], opts)!
    expect(pair.capturesRemaining).toBeGreaterThan(0)
    expect(pair.capturesRemaining).toBeLessThan(none.capturesRemaining)
    expect(males.capturesRemaining).toBeGreaterThan(pair.capturesRemaining)
    expect(males.supply?.notes.some((n) => n.includes('sans partenaire de sexe opposé'))).toBe(true)
    // Une tentative à 52 % échoue 48 % du temps : il faut alors refaire une G8 depuis zéro (≈ la moitié du programme).
    expect(pair.remainingShare).toBeGreaterThan(0.2)
    expect(pair.remainingShare).toBeLessThan(0.75)
  })

  it('porteuse : une Doré porteuse de Corail compte comme Corail pour Corail et Doré (F7)', () => {
    const GOAL = sid('Muldo Corail et Doré')
    const CORAIL = sid('Muldo Corail')
    const DOREM = sid('Muldo Doré')
    const porteur = mk(DOREM, { gender: 'male', level: 40, parents: [CORAIL, DOREM] })
    const plain = mk(DOREM, { gender: 'femelle', level: 40 })
    const supply = ownedRecipeSupply(cheapestRecipe(GOAL)!, [porteur, plain], { rules: R36 })
    expect(supply.roles.get(porteur.id)).toBe(CORAIL)
    expect(supply.roles.get(plain.id)).toBe(DOREM)
    const g = goalStatus(GOAL, [porteur, plain], opts)!
    const none = goalStatus(GOAL, [], opts)!
    expect(g.capturesRemaining).toBeLessThan(none.capturesRemaining / 2)
  })

  it('calendrier depuis votre étable : part restante appliquée à la simulation (ux F9)', () => {
    const cfg = goalProgramConfig({ ...SETTINGS, goalSpeciesId: EMERAUDE, jobLevel: 200 }, R36, { runs: 8 })!
    const sim = runProgram(cfg)
    const [l, r] = cheapestRecipe(EMERAUDE)!.crossing!
    const fromZero = remainingProgram(goalStatus(EMERAUDE, [], { ...opts, sim })!)!
    const fromStable = remainingProgram(goalStatus(EMERAUDE, [mk(l, { gender: 'male', level: 40 }), mk(r, { gender: 'femelle', level: 40 })], { ...opts, sim })!)!
    expect(fromZero.days?.mean).toBeCloseTo(sim.metrics.days.mean, 6)
    expect(fromStable.days!.mean).toBeLessThan(fromZero.days!.mean * 0.75)
    expect(fromStable.days!.mean).toBeGreaterThan(0)
    expect(fromStable.basis).toBe('simulation')
  })

  it('temps de jeu → passages par jour ; personnages → captures par combat (ux F4)', () => {
    expect(sessionsPerDayFor(0.5)).toBe(1)
    expect(sessionsPerDayFor(3)).toBe(2)
    expect(sessionsPerDayFor(6)).toBe(3)
    expect(sessionsPerDayFor(12)).toBe(4)
    expect(goalProgramConfig({ ...SETTINGS, goalSpeciesId: EMERAUDE, hoursPerDay: 10 }, R36)?.sessionsPerDay).toBe(4)
    expect(goalProgramConfig({ ...SETTINGS, goalSpeciesId: null }, R36)).toBeNull()
    expect(capturesPerFight(3, 1)).toBe(3)
    expect(capturesPerFight(undefined, 2)).toBe(2)
    const mounts = [mk(DORE_POURPRE)]
    const cap = byCat(adviseNow(input({ mounts, settings: { goalSpeciesId: ROUX, jobLevel: 10, accounts: 3 } })), 'capture')[0]
    const fights = cap.items?.find((i) => i.id === 'combats')
    expect(fights?.hint).toContain('3 personnages')
    const total = (cap.items ?? []).filter((i) => i.id.startsWith('g1-')).reduce((n, i) => n + Number(/(\d+)/.exec(i.text.split(':')[1])?.[1] ?? 0), 0)
    expect(fights?.text).toContain(`≈ ${Math.ceil(total / 3)} combat`)
  })
})

describe('plans d’enclos démarrés, métier, Takeza (revue)', () => {
  it('plan terminé : « Appliquer au lot », ni « démarrer le plan » ni recharge pour cet enclos (ux F2)', () => {
    const lot = Array.from({ length: 10 }, (_, i) => mk(DORE, { serenity: -1_000 + i * 50, location: { kind: 'enclos', paddock: 1 } }))
    const plan: AdvisorPaddockPlan = {
      paddockId: 1,
      tier: 2,
      mountIds: lot.map((m) => m.id),
      startedAt: NOW - 10 * 3_600_000,
      offsetMs: 0,
      steps: [step(['foudroyeur', 'abreuvoir'], 0, 3_600), step(['dragofesse', 'mangeoire'], 3_600, 3_600)],
      totalSeconds: 7_200,
      acknowledgedStepIndex: 2,
    }
    const g = { ...zeroGauges(), foudroyeur: 0, abreuvoir: 0 }
    const list = adviseNow(input({ mounts: lot, paddockPlans: { '1': plan }, paddocks: paddocks([{ gauges: g, active: ['foudroyeur', 'abreuvoir'], updatedAt: NOW - 3_600_000 }]), settings: { jobLevel: 10 } }))
    const fini = list.find((a) => a.id.startsWith('plan-fini:1:'))
    expect(fini?.link.label).toBe('Appliquer au lot')
    expect(fini?.title).toContain('appliquez-le au lot')
    expect(list.some((a) => a.items?.some((i) => i.id === 'demarrer-1'))).toBe(false)
    expect(list.some((a) => a.id.startsWith('jauge-vide:1:') || a.id.startsWith('recharge:1:'))).toBe(false)
  })

  it('plan en cours avec paliers par jauge : une jauge entretenue au palier 1 par le plan n’est pas « sous son palier » (F2)', () => {
    const lot = Array.from({ length: 10 }, (_, i) => mk(DORE, { serenity: -1_500 + i * 50, location: { kind: 'enclos', paddock: 1 } }))
    const plan: AdvisorPaddockPlan = {
      paddockId: 1,
      tier: 2,
      tiers: { foudroyeur: 1, abreuvoir: 2 },
      mountIds: lot.map((m) => m.id),
      startedAt: NOW - 600_000,
      offsetMs: 0,
      // Consommation réaliste (un plan réel la renseigne toujours) : les recharges se dimensionnent dessus.
      steps: [
        step(['foudroyeur', 'abreuvoir'], 0, 20_000, { consumed: { foudroyeur: 20_000, abreuvoir: 20_000 } }),
        step(['dragofesse', 'mangeoire'], 20_000, 3_600, { consumed: { dragofesse: 7_200, mangeoire: 7_200 } }),
      ],
      totalSeconds: 23_600,
      acknowledgedStepIndex: 0,
    }
    const g = { ...zeroGauges(), foudroyeur: 30_000, abreuvoir: 30_000 }
    const list = adviseNow(input({ mounts: lot, paddockPlans: { '1': plan }, paddocks: paddocks([{ gauges: g, active: ['foudroyeur', 'abreuvoir'], updatedAt: NOW }]), settings: { jobLevel: 10 } }))
    const titles = list.map((a) => a.title)
    expect(titles.some((t) => /rechargez Foudroyeur \(palier 1 au lieu de 2\)/.test(t))).toBe(false)
    expect(titles.some((t) => /rechargez Abreuvoir \(palier 1 au lieu de 2\)/.test(t))).toBe(true)
  })

  it('plan en cours : la recharge se dimensionne sur ce qu’il reste à consommer, pas sur tout le palier (intégration)', () => {
    const lot = Array.from({ length: 10 }, (_, i) => mk(DORE, { serenity: -1_500 + i * 50, location: { kind: 'enclos', paddock: 1 } }))
    const plan: AdvisorPaddockPlan = {
      paddockId: 1,
      tier: 2,
      mountIds: lot.map((m) => m.id),
      startedAt: NOW - 600_000,
      offsetMs: 0,
      steps: [step(['foudroyeur', 'abreuvoir'], 0, 20_000, { consumed: { foudroyeur: 10_000, abreuvoir: 10_000 } })],
      totalSeconds: 20_000,
      acknowledgedStepIndex: 0,
    }
    const g = { ...zeroGauges(), foudroyeur: 60_000, abreuvoir: 30_000 }
    const list = adviseNow(input({ mounts: lot, paddockPlans: { '1': plan }, paddocks: paddocks([{ gauges: g, active: ['foudroyeur', 'abreuvoir'], updatedAt: NOW }]) }))
    const ab = list.find((a) => a.id.startsWith('recharge:1:abreuvoir'))
    // Besoin restant ≈ 9 700 points : socle (30 000 → 40 000) + 9 700, soit ≈ 19 700 points (1 K/pt), pas 40 000 (jusqu'à 70 000).
    expect(ab?.amount?.value).toBeGreaterThanOrEqual(19_700)
    expect(ab?.amount?.value).toBeLessThan(25_000)
  })

  it('plan en cours : passer à peine sous le palier pour quelques points restants ne déclenche pas de recharge (intégration)', () => {
    // Joueur qui valide le changement 3 min après l'heure : Abreuvoir 360 points sous le palier 2 alors
    // que le plan ne lui demande plus que ≈ 250 points (≈ 2 min de retard au palier 1).
    const lot = Array.from({ length: 10 }, (_, i) => mk(DORE, { serenity: -900 + i * 50, location: { kind: 'enclos', paddock: 1 } }))
    const plan: AdvisorPaddockPlan = {
      paddockId: 1,
      tier: 2,
      mountIds: lot.map((m) => m.id),
      startedAt: NOW - 3_700_000,
      offsetMs: 0,
      steps: [
        step(['foudroyeur', 'abreuvoir'], 0, 3_600, { consumed: { foudroyeur: 7_200, abreuvoir: 7_200 } }),
        step(['foudroyeur', 'abreuvoir'], 3_600, 3_600, { consumed: { foudroyeur: 7_200, abreuvoir: 260 } }),
      ],
      totalSeconds: 7_200,
      acknowledgedStepIndex: 1,
    }
    const g = { ...zeroGauges(), foudroyeur: 60_000, abreuvoir: 39_640 }
    const list = adviseNow(input({ mounts: lot, paddockPlans: { '1': plan }, paddocks: paddocks([{ gauges: g, active: ['foudroyeur', 'abreuvoir'], updatedAt: NOW }]) }))
    expect(list.some((a) => a.id.startsWith('recharge:1:abreuvoir'))).toBe(false)
    // Avec un vrai besoin (7 200 points restants), la recharge reste conseillée.
    const big = { ...plan, steps: [plan.steps[0], { ...plan.steps[1], consumed: { foudroyeur: 7_200, abreuvoir: 7_200 } }] }
    const list2 = adviseNow(input({ mounts: lot, paddockPlans: { '1': big }, paddocks: paddocks([{ gauges: g, active: ['foudroyeur', 'abreuvoir'], updatedAt: NOW }]) }))
    expect(list2.some((a) => a.id.startsWith('recharge:1:abreuvoir'))).toBe(true)
  })

  it('plan en cours : une jauge de l’étape en cours sans monture éligible n’est pas « inutile » (traversée de 0) (intégration)', () => {
    // Caresseur pousse le lot (sérénité négative) vers le positif ; Dragofesse les prendra en arrivant.
    const lot = Array.from({ length: 10 }, (_, i) => mk(DORE, { serenity: -1_200 + i * 20, endurance: 20_000, maturity: 20_000, location: { kind: 'enclos', paddock: 1 } }))
    const plan: AdvisorPaddockPlan = {
      paddockId: 1,
      tier: 2,
      tiers: { caresseur: 1, dragofesse: 2 },
      mountIds: lot.map((m) => m.id),
      startedAt: NOW - 60_000,
      offsetMs: 0,
      steps: [step(['caresseur', 'dragofesse'], 0, 4_000, { consumed: { caresseur: 2_000, dragofesse: 3_000 } })],
      totalSeconds: 4_000,
      acknowledgedStepIndex: 0,
    }
    const g = { ...zeroGauges(), caresseur: 3_000, dragofesse: 50_000 }
    const list = adviseNow(input({ mounts: lot, paddockPlans: { '1': plan }, paddocks: paddocks([{ gauges: g, active: ['caresseur', 'dragofesse'], updatedAt: NOW - 60_000 }]) }))
    expect(list.some((a) => a.id.startsWith('jauge-inutile:1:dragofesse'))).toBe(false)
    // Sans plan, la même jauge est bien signalée.
    const free = adviseNow(input({ mounts: lot, paddocks: paddocks([{ gauges: g, active: ['caresseur', 'dragofesse'], updatedAt: NOW - 60_000 }]) }))
    expect(free.some((a) => a.id.startsWith('jauge-inutile:1:dragofesse'))).toBe(true)
  })

  it('fin de plan due mais non validée : ni recharge ni « inutile », et un seul lien vers l’enclos (intégration)', () => {
    const lot = Array.from({ length: 10 }, (_, i) => fecund(DORE, { serenity: -500 + i * 20, location: { kind: 'enclos', paddock: 1 } }))
    const plan: AdvisorPaddockPlan = {
      paddockId: 1,
      tier: 2,
      mountIds: lot.map((m) => m.id),
      startedAt: NOW - 7_200_000 - 50 * 60_000,
      offsetMs: 0,
      steps: [step(['foudroyeur', 'mangeoire'], 0, 7_200, { consumed: { foudroyeur: 14_400, mangeoire: 14_400 } })],
      totalSeconds: 7_200,
      acknowledgedStepIndex: 0,
    }
    const g = { ...zeroGauges(), foudroyeur: 45_000, mangeoire: 30_000 }
    const list = adviseNow(input({ mounts: lot, paddockPlans: { '1': plan }, paddocks: paddocks([{ gauges: g, active: ['foudroyeur', 'mangeoire'], updatedAt: NOW - 7_200_000 - 50 * 60_000 }]) }))
    expect(list.some((a) => a.id.startsWith('recharge:1:') || a.id.startsWith('jauge-vide:1:'))).toBe(false)
    expect(list.some((a) => a.id.startsWith('jauge-inutile:1:'))).toBe(false)
    const alarm = list.find((a) => a.id.startsWith('alarme:1:'))
    expect(alarm).toBeDefined()
    const labels = [alarm?.link.label, ...(alarm?.items ?? []).map((i) => i.link?.label).filter(Boolean)]
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('changement manqué pendant une poussée de sérénité : plan dépassé, ni « tout de suite » ni « Fait » (ux F6)', () => {
    const plan: AdvisorPaddockPlan = {
      paddockId: 1,
      tier: 2,
      mountIds: [],
      startedAt: NOW - 12 * 3_600_000,
      offsetMs: 0,
      steps: [
        step(['caresseur', 'mangeoire'], 0, 1_800, { switchWindow: { earliestSeconds: 1_200, latestSeconds: 1_700 } }),
        step(['dragofesse', 'mangeoire'], 1_800, 3_600),
      ],
      totalSeconds: 5_400,
      acknowledgedStepIndex: 0,
    }
    const list = adviseNow(input({ now: plan.startedAt + (1_700 + 9 * 3_600) * 1000, paddockPlans: { '1': plan }, settings: { jobLevel: 10 } }))
    const stale = list.find((a) => a.id.startsWith('plan-depasse:1:'))
    expect(stale).toBeDefined()
    expect(stale?.action).toBeUndefined()
    expect(stale?.title).toContain('recalculez')
    expect(list.some((a) => a.detail.includes('Faites-le tout de suite'))).toBe(false)
    expect(list.some((a) => a.action?.kind === 'advance-plan')).toBe(false)
  })

  it('XP du journal depuis la saisie du niveau : déduite, niveau estimé (ux F14)', () => {
    const base = jobStatus(40, fullCtx, R36, { todayIso: '2026-10-02', withPlan: false })
    const after = jobStatus(40, fullCtx, R36, { todayIso: '2026-10-02', withPlan: false, xpGained: 24 * 30 })
    expect(base.xpToNext - after.xpToNext).toBe(24 * 30)
    expect(after.xpGained).toBe(720)
    expect(after.progress).toBeGreaterThan(base.progress)
    // Le journal fait passer le niveau 40 → 80+ : nouvel enclos probablement débloqué, à confirmer.
    const big = jobStatus(79, fullCtx, R36, { todayIso: '2026-10-02', withPlan: false, xpGained: 1_000_000 })
    expect(big.estimatedLevel).toBeGreaterThan(79)
    expect(big.paddockUnlockedSinceEntry).toBe(true)
    const list = adviseNow(input({ mounts: [mk(DORE)], journalXp: { xp: 1_000_000 }, settings: { jobLevel: 79 } }))
    const est = list.find((a) => a.id.startsWith('metier:niveau-estime:79:'))
    expect(est?.priority).toBe(2)
    expect(est?.link.page).toBe('reglages')
  })

  it('Takeza : même seuil de génération que la page Accouplement (ux F16)', () => {
    const t = adviseNow(input({ mounts: [fecund(DORE, { gender: 'male' }), fecund(INDIGO, { gender: 'femelle' })] })).find((a) => a.id === 'almanax:2026-10-12:takeza-prep')
    expect(t?.detail).toContain(`≥ G${TAKEZA_PRIORITY_GENERATION}`)
  })
})

describe('cache de l’analyse (accueil, R12)', () => {
  beforeEach(() => clearAnalysisCache())

  it('même jour et mêmes données (références) : le même objet, calculé une fois', () => {
    const mounts = [fecund(DORE, { gender: 'male' }), fecund(INDIGO, { gender: 'femelle' })]
    const inp = input({ mounts, settings: { jobLevel: 10 } })
    const a = analyzeStateCached(inp)
    // Nouveaux objets d'entrée (remontage de la page) mais mêmes données : rien n'est recalculé.
    const b = analyzeStateCached({ ...inp, now: NOW + 3_600_000, settings: { ...inp.settings }, priceCtx: { ...inp.priceCtx }, mountPrices: { ...inp.mountPrices } })
    expect(b).toBe(a)
    expect(analysisCacheStats()).toEqual({ computed: 1, hits: 1 })
    // Données modifiées, ou autre jour : nouvelle analyse.
    expect(analyzeStateCached({ ...inp, mounts: [...mounts] })).not.toBe(a)
    expect(analyzeStateCached({ ...inp, now: NOW + 86_400_000 })).not.toBe(a)
    expect(analysisCacheStats().computed).toBe(3)
  })
})

// ---------- Tri et regroupement ----------

describe('tri et regroupement', () => {
  const base = (over: Partial<Advice>): Advice => ({ id: 'x', priority: 3, category: 'capture', title: 't', detail: 'd', link: { page: 'accueil', label: 'l' }, ...over })

  it('trie par priorité, heure puis ordre de session', () => {
    const list = sortAdvice([
      base({ id: 'c', priority: 2, category: 'clonage' }),
      base({ id: 'b', priority: 2, category: 'accouplement' }),
      base({ id: 'a', priority: 2, category: 'alarme', dueAt: NOW + 1000 }),
      base({ id: 'z', priority: 1, category: 'prix' }),
    ])
    expect(list.map((a) => a.id)).toEqual(['z', 'a', 'b', 'c'])
  })

  it('range chaque conseil dans un horizon', () => {
    expect(adviceHorizon(base({ dueAt: NOW + 10 * 60_000 }), NOW)).toBe('maintenant')
    expect(adviceHorizon(base({ dueAt: NOW + 3 * 3_600_000 }), NOW)).toBe('heures')
    expect(adviceHorizon(base({ dueAt: NOW + 10 * 3_600_000 }), NOW)).toBe('aujourdhui')
    expect(adviceHorizon(base({ dueAt: NOW + 30 * 3_600_000 }), NOW)).toBe('semaine')
    expect(adviceHorizon(base({ priority: 1 }), NOW)).toBe('maintenant')
    expect(adviceHorizon(base({ priority: 3 }), NOW)).toBe('aujourdhui')
    expect(adviceHorizon(base({ priority: 4 }), NOW)).toBe('semaine')
    expect(adviceHorizon(base({ priority: 4, horizon: 'maintenant' }), NOW)).toBe('maintenant')
    const groups = groupAdvice([base({ id: '1', priority: 1 }), base({ id: '2', priority: 4 }), base({ id: '3', priority: 1 })], NOW)
    expect(groups.map((g) => [g.horizon, g.advice.length])).toEqual([
      ['maintenant', 2],
      ['semaine', 1],
    ])
    expect(groups[0].label).toBe('Maintenant')
    expect(nextTimedAdvice([base({ id: 'a', dueAt: NOW + 5000 }), base({ id: 'b', dueAt: NOW + 1000 }), base({ id: 'c' })], NOW)?.id).toBe('b')
  })
})
