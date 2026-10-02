// Bonus Almanax liés à l'élevage (le 10 de chaque mois + Takeza à date variable).
// Source : research/data/mechanics.json (DofusDB almanax-calendars, texte officiel).
//
// Le jour Almanax est celui des serveurs de jeu (heure de Paris, `SERVER_TZ`) : pour un joueur au Québec
// ou aux Antilles, il change en fin d'après-midi ou en soirée. Toute recherche d'Almanax, de Takeza ou de
// bonus du métier doit donc partir de `serverDay(ms)`, pas de la date locale du navigateur (`isoDay`).
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

/** Fuseau horaire des serveurs de jeu (jour Almanax, Takeza). */
export const SERVER_TZ = 'Europe/Paris'

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Date ISO **locale du navigateur** (AAAA-MM-JJ) d'un instant (ms). Réservée à l'affichage purement local
 * (routines du jour…) : pour l'Almanax et le Takeza, utiliser `serverDay`.
 */
export function isoDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const serverParts = new Intl.DateTimeFormat('en-US', {
  timeZone: SERVER_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Heure murale de Paris d'un instant : [année, mois (1-12), jour, heure, minute, seconde]. */
function serverWallClock(ms: number): [number, number, number, number, number, number] {
  const parts = serverParts.formatToParts(ms)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? NaN)
  return [get('year'), get('month'), get('day'), get('hour') % 24, get('minute'), get('second')]
}

/** Date ISO (AAAA-MM-JJ) du jour de jeu (heure de Paris) à l'instant `ms`, quel que soit le fuseau du navigateur. */
export function serverDay(ms: number): string {
  const [y, m, d] = serverWallClock(ms)
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** Décalage (ms) de l'heure de Paris par rapport à UTC à l'instant `ms` (+1 h l'hiver, +2 h l'été). */
export function serverUtcOffsetMs(ms: number): number {
  const [y, m, d, h, mi, s] = serverWallClock(ms)
  return Date.UTC(y, m - 1, d, h, mi, s) - Math.floor(ms / 1000) * 1000
}

/** Date ISO décalée de `days` jours de calendrier (sans effet d'heure d'été ni de fuseau). */
export function addIsoDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

/** Instant (ms) du début du jour de jeu `iso` (minuit à Paris). */
export function serverDayStart(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  const midnightUtc = Date.UTC(y, m - 1, d)
  // Deux passes : le décalage de Paris à minuit (heure d'été ou non) se lit à l'instant visé.
  let at = midnightUtc - serverUtcOffsetMs(midnightUtc)
  at = midnightUtc - serverUtcOffsetMs(at)
  return at
}

/** Instant (ms) du prochain changement de jour de jeu (minuit à Paris) après `ms`. */
export function nextServerDayStart(ms: number): number {
  return serverDayStart(addIsoDays(serverDay(ms), 1))
}

/**
 * Le jour de jeu change-t-il à une autre heure que minuit pour ce navigateur ? Renvoie l'instant où le
 * jour de jeu `day` (AAAA-MM-JJ, ou l'instant `ms` dont on prend le jour de jeu) se termine — pour
 * afficher son heure locale, ex. « 18:00 » au Québec — ou null si le navigateur est à l'heure de Paris.
 */
export function serverDayChangeIfNotLocalMidnight(day: string | number): number | null {
  const at = serverDayStart(addIsoDays(typeof day === 'number' ? serverDay(day) : day, 1))
  const local = new Date(at)
  return local.getHours() === 0 && local.getMinutes() === 0 ? null : at
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

/** Bonus d'élevage actif à l'instant `ms` (jour de jeu, heure de Paris), ou null. */
export function almanaxAt(ms: number): AlmanaxEffect | null {
  return almanaxOn(serverDay(ms))
}

/** Jours de calendrier entre deux dates ISO (b − a). */
export function isoDaysBetween(a: string, b: string): number {
  const n = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
  }
  return n(b) - n(a)
}

/** Prochains bonus d'élevage dans les `days` jours suivant le jour de jeu `todayIso` (inclus). */
export function upcomingAlmanaxFrom(todayIso: string, days = 45): AlmanaxEffect[] {
  const out: AlmanaxEffect[] = []
  for (let i = 0; i <= days; i++) {
    const e = almanaxOn(addIsoDays(todayIso, i))
    if (e) out.push(e)
  }
  return out
}

/** Prochains bonus d'élevage dans les `days` jours de jeu à venir (aujourd'hui inclus, heure de Paris). */
export function upcomingAlmanax(nowMs: number, days = 45): AlmanaxEffect[] {
  return upcomingAlmanaxFrom(serverDay(nowMs), days)
}
