# API — tranche « Accouplement » (`src/domain/pairing.ts`)

Analyse d'un couple, classement des couples possibles de l'étable, plan d'appariement (chaque monture
une seule fois), conseil d'Optimakina, enregistrement d'une naissance réelle, suggestions de clonage
et calibration du modèle sur le journal. Module pur (aucun React, aucun store), testé dans
`src/domain/pairing.test.ts` (51 tests). Il s'appuie sur `breed()` (`genetics.ts`, modèle validé en
jeu), `matingEconomics()` (`economy.ts`), `cheapestRecipe`/`ancestorsOf` (`breedingPath.ts`),
`matingBlockers`/`babyMount` (`mounts.ts`) et `STRATEGY.matingRules` (titres des règles cités dans
les raisons et avertissements).

Page associée : `src/ui/pages/BreedingPage.tsx` (`#/accouplement`). Paramètres de route : `a`, `b`
(ids d'espèce, préremplissent le simulateur avec des arbres standard) et `onglet`
(`simulateur` | `couples` | `historique`). Le jour de jeu (Takeza, Almanax) suit `useServerDay()` : il
change à minuit (heure du serveur) sans recharger la page ; la case « Jour Takeza » reprend sa valeur
par défaut au changement de jour.

## Types et constantes

| Élément | Rôle |
|---|---|
| `type PairingObjective = 'progression' \| 'genetons' \| 'profit'` | Objectif du classement. |
| `type MakinaPolicy = 'auto' \| 'jamais' \| 'optimakina'` | Politique d'Optimakina. |
| `OBJECTIVE_LABELS`, `MAKINA_POLICY_LABELS`, `MAKINA_LABELS` | Libellés FR. |
| `theMakina(kind): string` | « l'Optimakina », « l'Animakina », « la Kromakina ». |
| `objectiveFromGoal(goal): PairingObjective` | `useSettings().goal` → objectif (`profit` → `profit`, sinon `progression`). |
| `OPTIMAKINA_SYSTEMATIC_GENERATION = 6`, `RECOMMENDED_LEVEL_SUM = 80`, `CALIBRATION_MIN_BIRTHS = 10` | Seuils de la recherche (M-OPTI-01, M-LEVEL-01) et de la calibration. |
| `OPTIMAKINA_GOAL_STEP_GENERATION = 4` | Étapes G4–G5 de l'objectif : Optimakina « à défaut de prix » seulement (phase P2). Ces deux constantes viennent d'`economy.ts` (source unique, réexportées ici) ; l'heuristique est `economy.optimakinaHeuristicUse`, la même que la Rentabilité. |
| `TAKEZA_PRIORITY_GENERATION = 6` | Seuil Takeza commun (« gardez pour ce jour les couples dont la cible est ≥ G6 ») : **à réutiliser par l'Accueil** (`advisor.ts`). |
| `STACK_MIN_ATTEMPTS = 3`, `STACK_MIN_GENERATION = 5` | M-STACK-01 : tentatives minimales, vérifiées sur les couples de l'objectif à partir de la cible G5. |
| `SuccessBasis = 'c-eff' \| 'valeur-bebes' \| 'genetons'`, `SUCCESS_BASIS_LABELS` | Critère de la valeur d'une réussite (formule affichée). |
| `CoupleCostValue = number \| { value, complete } \| null` | C_eff d'un couple ; `complete: false` = borne haute. |

### `PairingOptions`

`rules` (ruleset actif, `useRules()`), `objective`, `makinaPolicy`, `goalSpeciesId?`, `takeza?`,
`mountValue?: (speciesId, level) => number | null` (valeur nette d'une monture fertile, p. ex.
`mountValuation(...).best`), `makinaCost?: (kind, family, generation) => { price, complete } | null`
(p. ex. `economy.makinaCost`), `genetonValue?` (kamas par généton), `coupleCost?: (a, b) => CoupleCostValue`
(C_eff de la règle de prix, en pratique `economyCoupleCost(...).cost`), `kappa?`, `targetMode?`,
`forcedMakina?` (simulateur : impose la makina, `null` = aucune), `includeFertile?` (rankPairs : inclut
les fertiles, `ready = false`).

> L'option s'appelle `mountValue` et non `valueOf` : `valueOf` existe sur tout objet
> (`Object.prototype`), ce qui la rendrait toujours « définie ».

## Fonctions

| Signature | Rôle |
|---|---|
| `targetBreakdown(levelA, levelB, { makina?, takeza?, rules }, result?): TargetBreakdown` | Décompose B : `base` 30 %, `levels` (0,15 % × `levelSum`), `optimakina`, `takeza`, `raw`, `total` (B appliqué), `capped`, `noAlternative`. |
| `goalContext(goalSpeciesId): GoalContext \| null` | Recette la moins chère et ascendance de l'objectif (mémorisé). |
| `goalRelevance(speciesId, goal): number` | 3 objectif, 2 recette, 1,5 autre ascendance, 0,5 hors objectif, 1 sans objectif (ou autre famille). |
| `adviseOptimakina(base, withOpti, opts, { goalRelevant, coupleCost? }): MakinaAdvice` | Conseil d'Optimakina (voir ci-dessous). `MakinaAdvice` : `use`, `basis`, `reason` (commence par « Optimakina … » / « Pas d'Optimakina … »), `gain`, `baseChance` (p), `successValue`, **`successBasis`**, **`coupleCost`**, **`coupleCostComplete`**, `threshold`, **`thresholdIsUpperBound`**, `price`, `priceComplete`, `generation`. |
| `economyCoupleCost(cfg: CoupleCostConfig): CoupleCostModel` | C_eff à partir des prix de l'économie (voir ci-dessous) : `cost(a, b)` (à passer en `coupleCost`), `breakdown(a, b)` (détail par parent : obtention, XP, fécondation, valeur résiduelle, postes manquants), `parent(p)`. Mémorisé. `CoupleCostConfig = { ctx, mountPrices, saleTax, rules, jobLevel, tier, netKind? }`. `ACQUISITION_METHOD_LABELS`. |
| `analyzePair(a: BreedingParent, b: BreedingParent, opts, goal?): PairAnalysis` | Analyse d'un couple : `base` (sans makina), `withOptimakina`, `makinaAdvice`, `makina` retenue, `result`, `makinaPrice`, `score`, `progress`, `economics` (`matingEconomics`), `expectedValue?`, `valueComplete`, `goalChance`, `goalRelevant`, **`consumesGoalParents`** (espèces utiles à l'objectif consommées par un croisement hors objectif), **`opportunityCost`**, `reasons[]`, `warnings[]`. Lève une erreur si l'accouplement est impossible (familles, spéciale). |
| `rankPairs(mounts: Mount[], opts): PairSuggestion[]` | Tous les couples mâle × femelle féconds de même famille (`matingBlockers` vide), analysés, triés par score puis B puis génération. `PairSuggestion = PairAnalysis & { key, a (mâle), b (femelle), ready, waitFor, stackAttempts }`. **`waitFor`** : `{ mountId, partnerId, targetSpecies }[]` — couple hors objectif alors que la partenaire de l'objectif de `mountId` (y compris une G1 capturable : sa fécondation ne se recapture pas) est en préparation (fertile) : « Attendez plutôt que X soit féconde » ; score ramené à 0 (hors plan) en progression, et en génétons/kamas si le couple de l'objectif rapporte au moins autant. **`stackAttempts`** : couples possibles de cette paire d'espèces avec les montures fertiles ou fécondes (couples de l'objectif, cible ≥ G5 ; sinon null), avertissement M-STACK-01 sous 3. Ajoute M-STABLE-01 si une monture n'est pas dans l'étable. Analyses mises en cache par (espèce, arbre, niveau, Reproducteur). |
| `bestDisjointPairs(suggestions, { minScore? = 0 }): T[]` | Plan : glouton par score décroissant (chaque monture une seule fois), puis échanges de partenaires entre deux couples tant que la somme des scores augmente. Générique (`{ a: { id }, b: { id }, score }`). |
| `recordMating(a: Mount, b: Mount, babies: BabyChoice[], { rules, makina?, takeza?, kappa?, targetMode? }): MatingRecord` | Prépare l'enregistrement d'une naissance réelle : `babies` (`babyMount`, niveau 1, étable, capacité, sérénité, nom), `parentUpdates` (`fertility: 'sterile'`), `log` (forme de l'événement journal `accouplement` sans `kind`), `genetons` (par bébé « record »), `jobXp` (k × (G_A + G_B) × bébés), `targetBirths`, `errors` (bloquantes) et `warnings` (statut non féconde, nombre de bébés ≠ Reproducteur, issue non prévue par le modèle). Ne modifie rien. |
| `sterileClonePairs(mounts, { involving? }): ClonePair[]` | Paires de stériles clonables (même famille et génération, M-CLONE-01) : même couleur d'abord, **même sexe et même arbre en priorité** (`pairForCloning` de `mountFate.ts`), puis couleurs différentes ; `involving` = ne garder que les paires contenant ces ids. `ClonePair` : `sameSpecies`, **`sameGender`**, **`sameTree`**, **`certain`** (les trois). |
| `clonePairSummary(p): string` | « même couleur, même sexe, même arbre : résultat certain » / « couleur certaine ; sexe et généalogie : ceux de la monture gardée (50/50) » / couleurs différentes. |
| `matingCalibration(entries: MatingLogLike[]): MatingCalibration` | Journal vs modèle : `births`, `successes` (bébés de la génération cible), `expected` (Σ B par bébé), `sd`, `z`, `verdict` (`insuffisant` < 10 naissances, `conforme` si \|z\| ≤ 2, `au-dessus`, `en-dessous`), `genetons`, `jobXp`, `byGeneration[]`, `byChance[]` (tranches de B). |

## Scores (`PairAnalysis.score`)

- **progression** : `progress` = Σ P(issue absente des deux arbres) × génération × `goalRelevance` × bébés,
  **moins `opportunityCost`** = Σ pertinence × génération des montures utiles à l'objectif (recette,
  autre chemin, ou espèce portée par une porteuse ; une G1 capturable n'en est pas une) consommées par un
  croisement hors objectif (`!goalRelevant && goalChance === 0`) : ces couples tombent à un score ≤ 0 et
  sortent du plan. Les copies d'un membre de l'arbre (parents, grands-parents) valent 0 : un couple de
  même couleur ou un arbre « sale » est naturellement déclassé.
- **genetons** : génétons attendus (`result.expectedGenetons`).
- **profit** : `economics.expectedNet` = Σ P × valeur des bébés niv. 1 + génétons × valeur − makina ;
  sans `mountValue` : génétons × valeur − prix de la makina. La perte de valeur des parents (devenus
  stériles) n'entre pas dans le score : elle est la même quel que soit le partenaire.

## Conseil d'Optimakina (`adviseOptimakina`)

- `gain` = B(avec) − B(sans) ; `inutile` si 0 (déjà 100 % ou aucune autre issue).
- `jamais` / `optimakina` : politique imposée (`basis: 'jamais' | 'reglage'`).
- `auto` — valeur d'une réussite V (`successBasis`) : `'c-eff'` = C_eff / p si `coupleCost` est connu ;
  sinon `'genetons'` (objectif génétons : écart de génétons × valeur) ; sinon `'valeur-bebes'` (écart de
  valeur attendue, bébés + génétons, entre une naissance de la génération cible et une autre issue).
  Seuil = `gain × V` (= C_eff × Δ / p). La raison cite la formule réellement utilisée.
  - **la règle de prix décide dès que le prix (complet) et le seuil sont connus, quel que soit l'objectif**
    (progression comprise) : Optimakina si prix < seuil (`regle-prix`) ;
  - C_eff incomplet (une sortie des stériles non chiffrée) → seuil = borne haute (`thresholdIsUpperBound`) :
    refus certain si prix ≥ seuil, sinon heuristique ;
  - prix incomplet : refus si la partie connue dépasse déjà le seuil, sinon heuristique ;
  - règle indécidable (prix ou valeur inconnus) : heuristique de la recherche (`heuristique`) — cible ≥ G6
    (« systématique dès la G6 ») ; étape **G4–G5** de l'objectif (« à défaut de prix ») ; **jamais** une
    cible G2–G3 sans prix, même sur l'objectif.
- Même règle que `economy.decideOptimakina` (Rentabilité) pour la règle de prix ; l'heuristique de
  `decideOptimakina` retient encore toute étape de l'objectif (G2–G3 comprises) : écart signalé au groupe
  Économie.

## C_eff (`economyCoupleCost`)

Pour chaque parent : **remplacement** = obtention d'une monture fertile niv. 1 (G1 capturable : capture
au filet `netKind`, universel par défaut ; sinon la moins chère entre sa valeur actuelle — prix de décision
`mountValuation` — et sa production estimée par `expectedEffort` sans makina, avec clonage : captures ×
capture + (captures + intermédiaires) × XP + fécondations × fécondation) + XP du niveau 1 au niveau du
parent (Mangeoire, lot de 10, palier `tier`) + fécondation (lot typique de 10) ; **moins la valeur
résiduelle** de la stérile = max(meilleure sortie nette, ½ × (obtention − refécondation)). Un poste de
remplacement inconnu → `null` (jamais compté 0) ; une sortie de stérile non chiffrée → C_eff borne haute
(`complete: false`). Les postes manquants sont listés (`missing`, français) : la page les affiche avec un
lien vers Prix.

Branchement type (page Accouplement ; à reprendre dans `advisor.analyzeState`) :

```ts
const coupleCost = economyCoupleCost({ ctx: { ...usePriceContext(), jobLevel }, mountPrices, saleTax, rules, jobLevel, tier: preferredTier })
rankPairs(mounts, { ...opts, coupleCost: coupleCost.cost })
```

## Règles de la recherche reprises en raisons / avertissements

M-CLEAN-01 (arbres propres, naissance record / bonus partagé), M-CARRIER-01 (porteurs → G10),
M-G10OUT-01, M-LEVEL-01 (+x % en montant vers 40), M-MAKGEN-01, M-100PCT, M-ANIMA-36/37, M-KROMA-01,
M-TAKEZA-01, M-GENETON-01 (barème 3.7), M-STABLE-01 et **M-STACK-01** (rankPairs), « Consomme X, utile à
votre objectif… » et « Attendez plutôt que X soit féconde » (objectif). Les avertissements de `breed()`
(Reproducteur, Animakina 3.7) sont repris.

## Page (`BreedingPage.tsx`)

- Simulateur : conseil d'Optimakina avec le critère et le seuil réellement utilisés (`C_eff × Δ / p` ou
  autre), détail de C_eff par parent (`CoupleCostView`) ; « Comment c'est calculé » formulé du point de
  vue d'un parent (ses parents comptent, pas les leurs) et du bébé (génétons : les 2 parents et leurs 4
  parents).
- Mes couples : C_eff branché sur `rankPairs` ; la raison du conseil d'Optimakina est dans la ligne
  « Makina » de chaque couple ; badge « N tentative(s) possible(s) » (M-STACK-01) ; encart « En attente
  d'une partenaire de l'objectif » (`waitFor`) ; seuil Takeza `TAKEZA_PRIORITY_GENERATION` (et nombre de
  couples du plan concernés) ; clonages : nombre de paires au résultat certain (`clonePairSummary`).
- Prix (revue « marché ») : `MountPriceContext` avec `market: ctx.market` (prix « HDV mixte » des montures =
  plafond de vente, comme Rentabilité) ; généton = `useGenetonValue()` (vôtre > marché du serveur > défaut),
  libellé « 1 généton ≈ 454 K, marché (Puissant Parchemin d'Agilité) » ; prix d'une makina étiqueté par son
  origine (`PriceOriginNote` : « marché (02/10) · ≈ 31 vendus/jour (30 j) », « coût des ingrédients »,
  « prix par défaut (recherche) »). Bandeaux `MarketStatusCallouts` sous le titre.
