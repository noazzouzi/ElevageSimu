# API — tranche « Accouplement » (`src/domain/pairing.ts`)

Analyse d'un couple, classement des couples possibles de l'étable, plan d'appariement (chaque monture
une seule fois), conseil d'Optimakina, enregistrement d'une naissance réelle, suggestions de clonage
et calibration du modèle sur le journal. Module pur (aucun React, aucun store), testé dans
`src/domain/pairing.test.ts` (36 tests). Il s'appuie sur `breed()` (`genetics.ts`, modèle validé en
jeu), `matingEconomics()` (`economy.ts`), `cheapestRecipe`/`ancestorsOf` (`breedingPath.ts`),
`matingBlockers`/`babyMount` (`mounts.ts`) et `STRATEGY.matingRules` (titres des règles cités dans
les raisons et avertissements).

Page associée : `src/ui/pages/BreedingPage.tsx` (`#/accouplement`). Paramètres de route : `a`, `b`
(ids d'espèce, préremplissent le simulateur avec des arbres standard) et `onglet`
(`simulateur` | `couples` | `historique`).

## Types et constantes

| Élément | Rôle |
|---|---|
| `type PairingObjective = 'progression' \| 'genetons' \| 'profit'` | Objectif du classement. |
| `type MakinaPolicy = 'auto' \| 'jamais' \| 'optimakina'` | Politique d'Optimakina. |
| `OBJECTIVE_LABELS`, `MAKINA_POLICY_LABELS`, `MAKINA_LABELS` | Libellés FR. |
| `theMakina(kind): string` | « l'Optimakina », « l'Animakina », « la Kromakina ». |
| `objectiveFromGoal(goal): PairingObjective` | `useSettings().goal` → objectif (`profit` → `profit`, sinon `progression`). |
| `OPTIMAKINA_SYSTEMATIC_GENERATION = 6`, `RECOMMENDED_LEVEL_SUM = 80`, `CALIBRATION_MIN_BIRTHS = 10` | Seuils de la recherche (M-OPTI-01, M-LEVEL-01) et de la calibration. |

### `PairingOptions`

`rules` (ruleset actif, `useRules()`), `objective`, `makinaPolicy`, `goalSpeciesId?`, `takeza?`,
`mountValue?: (speciesId, level) => number | null` (valeur nette d'une monture fertile, p. ex.
`mountValuation(...).best`), `makinaCost?: (kind, family, generation) => { price, complete } | null`
(p. ex. `economy.makinaCost`), `genetonValue?` (kamas par généton), `coupleCost?: (a, b) => number | null`
(C_eff de la règle de prix), `kappa?`, `targetMode?`, `forcedMakina?` (simulateur : impose la makina,
`null` = aucune), `includeFertile?` (rankPairs : inclut les fertiles, `ready = false`).

> L'option s'appelle `mountValue` et non `valueOf` : `valueOf` existe sur tout objet
> (`Object.prototype`), ce qui la rendrait toujours « définie ».

## Fonctions

| Signature | Rôle |
|---|---|
| `targetBreakdown(levelA, levelB, { makina?, takeza?, rules }, result?): TargetBreakdown` | Décompose B : `base` 30 %, `levels` (0,15 % × `levelSum`), `optimakina`, `takeza`, `raw`, `total` (B appliqué), `capped`, `noAlternative`. |
| `goalContext(goalSpeciesId): GoalContext \| null` | Recette la moins chère et ascendance de l'objectif (mémorisé). |
| `goalRelevance(speciesId, goal): number` | 3 objectif, 2 recette, 1,5 autre ascendance, 0,5 hors objectif, 1 sans objectif (ou autre famille). |
| `adviseOptimakina(base, withOpti, opts, { goalRelevant, coupleCost? }): MakinaAdvice` | Conseil d'Optimakina (voir ci-dessous). |
| `analyzePair(a: BreedingParent, b: BreedingParent, opts, goal?): PairAnalysis` | Analyse d'un couple : `base` (sans makina), `withOptimakina`, `makinaAdvice`, `makina` retenue, `result`, `makinaPrice`, `score`, `progress`, `economics` (`matingEconomics`), `expectedValue?`, `valueComplete`, `goalChance`, `goalRelevant`, `reasons[]`, `warnings[]`. Lève une erreur si l'accouplement est impossible (familles, spéciale). |
| `rankPairs(mounts: Mount[], opts): PairSuggestion[]` | Tous les couples mâle × femelle féconds de même famille (`matingBlockers` vide), analysés, triés par score puis B puis génération. `PairSuggestion = PairAnalysis & { key, a (mâle), b (femelle), ready }`. Ajoute M-STABLE-01 si une monture n'est pas dans l'étable. Analyses mises en cache par (espèce, arbre, niveau, Reproducteur). |
| `bestDisjointPairs(suggestions, { minScore? = 0 }): T[]` | Plan : glouton par score décroissant (chaque monture une seule fois), puis échanges de partenaires entre deux couples tant que la somme des scores augmente. Générique (`{ a: { id }, b: { id }, score }`). |
| `recordMating(a: Mount, b: Mount, babies: BabyChoice[], { rules, makina?, takeza?, kappa?, targetMode? }): MatingRecord` | Prépare l'enregistrement d'une naissance réelle : `babies` (`babyMount`, niveau 1, étable, capacité, sérénité, nom), `parentUpdates` (`fertility: 'sterile'`), `log` (forme de l'événement journal `accouplement` sans `kind`), `genetons` (par bébé « record »), `jobXp` (k × (G_A + G_B) × bébés), `targetBirths`, `errors` (bloquantes) et `warnings` (statut non féconde, nombre de bébés ≠ Reproducteur, issue non prévue par le modèle). Ne modifie rien. |
| `sterileClonePairs(mounts, { involving? }): ClonePair[]` | Paires de stériles clonables (même famille et génération, M-CLONE-01) : même couleur d'abord (`sameSpecies`), puis couleurs différentes ; `involving` = ne garder que les paires contenant ces ids. |
| `matingCalibration(entries: MatingLogLike[]): MatingCalibration` | Journal vs modèle : `births`, `successes` (bébés de la génération cible), `expected` (Σ B par bébé), `sd`, `z`, `verdict` (`insuffisant` < 10 naissances, `conforme` si \|z\| ≤ 2, `au-dessus`, `en-dessous`), `genetons`, `jobXp`, `byGeneration[]`, `byChance[]` (tranches de B). |

## Scores (`PairAnalysis.score`)

- **progression** : `progress` = Σ P(issue absente des deux arbres) × génération × `goalRelevance` × bébés.
  Les copies d'un membre de l'arbre (parents, grands-parents) valent 0 : un couple de même couleur
  ou un arbre « sale » est naturellement déclassé.
- **genetons** : génétons attendus (`result.expectedGenetons`).
- **profit** : `economics.expectedNet` = Σ P × valeur des bébés niv. 1 + génétons × valeur − makina ;
  sans `mountValue` : génétons × valeur − prix de la makina. La perte de valeur des parents (devenus
  stériles) n'entre pas dans le score : elle est la même quel que soit le partenaire.

## Conseil d'Optimakina (`adviseOptimakina`)

- `gain` = B(avec) − B(sans) ; `inutile` si 0 (déjà 100 % ou aucune autre issue).
- `jamais` / `optimakina` : politique imposée (`basis: 'jamais' | 'reglage'`).
- `auto` : valeur d'une réussite V = C_eff / p si `coupleCost` est fourni ; sinon (objectif génétons)
  écart de génétons × valeur ; sinon écart de valeur attendue (bébés + génétons) entre une naissance
  de la génération cible et une autre issue. Seuil = `gain × V` (= C_eff × Δ / p).
  - prix complet : Optimakina si prix < seuil (`regle-prix`) ;
  - prix incomplet : refus si la partie connue dépasse déjà le seuil, sinon heuristique ;
  - prix ou valeurs inconnus, ou objectif progression sans C_eff : heuristique = cible ≥ G6 ou étape de
    l'objectif (« systématique dès la G6 », strategy.md §5.3) (`heuristique`).

## Règles de la recherche reprises en raisons / avertissements

M-CLEAN-01 (arbres propres, naissance record / bonus partagé), M-CARRIER-01 (porteurs → G10),
M-G10OUT-01, M-LEVEL-01 (+x % en montant vers 40), M-MAKGEN-01, M-100PCT, M-ANIMA-36/37, M-KROMA-01,
M-TAKEZA-01, M-GENETON-01 (barème 3.7), M-STABLE-01 (rankPairs). Les avertissements de `breed()`
(Reproducteur, Animakina 3.7) sont repris.
