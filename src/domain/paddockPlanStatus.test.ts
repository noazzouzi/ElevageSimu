import { describe, expect, it } from 'vitest'
import type { FertilityStep } from './fertility'
import { effectiveFertility } from './mounts'
import { planPaddock, toFillerSim, toSimMount, type PlanSchedule } from './paddockAssign'
import { END_OVERDUE_MS, planStatus, planYield, pointsValue, projectedMountPatches, remainingPlanConsumption } from './paddockPlanStatus'
import { projectMountsFromPlan, type ReplayablePlan } from './projection'
import { RULESETS } from './rules'
import type { GaugeId, Mount } from './types'

const R36 = RULESETS['3.6']
const MIN = 60_000
const HOUR = 3_600_000
// Un jour sans Almanax (heure locale) : 2026-09-15.
const T0 = new Date(2026, 8, 15, 8, 0).getTime()

let seq = 0
const mk = (over: Partial<Mount> = {}): Mount => ({
  id: `s${++seq}`,
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

const step = (gauges: GaugeId[], startSeconds: number, durationSeconds: number, extra: Partial<FertilityStep> = {}): FertilityStep => ({
  gauges,
  startSeconds,
  durationSeconds,
  purpose: 'test',
  consumed: {},
  ...extra,
})

describe('planStatus — changement manqué (ux F6)', () => {
  // Étape 1 : poussée de sérénité (Baffeur + Dragofesse) avec fenêtre 10–20 min ; étape 2 : Abreuvoir.
  const plan: PlanSchedule = {
    startedAt: T0,
    steps: [step(['baffeur', 'dragofesse'], 0, 1_200, { switchWindow: { earliestSeconds: 600, latestSeconds: 1_200 } }), step(['abreuvoir', 'dragofesse'], 1_200, 7_200)],
    totalSeconds: 8_400,
    acknowledgedStepIndex: 0,
  }

  it('changement manqué de 9 h pendant une poussée de sérénité : plan dépassé, pas « faites-le tout de suite »', () => {
    const st = planStatus(plan, T0 + 1_200_000 + 9 * HOUR)
    expect(st.state).toBe('stale')
    expect(st.serenityPush).toBe(true)
    expect(st.reason).toMatch(/Baffeur/)
    expect(st.reason).toMatch(/ne vaut plus/)
  })

  it('juste après l’heure prévue : dû, puis fenêtre dépassée, puis dépassé après max(30 min, 2 × fenêtre)', () => {
    expect(planStatus(plan, T0 + 5 * MIN).state).toBe('running')
    expect(planStatus(plan, T0 + 20 * MIN).state).toBe('due')
    expect(planStatus(plan, T0 + 25 * MIN).state).toBe('late')
    // Fenêtre de 10 min → seuil max(30 min, 20 min) = 30 min après la fin de fenêtre.
    expect(planStatus(plan, T0 + 49 * MIN).state).toBe('late')
    expect(planStatus(plan, T0 + 51 * MIN).state).toBe('stale')
  })

  it('une étape de statistique en retard de 9 h n’invalide pas le plan (seules Baffeur/Caresseur déplacent la sérénité)', () => {
    const p2: PlanSchedule = { ...plan, acknowledgedStepIndex: 1, steps: [...plan.steps, step(['caresseur'], 8_400, 600)], totalSeconds: 9_000 }
    const st = planStatus(p2, T0 + 8_400_000 + 9 * HOUR)
    expect(st.state).toBe('due')
    expect(st.lateMs).toBe(9 * HOUR)
  })

  it('fin du plan non validée depuis plus d’une heure : fin non validée ; toutes étapes validées : terminé', () => {
    const atEnd: PlanSchedule = { ...plan, acknowledgedStepIndex: 1 }
    expect(planStatus(atEnd, T0 + 8_400_000 + END_OVERDUE_MS + MIN).state).toBe('end-overdue')
    expect(planStatus(atEnd, T0 + 8_400_000 + MIN).state).toBe('due')
    expect(planStatus({ ...plan, acknowledgedStepIndex: 2 }, T0 + 99 * HOUR).state).toBe('finished')
  })
})

describe('planYield — montures réellement nourries (F15)', () => {
  it('10 montures bleues sous Foudroyeur + Abreuvoir : rendement maximal', () => {
    const sims = Array.from({ length: 10 }, () => toSimMount(mk({ serenity: -1_000 })))
    const y = planYield({ steps: [step(['foudroyeur', 'abreuvoir'], 0, 3_600)], tier: 2 }, sims, { rules: R36 })
    expect(y.full).toBe(true)
    expect(y.byGauge.foudroyeur?.yield).toBe(1)
    expect(y.byGauge.foudroyeur?.consumed).toBe(360 * 20)
    expect(y.warnings).toEqual([])
  })

  it('5 fertiles + 5 compléments XP : la moitié du carburant ne nourrit personne', () => {
    const sims = [...Array.from({ length: 5 }, () => toSimMount(mk({ serenity: -1_000 }))), ...Array.from({ length: 5 }, () => toFillerSim(mk({ serenity: -1_000, fertility: 'sterile' })))]
    const y = planYield({ steps: [step(['foudroyeur', 'abreuvoir'], 0, 3_600)], tier: 2 }, sims, { rules: R36 })
    expect(y.full).toBe(false)
    expect(y.byGauge.foudroyeur?.yield).toBeCloseTo(0.5)
    expect(y.byGauge.foudroyeur?.lostPoints).toBeCloseTo(3_600)
    expect(y.warnings[0]).toMatch(/^Foudroyeur : 1 étape à 5\/10 montures/)
  })

  it('lot de -900 à 900 (de part et d’autre de 0) : Foudroyeur ne nourrit pas 10 montures, pas de « rendement maximal »', () => {
    const lot = Array.from({ length: 10 }, (_, i) => toSimMount(mk({ serenity: -900 + i * 200 })))
    const plan = planPaddock(lot, { tier: 2, rules: R36 })
    const y = planYield(plan, lot, { rules: R36 })
    expect(y.full).toBe(false)
    expect(y.byGauge.foudroyeur!.yield).toBeLessThan(1)
    expect(y.warnings.some((w) => w.startsWith('Foudroyeur'))).toBe(true)
  })
})

describe('projectedMountPatches — appliquer l’état projeté au lot (F4, ux F2)', () => {
  const blue = () => Array.from({ length: 10 }, (_, i) => mk({ serenity: -1_900 + i * 200, level: 1 }))

  it('lot bleu après l’étape 1 : endurance et maturité à 20 000, sérénité inchangée', () => {
    const mounts = blue()
    const plan = planPaddock(mounts.map(toSimMount), { tier: 2, rules: R36 })
    expect(plan.steps[0].gauges.sort()).toEqual(['abreuvoir', 'foudroyeur'])
    const active: ReplayablePlan = { startedAt: T0, steps: plan.steps, totalSeconds: plan.totalSeconds, acknowledgedStepIndex: 0, tier: 2, tiers: plan.tiers, mountIds: mounts.map((m) => m.id) }
    const proj = projectMountsFromPlan(active, mounts, T0 + plan.steps[0].durationSeconds * 1000, { rules: R36 })
    const patches = projectedMountPatches(proj.byId, mounts)
    for (const m of mounts) {
      const after = { ...m, ...patches[m.id] }
      expect(after.endurance).toBe(20_000)
      expect(after.maturity).toBe(20_000)
      expect(after.serenity).toBe(m.serenity)
    }
  })

  it('plan terminé : toutes fécondes (effectiveFertility), niveau gagné à la Mangeoire, rangées à l’étable si demandé', () => {
    const mounts = blue()
    const plan = planPaddock(mounts.map(toSimMount), { tier: 2, rules: R36, withXp: true })
    expect(plan.converges).toBe(true)
    const done: ReplayablePlan = { startedAt: T0, steps: plan.steps, totalSeconds: plan.totalSeconds, acknowledgedStepIndex: plan.steps.length, tier: 2, tiers: plan.tiers, mountIds: mounts.map((m) => m.id) }
    const proj = projectMountsFromPlan(done, mounts, T0 + plan.totalSeconds * 1000, { rules: R36 })
    const patches = projectedMountPatches(proj.byId, mounts, { fecundToStable: true })
    const after = mounts.map((m) => ({ ...m, ...patches[m.id] }))
    expect(after.every((m) => effectiveFertility(m) === 'feconde')).toBe(true)
    expect(after.every((m) => m.location.kind === 'etable')).toBe(true)
    if (plan.steps.some((s) => s.gauges.includes('mangeoire'))) expect(after.some((m) => m.level > 1)).toBe(true)
  })

  it('stérile : statistiques jamais écrites ; sérénité relevée en jeu prioritaire', () => {
    const s = mk({ fertility: 'sterile', serenity: 100, endurance: 3 })
    const patches = projectedMountPatches({ [s.id]: { ...toSimMount(s), serenity: 900 } }, [s], { serenity: { [s.id]: -1_234 } })
    expect(patches[s.id]).toEqual({ serenity: -1_234 })
  })
})

describe('remainingPlanConsumption et pointsValue', () => {
  it('étape en cours au prorata du temps restant', () => {
    const plan: PlanSchedule = {
      startedAt: T0,
      steps: [step(['foudroyeur'], 0, 1_000, { consumed: { foudroyeur: 1_000 } }), step(['abreuvoir'], 1_000, 1_000, { consumed: { abreuvoir: 800 } })],
      totalSeconds: 2_000,
      acknowledgedStepIndex: 0,
    }
    const r = remainingPlanConsumption(plan, T0 + 250_000)
    expect(r.consumed).toEqual({ foudroyeur: 750, abreuvoir: 800 })
    expect(r.steps).toHaveLength(2)
  })

  it('un coût au point inconnu n’est jamais compté 0 : borne basse ou null', () => {
    const ok = { value: 2, complete: true, bound: null }
    expect(pointsValue([{ points: 100, pointCost: ok }])).toEqual({ value: 200, complete: true })
    expect(pointsValue([{ points: 100, pointCost: ok }, { points: 50, pointCost: { value: null, complete: false, bound: null } }])).toEqual({ value: 200, complete: false })
    expect(pointsValue([{ points: 50, pointCost: { value: 9, complete: false, bound: 'max' } }])).toEqual({ value: null, complete: false })
  })
})
