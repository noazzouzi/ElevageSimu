import { describe, expect, it } from 'vitest'
import { serverDayStart } from './almanax'
import { canBenefit, type SimMount } from './paddock'
import { planPaddock, toSimMount } from './paddockAssign'
import { planActiveHistory, projectGaugeLevels, projectMountsFromPlan, projectPaddock, type ReplayablePlan } from './projection'
import { RULESETS } from './rules'
import type { GaugeId, Mount } from './types'

const R36 = RULESETS['3.6']
const HOUR = 3_600_000
const zero = (): Record<GaugeId, number> => ({ baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 })

let seq = 0
const mk = (over: Partial<Mount> = {}): Mount => ({
  id: `p${++seq}`,
  speciesId: 94,
  gender: seq % 2 ? 'male' : 'femelle',
  level: 1,
  ability: null,
  fertility: 'fertile',
  parents: [],
  location: { kind: 'enclos', paddock: 1 },
  serenity: 0,
  endurance: 0,
  maturity: 0,
  love: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
})
const blueLot = () => Array.from({ length: 10 }, (_, i) => mk({ serenity: -1_900 + i * 200 }))
// Un jour sans Almanax (heure locale) : 2026-09-15.
const T0 = new Date(2026, 8, 15, 8, 0).getTime()

describe('projectGaugeLevels — niveaux vidés depuis la saisie', () => {
  it('Foudroyeur + Abreuvoir à 15 000 saisis il y a 5 h, 10 montures éligibles : vides, montures avancées', () => {
    const state = { gauges: { ...zero(), foudroyeur: 15_000, abreuvoir: 15_000 }, active: ['foudroyeur', 'abreuvoir'] as GaugeId[] }
    const p = projectGaugeLevels(state, T0, T0 + 5 * HOUR, R36, blueLot())
    expect(p.levels.foudroyeur).toBe(0)
    expect(p.levels.abreuvoir).toBe(0)
    expect(p.estimated).toBe(true)
    // Palier 1 : 10 points par tick → 15 000 points en 15 000 s.
    expect(p.emptiedAt.foudroyeur).toBe(T0 + 15_000_000)
    expect(p.mounts.every((m) => m.endurance === 15_000 && m.maturity === 15_000)).toBe(true)
    expect(p.stale).toBe(false)
  })

  it('sans monture éligible, la jauge ne consomme rien', () => {
    const state = { gauges: { ...zero(), dragofesse: 30_000 }, active: ['dragofesse'] as GaugeId[] }
    const p = projectGaugeLevels(state, T0, T0 + 5 * HOUR, R36, blueLot())
    expect(p.levels.dragofesse).toBe(30_000)
    expect(p.estimated).toBe(false)
  })

  it('heure de saisie par jauge et jauges actives successives', () => {
    const state = { gauges: { ...zero(), foudroyeur: 50_000, abreuvoir: 20_000 }, active: ['foudroyeur', 'abreuvoir'] as GaugeId[] }
    // Abreuvoir ressaisi 1 h avant maintenant : sa valeur saisie remplace l'estimation à cette heure-là.
    const p = projectGaugeLevels(state, T0, T0 + 2 * HOUR, R36, blueLot(), { gaugeUpdatedAt: { abreuvoir: T0 + HOUR } })
    expect(p.levels.abreuvoir).toBe(20_000 - 3_600)
    // Palier 2 (20 points par tick) jusqu'à 40 000 en 5 000 s, puis palier 1 (10 par tick) pendant 2 200 s.
    expect(p.levels.foudroyeur).toBe(40_000 - 2_200)
    // Jauges coupées au bout d'une heure : plus de consommation ensuite.
    const off = projectGaugeLevels(state, T0, T0 + 3 * HOUR, R36, blueLot(), { activeHistory: [{ at: T0 + HOUR, active: [] }] })
    expect(off.levels.foudroyeur).toBe(50_000 - 3_600 * 2)
  })

  it('Almanax : seul le jour du Foudroyeur (10/03) double le gain, la consommation reste la même', () => {
    const start = serverDayStart('2026-03-09') + 23 * HOUR // 23 h, heure de jeu (Paris)
    const state = { gauges: { ...zero(), foudroyeur: 30_000 }, active: ['foudroyeur'] as GaugeId[] }
    const lot = [mk({ serenity: -500 })]
    const p = projectGaugeLevels(state, start, start + 2 * HOUR, R36, lot)
    expect(p.levels.foudroyeur).toBe(30_000 - 7_200)
    // 1 h avant minuit (×1) puis 1 h le 10/03 (×2).
    expect(p.mounts[0].endurance).toBe(3_600 + 7_200)
    expect(projectGaugeLevels(state, start, start + 2 * HOUR, R36, lot, { almanax: false }).mounts[0].endurance).toBe(7_200)
  })
})

describe('projectMountsFromPlan — montures d’un plan démarré', () => {
  const lot = blueLot()
  const plan = planPaddock(lot.map(toSimMount), { tier: 2, withXp: true, rules: R36 })
  const active = (ack: number): ReplayablePlan => ({
    startedAt: T0,
    offsetMs: 0,
    steps: plan.steps,
    totalSeconds: plan.totalSeconds,
    acknowledgedStepIndex: ack,
    tier: 2,
    tiers: plan.tiers,
    rulesetId: '3.6',
    mountIds: lot.map((m) => m.id),
  })

  it('après la 1re étape (bleu) : endurance et maturité pleines, sérénité inchangée', () => {
    const first = plan.steps[0]
    expect([...first.gauges].sort()).toEqual(['abreuvoir', 'foudroyeur'])
    const now = T0 + (first.startSeconds + first.durationSeconds) * 1000
    const p = projectMountsFromPlan(active(1), lot, now)
    for (const m of lot) {
      const s = p.byId[m.id]
      expect([s.endurance, s.maturity, s.serenity]).toEqual([20_000, 20_000, m.serenity])
    }
    expect(p.stepIndex).toBe(1)
    expect(p.fecundIds).toEqual([])
  })

  it('pendant l’étape Caresseur + Dragofesse : des montures profitent de la Dragofesse (pas de « jauge inutile »)', () => {
    const k = plan.steps.findIndex((s) => s.gauges.includes('caresseur') && s.gauges.includes('dragofesse'))
    expect(k).toBeGreaterThan(0)
    const st = plan.steps[k]
    const now = T0 + (st.startSeconds + st.durationSeconds / 2) * 1000
    const p = projectMountsFromPlan(active(k), lot, now)
    expect(p.mounts.filter((m) => canBenefit('dragofesse', m)).length).toBeGreaterThan(0)
    // Sans projection (statistiques de l'inventaire), personne n'est éligible : c'était le faux conseil.
    expect(lot.map(toSimMount).filter((m) => canBenefit('dragofesse', m)).length).toBe(0)
  })

  it('plan terminé : tout le lot est fécond', () => {
    const p = projectMountsFromPlan(active(plan.steps.length), lot, T0 + (plan.totalSeconds + 60) * 1000)
    expect(p.finished).toBe(true)
    expect(p.fecundIds.sort()).toEqual(lot.map((m) => m.id).sort())
  })

  it('étape en cours bornée à sa durée prévue, sauf continueCurrentStep ; montures supprimées signalées', () => {
    const late = T0 + (plan.steps[0].durationSeconds + 3_600) * 1000
    const capped = projectMountsFromPlan(active(0), lot, late)
    expect(capped.mounts.every((m) => m.serenity === lot.find((x) => x.id === m.id)!.serenity)).toBe(true)
    const p = projectMountsFromPlan({ ...active(0), mountIds: [...lot.map((m) => m.id), 'disparue'] }, lot, late)
    expect(p.missingIds).toEqual(['disparue'])
  })
})

describe('planActiveHistory et projectPaddock', () => {
  it('historique des jauges du plan, puis projection jauges + montures', () => {
    const lot = blueLot()
    const plan = planPaddock(lot.map(toSimMount), { tier: 2, withXp: true, rules: R36 })
    const running: ReplayablePlan = { startedAt: T0, offsetMs: 0, steps: plan.steps, totalSeconds: plan.totalSeconds, acknowledgedStepIndex: 1, tier: 2, tiers: plan.tiers, rulesetId: '3.6', mountIds: lot.map((m) => m.id) }
    const h = planActiveHistory(running)
    expect(h).toHaveLength(2)
    expect(h[1]).toEqual({ at: T0 + plan.steps[1].startSeconds * 1000, active: plan.steps[1].gauges })
    expect(planActiveHistory({ ...running, acknowledgedStepIndex: plan.steps.length }).at(-1)?.active).toEqual([])

    const now = T0 + (plan.steps[1].startSeconds + 60) * 1000
    const state = { gauges: { ...zero(), foudroyeur: 70_000, abreuvoir: 70_000 }, active: plan.steps[1].gauges }
    const proj = projectPaddock({ state, activeSinceMs: T0, nowMs: now, rules: R36, mounts: lot, plan: running })
    // Étape 1 (Foudroyeur + Abreuvoir, palier 2) : 20 000 points chacune, puis jauges changées.
    expect(proj.gauges.levels.foudroyeur).toBe(50_000)
    expect(proj.gauges.levels.abreuvoir).toBe(50_000)
    expect(proj.plan?.stepIndex).toBe(1)
    const sample: SimMount = proj.mounts[0]
    expect(sample.endurance).toBe(20_000)
  })
})
