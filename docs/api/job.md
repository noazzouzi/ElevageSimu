# API — Métier Éleveur (`src/domain/job.ts`)

Logique pure (aucun React, aucun store), testée dans `src/domain/job.test.ts` (28 tests). S'appuie sur
`craftXp`, `jobXpForLevel`, `jobLevelFromXp` (`xp.ts`), `craftCost`, `resolvePrice`, `marketPrice`
(`pricing.ts`), les recettes `FUELS`/`MAKINAS`/`NETS` et `GAME.almanaxCalendar` (`src/data`).
Page associée : `src/ui/pages/JobPage.tsx` (`#/metier`).

```ts
const rules = useRules(); const ctx = usePriceContext(); const level = useSettings((s) => s.jobLevel)
const plan = levelingPlan(level, nextPaddockTarget(level), ctx, { rules, metric: 'kamas' })
```

**Règles communes.** Un prix inconnu n'est jamais 0 : `cost` est le total connu (borne basse) avec
`complete: false` et `missing` (ids à chiffrer, lien `href('prix', { q: itemName(id) })`), ou `null` si
rien n'est chiffré. Le coût d'un craft = ses **ingrédients** (on fabrique l'objet, on ne l'achète pas).
En 3.7, les makinas utilisent leur recette bêta (`beta37Ingredients`) ; carburants et filets sont inchangés.

## Types et constantes

| Élément | Rôle |
|---|---|
| `JobRecipe = FuelRecipe \| MakinaRecipe \| NetRecipe` | Recette du métier. |
| `JobRecipeKind = 'carburant' \| 'makina' \| 'filet'`, `JobOptionKind = JobRecipeKind \| 'capture'` | Types d'options. `JOB_RECIPE_KINDS`, `JOB_KIND_LABELS`. |
| `JobMetric = 'kamas' \| 'ressources'`, `JOB_METRIC_LABELS` | Critère du plan. |
| `CAPTURE_OPTION_ID = -32521`, `UNIVERSAL_NET_ID = 32521` | Option « filet universel + capture » (pas une recette). |
| `EFFICIENT_FACTOR = 2` | Ensemble « efficace » (≤ 2 × meilleur ratio ressources/XP) utilisé par le repli du mode kamas. |
| `GAUGE_PREFERENCE` | Départage des carburants à efficacité égale (Mangeoire d'abord). |
| `CraftOption` | `id, name, kind, level, gauge, tier, xp` (par craft, bonus et capture compris), `craftXp` (craft seul), `ingredients, ingredientCount, cost, costComplete, missing, kamasPerXp` (coût complet seulement), `kamasPerXpMin` (borne basse), `resourcesPerXp, productValue` (prix HDV connu de l'objet produit), `beta37`. |

## Options de craft

| Export | Rôle |
|---|---|
| `craftOptionsAt(jobLevel, ctx, rules, {almanaxXpBonus?, kinds?, fuelGauges?}): CraftOption[]` | Toutes les recettes de niveau ≤ `jobLevel` avec XP > 0 (`craftXp(L, J, ratio)`, ×(1+bonus) arrondi bas), triées par ressources/XP. |
| `sortCraftOptions(options, metric): CraftOption[]` | Tri `kamas` (coûts complets d'abord, kamas/XP croissants) ou `ressources` (ressources/XP, puis coût connu). |
| `captureOption(jobLevel, ctx, rules, {almanaxXpBonus?}): CraftOption \| null` | Craft d'un Filet de capture universel + capture : XP du craft + 30 XP (bonus Almanax sur le craft seul). |
| `bestCraftAt(jobLevel, ctx, rules, metric, opts & {includeCaptures?}): CraftChoice \| null` | Meilleure option : `{option, fallback, toPrice}`. Mode kamas : si aucune recette efficace n'a de coût complet → repli ressources (`fallback: true`) ; `toPrice` = ingrédients des recettes efficaces non chiffrées qui pourraient être moins chères. |
| `recipeIngredients(recipe, rules): {ingredients, beta37}` | Ingrédients selon le ruleset (makinas bêta en 3.7). |
| `recipeCraftCost(recipe, ctx, rules): {cost, complete, missing}` | Coût des ingrédients d'un craft. |

## Plan de montée

| Export | Rôle |
|---|---|
| `levelingPlan(fromLevel, toLevel, ctx, opts: LevelingOptions): LevelingPlan` | Simulation niveau par niveau (la meilleure option du niveau est craftée jusqu'au niveau suivant, report de l'XP en trop). `opts` : `rules, metric, includeCaptures?, almanaxXpBonus?, kinds?, fuelGauges?, startXp?` (XP déjà gagnée dans le niveau), `family?` (jalons d'Optimakina). |
| `LevelingPlan` | `fromLevel, toLevel, metric, xpNeeded, segments: PlanSegment[], totals: LevelingTotals, shopping: ShoppingLine[], milestones: PlanMilestone[], progress: LevelProgress[], fallbackLevels, toPrice, blockedAt` (niveau sans recette possible avec les filtres, sinon null), `reachedLevel`. |
| `PlanSegment` | Même recette sur plusieurs niveaux : `fromLevel, toLevel, recipeId, recipeName, kind, recipeLevel, gauge, ingredients` (par craft), `crafts, captures, xp, xpPerCraftStart, xpPerCraftEnd, resources, cost, complete, fallback, toPrice`. |
| `LevelingTotals` | `crafts, captures, xp, resources, cost, costComplete, productValue` (valeur HDV connue des objets produits), `productsUnpriced`. |
| `ShoppingLine` | Liste de courses agrégée : `id, name, qty, unit, subtotal` (null si sans prix), `origin` (`joueur`/`defaut`/`craft`/`manquant`), `confidence?`, `missing`. Triée : chiffrés d'abord, par sous-total. |
| `LevelProgress` | Cumuls (`crafts, resources, cost, costComplete, xp`) au moment où chaque niveau est atteint. |
| `shoppingListText(lines): string` | « Nom × quantité » par ligne (copier-coller). |

Validé contre la recherche (strategy.md §3.2, crafts.md §6) : 1 → 200 au critère ressources = 398 065 XP
pour 398 000 requis, **6 993 crafts et 23 535 ressources** (26 filets universels puis la dernière taille
de carburant débloquée), cumuls par palier à ± 3 % du tableau `STRATEGY.jobLevelingPlan`.

## Jalons et enclos

| Export | Rôle |
|---|---|
| `jobMilestones({family?}): JobMilestoneDef[]` | Enclos 40/80/120/160/200, carburants 5/55/105/155, filets 100/150/200 (depuis `NETS`) et, avec `family`, l'Optimakina de chaque génération. `{level, kind: 'enclos'\|'carburant'\|'filet'\|'makina', label, detail}`, triés par niveau. |
| `PlanMilestone` | Jalon + `status: 'acquis' \| 'plan' \| 'au-dela'` et cumuls (`crafts, cost, costComplete, resources, xp`) quand il est atteint dans le plan. |
| `nextPaddockTarget(level): number` | Prochain niveau qui débloque un enclos (200 au maximum). |
| `paddocksAt(level): number` | Enclos débloqués à ce niveau (1 à 6). |

## Autres sources d'XP

| Export | Rôle |
|---|---|
| `captureJobXp(count): number` | 30 XP par monture capturée. |
| `matingJobXp(genA, genB, rules, babies = 1): number` | `rules.matingXpPerGeneration × (G_A + G_B) × bébés` (30 en 3.6/3.7, 10 en 3.5). |
| `otherXpSources(xpNeeded, rules, pairs?): XpEquivalent[]` | Nombre de captures et d'accouplements types (G1×G1, G4×G4, G6×G6, G9×G9 par défaut) pour couvrir `xpNeeded` : `{id, label, xpEach, count, note, confidence}`. |

## Almanax et repères

| Export | Rôle |
|---|---|
| `jobAlmanaxDays(todayIso): JobAlmanaxDay[]` | Prochains jours utiles au métier depuis `GAME.almanaxCalendar` (22/10 +50 % XP Éleveurs, 01/05 +50 % tous métiers, 10/05 −15 % d'ingrédients, 10/08 double craft), dates annuelles projetées : `{date, name, effect, use, daysUntil, xpBonus, breederOnly, ingredientSaving, doubleCraftChance}`. |
| `JOB_COST_REPORTS: JobCostReport[]` | Coûts de montée rapportés par la communauté (economy.md §10) : `{range, value, date, source, confidence, note}` — témoignages, à afficher comme tels. |

## Hypothèses (affichées sur la page)

- Le bonus d'XP Almanax s'applique à l'XP de craft, arrondi à l'entier inférieur, pas aux 30 XP de capture (à vérifier en jeu).
- XP du doublon d'un filet multiplicateur : inconnue, non comptée (l'option capture n'utilise que le filet universel).
- Le temps des combats de capture n'est pas compté.
