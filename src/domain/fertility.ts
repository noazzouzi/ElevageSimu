// Planificateur de fécondité : quelles jauges activer, dans quel ordre et pendant combien de temps
// pour rendre féconde une monture (ou un groupe de montures de sérénité proche).
//
// Principes (déduits des règles de sérénité) :
// - La maturité ne monte qu'entre -2 000 et 2 000 : on la fait en priorité, couplée à l'endurance
//   (sérénité -2 000…-1) ou à l'amour (0…2 000).
// - L'endurance monte sur toute la plage négative et l'amour sur toute la plage positive : une fois
//   la maturité pleine, on peut pousser la sérénité (Baffeur/Caresseur) sans risque de dépassement.
// - Pour revenir dans la zone de maturité depuis un extrême, on vise le centre de la zone (±1 000)
//   pour laisser une marge à l'alarme.
import { GAUGE_LABELS, MATURITY_SERENITY_RANGE, MOUNT_STAT_MAX, TICK_SECONDS } from './constants'
import { formatDuration, simulatePaddock, type SimMount } from './paddock'
import type { FuelTier, GaugeId } from './types'

export interface FertilityOptions {
  /** Tier maintenu sur les jauges (recharges régulières). */
  tier: FuelTier
  /** Activer la Mangeoire quand une seule autre jauge est utile. */
  withXp?: boolean
  almanaxDoubled?: GaugeId | null
  /** Durée maximale planifiée (défaut : 7 jours). */
  maxSeconds?: number
}

export interface FertilityStep {
  gauges: GaugeId[]
  startSeconds: number
  durationSeconds: number
  /** Explication en français de l'objectif de l'étape. */
  purpose: string
  /** Fenêtre pendant laquelle il faut changer les jauges (pour les étapes de sérénité). */
  switchWindow?: { earliestSeconds: number; latestSeconds: number }
  consumed: Partial<Record<GaugeId, number>>
}

export interface FertilityPlan {
  steps: FertilityStep[]
  totalSeconds: number
  fecundAt: Record<string, number>
  consumed: Record<GaugeId, number>
  warnings: string[]
  mounts: SimMount[]
}

type Decision = { gauges: GaugeId[]; purpose: string; pushTarget?: number }

const SER_TARGET_NEG = -1_000
const SER_TARGET_POS = 1_000

/** Décide la paire de jauges pour une monture selon ses besoins et sa sérénité. */
export function decideGauges(m: SimMount, withXp: boolean): Decision | null {
  const needE = m.endurance < MOUNT_STAT_MAX
  const needM = m.maturity < MOUNT_STAT_MAX
  const needA = m.love < MOUNT_STAT_MAX
  const s = m.serenity
  const filler = (g: GaugeId[]): GaugeId[] => (withXp && g.length < 2 ? [...g, 'mangeoire'] : g)
  if (!needE && !needM && !needA) return null

  if (needM) {
    if (s < MATURITY_SERENITY_RANGE[0]) {
      const target = needE || !needA ? SER_TARGET_NEG : SER_TARGET_POS
      return {
        gauges: needE ? ['caresseur', 'foudroyeur'] : filler(['caresseur']),
        purpose: `Remonter la sérénité vers ${target.toLocaleString('fr-FR')} (zone de maturité)${needE ? " tout en montant l'endurance" : ''}`,
        pushTarget: target,
      }
    }
    if (s > MATURITY_SERENITY_RANGE[1]) {
      const target = needA || !needE ? SER_TARGET_POS : SER_TARGET_NEG
      return {
        gauges: needA ? ['baffeur', 'dragofesse'] : filler(['baffeur']),
        purpose: `Baisser la sérénité vers ${target.toLocaleString('fr-FR')} (zone de maturité)${needA ? " tout en montant l'amour" : ''}`,
        pushTarget: target,
      }
    }
    if (s < 0) {
      if (needE) return { gauges: ['foudroyeur', 'abreuvoir'], purpose: 'Monter endurance + maturité' }
      if (needA)
        return {
          gauges: ['caresseur', 'abreuvoir'],
          purpose: `Monter la maturité en remontant la sérénité vers ${SER_TARGET_POS.toLocaleString('fr-FR')} (pour l'amour)`,
          pushTarget: SER_TARGET_POS,
        }
      return { gauges: filler(['abreuvoir']), purpose: 'Monter la maturité' }
    }
    if (needA) return { gauges: ['abreuvoir', 'dragofesse'], purpose: 'Monter maturité + amour' }
    if (needE)
      return {
        gauges: ['baffeur', 'abreuvoir'],
        purpose: `Monter la maturité en baissant la sérénité vers ${SER_TARGET_NEG.toLocaleString('fr-FR')} (pour l'endurance)`,
        pushTarget: SER_TARGET_NEG,
      }
    return { gauges: filler(['abreuvoir']), purpose: 'Monter la maturité' }
  }

  // Maturité pleine : endurance et/ou amour, dépassement de sérénité sans conséquence.
  if (s < 0) {
    if (needE) return { gauges: filler(['foudroyeur']), purpose: "Monter l'endurance" }
    return { gauges: ['caresseur', 'dragofesse'], purpose: "Passer en sérénité positive et monter l'amour" }
  }
  if (needA) return { gauges: filler(['dragofesse']), purpose: "Monter l'amour" }
  return { gauges: ['baffeur', 'foudroyeur'], purpose: "Passer en sérénité négative et monter l'endurance" }
}

const key = (g: GaugeId[]) => [...g].sort().join('+')

/** Décision majoritaire pour un groupe (les montures fécondes sont ignorées). */
function decideGroup(mounts: SimMount[], withXp: boolean): Decision | null {
  const counts = new Map<string, { d: Decision; n: number }>()
  for (const m of mounts) {
    const d = decideGauges(m, withXp)
    if (!d) continue
    const k = key(d.gauges)
    const e = counts.get(k)
    if (e) e.n++
    else counts.set(k, { d, n: 1 })
  }
  let best: { d: Decision; n: number } | null = null
  for (const e of counts.values()) if (!best || e.n > best.n) best = e
  return best?.d ?? null
}

/** Construit le plan de fécondité complet d'un groupe de montures placées dans le même enclos. */
export function planFertility(input: SimMount[], opts: FertilityOptions): FertilityPlan {
  const maxSeconds = opts.maxSeconds ?? 7 * 86_400
  const withXp = opts.withXp ?? false
  let mounts = input.map((m) => ({ ...m }))
  const steps: FertilityStep[] = []
  const warnings: string[] = []
  const consumed: Record<GaugeId, number> = {
    baffeur: 0,
    caresseur: 0,
    foudroyeur: 0,
    abreuvoir: 0,
    dragofesse: 0,
    mangeoire: 0,
  }
  const fecundAt: Record<string, number> = {}
  let t = 0

  for (let guard = 0; guard < 40 && t < maxSeconds; guard++) {
    const d = decideGroup(mounts, withXp)
    if (!d) break
    const k = key(d.gauges)
    const maintain: Partial<Record<GaugeId, FuelTier>> = {}
    for (const g of d.gauges) maintain[g] = opts.tier
    const res = simulatePaddock({
      gauges: { baffeur: 0, caresseur: 0, foudroyeur: 0, abreuvoir: 0, dragofesse: 0, mangeoire: 0 },
      active: d.gauges,
      mounts,
      almanaxDoubled: opts.almanaxDoubled ?? null,
      maintainTier: maintain,
      maxSeconds: maxSeconds - t,
      stopWhen: (ms) => {
        if (d.pushTarget !== undefined) {
          const pushing = d.gauges.includes('caresseur') ? 1 : -1
          const reached = ms.every((m) => (pushing > 0 ? m.serenity >= d.pushTarget! : m.serenity <= d.pushTarget!))
          if (reached) return true
        }
        const nd = decideGroup(ms, withXp)
        if (!nd) return true
        // Pendant une poussée de sérénité, on ignore l'entrée dans la zone avant d'atteindre la cible.
        if (d.pushTarget !== undefined && nd.pushTarget === undefined && pushingContinues(d, ms)) return false
        return key(nd.gauges) !== k
      },
    })
    if (res.seconds === 0) {
      warnings.push(`Aucune progression possible avec ${d.gauges.map((g) => GAUGE_LABELS[g]).join(' + ')}.`)
      break
    }
    const stepConsumed: Partial<Record<GaugeId, number>> = {}
    for (const g of d.gauges) {
      stepConsumed[g] = res.consumed[g]
      consumed[g] += res.consumed[g]
    }
    const step: FertilityStep = {
      gauges: d.gauges,
      startSeconds: t,
      durationSeconds: res.seconds,
      purpose: d.purpose,
      consumed: stepConsumed,
    }
    if (d.pushTarget !== undefined) step.switchWindow = switchWindow(d, opts, t, res.seconds)
    for (const [id, at] of Object.entries(res.fecundAt)) if (fecundAt[id] === undefined) fecundAt[id] = t + at
    steps.push(step)
    t += res.seconds
    mounts = res.mounts
  }
  // Fusion des étapes consécutives identiques.
  const merged: FertilityStep[] = []
  for (const s of steps) {
    const last = merged[merged.length - 1]
    if (last && key(last.gauges) === key(s.gauges) && last.purpose === s.purpose) {
      last.durationSeconds += s.durationSeconds
      for (const [g, v] of Object.entries(s.consumed)) last.consumed[g as GaugeId] = (last.consumed[g as GaugeId] ?? 0) + (v ?? 0)
    } else merged.push(s)
  }
  if (mounts.some((m) => fecundAt[m.id] === undefined)) warnings.push('Certaines montures ne sont pas fécondes à la fin du plan.')
  return { steps: merged, totalSeconds: t, fecundAt, consumed, warnings, mounts }
}

function pushingContinues(d: Decision, ms: SimMount[]): boolean {
  if (d.pushTarget === undefined) return false
  const up = d.gauges.includes('caresseur')
  return ms.some((m) => (up ? m.serenity < d.pushTarget! : m.serenity > d.pushTarget!))
}

/**
 * Fenêtre de changement de jauges pour une étape de poussée de sérénité : au plus tôt quand toutes
 * les montures sont entrées dans la zone visée, au plus tard avant que la première n'en sorte.
 */
function switchWindow(d: Decision, opts: FertilityOptions, start: number, duration: number) {
  const up = d.gauges.includes('caresseur')
  const rate = { 1: 10, 2: 20, 3: 30, 4: 40 }[opts.tier] * (opts.almanaxDoubled === (up ? 'caresseur' : 'baffeur') ? 2 : 1)
  // Zone visée : [-2000,-1] ou [0,2000]
  const target = d.pushTarget!
  const zone: [number, number] = target < 0 ? [MATURITY_SERENITY_RANGE[0], -1] : [0, MATURITY_SERENITY_RANGE[1]]
  const end = start + duration
  // Marge restante entre la cible et la sortie de zone, à la vitesse de poussée.
  const margin = up ? zone[1] - target : target - zone[0]
  const entryMargin = up ? target - zone[0] : zone[1] - target
  const latest = end + Math.floor(margin / rate) * TICK_SECONDS
  const earliest = Math.max(start, end - Math.floor(entryMargin / rate) * TICK_SECONDS)
  return { earliestSeconds: earliest, latestSeconds: latest }
}

/** Résumé texte d'un plan, pour l'affichage ou les tests. */
export function describePlan(plan: FertilityPlan): string[] {
  return plan.steps.map(
    (s, i) =>
      `${i + 1}. ${s.gauges.map((g) => GAUGE_LABELS[g]).join(' + ')} pendant ${formatDuration(s.durationSeconds)} — ${s.purpose}`,
  )
}
