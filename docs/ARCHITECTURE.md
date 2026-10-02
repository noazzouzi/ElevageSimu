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
                   MarketImport.tsx (Prix › Marché HDV : import CSV, compléter, annuler l'import, historique) ;
                   MarketStatus.tsx (bandeaux « prix périmés / d'un autre serveur / sans volumes » des pages
                   de conseil, origine d'un prix « marché (02/10) · N vendus/24 h ») ;
                   confirmPending.ts (changer de profil/serveur avec des modifications non enregistrées :
                   sauvegarde proposée puis confirmation)
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

## Vue d'ensemble de la v2 (flux de données)

```
registre « elevagesimu:profiles » ──► profil de l'onglet (sessionStorage) ──► clés p:<profil>:* (réglages, montures,
       │                                                                    enclos, plans, journal, préférences)
       └──► serveur du profil ──► clés s:<serveur>:prices / market / market-history
                                      ▲
export HDV (CSV) ──► parseHdvCsv ──► buildSnapshot (objets utiles, 7 nombres) ──► applyMarketSnapshot (tout ou rien)
                                                                                     │
usePriceContext() = prix saisis > marché importé > défauts > craft  ◄────────────────┘
       │
       ├──► pages de coûts (Prix, Rentabilité, Enclos, Métier, Accouplement, Optimiseur)
       ├──► production.ts (simulation en continu, optimiseur) ──► modes.ts (classement, routine, montée en charge)
       │        └──► résultats enregistrés p:<profil>:modes (recalculables) ──► mode actif : accueil, Plan,
       │             Mes montures (modeAwareFates), conseiller
       └──► investment.ts (allocations, plan daté, point mort, sensibilité) ──► « Suivre ce plan » (plan suivi)
```

- **Profils** : `profiles.ts` résout le profil de l'onglet au chargement (avant les stores) ; changer de profil =
  écrire le registre puis recharger. Les anciennes clés v1 sont reprises dans « Principal » (copie avec empreintes).
- **Marché** : un instantané par serveur ; la statistique (`auto` = médiane 24 h si ≥ 5 ventes, sinon 30 j) et la
  part vendable du volume sont des réglages du serveur ; le préréglage de Tylezia (02/10/2026) est versionné
  (`src/data/market/`, régénéré par `scripts/import-hdv-csv.mjs`).
- **Modes et investissement** : calculs lourds dans des Web Workers (`production.worker.ts`, `investment.worker.ts`),
  repli sur la page sinon ; résultats liés à une clé d'hypothèses (`modeContextKey`) qui les rend « à recalculer ».
- **Sauvegarde** : tout ou un profil (`src/lib/backup.ts`), validation et migration de chaque store
  (`src/store/schema.ts`), écriture tout ou rien.

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
| `src/store/profiles.ts`, `profileRegistry.ts`, `tabProfile.ts` | Profils et serveurs | `STORE_KEYS` (clés du profil ouvert), `profileKey(base)` (préférences de page), `ACTIVE_PROFILE_ID`, `ACTIVE_SERVER_ID` (profil de **cet onglet**, sessionStorage ; le registre ne donne que celui d'un nouvel onglet), `useProfiles` (créer, dupliquer, renommer, supprimer, changer de serveur, ouvrir — refus `pending` si des modifications ne sont pas enregistrées), `useActiveProfile()`, `useActiveServer()` ; migration des données d'avant les profils (empreintes : changements d'un onglet resté sur l'ancienne version), copie de secours et reconstruction du registre — docs/api/profiles.md |
| `src/domain/production.ts` | Production en continu, optimiseur, comparaison des modes | `runProduction`, `optimizeMode`, `compareModes` ; `steady.stable` (régime réellement permanent, sinon avertissement `montee` et réévaluation plus longue), `scoreSe` + `rankWithTies` (égalités statistiques départagées par le capital), `summary.speculative` (vente au prix « HDV mixte » : hors classement), `naturalLeveling`, `jobLevelSchedule`, `bandOf`/`bandLabel` — docs/api/production.md |
| `src/domain/modes.ts`, `src/domain/investment.ts` | Modes de rentabilité, estimateur d'investissement | `rankModes`, `modeSensitivity`, `dailyRoutine`, `routineSessionAt`, `modeTimeline` (montée en charge datée), `genetonWhy`, `resolveActiveMode` (`familySwitch`, plan suivi `PinnedModePlan`), `familySwitchText` — docs/api/modes.md ; `planInvestment` (`pickRecommended`, `worstCase`, bandes min–max sous 10 tirages, `initialStock` / `stockFromInventory`, `roiIsSignificant`) — docs/api/investment.md |
| `src/ui/useModes.ts`, `src/ui/useModesRun.ts`, `src/store/modeResults.ts` | Mode actif et comparaison des modes | `useModeProfile`, `useActiveMode` ; **`startModesRun` / `useModesRun`** (calcul au niveau du module : quitter la page Modes ne l'interrompt pas) ; `useModeResults` (résultats, recalculables) et **`useModePlan`** (plan d'investissement suivi : « Suivre ce plan ») |
| `src/ui/useAdvisorSettings.ts` | Réglages du conseiller mémorisés | mêmes entrées pour l'accueil et Mes montures (`modeAwareFates` : même sort de monture sur les deux pages) |
| `src/store/market.ts` | Marché importé (par serveur) | `useMarket`, `useMarketHistory`, `applyMarketSnapshot(serverId, snap)`, `mergeMarketSnapshot` (compléter), `undoMarketImport` / `useMarketUndo` (annuler le dernier import, sessionStorage de l'onglet), `serverMarketSnapshot`, `MARKET_PRESETS` (Tylezia 02/10/2026), `useMarketSource()` (`originServer` : prix d'un autre serveur), `useMarketGeneton(tax)` — docs/api/market.md |
| `src/lib/backup.ts` | Sauvegarde | tout ou un profil (`exportAll`, `exportProfile`, `importAll`, `downloadProfileBackup`) ; serveur d'une sauvegarde de profil (`planProfileServer`, garder / remplacer / fusionner ses prix) ; écriture tout ou rien ; place occupée en caractères (`storageUsage`, `storageQuotaChars`) et données recalculables — docs/api/backup.md |
| `src/store/settings.ts` | Réglages (du profil ouvert) | `useSettings` (ruleset, jobLevel, jobLevelUpdatedAt, family, goalSpeciesId, preferredTier, xpFiller, parentTargetLevel, useOptimakina, saleTax, useDefaultPrices, accounts, hoursPerDay, checkIntervalMinutes, almanaxGaugeDoubling…), `useRules()` |
| `src/store/schema.ts`, `persistence.ts`, `sync.ts` | Persistance sûre | `STORE_BASES` (versions, portée profil/serveur), `persistedStoreInfo(key)`, clés (`profileStoreKey`, `serverStoreKey`, `parseStoreKey`), sanitizers, `persistOptions` (migration, normalisation, écriture sans exception, alertes), `syncAcrossTabs`, `freezeWrites`, `safeWriteText` — docs/api/infra.md |
| `src/store/inventory.ts` | Montures possédées | `useInventory` (`mounts`, `add`, `addMany`, `update`, `updateMany`, `patchMany`, `remove`, `removeMany`, `replaceAll`), `newId` |
| `src/store/paddocks.ts` | Enclos | `usePaddocks` (niveaux de jauges saisis, jauges actives) |
| `src/store/prices.ts` | Prix saisis (du serveur ouvert, partagés par ses profils) | `usePrices` (items, mounts `${speciesId}|${band}`, generations `${family}|${gen}|${band}`, genetonValue), `usePriceContext()` (niveau d'Éleveur et **marché importé du serveur** inclus), `useGenetonValue()` (valeur du généton du profil — vôtre > marché > défaut —, `value` brute et `net`, la même sur toutes les pages), `genetonOriginLabel(g)` |
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
  Une origine `marche` s'affiche « marché (JJ/MM) » avec le volume (`ResolvedPrice.market.sold24`) :
  `priceOriginText` / `<PriceOriginNote>` (src/ui/MarketStatus.tsx). Une page qui conseille avec les prix du
  marché affiche `<MarketStatusCallouts />` sous son titre (export périmé, prix d'un autre serveur, volumes
  absents) ; une page de coûts qui n'affiche pas l'origine de chaque prix (Métier, Enclos, Accouplement,
  Optimiseur) passe `showSource` (« Prix : HDV de Tylezia du 02/10/2026… », ou « aucun export HDV importé »). Généton : `useGenetonValue()` (jamais `genetonKamasValue(override)` sans le marché) ; montants
  affichés nets de taxe. `MountPriceContext` : toujours avec `market: ctx.market`.
- Marché importé : une liquidité inconnue (objet absent, export sans colonnes de ventes) vaut `null`
  (`marketDepth`), jamais « 0 vente » ; deux serveurs se comparent avec une seule statistique ; un import se
  compare à statistique égale ; un import partiel se confirme, se « complète » et s'annule ; une saisie de
  prix (ou un nouvel import du même jour) rend les résultats des modes « à recalculer » (`modeContextKey`).
- Données par profil : tout store persisté utilise `STORE_KEYS` (src/store/profiles.ts) et toute préférence
  de page `profileKey(base)` — jamais une clé « elevagesimu:xxx » écrite en dur. Une donnée qui se recalcule
  (résultats de simulation) est déclarée dans `REGENERABLE_BASES` (src/lib/backup.ts) pour être supprimable
  quand le stockage est plein.
- Intégrité des données : une écriture refusée n'est jamais présentée comme un succès (import du marché,
  import d'une sauvegarde : tout ou rien) ; une action qui recharge l'application refuse de perdre des
  modifications non enregistrées sans confirmation (`code: 'pending'`) ; les tailles s'affichent en
  caractères (l'unité du quota du localStorage).
- Résultats de simulation (Monte-Carlo) : jamais de classement sur le bruit des tirages (raffinement sur des
  graines indépendantes du tri, égalités statistiques `statisticalTie` / `profitTie` ; une sensibilité qui décale
  la chronologie — durées, crafts — signale un écart dans le bruit, `withinNoise`) ; une bande « 8 tirages sur
  10 » n'existe qu'à partir de 10 tirages, sinon « min–max des N tirages » (`bandOf`, `bandLabel`) ; une montée en
  charge n'est pas un régime permanent (`steady.stable`).
- Prix d'objets-montures du marché (« HDV mixte ») : indication et plafond seulement — une vente qui en dépend
  est « spéculative », affichée à part et jamais choisie automatiquement (mode « auto », estimateur) tant que le
  joueur n'a pas saisi son prix ; le plafond prudent (`conservativeMountMarketPrice`) ne dépasse jamais les dernières
  ventes (min des médianes 30 j / 24 h et de la moyenne 30 j). Génétons : échanges reconfirmés seulement (Puissants
  Parchemins), part du bénéfice net toujours affichée (montant et %), stratégie « sans génétons » signalée si elle change.
- Achats au marché : jamais plus que la part du volume (`maxMarketShare`) sans le dire — carburant remplacé, Optimakinas
  au-delà comptées au prix haut, contrôle « Achats / jour face aux ventes du marché ».
- Routine d'un mode : les quantités « par jour » sont celles du **régime permanent** — elles ne sont jamais présentées
  comme la liste d'aujourd'hui (l'accueil donne les gestes du jour d'après l'étable, et la montée en charge datée,
  enclos débloqués en route compris : `modeTimeline` jalons `enclos`, ligne « Enclos » de la stratégie).
- Un mode actif (rush, brisage, vente) remplace l'objectif de génération partout où l'on conseille : sort des
  montures (Mes montures et accueil, même `modeAwareFates`), bandeaux (Plan, Mes montures) ; l'objectif des réglages
  ne sert qu'en Progression.
- Un mode (ou un plan suivi) qui travaille une autre famille que celle du profil se confirme à l'activation et reste
  signalé (`familySwitch`).
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
