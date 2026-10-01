// Types du domaine de l'élevage (système Dofus 3.5+).

export type FamilyId = 'dragodinde' | 'muldo' | 'volkorne'

export type Gender = 'male' | 'femelle'

/** Capacités spéciales (obtenues uniquement via Animakina / Kromakina). */
export type Ability = 'amoureuse' | 'endurante' | 'precoce' | 'sage' | 'reproducteur' | 'cameleone'

/** Statut de reproduction d'une monture. */
export type Fertility = 'fertile' | 'feconde' | 'sterile' | 'senile'

/** Jauges d'enclos. Baffeur et Caresseur sont mutuellement exclusifs. */
export type GaugeId = 'baffeur' | 'caresseur' | 'foudroyeur' | 'abreuvoir' | 'dragofesse' | 'mangeoire'

/** Tiers de carburant : 1 = Extrait, 2 = Philtre, 3 = Potion, 4 = Élixir. */
export type FuelTier = 1 | 2 | 3 | 4

export type FuelSize = 'minuscule' | 'petit' | 'normal' | 'grand' | 'gigantesque'

export type MakinaKind = 'animakina' | 'kromakina' | 'optimakina'

/** Une « espèce » de monture = une couleur d'une famille (ex. Muldo Doré et Indigo). */
export interface Species {
  /** Identifiant stable, ex. "muldo:dore-et-indigo". */
  id: string
  family: FamilyId
  /** Nom exact en jeu (FR). */
  name: string
  generation: number
  colors: string[]
  capturable: boolean
  /** Couples de parents (ids d'espèces) permettant d'obtenir cette espèce comme nouvelle génération. */
  crossings: [string, string][]
  dofusdbId: number | null
  /** Bonus de la monture par niveau de référence (clés : "1", "100", "200"). */
  statsByLevel: Record<string, Record<string, number>> | null
}

/** Jauges internes d'une monture. */
export interface MountGauges {
  /** -5 000 … 5 000 */
  serenity: number
  /** 0 … 20 000 */
  endurance: number
  /** 0 … 20 000 */
  maturity: number
  /** 0 … 20 000 */
  love: number
}

export type MountLocation =
  | { kind: 'etable' }
  | { kind: 'inventaire' }
  | { kind: 'enclos'; paddock: number }

/** Une monture possédée par le joueur. */
export interface Mount extends MountGauges {
  id: string
  speciesId: string
  gender: Gender
  level: number
  /** Expérience cumulée depuis le niveau 1 (optionnelle, sinon dérivée du niveau). */
  xp?: number
  ability: Ability | null
  fertility: Fertility
  /** Espèces des parents (null si capturée). */
  parents: [string, string] | null
  /** Espèces des grands-parents (jusqu'à 4, dans l'ordre parent1.p1, parent1.p2, parent2.p1, parent2.p2). */
  grandparents: string[]
  location: MountLocation
  name?: string
  notes?: string
  createdAt: number
  updatedAt: number
}

/** État d'un enclos (10 places). */
export interface PaddockState {
  /** 1 … 6 */
  id: number
  gauges: Record<GaugeId, number>
  /** Au plus 2 jauges actives, jamais Baffeur + Caresseur. */
  active: GaugeId[]
  /** Horodatage (ms) de la dernière saisie des niveaux de jauges. */
  updatedAt: number
}
