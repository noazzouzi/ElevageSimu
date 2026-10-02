// Bonus Almanax liés à l'élevage (le 10 de chaque mois + Takeza à date variable).
// Source : research/data/mechanics.json (DofusDB almanax-calendars, texte officiel).
import { GAME } from '../data'
import type { Ability, GaugeId } from './types'

const CLIENT_GAUGE: Record<string, GaugeId> = {
  SLAPPER: 'baffeur',
  PATTER: 'caresseur',
  BLASTER: 'foudroyeur',
  DRINKING_TROUGH: 'abreuvoir',
  DRAGO_BUTT: 'dragofesse',
  FEEDER: 'mangeoire',
}

const ABILITY_BY_LABEL: Record<string, Ability> = {
  Endurante: 'endurante',
  Amoureuse: 'amoureuse',
  Sage: 'sage',
  Précoce: 'precoce',
}

/** Dates de Takeza connues (le jour varie chaque année). */
export const TAKEZA_DATES = ['2026-10-12', '2027-10-11', '2028-10-09', '2029-10-08', '2030-10-14']

export interface AlmanaxEffect {
  /** Date ISO locale (AAAA-MM-JJ). */
  date: string
  name: string
  effect: string
  doubledGauge: GaugeId | null
  babyAbility: Ability | null
  takeza: boolean
}

/** Date ISO locale d'un instant (ms). */
export function isoDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Bonus d'élevage actif à une date (ou null). */
export function almanaxOn(isoDate: string): AlmanaxEffect | null {
  const [, mm, dd] = isoDate.split('-')
  if (TAKEZA_DATES.includes(isoDate))
    return { date: isoDate, name: 'Takeza', effect: '+20 % de chances d’obtenir la génération cible', doubledGauge: null, babyAbility: null, takeza: true }
  if (dd !== '10') return null
  const b = GAME.almanaxBreedingBonuses.find((x) => x.date === `10/${mm}`)
  if (!b) return null
  return {
    date: isoDate,
    name: b.meryde ?? b.month,
    effect: b.effect,
    doubledGauge: b.gauge ? (CLIENT_GAUGE[b.gauge] ?? null) : null,
    babyAbility: b.ability ? (ABILITY_BY_LABEL[b.ability] ?? null) : null,
    takeza: false,
  }
}

/** Prochains bonus d'élevage dans les `days` jours à venir (aujourd'hui inclus). */
export function upcomingAlmanax(nowMs: number, days = 45): AlmanaxEffect[] {
  const out: AlmanaxEffect[] = []
  for (let i = 0; i <= days; i++) {
    const e = almanaxOn(isoDay(nowMs + i * 86_400_000))
    if (e) out.push(e)
  }
  return out
}
