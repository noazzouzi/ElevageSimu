# ElevageSimu — architecture et contrats

Application web (React 19 + TypeScript strict + Vite + Vitest + zustand), 100 % côté navigateur,
en **français**, pour simuler, planifier et rentabiliser l'élevage de montures de Dofus (système 3.5+,
règles 3.6 « live » par défaut, 3.7 bêta en option).

La **spécification de référence** des règles du jeu est `research/README.md` §2 (constantes finales,
avec confiance et chemin des données). Les détails sont dans `research/*.md` et `research/data/*.json`.
Ne jamais inventer une donnée de jeu : tout vient de `src/data` (généré) ou de la recherche ; une
valeur incertaine est affichée comme telle (badge de confiance, mention « estimation »).

## Commandes

```bash
npm run dev        # serveur de développement
npm run build      # tsc -b + build Vite (doit passer)
npm test           # vitest run
npx vitest run src/domain/xxx.test.ts   # un fichier de test
npm run lint       # oxlint src
node scripts/build-data.mjs             # régénère src/data/*.json depuis research/
```

## Arborescence

```
src/
  data/            JSON générés + index.ts (accès typé, index de croisements, stats)
  domain/          logique pure, testée (aucun import React, aucun accès au store)
  store/           stores zustand persistés (localStorage, clés « elevagesimu:* »)
  lib/format.ts    formatage FR (kamas, %, durées, heures)
  ui/
    components.tsx composants génériques (PageHeader, Card, Stat, Badge, Callout, Progress,
                   NumberField, SelectField, Tabs, Empty, GaugeChip)
    species.tsx    GenBadge, SpeciesName, ConfidenceBadge, SpeciesPicker
    router.ts      routage par hash : href(page, params), navigate(), useRoute()
    pages/         une page = un fichier XxxPage.tsx (export default), enregistrée dans registry.tsx
                   (chargée à la demande via React.lazy, sauf l'accueil ; App.tsx l'affiche sous
                   <Suspense> et un filet d'erreur par page) ; pages.smoke.test.tsx (jsdom) vérifie
                   que chaque page s'affiche avec son titre, à vide comme avec une étable remplie
  index.css        système de design (variables, .card, .grid-2/3/4, .table, .badge, .btn, .steps…)
```

## Briques existantes (à réutiliser, ne pas dupliquer)

| Module | Rôle | API principale |
|---|---|---|
| `src/data/index.ts` | Données | `SPECIES`, `getSpecies(id)`, `speciesOfFamily(f)`, `crossingChild(a,b)`, `childrenOf(id)`, `statValue`, `speciesStatsAt`, `FAMILIES`, `FAMILY_IDS`, `FUELS`, `MAKINAS`, `NETS`, `INGREDIENTS`, `getIngredient`, `getRecipe`, `itemName`, `findMakina`, `GAME` (tables XP, Almanax), `PRICES_DEFAULT`, `defaultItemPrice`, `STRATEGY` (phases, règles, grille de sort, formules, erreurs fréquentes) |
| `src/domain/types.ts` | Types | `Species` (id numérique = id client), `Mount`, `PaddockState`, `GaugeId`, `FuelTier`, `Ability`, `RulesetId`… |
| `src/domain/rules.ts` | Versions du jeu | `RULESETS['3.5'|'3.6'|'3.7']`, `getRuleset(id)` : paliers de jauge, durabilité ×2 (3.7), Optimakina, génétons, XP d'accouplement, Animakina |
| `src/domain/constants.ts` | Constantes communes | sérénité, 20 000, enclos (niveaux de déblocage), libellés de jauges et capacités, Animakina… |
| `src/domain/genetics.ts` | **Modèle de naissance** (validé sur 5 captures en jeu) | `breed(a, b, {makina, takeza, rules})` → distribution, génération cible, B, génétons, XP, makina requise ; `targetChance(lvA, lvB, opts)` ; `naturalDistribution` |
| `src/domain/paddock.ts` | Simulation d'enclos (tick 10 s) | `simulatePaddock`, `gaugeTier`, `gaugeRate`, `gaugeDrainSeconds`, `serenityBand`, `canBenefit`, `isFecund`, `validateActiveGauges` |
| `src/domain/fertility.ts` | Plan de fécondité d'un lot | `planFertility(mounts, {tier, withXp, almanaxDoubled, rules})` → étapes (jauges, durées, fenêtres de changement), consommation ; `decideGauges` |
| `src/domain/xp.ts` | XP | `mountXpForLevel`, `mountLevelFromXp`, `mountXpBetween`, `jobXpForLevel`, `jobLevelFromXp`, `jobXpBetween`, `craftXp(L, J, ratio)` |
| `src/domain/pricing.ts` | Prix | `marketPrice`, `craftCost`, `resolvePrice(id, ctx)` (joueur > défaut > coût des ingrédients ; `complete=false` si un ingrédient manque), `netSale` |
| `src/domain/almanax.ts` | Almanax | `almanaxOn(isoDate)`, `upcomingAlmanax(now, days)`, `isoDay(ms)` |
| `src/domain/mounts.ts` | Montures | `effectiveFertility`, `matingBlockers`, `cloningBlockers`, `toBreedingParent`, `capturedMount`, `babyMount`, `mountName`, libellés |
| `src/store/settings.ts` | Réglages | `useSettings` (ruleset, jobLevel, family, goalSpeciesId, preferredTier, xpFiller, parentTargetLevel, useOptimakina, saleTax, useDefaultPrices…), `useRules()` |
| `src/store/inventory.ts` | Montures possédées | `useInventory` (`mounts`, `add`, `addMany`, `update`, `remove`, `replaceAll`), `newId` |
| `src/store/paddocks.ts` | Enclos | `usePaddocks` (niveaux de jauges saisis, jauges actives) |
| `src/store/prices.ts` | Prix saisis | `usePrices` (items, mounts `${speciesId}|${band}`, generations `${family}|${gen}|${band}`, genetonValue), `usePriceContext()` |
| `src/store/journal.ts` | Journal | `useJournal().log({kind: 'capture'|'accouplement'|'clonage'|'extraction'|'vente'|'achat'|'craft'|'note', …})` |

## Règles de code

- TypeScript strict, pas de `any`. Logique dans `src/domain/*.ts` (pure, testée) ; les pages ne font
  que composer. Tests Vitest à côté du module (`xxx.test.ts`).
- Pas de nouvelle dépendance npm. Graphiques : SVG fait main (léger) ou tableaux.
- Interface 100 % française, vocabulaire du jeu (« féconde », « génération cible », « Optimakina »,
  « palier » ou « tier », « génétons », « HDV »). Montants : `formatKamas`. Pourcentages : `formatPercent`.
- Styles : classes de `src/index.css` ; styles propres à une page dans `src/ui/pages/XxxPage.css`
  importé par la page. Pas de couleur codée en dur hors variables CSS.
- Accessibilité : libellés de champs (`label.field`), boutons explicites, contrastes du thème.
- Les règles du jeu viennent du ruleset actif (`useRules()`), jamais de 3.6 codé en dur dans une page.
- Les prix : toujours `usePriceContext()` + `resolvePrice`/`craftCost` ; un coût incomplet est affiché
  avec un avertissement et un lien vers la page Prix (`href('prix', {q: nom})`), jamais compté comme 0.
- Chaque module de domaine nouveau documente son API dans `docs/api/<module>.md` (court).

## Répartition des modules (propriétaires)

| Tranche | Fichiers (propriété exclusive) |
|---|---|
| Économie | `src/domain/fuel.ts`, `src/domain/economy.ts` (+ tests), `src/ui/pages/ProfitPage.tsx`, `src/ui/pages/PricesPage.tsx` |
| Montures | `src/domain/mountFate.ts` (+ tests), `src/ui/pages/MountsPage.tsx`, `src/ui/MountEditor.tsx` |
| Enclos | `src/domain/paddockAssign.ts` (+ tests), `src/store/paddockPlans.ts`, `src/ui/pages/PaddocksPage.tsx` |
| Guide & réglages | `src/ui/pages/GuidePage.tsx`, `src/ui/pages/SettingsPage.tsx`, `src/lib/backup.ts` |
| Génétique | `src/domain/breedingPath.ts` (+ tests), `src/ui/pages/GeneticsPage.tsx` |
| Accouplement | `src/domain/pairing.ts` (+ tests), `src/ui/pages/BreedingPage.tsx` |
| Optimiseur | `src/domain/programSim.ts` (+ tests), `src/domain/programSim.worker.ts`, `src/ui/pages/OptimizerPage.tsx` |
| Métier | `src/domain/job.ts` (+ tests), `src/ui/pages/JobPage.tsx` |
| Pilotage | `src/domain/advisor.ts` (+ tests), `src/ui/pages/HomePage.tsx`, `src/ui/pages/PlanPage.tsx`, `src/store/planProgress.ts` |

Un fichier partagé (`index.css`, `components.tsx`, `species.tsx`, `data/index.ts`, stores existants)
ne se modifie que par **ajout** compatible (nouvel export, nouvelle classe), jamais en cassant l'existant.
