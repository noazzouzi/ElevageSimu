// Tables d'expérience : montures, métier d'Éleveur, XP de craft.
// Sources : research/data/mechanics.json (table XP monture DPLN ; table métier 10·L·(L−1) ;
// formule de craft du client validée sur 3 valeurs en jeu).
import { GAME } from '../data'

export const MAX_LEVEL = 200

/** XP cumulée nécessaire pour atteindre le niveau L d'une monture. */
export function mountXpForLevel(level: number): number {
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)))
  return GAME.mountXpTable[L - 1]
}

/** Niveau d'une monture pour une XP cumulée. */
export function mountLevelFromXp(xp: number): number {
  return levelFromTable(GAME.mountXpTable, xp)
}

/** XP de monture à gagner pour passer du niveau `from` au niveau `to`. */
export function mountXpBetween(from: number, to: number): number {
  return Math.max(0, mountXpForLevel(to) - mountXpForLevel(from))
}

/** XP cumulée nécessaire pour atteindre le niveau L du métier d'Éleveur. */
export function jobXpForLevel(level: number): number {
  const L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)))
  return GAME.jobXpTable[L - 1]
}

export function jobLevelFromXp(xp: number): number {
  return levelFromTable(GAME.jobXpTable, xp)
}

export function jobXpBetween(from: number, to: number): number {
  return Math.max(0, jobXpForLevel(to) - jobXpForLevel(from))
}

function levelFromTable(table: number[], xp: number): number {
  let lo = 0
  let hi = table.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (table[mid] <= xp) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/**
 * XP de métier rapportée par un craft : floor(20·L·r/100 / (1 + 0,1·(J−L)^1,1)).
 * 0 si le niveau de métier est inférieur au niveau de la recette ou le dépasse de plus de 100.
 * r = 5 pour carburants, makinas et filets ; 50 pour le Filet de capture universel.
 */
export function craftXp(recipeLevel: number, jobLevel: number, ratioPct: number): number {
  const L = recipeLevel
  const J = jobLevel
  if (J < L || J - L > 100) return 0
  return Math.floor((20 * L * ratioPct) / 100 / (1 + 0.1 * Math.pow(J - L, 1.1)))
}
