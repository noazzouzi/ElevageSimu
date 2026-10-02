# API — tranche « Génétique » (`src/domain/breedingPath.ts`)

Chemins d'élevage : quelles captures et quels croisements mènent à une espèce, et combien d'efforts
(accouplements, captures, fécondations, clonages, génétons) il faut **en moyenne**. Module pur (aucun
React, aucun store), testé dans `src/domain/breedingPath.test.ts` (23 tests). Il s'appuie sur
`breed()` de `genetics.ts` (modèle de naissance validé en jeu) et sur `src/data` (croisements du client).

Page associée : `src/ui/pages/GeneticsPage.tsx` (`#/genetique`, paramètres `?id=<espèce>` ou
`?famille=dragodinde|muldo|volkorne`).

## Ascendance

| Signature | Rôle |
|---|---|
| `ancestorsOf(speciesId: number): number[]` | Toutes les espèces présentes dans au moins un chemin de croisement vers `speciesId` (toutes recettes confondues), triées par génération puis par nom. Sans l'espèce elle-même ; `[]` pour une G1. |
| `descendantsOf(speciesId: number): number[]` | Toutes les espèces que l'on peut obtenir, directement ou non, à partir de `speciesId` (index inverse mémorisé). |

## Recette idéale (captures minimales)

« Idéal » = chaque accouplement donne le bébé voulu, sans clonage, sans Reproducteur, sexes ignorés.
C'est le calcul « captures minimales » de `research/tree-*.md`.

| Signature | Rôle |
|---|---|
| `interface RecipeNode { speciesId; generation; crossing: [number, number] \| null; parents: [RecipeNode, RecipeNode] \| null; captures: number }` | Nœud d'arbre : `crossing`/`parents` = `null` pour une G1 capturée ; `captures` = G1 du sous-arbre. |
| `minCaptures(speciesId): number` | Nombre minimal de G1 à capturer (mémorisé). `Infinity` pour les spéciales G0. |
| `crossingOptions(speciesId): CrossingOption[]` | Chaque croisement de l'espèce avec `captures`, `matings` (= captures − 1), `maxParentGeneration`, `cheapest`, trié du moins cher au plus cher. |
| `cheapestRecipe(speciesId): RecipeNode \| null` | Arbre de la recette la moins chère en captures (égalités : génération du parent le plus haut, puis identifiants). `null` si non élevable. |
| `recipeFor(speciesId, crossing): RecipeNode` | Même chose en imposant le croisement du haut (lève une erreur si le croisement ne donne pas l'espèce). |
| `capturesByColor(tree): Map<number, number>` | G1 à capturer par couleur (id d'espèce G1 → nombre). |
| `matingsCount(tree): number` | Accouplements de la recette idéale (nœuds internes). |
| `requiredSpecies(tree): RequiredSpecies[]` | Espèces de la recette `{ speciesId, generation, count, crossing }`, de la cible vers les captures. |

Validation (tests) : Volkornes 4 (G3) / 13 (Prune, Émeraude) / 31 (Doré) / 58 (gemmes G9), et 79 pour
la recette « Doré et X × Doré et Prune » ; Muldos 4/4/10/10/22/25/49/52/52/55, G10 de 50 (Corail et
Doré) à 107 (Ambre et Azur) ; Dragodindes 4/10/34/112, G10 de 113 à 224 (Prune et Émeraude). Tous
identiques aux tableaux de `research/tree-volkorne.md` §3, `tree-muldo.md` §6 et `tree-dragodinde.md` §3.

## Chance d'un croisement

| Signature | Rôle |
|---|---|
| `cleanParent(speciesId, level): BreedingParent` | Monture « propre » : ses parents sont ceux de sa recette la moins chère (aucun pour une G1). |
| `crossingChance(childId, crossing, { parentLevel, makina: 'none' \| 'optimakina', rules?, takeza? }): CrossingChance` | `breed()` sur deux parents propres : `chance` (P du bébé visé), `targetChance` (B), `sharedWith` (autres issues de la génération cible), `genetonsIfRecord`, `jobXp`. |

## Effort attendu

| Signature | Rôle |
|---|---|
| `expectedEffort(speciesId, opts: EffortOptions): EffortEstimate` | Effort moyen pour **1** exemplaire en suivant la recette (`opts.recipe` ou `cheapestRecipe`). |
| `parentConsumption(cloning): number` | Part de chaque parent consommée par accouplement : 1 sans clonage, ½ avec. |
| `parentsNeeded(attempts, cloning): number` | Exemplaires d'un parent pour `attempts` accouplements : `f × attempts + (1 − f)` (le dernier clone d'une couleur ne resert pas), 0 si aucun accouplement. |

`EffortOptions` : `parentLevel` (tous les parents, captures comprises), `makina: 'none' | 'optimakina'`,
`optimakinaFromGeneration?` (défaut 2 = partout ; 6 = « dès la G6 »), `rules?` (défaut 3.6 ; passer
`useRules()`), `cloning`, `takeza?`, `recycleByproducts?` (défaut `false`, voir plus bas), `recipe?`,
**`owned?: ReadonlyMap<espèce, exemplaires>`** (montures possédées et utilisables, effectifs déjà ajustés
aux sexes et aux porteuses — `ownedRecipeSupply` de `advisor.ts`).

`EffortEstimate` : `captures`, `capturesByColor: Map`, `matings`, `fecundations` (= 2 × accouplements),
`clonings` (= accouplements si clonage), `optimakinas`, `genetons`, `jobXp { matings, captures, total }`
(30 XP par capture), `ideal { captures, matings }`, `nodes: NodeEffort[]` (par espèce, de la cible vers
les captures : `demand`, **`owned`**, `recycled`, `needed`, `chance`, `targetChance`, `sharedWith`, `matings`,
`optimakina`, `genetonsPerMating`, `jobXpPerMating`), `assumptions: string[]` (texte FR à afficher).

### Montures possédées (`owned`)

Une monture possédée couvre d'abord la **demande attendue** de son espèce (`demand`, issue des
accouplements qui l'utilisent), pas tout son sous-arbre avec certitude : un parent du haut d'une G9 à
52 % a une demande de ½ × 1/0,52 + ½ ≈ 1,46 ; un exemplaire possédé en laisse ≈ 0,46 à produire. Quand
il reste une fraction q < 1 à produire, c'est « avec la probabilité q, **un** exemplaire » : l'effort
ajouté est q × l'effort d'un exemplaire depuis sa propre recette (vos autres montures de ce sous-arbre
comprises), et non q exemplaires à chaque étage (le reliquat de clonage de chaque étage serait compté
comme certain). Exemples (niveau 40, Optimakina dès la G6) : Dragodinde Émeraude 406 captures depuis zéro,
≈ 192 avec un couple ♂/♀ Ivoire et Turquoise × Ivoire et Pourpre (un échec à 48 % oblige à refaire une
G8) ; Muldo Corail et Doré 233 → ≈ 92 avec une Doré porteuse de Corail et une Doré. Sans `owned`, les
résultats sont inchangés.

### Méthode (calcul déterministe en espérance)

1. Ordre : génération décroissante (un parent est toujours d'une génération inférieure).
2. Besoin de la cible = 1. Pour chaque espèce croisée : P = probabilité du bébé visé, calculée par
   `breed()` avec des **arbres réalistes** (chaque parent a pour parents ceux de sa recette, une G1 n'en
   a pas), au niveau `parentLevel`, avec l'Optimakina si sa génération ≥ `optimakinaFromGeneration`.
3. Accouplements = besoin / P (espérance d'une loi géométrique : 1/P accouplements par réussite).
4. Besoin d'un parent = `parentsNeeded(Σ accouplements qui l'utilisent, cloning)`. Avec clonage, 2
   stériles redonnent ≈ 1 fertile (½ de chaque parent) ; le reliquat ½ rend compte du premier
   accouplement, qui demande des parents entiers. Vérifié : à P = 1 sans clonage on retrouve
   exactement la recette idéale ; avec clonage, un parent partagé coûte ½ de moins (Volkorne Roux :
   3,5 captures au lieu de 4, comme l'indique tree-volkorne.md).
5. Captures = besoin restant des G1. Fécondations = 2 × accouplements. Génétons = Σ accouplements ×
   `expectedGenetons` du modèle (naissance « record » uniquement).

Non modélisé : sexes (♂/♀), places d'enclos et délais, Reproducteur, porteurs, achats/ventes (sexes et
porteuses des montures possédées : ajustés en amont par `ownedRecipeSupply`).

`recycleByproducts: true` réutilise les bébés hors cible d'une espèce utile plus bas dans la recette.
**Borne optimiste seulement** : combiné au clonage, chaque accouplement raté rend ≈ 2 parents utiles et
les captures tombent vers 1–15 quelle que soit la cible (G9 comprise), ce qui ignore les sexes, les
délais de fécondation et la dilution des arbres. Ne pas l'utiliser pour planifier.

## Comparaison avec la simulation Monte-Carlo (research/strategy.md §6.2, `pyramid-results*.json`)

Captures / accouplements, 60 places, parents tous au même niveau. « Modèle » = `expectedEffort` (sans
recyclage). Le simulateur produit **un** exemplaire avec sexes, arrondis, places et une politique de
captures « remplir les places libres ».

| Cible | Niv. 40 + clonage : modèle | simulation | Niv. 40 + clonage + Opti partout : modèle | simulation |
|---|---|---|---|---|
| Dragodinde Ébène (G3) | 10 / 10 | 13 / 14 | 7 / 8 | 13 / 13 |
| Dragodinde Pourpre (G5) | 36 / 53 | 38 / 78 | 20 / 31 | 28 / 53 |
| Dragodinde Turquoise (G7) | 162 / 266 | 99 / 278 | 62 / 114 | 66 / 165 |
| Dragodinde Émeraude (G9) | 748 / 1 273 | 188 / 821 | 196 / 388 | 111 / 378 |
| Muldo Prune (G7) | 128 / 202 | 104 / 259 | 55 / 93 | 63 / 135 |
| Volkorne Doré (G7) | 182 / 295 | 101 / 328 | 75 / 132 | 76 / 238 |
| Muldo Corail (G9) | 340 / 566 | 183 / 617 | 103 / 190 | 108 / 267 |
| Volkorne Jade (G9) | 411 / 686 | 198 / 775 | 131 / 245 | 106 / 347 |
| Dragodinde Amande et Émeraude (G10) | 1 028 / 1 754 | 247 / 1 130 | 236 / 470 | 137 / 471 |
| Muldo Corail et Doré (G10) | 458 / 768 | 228 / 818 | 121 / 227 | 119 / 322 |
| Volkorne Jade et Pourpre (G10) | 543 / 913 | 281 / 1 208 | 152 / 289 | 124 / 417 |

Autres politiques (modèle / simulation) : niveau 1 + clonage, Ébène 16/17 vs 20/32, Pourpre 100/136 vs
83/170, Turquoise 828/1 177 vs 184/726, Émeraude 7 068/10 126 vs 638/3 394 ; niveau 100 + Optimakina,
Ébène 5/5 vs 10/9, Émeraude 40/99 vs 64/217, Volkorne Doré 27/53 vs 58/140 ; niveau 1 sans clonage,
Turquoise 32 200/18 974 vs ~17 000/~15 000 (même ordre de grandeur, « la pyramide explose »).
Génétons (niv. 40, sans makina) : Émeraude 3 211 vs 2 991, Corail 1 764 vs 2 081, Jade 1 597 vs 2 021.
`deterministic-tables.json → level_cost_benefit` : +12 % pour un couple niveau 40, soit B = 42 % =
`targetChance(40, 40)`, valeur utilisée par le modèle.

**Écarts documentés**

- **Accouplements** : ×0,55 à ×1,55 de la simulation dans tous les cas à niveau 40 (testé : ×0,5–×2 sans
  makina, ×0,4–×2,5 avec Optimakina partout). Le modèle n'a ni sexes ni arrondis ; la simulation remet
  aussi en jeu les bébés hors cible, ce qui ajoute des accouplements.
- **Captures, longues chaînes à faible chance (niv. 1–40 sans makina, G9–G10)** : le modèle donne ×1,9 à
  ×4,2 (niv. 40) et jusqu'à ×11 (niv. 1) les captures de la simulation, car il ne réutilise pas les bébés
  hors cible (environ 58 % des naissances à 42 %, souvent de la couleur d'un parent). C'est un
  **majorant prudent** des captures ; le minorant est l'option `recycleByproducts` (beaucoup trop
  optimiste pour planifier). Les pages l'affichent comme tel : le Plan et l'accueil retiennent la
  simulation Monte-Carlo (`programSim`, captures par couleur) et ne montrent le modèle analytique qu'en
  « référence (borne haute) » (voir pilotage.md, `withGoalSimulation`).
- **Avec Optimakina partout (niv. 40)** : captures et accouplements à ×0,5–×1,8 de la simulation ; c'est
  la configuration où le modèle colle le mieux.
- **Niveau 100 + Optimakina, petites cibles** : le modèle donne ×0,4–×0,6 de la simulation, qui capture
  pour remplir ses places et subit les sexes ; avec une forte chance, ces effets d'arrondi dominent.
- **Fécondations** : 2 par accouplement dans le modèle, ≈ 2,2 dans la simulation (montures élevées mais
  pas utilisées à la fin).
- Aucun croisement de recette la moins chère n'a de « cible partagée » avec des arbres propres
  (vérifié sur les 306 montures élevables au niveau 40) : P(bébé) = B partout ; `sharedWith` reste
  utile pour les recettes imposées et les arbres réels.
