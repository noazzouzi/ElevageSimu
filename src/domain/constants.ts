// Constantes de l'élevage 3.5+.
// Source principale : Guide de l'éleveur (édition 2026), dofuspourlesnoobs.com — voir research/.
import type { Ability, FuelSize, FuelTier, GaugeId } from './types'

/** Durée d'un « tick » d'enclos, en secondes : les jauges actives agissent toutes les 10 s. */
export const TICK_SECONDS = 10

// Plafonds de jauge, paliers et débits : jamais ici (ils changent avec la version du jeu) — lire le
// ruleset actif (`rules.gaugeTierMax`, `rules.gaugeRatePerTick`, `gaugeMax(rules)`), R14.

/** Nombre maximal de jauges actives simultanément dans un enclos. */
export const MAX_ACTIVE_GAUGES = 2

/** Valeur max des jauges d'endurance, de maturité et d'amour d'une monture. */
export const MOUNT_STAT_MAX = 20_000

export const SERENITY_MIN = -5_000
export const SERENITY_MAX = 5_000

/** Plage de sérénité permettant de gagner de la maturité (incluse). */
export const MATURITY_SERENITY_RANGE: [number, number] = [-2_000, 2_000]
/** L'endurance augmente si la sérénité est strictement négative (-5 000 … -1). */
export const ENDURANCE_SERENITY_MAX = -1
/** L'amour augmente si la sérénité est positive ou nulle (0 … 5 000). */
export const LOVE_SERENITY_MIN = 0

export const PADDOCK_SLOTS = 10
export const MAX_PADDOCKS = 6
export const STABLE_SLOTS = 250

/** Niveau du métier d'Éleveur requis pour chaque enclos (Village des Éleveurs). */
export const PADDOCK_UNLOCK_LEVELS: { level: number; name: string; coords: string }[] = [
  { level: 1, name: 'Enclos du débutant', coords: '[-18,0]' },
  { level: 40, name: 'Enclos du novice', coords: '[-19,0]' },
  { level: 80, name: "Enclos de l'apprenti", coords: '[-20,0]' },
  { level: 120, name: "Enclos de l'initié", coords: '[-20,2]' },
  { level: 160, name: 'Enclos du vétéran', coords: '[-19,2]' },
  { level: 200, name: 'Enclos de maître', coords: '[-18,2]' },
]

/** Niveau de métier requis pour fabriquer chaque tier de carburant. */
export const FUEL_TIER_UNLOCK_LEVEL: Record<FuelTier, number> = { 1: 5, 2: 55, 3: 105, 4: 155 }

export const FUEL_TIER_NAMES: Record<FuelTier, string> = {
  1: 'Extrait',
  2: 'Philtre',
  3: 'Potion',
  4: 'Élixir',
}

export const FUEL_SIZE_DURABILITY: Record<FuelSize, number> = {
  minuscule: 1_000,
  petit: 2_000,
  normal: 3_000,
  grand: 4_000,
  gigantesque: 5_000,
}

export const FUEL_SIZES: FuelSize[] = ['minuscule', 'petit', 'normal', 'grand', 'gigantesque']

/** Prix (en poussière d'élevage) des carburants Gigantesques chez Adèle Vage [-18,1]. */
export const DUST_SHOP_PRICES: Record<FuelTier, number> = { 1: 50, 2: 200, 3: 800, 4: 3_200 }

export const GAUGE_IDS: GaugeId[] = ['baffeur', 'caresseur', 'foudroyeur', 'abreuvoir', 'dragofesse', 'mangeoire']

export const GAUGE_LABELS: Record<GaugeId, string> = {
  baffeur: 'Baffeur',
  caresseur: 'Caresseur',
  foudroyeur: 'Foudroyeur',
  abreuvoir: 'Abreuvoir',
  dragofesse: 'Dragofesse',
  mangeoire: 'Mangeoire',
}

/** Effet de chaque jauge, pour l'affichage. */
export const GAUGE_EFFECTS: Record<GaugeId, string> = {
  baffeur: 'Baisse la sérénité',
  caresseur: 'Augmente la sérénité',
  foudroyeur: "Augmente l'endurance (sérénité < 0)",
  abreuvoir: 'Augmente la maturité (sérénité entre -2 000 et 2 000)',
  dragofesse: "Augmente l'amour (sérénité ≥ 0)",
  mangeoire: "Donne de l'expérience",
}

/** Capacité doublant le gain d'une jauge. */
export const ABILITY_DOUBLES: Partial<Record<Ability, GaugeId>> = {
  endurante: 'foudroyeur',
  precoce: 'abreuvoir',
  amoureuse: 'dragofesse',
  sage: 'mangeoire',
}

export const ABILITY_LABELS: Record<Ability, string> = {
  amoureuse: 'Amoureuse',
  endurante: 'Endurante',
  precoce: 'Précoce',
  sage: 'Sage',
  reproducteur: 'Reproducteur',
  cameleone: 'Caméléone',
}

/** Probabilités de l'Animakina. */
export const ANIMAKINA_ODDS: Partial<Record<Ability, number>> = {
  amoureuse: 0.27,
  endurante: 0.27,
  precoce: 0.27,
  reproducteur: 0.05,
  sage: 0.14,
}

/** Bonus de chance d'obtenir la génération cible. */
export const TARGET_GEN_BASE_CHANCE = 0.3
export const TARGET_GEN_PER_LEVEL = 0.0015
export const OPTIMAKINA_BONUS = 0.1
export const TAKEZA_BONUS = 0.2

/** Génétons gagnés par parent selon sa génération (si le bébé dépasse toute la généalogie). */
export const GENETONS_BY_PARENT_GENERATION: Record<number, number> = {
  1: 1,
  2: 2,
  3: 4,
  4: 8,
  5: 15,
  6: 30,
  7: 60,
  8: 120,
  9: 250,
}

/** XP de métier : 30 par génération par parent lors d'un accouplement ; 30 par capture. */
export const JOB_XP_PER_GENERATION_PER_PARENT = 30
export const JOB_XP_PER_CAPTURE = 30

export const MOUNT_MAX_LEVEL = 200
/** XP cumulée nécessaire pour atteindre les niveaux 100 et 200 (guide). */
export const MOUNT_XP_TO_LEVEL_100 = 172_668
export const MOUNT_XP_TO_LEVEL_200 = 867_582
