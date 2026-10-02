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

/** Ruleset (version des règles du jeu). 3.6 = live par défaut ; 3.7 = bêta. */
export type RulesetId = '3.5' | '3.6' | '3.7'

/** Statistique d'une monture : valeur(L) = floor((r1·min(L,100) + r2·max(0,L−100)) / 100). */
export interface SpeciesStat {
  name: string
  effectId: number
  /** Taux par niveau ×100 (entier) jusqu'au niveau 100. */
  r1: number
  /** Taux par niveau ×100 (entier) du niveau 101 au niveau 200. */
  r2: number
}

/** Une « espèce » de monture = une couleur d'une famille (ex. Muldo Doré et Indigo). */
export interface Species {
  /** Identifiant de monture du client Ankama (= id DofusDB /mounts). */
  id: number
  family: FamilyId
  /** Nom exact en jeu (FR). */
  name: string
  /** 1 … 10 (0 = monture spéciale non élevable). */
  generation: number
  colors: string[]
  capturable: boolean
  breedable: boolean
  /** Poids génétique du client (90 monocolores Dragodinde/Muldo, 20 bicolores, 1 Volkornes…). */
  geneticWeight: number
  /** Objet-monture (prix HDV). */
  itemId: number | null
  /** Ressources obtenues à l'extraction (= génération ; G1 = 0). */
  extractionQty: number
  /** Génétons rapportés quand cette monture est parent d'une naissance « record ». */
  genetons: Record<RulesetId, number>
  /** Monstre à capturer (G1 uniquement). */
  captureMonsterId: number | null
  /** Paires de parents (ids, triés) qui donnent cette espèce. */
  crossings: [number, number][]
  stats: SpeciesStat[]
  crossingsConfidence: string
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
  speciesId: number
  gender: Gender
  level: number
  /** Expérience cumulée depuis le niveau 1 (optionnelle, sinon dérivée du niveau). */
  xp?: number
  ability: Ability | null
  fertility: Fertility
  /**
   * Espèces des parents (ids) — c'est l'« arbre » de la monture vu par le jeu (elle-même + ses
   * 2 parents). Vide si capturée. Les grands-parents n'influencent pas les naissances.
   */
  parents: number[]
  /** Espèces des grands-parents (affichage seulement ; facultatif). */
  grandparents?: number[]
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
