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
npm run lint       # oxlint --react-plugin src (règles React et hooks comprises)
node scripts/build-data.mjs             # régénère src/data/*.json depuis research/
node scripts/import-hdv-csv.mjs <csv> <serveur> <AAAA-MM-JJ>   # préréglage de prix HDV (src/data/market/)
```

## Arborescence

```
src/
  data/            JSON générés + index.ts (accès typé, index de croisements, stats)
    market/        préréglages de prix HDV (instantanés compacts, chargés à la demande)
  domain/          logique pure, testée (aucun import React, aucun accès au store)
  store/           stores zustand persistés (localStorage) : registre des profils « elevagesimu:profiles »,
                   données de profil « elevagesimu:p:<profil>:<base> », de serveur « elevagesimu:s:<serveur>:<base> »
  lib/format.ts    formatage FR (kamas, %, durées, heures)
  ui/
    components.tsx composants génériques (PageHeader, Card, Stat, Badge, Callout, Progress,
                   NumberField, SelectField, Tabs, Empty, GaugeChip)
    ProfileSwitcher.tsx  sélecteur de profil de la barre latérale ; ProfilesSection.tsx (Réglages) ;
                   MarketImport.tsx (Prix › Marché HDV : import CSV, historique)
    species.tsx    GenBadge, SpeciesName, ConfidenceBadge, SpeciesPicker
    router.ts      routage par hash : href(page, params), navigate(), useRoute()
    pages/         une page = un fichier XxxPage.tsx (export default), enregistrée dans registry.tsx
                   (chargée à la demande via React.lazy, sauf l'accueil ; App.tsx l'affiche sous
                   <Suspense> et un filet d'erreur par page) ; pages.smoke.test.tsx (jsdom) vérifie
                   que chaque page s'affiche avec son titre, à vide comme avec une étable remplie
                   ; tests de page ciblés (jsdom) : MountsPage, PaddocksPage, ProfitPage, JobPage
  index.css        système de design (variables, .card, .grid-2/3/4, .table, .badge, .btn, .steps…) ;
                   sous 520 px, tuiles d'indicateurs (.grid-4, .kpis, .hp-kpis) sur deux colonnes
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
| `src/domain/fertility.ts` | Plan de fécondité d'un lot | `planFertility(mounts, {tier, serenityTier?, tierByGauge?, withXp, startMs?, applyAlmanax?, almanaxDoubled?, rules})` → étapes (jauges, durées, fenêtres simulées), consommation, `tiers`, `converges`, `notes` ; `decideGauges`, `almanaxScheduleFrom` (jour de jeu) |
| `src/domain/projection.ts` | Projection « maintenant » d'un enclos | `projectPaddock`, `projectGaugeLevels`, `projectMountsFromPlan`, `planActiveHistory` (même calcul pour l'Enclos et l'Accueil) — docs/api/projection.md |
| `src/domain/paddockPlanStatus.ts` | État d'un plan démarré | `planStatus` (en cours / dû / en retard / dépassé / terminé), `planYield`, `projectedMountPatches`, `remainingPlanConsumption`, `pointsValue` |
| `src/domain/xp.ts` | XP | `mountXpForLevel`, `mountLevelFromXp`, `mountXpBetween`, `jobXpForLevel`, `jobLevelFromXp`, `jobXpBetween`, `craftXp(L, J, ratio)` |
| `src/domain/market.ts` | Prix du marché (export HDV CSV) | `parseHdvCsv`, `buildSnapshot`, `relevantItemIds`, `priceFromRow(row, stat)` (`auto` = médiane 24 h si ≥ 5 ventes, sinon 30 j), `marketDepth` / `sellablePerDay` (liquidité), `genetonValueFromMarket`, `marketMountReference` (« HDV mixte »), `diffPrices`, `keyPrices` — docs/api/market.md |
| `src/domain/pricing.ts` | Prix | `marketPrice`, `craftCost`, `resolvePrice(id, ctx)` (joueur > **marché importé** (`ctx.market`, origine `marche`) > défaut > coût des ingrédients ; avec `ctx.jobLevel`, recette hors de portée → prix HDV d'abord, sinon craft signalé `craftLocked` ; `conflict` si un prix par défaut contredit vos ingrédients ; `complete=false` si un ingrédient manque), `netSale` |
| `src/domain/almanax.ts` | Almanax (jour de jeu, heure de Paris) | `serverDay(ms)`, `almanaxAt(ms)`, `almanaxOn(isoDate)`, `upcomingAlmanax(now, days)`, `serverDayStart`, `nextServerDayStart` ; `isoDay(ms)` = jour local (affichage seulement) ; hook `useServerDay()` (src/ui) |
| `src/domain/mounts.ts` | Montures | `effectiveFertility`, `matingBlockers`, `cloningBlockers`, `toBreedingParent`, `capturedMount`, `babyMount`, `mountName`, libellés |
| `src/store/profiles.ts`, `profileRegistry.ts` | Profils et serveurs | `STORE_KEYS` (clés du profil ouvert), `profileKey(base)` (préférences de page), `ACTIVE_PROFILE_ID`, `ACTIVE_SERVER_ID`, `useProfiles` (créer, dupliquer, renommer, supprimer, changer de serveur, ouvrir), `useActiveProfile()`, `useActiveServer()` ; migration des données d'avant les profils — docs/api/profiles.md |
| `src/store/market.ts` | Marché importé (par serveur) | `useMarket`, `useMarketHistory`, `applyMarketSnapshot(serverId, snap)`, `MARKET_PRESETS` (Tylezia 02/10/2026), `useMarketSource()`, `useMarketGeneton(tax)` — docs/api/market.md |
| `src/lib/backup.ts` | Sauvegarde | tout ou un profil (`exportAll`, `exportProfile`, `importAll`, `downloadProfileBackup`) — docs/api/backup.md |
| `src/store/settings.ts` | Réglages (du profil ouvert) | `useSettings` (ruleset, jobLevel, jobLevelUpdatedAt, family, goalSpeciesId, preferredTier, xpFiller, parentTargetLevel, useOptimakina, saleTax, useDefaultPrices, accounts, hoursPerDay, checkIntervalMinutes, almanaxGaugeDoubling…), `useRules()` |
| `src/store/schema.ts`, `persistence.ts`, `sync.ts` | Persistance sûre | `STORE_BASES` (versions, portée profil/serveur), `persistedStoreInfo(key)`, clés (`profileStoreKey`, `serverStoreKey`, `parseStoreKey`), sanitizers, `persistOptions` (migration, normalisation, écriture sans exception, alertes), `syncAcrossTabs`, `freezeWrites`, `safeWriteText` — docs/api/infra.md |
| `src/store/inventory.ts` | Montures possédées | `useInventory` (`mounts`, `add`, `addMany`, `update`, `updateMany`, `patchMany`, `remove`, `removeMany`, `replaceAll`), `newId` |
| `src/store/paddocks.ts` | Enclos | `usePaddocks` (niveaux de jauges saisis, jauges actives) |
| `src/store/prices.ts` | Prix saisis (du serveur ouvert, partagés par ses profils) | `usePrices` (items, mounts `${speciesId}|${band}`, generations `${family}|${gen}|${band}`, genetonValue), `usePriceContext()` (niveau d'Éleveur et **marché importé du serveur** inclus) |
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
  Une origine `marche` s'affiche « marché (JJ/MM) » avec le volume (`ResolvedPrice.market.sold24`).
- Données par profil : tout store persisté utilise `STORE_KEYS` (src/store/profiles.ts) et toute préférence
  de page `profileKey(base)` — jamais une clé « elevagesimu:xxx » écrite en dur.
- Chaque module de domaine nouveau documente son API dans `docs/api/<module>.md` (court).

## Répartition des modules (propriétaires)

| Tranche | Fichiers (propriété exclusive) |
|---|---|
| Économie | `src/domain/fuel.ts`, `src/domain/economy.ts` (+ tests), `src/ui/pages/ProfitPage.tsx`, `src/ui/pages/PricesPage.tsx` |
| Montures | `src/domain/mountFate.ts` (+ tests), `src/ui/pages/MountsPage.tsx`, `src/ui/MountEditor.tsx` |
| Enclos | `src/domain/paddockAssign.ts`, `src/domain/projection.ts`, `src/domain/paddockPlanStatus.ts` (+ tests), `src/store/paddockPlans.ts`, `src/store/paddocks.ts`, `src/ui/pages/PaddocksPage.tsx`, `src/ui/alarms.tsx` (alarmes globales, montées dans `App.tsx`) |
| Guide & réglages | `src/ui/pages/GuidePage.tsx`, `src/ui/pages/SettingsPage.tsx`, `src/lib/backup.ts` |
| Génétique | `src/domain/breedingPath.ts` (+ tests), `src/ui/pages/GeneticsPage.tsx` |
| Accouplement | `src/domain/pairing.ts` (+ tests), `src/ui/pages/BreedingPage.tsx` |
| Optimiseur | `src/domain/programSim.ts` (+ tests), `src/domain/programSim.worker.ts`, `src/ui/pages/OptimizerPage.tsx` |
| Métier | `src/domain/job.ts` (+ tests), `src/ui/pages/JobPage.tsx` |
| Pilotage | `src/domain/advisor.ts` (+ tests), `src/ui/pages/HomePage.tsx`, `src/ui/pages/PlanPage.tsx`, `src/store/planProgress.ts` |
| Fondation v2 (profils, marché HDV) | `src/store/profiles.ts`, `profileRegistry.ts`, `market.ts`, `schema.ts`, `persistence.ts` (+ tests), `src/domain/market.ts`, `src/domain/pricing.ts` (+ tests), `src/lib/backup.ts`, `src/ui/ProfileSwitcher.tsx`, `src/ui/ProfilesSection.tsx`, `src/ui/MarketImport.tsx`, `scripts/import-hdv-csv.mjs`, `src/data/market/*.json` |

Un fichier partagé (`index.css`, `components.tsx`, `species.tsx`, `data/index.ts`, stores existants)
ne se modifie que par **ajout** compatible (nouvel export, nouvelle classe), jamais en cassant l'existant.
