# API — Modes de rentabilité (`src/domain/modes.ts`, page `#/modes`)

Un **mode** fixe l'objectif économique d'un profil (`settings.mode`) et oriente le conseiller, l'accueil et
le plan. Spécification : `docs/SPEC-v2.md` §4. Le module **ne simule rien** : il s'appuie sur le moteur de
production (`docs/api/production.md` : `compareModes`, `optimizeMode`, `runProduction`, worker) et en
résume les résultats (`ModeOutcome`, sérialisable, ≈ 5–35 Ko par mode) pour l'affichage, la routine
quotidienne et l'enregistrement par profil. Module pur ; un prix inconnu n'est jamais compté 0.
Tests : `src/domain/modes.test.ts` (32 tests, ≈ 2 s : préréglage de Tylezia + lignes réelles du CSV de
Tylezia du 02/10/2026 ; blocs « ECO-V2 » et « UX2 » des revues économique et « parcours » v2) ;
`src/ui/useModesRun.test.ts` (calcul hors de la page).

| Fichier | Rôle |
|---|---|
| `src/domain/modes.ts` | Définitions, profil → configuration, classement, analyse, routine, mode actif. |
| `src/store/modeResults.ts` | Dernière comparaison du profil ouvert (`elevagesimu:p:<profil>:modes`, préférence de page : suit le profil et sa sauvegarde) : `useModeResults` (`results`, `save(r)` → false si l'écriture échoue, `clear()`), `loadModeResults()`, `compactModeResultsJson(r)` (6 chiffres significatifs), synchronisation entre onglets. Illisible / autre version → ignoré (recalcul proposé). **Plan d'investissement suivi** (revue UX2-04) : `useModePlan` (`plan`, `pin(p)`, `unpin()`), `loadModePlan()`, clé `profileKey('mode-plan')` (choix du joueur : non recalculable, gardé quand le stockage est plein ; sans son résultat si l'écriture complète échoue). |
| `src/ui/useModes.ts` | `useModeProfile()` (réglages + prix + marché + part du marché du serveur ouvert + levier « HDV mixte » + option « sans génétons », mémorisé), `useModeContextKey(profile)`, `useActiveMode(routineProfile?)` (plan suivi compris), préférences de la page (`profileKey('modes-ui')` : `{precision, trustMixed, includeGenetons}`, `useModesUiPrefs`, `saveModesUiPrefs`, `loadModesUiPrefs`). |
| `src/ui/useModesRun.ts` | **Calcul de la comparaison au niveau du module** (revue UX2-18) : `startModesRun(profile, {precision, serverId})` (Web Worker, repli `compareModesAsync`), `cancelModesRun()`, `useModesRun` (`progress`, `error`, `saveFailed`, `finishedAt`), `MODES_RUNS`. Quitter la page Modes n'interrompt plus le calcul : il continue en arrière-plan et ses résultats sont enregistrés (`useModeResults.save`) à la fin ; l'accueil affiche « Comparaison des modes en cours en arrière-plan (N %) ». |
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
| `ModeProfile` | `{jobLevel, hoursPerDay, characters (settings.accounts), rules, prices: ProductionPrices ({ctx, saleTax, maxMarketShare, mountPrices, genetonValue, trustMixedMountPrices}), paddocks?, jobXp?, fixedPaddocks?, sessionsPerDay?, horizonDays?, family?, parentTargetLevel?, preferredTier?, useOptimakina?, goalSpeciesId?}`. Construit par `useModeProfile()`. |
| `profilePaddocks(p)` | Enclos au départ (défaut : niveau d'Éleveur). |
| `modeProfileContext(p, {modes?, quick? (vrai), runs?, horizonDays?, seed?})` | `ProfileProductionContext` pour `compareModes` / worker `compare` (`auto` et modes sans production filtrés) ; **`naturalLeveling`** vrai sauf `fixedPaddocks` : enclos et filets débloqués en route par l'XP d'élevage (comme « Sans investissement » de l'estimateur ; niveau 1 : Rush Corne G2 ≈ 335 K/jour sur 90 jours contre ≈ 349 K pour l'estimateur, au lieu de 125 K avec 1 enclos figé). |
| `modeConfig(mode, p, {family?, params?})` | `ProductionConfig` d'un mode (null pour `auto`) : famille du mode (vente : `family`, sinon celle du profil) ; progression : monture visée, niveau des parents, palier, Optimakina des réglages ; `params` (stratégie retenue) appliqués. |
| `defaultModeParams(mode)` | Stratégie tant que rien n'est calculé : rushs et vente G6 · parents 40 · Optimakina auto · palier 2 · accoupler avant d'extraire ; brisage niveau 80 · palier 1. |
| `modeContextKey(p, {serverId?})`, `MODE_MODEL_VERSION` (2), `modePriceFingerprint(prices)` | Clé des hypothèses (version du modèle, enclos figés ou montée naturelle, prix « HDV mixte » comptés ou non, niveau, enclos, temps de jeu, personnages, règles, marché (serveur, date, statistique), taxe, part du marché, généton, prix de montures du joueur) **et empreinte des prix** (FNV-1a d'un JSON à clés triées : prix saisis des objets `ctx.overrides` — Corne, carburants, makinas… —, prix de montures par couleur et par génération, « prix par défaut » `useDefaults` du contexte et des montures, **instant de l'import du marché** `importedAt` — un export corrigé du même jour —, liquidité inconnue, serveur d'origine de l'export) : un résultat enregistré avec une autre clé est « à recalculer » (Modes, Accueil, Plan : bandeau « autres hypothèses » / « Recalculer »). Revue « marché » MKT-01 : saisir 8 000 K pour la Corne sur la page Prix rend la comparaison enregistrée périmée. Option « sans génétons » : `'sans-genetons'` ajouté en fin de clé seulement dans ce cas (les calculs enregistrés avec génétons ne deviennent pas périmés). |

## Résultats

| Export | Rôle |
|---|---|
| `ModeDigest`, `digestSummary(summary)` | Ce qu'il faut d'un `ProductionSummary` : configuration, lot, `steady` (dont `stable`, `instability`, `netPerDaySe`, `genetonShareOfNet`), montée, capital, `market` (liquidité), `routine`, plan (cibles, chaîne, captures, Optimakina), prix utilisés, manquants, avertissements, hypothèses, `netByDay`, `cumulativeByDay`, **`speculative`**, **`paddockSchedule`**, **`purchases?`** (achats face au volume, `PurchaseCheck[]`), **`firstSaleDay?`** (premier jour de vente ou de brisage), **`config.initialStockCount?`** (montures au départ). Champs « ? » absents des résultats enregistrés avant la revue UX2. |
| `ModeStrategy` (= `RankedStrategy` sans résumé), `ModeOutcome` | `{modeId, family, available, reason?, strategy, alternatives (4), variants (vente : par famille), digest, evaluated, notes}`. |
| `outcomeFromRow(row)`, `outcomesFromComparison(cmp)`, `outcomeFromSummary(mode, summary, label)` | Depuis `compareModes` / une simulation unique (progression). |
| `rankModes(outcomes)` → `{rows: ModeRanking[], bestModeId}` | Classes : disponibles chiffrés en kamas, puis **ventes spéculatives** (« HDV mixte » : **hors classement**, `rank` null, jamais `bestModeId`), puis « classés en quantité », puis indisponibles ; dans une classe, `compareRanked` (coûts chiffrés, bénéfice/jour en régime permanent, montée) avec **égalités statistiques** (|Δ| < 2 × √(seA² + seB²)) départagées par le capital puis la montée (`rankWithTies`). `ModeRanking` : `rank`, `net` (Range), `netMean`, `p10`/`p90`, `status`, `comparable`, `scoreBasis`, produit principal (`productName`, `producedPerDay`, `soldPerDay`, `marketPerDay`, `capPerDay`, `shareOfMarket`), `saturated`, `rampUpDays`, `capital`, `breakEvenDay`, `risks`, **`stable`**, **`speculative`**, **`tieWithBest`**, `runs`, `netSe`, `genetonShareOfNet`, **`genetonsPerDay`** (tableau : « dont génétons X (Y % du net) »), `best`. `isSpeculative(o)`. |
| `mainMarketCheck(o)`, `outcomeRisks(o)` | Produit principal (ressource, rune, monture la plus vendue) ; risques (mode + `saturation`, `liquidite-inconnue`, `prix-manquants`, `cible-non-atteinte`, `etable`, `etable-saturee`, `genetons`, `speculatif` (danger), `volume-achat`, `non-stabilise`, `genetons-part` (> 25 % du net), `montee-longue` > 30 j, `liquidite-limite` > 70 % du plafond). |
| `strategyParamLines(o)`, `strategyWhy(o)`, `genetonWhy(o)` | Paramètres en clair ; pourquoi (écart avec la suivante, palier et sessions, Optimakina, accoupler avant d'extraire, part du marché, montée longue ; produit sans prix → classement par quantité) ; **génétons** (revue UX2-07, dès 10 % du net) : leur valeur par jour et leur part, le bénéfice sans eux, et « Sans les génétons, G4 · … serait retenue (≈ X/jour, montée N j, capital C) » quand le classement des stratégies évaluées sur « bénéfice − génétons » change de vainqueur. |
| `revenueCostBreakdown(o)` | Revenus et coûts par jour (catégories non nulles). |
| `mainRevenueCategory(o)`, `modeSensitivity(o, [0.8, 1.2])` | `SensitivityPoint {id, factor, label, net, netMean, delta}` : ±20 % du prix du produit (ressource, runes, montures ; progression : le plus gros revenu) à quantités vendues inchangées (`net + (f − 1) × revenu`, ids `prix-0.8`, `prix-1.2`), puis **`genetons-50`** (« Génétons ÷ 2 ») et **`sans-genetons`** (tous les modes : −revenu des génétons) et **`prix-montures-50`** (ventes de montures : −50 %). |
| `liquidityCheck(o, share)`, `LIQUIDITY_STATUS_LABELS` | Par produit vendu : `ok` (absorbé), `limite` (> 70 % du plafond), `sature`, `inconnu` (pas d'export HDV) ; quantités sous 10 avec une décimale. |

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
`routineSessionAt(routine, heure)` : passage de l'heure de Paris (2 passages : matin avant midi, soir après) — l'accueil
affiche « Routine du mode — passage du soir (régime permanent) », jamais « matin » le soir (revue UX2-03).

**Montée en charge** (revue UX2-03) : `modeTimeline(outcome, {freeSlots?}): ModeMilestone[]` = jalons datés de la
simulation, dans l'ordre chronologique (`remplir` les places, `premiere-cible` 1re G{T}, `premieres-ventes`, `enclos`
(« 4e enclos (XP d'élevage) ≈ jour 17 », un jalon par enclos débloqué en route : la routine du régime les suppose en
service), `regime`, `point-mort` ; `day` null si non atteint) ; la ligne « Enclos » de `strategyParamLines` dit de même
« 3 × 10 places au départ, puis 4 (jour 17), 5 (jour 39) par l'XP d'élevage » (`digest.paddockSchedule`) ; `timelineBasis(outcome)` : « simulation depuis un élevage vide » ou « depuis N
montures au départ » (plan d'investissement parti de l'étable). Affichés par l'accueil, le Plan (onglet Routines) et la
carte « routine du jour » du conseiller : les quantités de la routine sont celles du régime permanent.

## Résultats enregistrés et mode actif

| Export | Rôle |
|---|---|
| `StoredModeResults` `{version: 1, computedAt, contextKey, context, quick, bestModeId, outcomes, notes}`, `storeModeResults(cmp \| outcomes, p, {computedAt, quick, serverId?, extra?})`, `sanitizeStoredModeResults(raw)` | Enregistrement d'une comparaison (≈ 110 Ko pour 7 modes). `bestModeId` exclut la progression (« auto » = mode de rentabilité). |
| `ActiveMode`, `resolveActiveMode(requested, stored, {contextKey?, family?, routine?, pinned?})` | `requested` (réglage), `id` (`auto` → meilleur calculé, sinon `progression` + `note`), `kind`, `family`, `params: ModeStrategyParams` (`targetGeneration`, `parentLevel`, `brisageLevel`, `tier`, `mateBeforeExtract`, `optimakina`, `targetSpeciesIds`), `strategyLabel`, `source` (`calcul` \| `defaut`), `computedAt`, `stale`, `outcome`, `routine`, `itemId`, `sellCapPerDay`, **`familySwitch`** (`{from, to}` quand le mode travaille une autre famille que `settings.family`, sinon null — revue UX2-01), **`plan`** (plan d'investissement suivi : `{label, pinnedAt, budget, horizonDays}`). Plan suivi (`pinned`, seulement pour son mode demandé explicitement, jamais en « auto ») : ses paramètres, son libellé « … (plan d’investissement suivi) » et sa routine (résultat du plan) remplacent ceux de la comparaison ; périmé si sa `contextKey` diffère. |
| `PinnedModePlan`, `sanitizePinnedModePlan(raw)` | Plan suivi `{version: 1, modeId, family, params, label, source: 'investissement', pinnedAt, budget, horizonDays, outcome (outcomeFromSummary du plan), contextKey}` ; lecture tolérante (mode `auto`/`progression` ou illisible → null ; paramètres invalides ignorés). |
| `familySwitchText(modeLabel, from, to, owned)` | « Le mode automatique (aujourd’hui Rush Muldo (Ambres)) travaille les Muldos : vos 12 Volkornes ne servent plus la stratégie… » — confirmation avant d'activer (Modes, Réglages, « Suivre ce plan ») et bandeaux (Modes, accueil, Plan). |
| `activeModeKey(m)` | Clé courte (cache de l'analyse du conseiller). |

## Page « Modes de rentabilité » (`#/modes?mode=<id>`)

- En-tête : profil et serveur actifs, date et statistique de l'export HDV (sans export : avertissement,
  pas de plafond de liquidité ; export ancien : `snapshotFreshness`) ; « Calculer / Recalculer ».
- Hypothèses du profil (niveau → enclos au départ puis montée naturelle, temps de jeu → passages, personnages et
  filet, part du marché, durée, règles), **précision** (rapide ≈ 8–15 s : grilles réduites, 8 tirages ; fine ≈ 1
  à 2 min : grilles complètes, 12 tirages ; préférence `profileKey('modes-ui')`) et levier **« Compter les prix
  « HDV mixte » des montures dans le classement »** (défaut éteint).
- Calcul dans le **Web Worker** du moteur (`compare`, puis `simulate` de la progression du profil) avec
  barre de progression et **Annuler** (`worker.terminate()`) ; repli `compareModesAsync` sur le fil
  principal ; lancé automatiquement à la première visite sans résultat ; résultats enregistrés
  (`useModeResults.save`) ; calcul fait avec d'autres hypothèses → bandeau « Recalculer ». Le calcul vit dans
  `useModesRun` : quitter la page ne le perd plus (revue UX2-18 ; vérifié dans Chromium : enregistré 6 s après avoir quitté
  la page).
- Bandeau mode actif / meilleur mode (« Mode automatique »). **Activer un mode** (ou le mode automatique) qui travaille une
  autre famille que celle du profil demande une confirmation qui nomme le changement (`familySwitchText`) ; le changement
  reste signalé (bandeau) tant qu'il dure ; activer un mode ici cesse de suivre un plan d'investissement (« Ne plus suivre
  ce plan » sinon).
- Option **« Compter les génétons dans le bénéfice »** (défaut oui ; décochée : classement sans génétons, autre clé).
- Tableau comparatif : bénéfice net/jour en régime permanent (« ≥ / inconnu » si prix manquants, « min–max des
  N tirages », « dont génétons X % du net », « régime sur N j » si réévalué plus longtemps), badges « à égalité »
  et **« spéculatif · hors classement »** (« saisissez le prix d’un bébé niv. 1 fécond »), production/jour face aux
  ventes du marché, montée en charge, capital immobilisé, point mort, badges de risque (dont « Non stabilisé ») ;
  ligne Progression.
- Détail du mode : indicateurs, courbe du cumul (SVG), stratégie retenue et pourquoi, autres stratégies,
  variantes par famille (vente), **routine quotidienne** (cases du jour `routine:<jour>:mode-…`), revenus et
  coûts, sensibilité (±20 %, génétons ÷ 2, sans génétons, prix des montures −50 %), liquidité (ventes) et **achats / jour
  face aux ventes du marché** (carburants, Optimakinas, filets : plafond, part, badge « Achats > volume »), avertissements,
  hypothèses (simulation depuis un élevage vide ; classement sur le régime permanent, l'estimateur sur l'horizon) et prix
  utilisés (liens Prix) ; encadrés « Spéculatif (HDV mixte) » et « Régime non stabilisé » (raisons) ; boutons
  **Activer ce mode** (`settings.mode`) et **Estimer un investissement** (`href('investissement', {mode})`).

## Repères (Tylezia 02/10/2026, niveau 120 = 4 enclos au départ + montée naturelle, 3 h/jour, 1 personnage, précision rapide)

| Mode | Stratégie retenue | Net/jour | Produit/jour | Montée | Capital |
|---|---|---|---|---|---|
| Rush Ambre | G8 · palier 2 (régime sur 117 j, non stabilisé : étable saturée) | ≈ 1,77 M | 89 Ambres (3,7 % du marché) | — | 3,4 M |
| Rush Neurone | G4 · palier 2 (régime sur 114 j) | ≈ 1,09 M | 57 Neurones (2,5 %) | 53 j | 1,1 M |
| Rush Corne | G6 · palier 2 (régime sur 108 j) | ≈ 1,06 M | 71 Cornes (1,7 %) | 74 j | 2,5 M |
| Brisage PM | niv. 80 · palier 1 | ≈ 0,52 M | 25 montures brisées | 8 j | 0,2 M |
| Brisage PA | niv. 80 · palier 1 | ≈ 0,39 M | 25 montures brisées | 8 j | 0,2 M |
| Vente de montures (Muldos) — **spéculatif, hors classement** | G10 · palier 2 (régime sur 138 j) | ≈ 1,98 M | 0,84 monture vendue (+ 57 Ambres) | — | 4,5 M |

Mode automatique : Rush Ambre (graines 1 à 4). Avant la revue v2, la vente de montures (≈ 1,93 M, prix « HDV
mixte » des objets-montures) était désignée « auto » et la Rush Corne retenait une G10 (≈ 0,79 M) sur une fenêtre de
60 jours qui n'était que sa montée en charge. Joueur parfait : compter ×1,5 sur les durées.
