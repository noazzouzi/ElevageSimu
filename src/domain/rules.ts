// Jeux de règles selon la version du jeu. 3.6 = live (défaut) ; 3.7 = bêta (client 3.7.3.3).
// Sources : research/README.md §2.1, research/data/mechanics.json (client Ankama par version).
import type { Ability, FuelTier, RulesetId } from './types'

export interface Ruleset {
  id: RulesetId
  label: string
  /** Bornes hautes des paliers de jauge. */
  gaugeTierMax: Record<FuelTier, number>
  /** Consommation (et gain) par tick de 10 s selon le palier. */
  gaugeRatePerTick: Record<FuelTier, number>
  /** Multiplicateur de durabilité des carburants (×2 en 3.7). */
  fuelDurabilityFactor: number
  /** Bonus de génération cible de l'Optimakina. */
  optimakinaBonus: number
  /** XP d'Éleveur par génération et par parent lors d'un accouplement. */
  matingXpPerGeneration: number
  /** Génétons par parent selon sa génération (index = génération). */
  genetonsByGeneration: number[]
  /** L'Animakina donne une capacité aléatoire (3.5/3.6) ou permet de choisir le sexe (3.7). */
  animakina: 'capacite' | 'sexe'
  /** Probabilités de capacité sans makina (3.7 bêta, devblog). */
  naturalAbilityOdds: Partial<Record<Ability, number>> | null
  stableSlots: number
  /** Le clone conserve sa sérénité (3.7) ou est réinitialisé. */
  cloneKeepsSerenity: boolean
}

const BASE: Omit<Ruleset, 'id' | 'label'> = {
  gaugeTierMax: { 1: 40_000, 2: 70_000, 3: 90_000, 4: 100_000 },
  gaugeRatePerTick: { 1: 10, 2: 20, 3: 30, 4: 40 },
  fuelDurabilityFactor: 1,
  optimakinaBonus: 0.1,
  matingXpPerGeneration: 30,
  genetonsByGeneration: [0, 1, 2, 4, 8, 15, 30, 60, 120, 250, 0],
  animakina: 'capacite',
  naturalAbilityOdds: null,
  stableSlots: 250,
  cloneKeepsSerenity: false,
}

export const RULESETS: Record<RulesetId, Ruleset> = {
  '3.5': { ...BASE, id: '3.5', label: '3.5 (03/03 → 22/06/2026)', matingXpPerGeneration: 10 },
  '3.6': { ...BASE, id: '3.6', label: '3.6 — version actuelle (live)' },
  '3.7': {
    ...BASE,
    id: '3.7',
    label: '3.7 — bêta (valeurs susceptibles de changer)',
    gaugeTierMax: { 1: 80_000, 2: 140_000, 3: 180_000, 4: 200_000 },
    fuelDurabilityFactor: 2,
    optimakinaBonus: 0.2,
    genetonsByGeneration: [0, 2, 4, 8, 15, 30, 60, 120, 250, 500, 0],
    animakina: 'sexe',
    naturalAbilityOdds: { reproducteur: 0.03, sage: 0.06, precoce: 0.08, amoureuse: 0.08, endurante: 0.08 },
    stableSlots: 500,
    cloneKeepsSerenity: true,
  },
}

export const DEFAULT_RULESET: RulesetId = '3.6'

export function getRuleset(id: RulesetId | undefined): Ruleset {
  return RULESETS[id ?? DEFAULT_RULESET] ?? RULESETS[DEFAULT_RULESET]
}

/** Capacité maximale d'une jauge pour ce ruleset. */
export function gaugeMax(rules: Ruleset): number {
  return rules.gaugeTierMax[4]
}
