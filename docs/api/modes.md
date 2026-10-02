# API — Modes de rentabilité (`src/domain/modes.ts`, page `#/modes`)

Un **mode** fixe l'objectif économique d'un profil (`settings.mode`) et oriente le conseiller, l'accueil et
le plan. Spécification : `docs/SPEC-v2.md` §4. Le module **ne simule rien** : il s'appuie sur le moteur de
production (`docs/api/production.md` : `compareModes`, `optimizeMode`, `runProduction`, worker) et en
résume les résultats (`ModeOutcome`, sérialisable, ≈ 5–35 Ko par mode) pour l'affichage, la routine
quotidienne et l'enregistrement par profil. Module pur ; un prix inconnu n'est jamais compté 0.
Tests : `src/domain/modes.test.ts` (21 tests, ≈ 0,3 s : préréglage de Tylezia + lignes réelles du CSV de
Tylezia du 02/10/2026).

| Fichier | Rôle |
|---|---|
| `src/domain/modes.ts` | Définitions, profil → configuration, classement, analyse, routine, mode actif. |
| `src/store/modeResults.ts` | Dernière comparaison du profil ouvert (`elevagesimu:p:<profil>:modes`, préférence de page : suit le profil et sa sauvegarde) : `useModeResults` (`results`, `save(r)` → false si l'écriture échoue, `clear()`), `loadModeResults()`, `compactModeResultsJson(r)` (6 chiffres significatifs), synchronisation entre onglets. Illisible / autre version → ignoré (recalcul proposé). |
| `src/ui/useModes.ts` | `useModeProfile()` (réglages + prix + marché + part du marché du serveur ouvert, mémorisé), `useModeContextKey(profile)`, `useActiveMode(routineProfile?)`. |
| `src/ui/pages/ModesPage.tsx` | Page « Modes de rentabilité » (Économie). |
| `src/store/schema.ts` | Réglage `mode: ProfileMode` (= `ProfitModeId`), `PROFILE_MODES`. |

## Réglage du profil

`settings.mode` : `'auto' | 'rush-corne' | 'rush-ambre' | 'rush-neurone' | 'brisage-pa' | 'brisage-pm' |
'vente-montures' | 'progression'`, défaut **`progression`** (comportement d'avant les modes). Ajouté sans
changement de version des réglages (comme `almanaxGaugeDoubling`) : champ absent (profil migré, ancienne
sauvegarde) → `progression` ; valeur inconnue → `progression` + alerte « réglage invalide corrigé (mode de
rentabilité) ». La liste de `schema.ts` est vérifiée à la compilation contre `ProfitModeId` (production.ts).

## Définitions

| Export | Rôle |
|---|---|
| `ModeId` (= `ProfitModeId`), `MODE_IDS`, `DEFAULT_MODE = 'progression'`, `MODE_HORIZON_DAYS = 60` | Identifiants dans l'ordre d'affichage. |
| `MODES: ModeDef[]`, `modeDef(id)` (inconnu → progression), `isModeId(v)`, `productionModeOf(id)` | `ModeDef` = `ProfitModeDef` (production.ts) + `kind` (`rush` \| `brisage` \| `vente` \| `progression` \| `auto`), `family` (rush, brisage ; null sinon), `resourceItemId`/`resourceName` (Corne 19975, Ambre 17864, Neurone 33515, Ga Pa 1557, Ga Pme 1558), `revenueKind`, `description`, `risks: ModeRisk[]` (`brisage-correctif`, `hdv-mixte`), `icon`. |
| `ModeRisk {code, tone, label, text}` | Badge de risque (`danger` \| `warn` \| `info`). |
| `pluralItemName(name, n)` | « Corne de volkorne » → « Cornes de volkorne » (n ≥ 2). |

## Profil → production

| Export | Rôle |
|---|---|
| `ModeProfile` | `{jobLevel, hoursPerDay, characters (settings.accounts), rules, prices: ProductionPrices ({ctx, saleTax, maxMarketShare, mountPrices, genetonValue}), paddocks?, sessionsPerDay?, horizonDays?, family?, parentTargetLevel?, preferredTier?, useOptimakina?, goalSpeciesId?}`. Construit par `useModeProfile()`. |
| `profilePaddocks(p)` | Enclos (défaut : niveau d'Éleveur). |
| `modeProfileContext(p, {modes?, quick? (vrai), runs?, horizonDays?, seed?})` | `ProfileProductionContext` pour `compareModes` / worker `compare` (`auto` et modes sans production filtrés). |
| `modeConfig(mode, p, {family?, params?})` | `ProductionConfig` d'un mode (null pour `auto`) : famille du mode (vente : `family`, sinon celle du profil) ; progression : monture visée, niveau des parents, palier, Optimakina des réglages ; `params` (stratégie retenue) appliqués. |
| `defaultModeParams(mode)` | Stratégie tant que rien n'est calculé : rushs et vente G6 · parents 40 · Optimakina auto · palier 2 · accoupler avant d'extraire ; brisage niveau 80 · palier 1. |
| `modeContextKey(p, {serverId?})` | Clé des hypothèses (niveau, enclos, temps de jeu, personnages, règles, marché (serveur, date, statistique), taxe, part du marché, généton) : un résultat enregistré avec une autre clé est « à recalculer ». |

## Résultats

| Export | Rôle |
|---|---|
| `ModeDigest`, `digestSummary(summary)` | Ce qu'il faut d'un `ProductionSummary` : configuration, lot, `steady`, montée, capital, `market` (liquidité), `routine`, plan (cibles, chaîne, captures, Optimakina), prix utilisés, manquants, avertissements, hypothèses, `netByDay`, `cumulativeByDay`. |
| `ModeStrategy` (= `RankedStrategy` sans résumé), `ModeOutcome` | `{modeId, family, available, reason?, strategy, alternatives (4), variants (vente : par famille), digest, evaluated, notes}`. |
| `outcomeFromRow(row)`, `outcomesFromComparison(cmp)`, `outcomeFromSummary(mode, summary, label)` | Depuis `compareModes` / une simulation unique (progression). |
| `rankModes(outcomes)` → `{rows: ModeRanking[], bestModeId}` | Disponibles d'abord ; produit chiffré en kamas avant « classé en quantité » ; puis `compareRanked` (coûts chiffrés, bénéfice/jour en régime permanent, montée). `ModeRanking` : `rank`, `net` (Range), `netMean`, `p10`/`p90`, `status`, `comparable`, `scoreBasis`, produit principal (`productName`, `producedPerDay`, `soldPerDay`, `marketPerDay`, `capPerDay`, `shareOfMarket`), `saturated`, `rampUpDays`, `capital`, `breakEvenDay`, `risks`, `best`. |
| `mainMarketCheck(o)`, `outcomeRisks(o)` | Produit principal (ressource, rune, monture la plus vendue) ; risques (mode + `saturation`, `liquidite-inconnue`, `prix-manquants`, `cible-non-atteinte`, `etable`, `genetons`, `montee-longue` > 30 j, `liquidite-limite` > 70 % du plafond). |
| `strategyParamLines(o)`, `strategyWhy(o)` | Paramètres en clair ; pourquoi (écart avec la suivante, palier et sessions, Optimakina, accoupler avant d'extraire, part du marché, montée longue ; produit sans prix → classement par quantité). |
| `revenueCostBreakdown(o)` | Revenus et coûts par jour (catégories non nulles). |
| `mainRevenueCategory(o)`, `modeSensitivity(o, [0.8, 1.2])` | Sensibilité ±20 % du prix du produit (ressource, runes, montures ; progression : le plus gros revenu) à quantités vendues inchangées : `net + (f − 1) × revenu`. |
| `liquidityCheck(o, share)`, `LIQUIDITY_STATUS_LABELS` | Par produit vendu : `ok` (absorbé), `limite` (> 70 % du plafond), `sature`, `inconnu` (pas d'export HDV). |

## Routine quotidienne

`dailyRoutine(mode, outcome, {characters?, freeSlots?, sessionsPerDay?, maxMarketShare?}): ModeRoutine | null`
— régime permanent de la stratégie retenue, **par passage** (ordre règle 13 : accoupler → cloner → sortir →
capturer → mettre en enclos) puis **une fois par jour** :

- accouplements par génération de bébé, croisements les plus fréquents, part avec Optimakina ; « accoupler
  avant d'extraire » (G cible fécondes, sexes opposés) ;
- clonages par génération ; extractions par génération → ressources (« Cornes de volkorne ») ; mises en
  vente par espèce (plafond de volume) ; brisages au niveau visé → runes ;
- captures : couleurs G1 et parts, nombre (places libres du jour au premier passage si `freeSlots`, sinon
  régime permanent), combats (personnages × montures par lancer, filet) ;
- lots : nombre, jauges et paliers, Mangeoire, durée du lot (brisage : Mangeoire seule au palier) ;
- par jour : vendre ≈ N ressources/runes **sans dépasser le plafond** (part du volume quotidien du serveur),
  carburant par jauge (objets par jour et par semaine, **à fabriquer / à acheter à l'HDV** selon le prix
  retenu, coût par jour), Optimakinas (prix par génération), filets, génétons, bénéfice attendu.

`ModeRoutine = {modeId, label, strategyLabel, sessionsPerDay, sessions: RoutineSession[], daily: RoutineItem[],
summary, headline {captures, matings, clones, extracted, resources, broken, sold, net, netMean, status}, notes}` ;
`RoutineItem = {id, kind, text, hint?, perDay?, kamas? {label, value (null = inconnu), complete}, tone?}`.
`mergedSessions(routine)` regroupe les passages identiques (« À chaque passage (matin et soir) »).

## Résultats enregistrés et mode actif

| Export | Rôle |
|---|---|
| `StoredModeResults` `{version: 1, computedAt, contextKey, context, quick, bestModeId, outcomes, notes}`, `storeModeResults(cmp \| outcomes, p, {computedAt, quick, serverId?, extra?})`, `sanitizeStoredModeResults(raw)` | Enregistrement d'une comparaison (≈ 110 Ko pour 7 modes). `bestModeId` exclut la progression (« auto » = mode de rentabilité). |
| `ActiveMode`, `resolveActiveMode(requested, stored, {contextKey?, family?, routine?})` | `requested` (réglage), `id` (`auto` → meilleur calculé, sinon `progression` + `note`), `kind`, `family`, `params: ModeStrategyParams` (`targetGeneration`, `parentLevel`, `brisageLevel`, `tier`, `mateBeforeExtract`, `optimakina`, `targetSpeciesIds`), `strategyLabel`, `source` (`calcul` \| `defaut`), `computedAt`, `stale`, `outcome`, `routine`, `itemId`, `sellCapPerDay`. |
| `activeModeKey(m)` | Clé courte (cache de l'analyse du conseiller). |

## Page « Modes de rentabilité » (`#/modes?mode=<id>`)

- En-tête : profil et serveur actifs, date et statistique de l'export HDV (sans export : avertissement,
  pas de plafond de liquidité ; export ancien : `snapshotFreshness`) ; « Calculer / Recalculer ».
- Hypothèses du profil (niveau → enclos, temps de jeu → passages, personnages et filet, part du marché,
  durée, règles) et **précision** (rapide ≈ 5 s : grilles réduites ; fine ≈ 40 s : grilles complètes ;
  préférence `profileKey('modes-ui')`).
- Calcul dans le **Web Worker** du moteur (`compare`, puis `simulate` de la progression du profil) avec
  barre de progression et **Annuler** (`worker.terminate()`) ; repli `compareModesAsync` sur le fil
  principal ; lancé automatiquement à la première visite sans résultat ; résultats enregistrés
  (`useModeResults.save`) ; calcul fait avec d'autres hypothèses → bandeau « Recalculer ».
- Bandeau mode actif / meilleur mode (« Mode automatique »).
- Tableau comparatif : bénéfice net/jour en régime permanent (« ≥ / inconnu » si prix manquants, min–max des
  tirages), production/jour face aux ventes du marché, montée en charge, capital immobilisé, point mort,
  badges de risque ; ligne Progression.
- Détail du mode : indicateurs, courbe du cumul (SVG), stratégie retenue et pourquoi, autres stratégies,
  variantes par famille (vente), **routine quotidienne** (cases du jour `routine:<jour>:mode-…`), revenus et
  coûts, sensibilité ±20 %, liquidité, avertissements, hypothèses et prix utilisés (liens Prix) ; boutons
  **Activer ce mode** (`settings.mode`) et **Estimer un investissement** (`href('investissement', {mode})`).

## Repères (Tylezia 02/10/2026, niveau 120 = 4 enclos, 3 h/jour, 1 personnage, précision rapide)

| Mode | Stratégie retenue | Net/jour | Produit/jour | Montée | Capital |
|---|---|---|---|---|---|
| Vente de montures (Muldos) | G10 · Optimakina auto · palier 2 | ≈ 1,93 M | 1,6 monture vendue (+ 30 Ambres) | 54 j | 7,4 M |
| Rush Ambre | G8 · palier 2 | ≈ 0,88 M | 48 Ambres (2 % du marché) | 20 j | 3,0 M |
| Rush Neurone | G4 · palier 2 | ≈ 0,88 M | 45 Neurones (2 %) | 14 j | 1,0 M |
| Rush Corne | G10 · palier 2 | ≈ 0,79 M | 50 Cornes (1,2 %) | 55 j | 7,4 M |
| Brisage PM | niv. 80 · palier 1 | ≈ 0,52 M | 31 runes Ga Pme | 8 j | 0,2 M |
| Brisage PA | niv. 80 · palier 1 | ≈ 0,39 M | 19 runes Ga Pa | 8 j | 0,2 M |
| Progression (Volkornes, sans objectif) | G10 | ≈ 0,27 M | 18 Cornes (surplus) | 54 j | 3,0 M |

Joueur parfait : compter ×1,5 sur les durées. Vente : prix « HDV mixte » prudent (×0,85), marché de la
monture la plus vendue saturé (38 % de 3,6 ventes/jour) — d'où le badge « Marché saturé ».
