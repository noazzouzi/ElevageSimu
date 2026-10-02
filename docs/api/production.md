# API — Moteur de production (`src/domain/production.ts`, `src/domain/production.worker.ts`)

Simulation **en continu** (session par session, sur N jours) d'un élevage qui produit pour un mode de
rentabilité (extraction, brisage, vente, progression), valorisée aux **prix du marché du serveur** (export
HDV importé) dans la limite de sa **liquidité**, optimiseur de stratégie par mode et comparaison des modes
(page « Modes de rentabilité », estimateur d'investissement). Spécification : `docs/SPEC-v2.md` §4.
Module pur (aucun React, aucun store, aucun `Math.random` : mulberry32 à graine, comme `programSim`).
Tests : `src/domain/production.test.ts` (31 tests, ≈ 1 s ; préréglage de Tylezia et extrait du CSV réel).

S'appuie sur `breed` (genetics), `cheapestRecipe`/`requiredSpecies`/`cleanParent` (breedingPath),
`batchProfile('typique')`, `gaugePointCost`, `captureCost`, `makinaCost`, `brisageValue`, `mountSalePrice`,
`decideOptimakina`, `socleInvestment`, `xpOverlapPoints`, `genetonKamasValue` (economy), `bestFuel` (fuel),
`marketPrice` (pricing), `marketDepth`/`genetonValueFromMarket`/`MOUNT_MARKET_NOTE` (market),
`mulberry32`/`runSeed`/`distStat` (programSim), `mountXpForLevel` (xp).

## Utilisation type

```ts
const ctx = usePriceContext()                          // prix saisis + marché importé du serveur + niveau d'Éleveur
const server = useActiveServer()
const base: ProductionConfig = {
  family: 'volkorne', mode: 'extraction', targetGeneration: 'auto',
  paddocks: unlockedPaddockCount(settings.jobLevel), hoursPerDay: settings.hoursPerDay,
  characters: settings.accounts, jobLevel: settings.jobLevel, rules: useRules(),
  prices: { ctx, saleTax: settings.saleTax, maxMarketShare: server.maxMarketShare, mountPrices },
  horizonDays: 60,
}
const summary = runProduction(base, { runs: 4 })       // ProductionSummary (sérialisable)
const best = optimizeMode('extraction', base)          // stratégies classées (grille complète ≈ 4–5 s : Web Worker)
const modes = compareModes({ rules, prices: base.prices, jobLevel, hoursPerDay, characters })   // ≈ 3–6 s
```

Dans une page : `new Worker(new URL('../../domain/production.worker.ts', import.meta.url), { type: 'module' })`
(voir plus bas) ; sans Worker : `runProductionAsync`, `optimizeModeAsync`, `compareModesAsync` (rendent la main
toutes les ~40 ms, `shouldStop`).

## Modes de rentabilité

| Export | Rôle |
|---|---|
| `ProductionMode = 'extraction' \| 'brisage' \| 'vente' \| 'progression'`, `PRODUCTION_MODE_LABELS` | Sortie des montures produites. |
| `ProfitModeId`, `PROFIT_MODES: ProfitModeDef[]`, `profitMode(id)`, `COMPARED_MODES` | Modes de la spécification : `rush-corne` (extraction Volkorne), `rush-ambre` (Muldo), `rush-neurone` (Dragodinde), `brisage-pa` (Volkorne, Ga Pa), `brisage-pm` (Muldo, Ga Pme), `vente-montures` (3 familles), `progression`, `auto`. `ProfitModeDef = {id, label, short, mode, families, itemId, objective, revenue, risk?}`. |

- **extraction** : produire la génération visée (recette la moins chère en captures) et l'extraire ; surplus de
  génération ≥ 2 extrait, G1 en trop relâchées.
- **vente** : produire les montures de la génération visée **les mieux payées** (prix prudent × volume, 3 au
  plus) ; toute monture fertile dont le prix prudent dépasse sa valeur d'extraction est mise en vente
  (plafond de volume par espèce, surplus au-delà de 3 jours de volume extrait), le reste est extrait.
- **brisage** : capturer, monter au niveau de brisage (lots de Mangeoire seule), briser ; avec « accoupler
  avant » : fécondation + montée au niveau de brisage, accouplement, stériles brisées, bébés montés puis brisés.
- **progression** : les montures visées sont gardées (génétons et surplus extrait seulement).

## Configuration (`ProductionConfig`)

| Champ | Défaut | Rôle |
|---|---|---|
| `family`, `mode` | — | Famille et mode. Brisage impossible pour les Dragodindes (erreur). |
| `targetGeneration` | `'auto'` | 2 … 10 ; `'auto'` = tri rapide par simulation (`autoTargetGeneration`). Ignorée en brisage. |
| `targetSpeciesIds?` | — | Espèces visées imposées. |
| `mateBeforeExtract` | `true` | Règle 12 de la recherche : les montures de la génération visée sont fécondées et accouplées entre elles **une fois** (bébé gratuit), puis extraites. Brisage : accoupler les captures avant de les briser. |
| `cloning` | `true` | `true` (générations sous la cible), `false`, `{maxGeneration}`. |
| `parentLevel` | 40 | Niveau des parents (Mangeoire pendant la fécondation). |
| `brisageLevel` | 53 | Niveau de brisage. |
| `optimakina` | `'auto'` | `'none'`, `'all'`, `{fromGeneration}`, `'auto'` = `decideOptimakina` par génération (règle `prix < C_eff × Δ / p`, C_eff ≈ 2 × (fécondation + XP par monture) + valeur d'extraction des deux parents ; à défaut de prix, heuristique G6+). |
| `tier` | 2 | Palier des jauges de statistiques (brisage : palier de la Mangeoire). |
| `xpTier` | `'auto'` | Palier de la Mangeoire pendant la fécondation : le moins cher au point qui n'allonge pas le lot d'une session. |
| `paddocks`, `paddockSchedule?` | — | Enclos débloqués ; `[{day, paddocks}]` = jalons du métier en cours de route. |
| `slotsPerPaddock` | 10 | Places par enclos. |
| `sessionsPerDay` / `hoursPerDay` | d'après `hoursPerDay` (3 h → 2) | Même barème que le Plan (`sessionsForHours` = `advisor.sessionsPerDayFor`). |
| `captureHoursPerDay` | `hoursPerDay / 2` | Temps de capture par jour. |
| `characters`, `netKind`, `mountsPerCast`, `fightsPerHour`, `captureRate?` | 1, filet du niveau, défaut du filet, **12** | Captures/heure = min(personnages × montures par lancer, groupe 8 ou 16) × combats/heure (`capturesPerFight`). |
| `buyG1PerDay?`, `g1Price?` | 0 | G1 achetées à l'HDV (prix : la plus haute des médianes ; au plus 15 % du volume de leurs objets) ; avertissement « séniles ». |
| `initialStock?` | — | `[{speciesId, count, state?, level?}]` (arbre propre supposé pour G ≥ 2). |
| `jobLevel` | `ctx.jobLevel`, sinon 200 | Prix de craft, filet par défaut. |
| `rules`, `prices`, `horizonDays` | —, —, (1 … 365) | `prices = {ctx, mountPrices?, saleTax (0,02), maxMarketShare (0,15), genetonValue?, includeGenetons (vrai), mountSaleFactor (0,85), revenueFactor (1), costFactor (1)}`. |
| `minBatchFill` | 6 | Montures minimum pour lancer un lot (sinon attente de 2 sessions au plus). |
| `cloneKeepsLevel` | `true` | Hypothèse de l'Optimiseur (inconnu en jeu). |
| `durationFactor` | 1 | Sensibilité : durées des lots × facteur (1,5 = joueur réel). |

`normalizeProductionConfig(cfg)` applique bornes et défauts ; `netKindForJobLevel`, `sessionsForHours`,
`capturesPerFight`, `conservativeMountMarketPrice(market, speciesId, factor)` sont exportés.

## Modèle simulé (hypothèses, affichées dans `summary.assumptions`)

- **Sessions** régulièrement espacées ; ordre d'une session (règle 13) : accouplements de la recette →
  accouplements des condamnées → clonages et sorties des stériles → achats puis captures → mise en enclos.
- **Lots** : un enclos libre reçoit un lot (≤ 10 montures, génération la plus haute d'abord). Durée = lot
  **typique** du planificateur au palier (`batchProfile('typique')` : 26 130 s au palier 2) + l'XP au-delà de
  ce que donne la Mangeoire en 2e jauge pendant la phase d'amour (`xpOverlapPoints`), arrondie aux sessions.
  À 2 sessions/jour, un lot occupe 1 session aux paliers 2–4 et 2 sessions au palier 1. **Carburant compté par
  lot** (60 000 points + sérénité, quel que soit le nombre de montures) ; Mangeoire = XP manquante la plus
  grande du lot. Lots de montée (brisage) : Mangeoire seule au palier `tier`.
- **Accouplements pilotés par le besoin** (comme l'Optimiseur) : besoin de la cible = places d'enclos, propagé
  par B et le clonage ; un croisement ne s'accouple que si son bébé manque ; génération la plus haute d'abord ;
  à génération égale, le croisement le plus en retard (parent partagé réparti) ; parents gardés pour un
  croisement plus haut dont le partenaire sort d'enclos ; arbres « propres » d'abord ; **sexes** : on consomme
  le sexe en surnombre de chaque espèce. Naissances : `breed()` avec les arbres réels (parents des parents),
  bébés 50/50.
- **Captures** : seulement pour remplir les places libres, couleurs G1 selon le besoin de la recette, **sexe
  en déficit** de la couleur (conseil de la recherche) ; 30 XP d'Éleveur par capture. Étable : au-delà de
  `rules.stableSlots`, plus de captures, et les fécondes les plus en surplus sont sorties (`released`).
- **Clonage** : stériles de même génération, même couleur d'abord, puis couleurs utiles (après une session
  d'attente), puis utile + inutile ; stérile seule sortie après 4 sessions ; le clone retourne en fécondation.
- **Condamnées** (`mateBeforeExtract`) : appariées par paires de sexes opposés au meilleur bébé attendu
  (Σ p × génération) ; sans partenaire après 2 sessions : extraites telles quelles.
- **Ventes** (fin de journée) : ressources, runes, montures et génétons vendus au plus `maxMarketShare` ×
  ventes moyennes par jour (30 j) de l'objet ; le reste est **reporté** (report de quota ≤ 1 unité, pas de
  banque de volume) ; liquidité inconnue (pas d'export) → non plafonné, signalé.
- **Prix** : `ProductionPriceBook` (mémorisé par contexte) — filet (`captureCost`), carburant au point par jauge
  au palier entretenu (`gaugePointCost`, sérénité au palier 1), Mangeoire (`bestFuel`), Optimakina par
  génération (`makinaCost`), ressource d'extraction / rune (`marketPrice` + `marketDepth`), brisage
  (`brisageValue` : rendements observés à l'échelle du prix de la rune Ga ; unités = valeur ÷ prix de la rune),
  montures (prix saisi du joueur, sinon **min(médiane 30 j, médiane 24 h si ≥ 5 ventes) × 0,85**, « HDV
  mixte » ; prix < ½ valeur d'extraction dès la G5 = séniles probables, jamais vendues), généton (valeur
  saisie, sinon marché `genetonValueFromMarket` net de taxe, sinon 375 K ; plafond = volume du meilleur
  parchemin × son coût).
- **Jamais 0 pour un prix inconnu** : chaque journée a `cost`, `revenue`, `net` en `Range` (borne inconnue =
  null) et des montants « connus » (`costKnown`, `revenueKnown`, `netKnown`, bornes basses). Un coût incomplet
  à 0 (aucun ingrédient chiffré) devient inconnu. `rangeStatus(r)` → `ProfitStatus` (`exact`, `intervalle`,
  `borne-basse` « ≥ », `borne-haute` « ≤ », `inconnu`) ; afficher avec `formatKamasRange`.
- **Socle** des paliers ≥ 2 (`socleInvestment`, enclos max du calendrier) : **capital**, jamais un coût.

## Simulation et résultats

| Export | Rôle |
|---|---|
| `simulateProduction(cfg, seed): ProductionRun` | Un tirage : `days: ProductionDay[]` (quantités : captures, achats, fécondations, montées, lots, accouplements, condamnées, Optimakinas, naissances par génération, clones, extractions, ressources produites/vendues/stock, brisées, runes, mises en vente, vendues, gardées, relâchées, génétons, XP métier, points de carburant par jauge, Optimakinas par génération, montures en étable, occupation ; montants `cost`/`revenue`/`net`/`cumulative` en `Range`, `*Known`, `costByCategory`, `revenueByCategory`), `ledger` (**conservation** : initiales + capturées + achetées + nées = extraites + brisées + vendues + gardées + relâchées + perdues au clonage + restantes), `inventory` (fin : par file et espèce), `firstTargetDay`, `peakHeld`, `stableOverflow`. |
| `runProduction(cfg, {runs = 4, seed = 1, onProgress?}): ProductionSummary` | Monte-Carlo (graines `runSeed`). Résumé **sérialisable** (sans le contexte de prix). |
| `summarizeProduction(cfg, runs, seed?)` | Agrégat de tirages déjà simulés. |
| `productionPlan(cfg): ProductionPlanInfo` | Plan résolu : `targetGeneration`, `targets`, `steps` (croisements, Optimakina, B, besoin relatif), `captureShares`, `optimakina` (décision et raison par génération), `notes`. |
| `productionPriceBook(normalizedCfg)` | Prix unitaires utilisés (`UnitPrice {value, complete, bound, estimated, missing, origin, itemId, label}`). |
| `autoTargetGeneration(cfg)`, `AUTO_TARGET_GENERATIONS` | Génération 'auto' : un tirage par génération 2 … 10 (≤ 45 jours), meilleur bénéfice connu en régime permanent (sans prix de la ressource : le plus de ressources). |
| `steadyWindowStart(H)` | Régime permanent = dernier tiers de la durée (7 jours au moins). |
| `cheapestOfGeneration(family, g)` | Espèce de génération g la moins chère en captures. |

`ProductionSummary` : `config` (normalisée, sans prix), `plan`, `runs`, `seed`, `horizonDays`,
`sessionsPerDay`, `cycleHours`, `captureCapacityPerDay`, `batch {tier, xpTier, seconds, sessions, points}`,
`daily[]` (par jour : `net {mean, p10, p90}`, `netRange`, `cumulative {mean, p10, p90}`, `cumulativeRange`,
quantités moyennes), **`steady`** (`fromDay`, `toDay`, `netPerDay: DistStat`, `net`/`revenue`/`cost` en
`Range`, `status`, `costByCategory`, `revenueByCategory`, et par jour : captures, achats, fécondations,
montées, lots, accouplements, condamnées, Optimakinas, naissances, cibles, clones, extractions, ressources
produites/vendues, brisées, runes, mises en vente, vendues, gardées, génétons, XP métier, occupation),
`rampUpDays` (premier jour où la moyenne glissante sur 7 jours atteint 90 % du régime permanent, null sinon),
`firstTargetDay: DistStat | null`, **`capital`** (`socle`, `socleLow`, `socleHigh`, `peakCashNeed` = trésorerie
avancée avant que la production ne paie, `total`, `breakEvenDay` = premier jour où le cumul couvre le socle
et le reste), `totals` (sur la durée), **`market: MarketCheck[]`** (ressource / rune / 12 montures les plus
vendues : produit et vendu par jour, plafond, ventes du marché, part du marché, `saturated`, stock final),
**`routine`** (régime permanent, par jour : captures par couleur, accouplements par croisement, condamnées,
clonages et extractions par génération, ventes par espèce, brisées, lots, **carburant par jauge** avec palier,
objet retenu, durabilité, objets/jour, coût/jour), `prices: PriceLine[]` (prix utilisés, origine, manquants),
`complete`, `missing` (ids à chiffrer → `href('prix', { q: itemName(id) })`), `estimated`, `peakHeld`,
`stableOverflow`, `ledger`, `warnings: {code, tone, text}[]` (`saturation`, `liquidite-inconnue`,
`prix-manquants`, `brisage-risque`, `hdv-mixte`, `achat-senile`, `achat-limite`, `etable`, `genetons`,
`cible-non-atteinte`, `montee`, `plan`), `assumptions: string[]`.

`PRODUCTION_COST_LABELS` (`capture`, `achat`, `carburant`, `xp`, `makina`) et `PRODUCTION_REVENUE_LABELS`
(`ressources`, `runes`, `montures`, `genetons`) : libellés FR.

## Optimiseur

`optimizeMode(mode, base, {grid?, quick?, runs = 4, screenRuns = 1, keep = 5, keepSummaries = 3, horizonDays?, seed?, rankBy = 'steady', onProgress?}): ModeOptimization`

- Grille par défaut (`defaultGrid(mode, {quick})`) : génération visée 2 … 10 × parents {1, 40} × Optimakina
  {aucune, auto} × palier {1, 2, 3} × « accoupler avant d'extraire » {oui, non} (vente/progression : oui) =
  216 points ; `quick` : générations {2, 3, 4, 5, 6, 8, 10}, parents 40, Optimakina auto = 42 points.
  Brisage : niveau {45, 53, 60, 80, 100} × palier {1, 2, 3} × accoupler {non, oui} (`quick` : 4 niveaux, sans
  accouplement).
- Tri en 1 tirage par point, puis **raffinement** : les `keep` premières sont recalculées avec `runs` tirages,
  et on recommence tant qu'une stratégie d'un seul tirage remonte dans le haut du classement (≤ 3 × keep).
- Classement (`compareRanked`) : coûts chiffrés d'abord (`comparable` = borne basse connue), puis `score`
  décroissant (`rankBy: 'steady'` = bénéfice connu par jour en régime permanent ; `'horizon'` = moyen sur toute
  la durée, montée comprise — pour l'investissement), puis montée en charge la plus courte. Sans prix du
  produit (ressource, rune), le bénéfice connu ne compterait que les coûts : `scoreBasis: 'quantite'` et
  classement par quantité produite par jour (note affichée) ; `compareModes` ne désigne alors pas ce mode.
- `RankedStrategy` : `id`, `label` (`strategyLabel`, ex. « G6 · parents niv. 40 · Optimakina auto · palier 2 ·
  accoupler avant d'extraire »), `params`, `steadyNet`, `horizonNet`, `score`, `net`, `status`, `comparable`,
  `scoreBasis`, `complete`, `missing`, `rampUpDays`, `breakEvenDay`, `capital`, `resourcesPerDay`, `brokenPerDay`,
  `mountsSoldPerDay`, `saturated`, `targetGeneration`, `runs`, `summary` (les `keepSummaries` premières).
- `ModeOptimization = {mode, family, strategies, best, evaluated, notes}` ; `optimizeModeAsync(...)` (null si
  arrêté).

## Comparaison des modes (`compareModes`)

`compareModes(ctx: ProfileProductionContext, {onProgress?}): ModeComparison` — pour chaque mode de
`ctx.modes ?? COMPARED_MODES`, `optimizeMode` (grilles `quick` par défaut, `runs` 3, `keep` 3,
`horizonDays` 60) ; la vente est évaluée pour les 3 familles. `ProfileProductionContext = {rules, prices,
jobLevel, paddocks? (défaut : niveau d'Éleveur), paddockSchedule?, hoursPerDay, sessionsPerDay?,
captureHoursPerDay?, characters, netKind?, mountsPerCast?, fightsPerHour?, buyG1PerDay?, initialStock?,
horizonDays?, runs?, modes?, quick?, grid? (par mode), seed?}`. `baseConfigFor(ctx, family, mode)` donne la
configuration de base.

`ModeComparison = {rows: ModeComparisonRow[], bestMode, horizonDays, notes}` ; une ligne : `modeId`, `def`,
`family` (meilleure famille en vente), `best`, `optimization`, `variants` (vente : meilleure stratégie par
famille), `available`, `reason?`. `bestMode` = meilleur mode parmi les stratégies au coût chiffré (« auto »).
`compareModesAsync(ctx, {onProgress?, shouldStop?, sliceMs?})`, `runProductionAsync(cfg, opts)`.

## Web Worker (`production.worker.ts`)

```ts
const w = new Worker(new URL('../../domain/production.worker.ts', import.meta.url), { type: 'module' })
w.postMessage({ type: 'compare', requestId, context } satisfies ProductionWorkerRequest)
w.onmessage = (e: MessageEvent<ProductionWorkerMessage>) => { /* progress | summary | optimization | comparison | error */ }
```

| Élément | Rôle |
|---|---|
| `ProductionWorkerRequest` | `{type: 'simulate', requestId, config, runs?, seed?}` \| `{type: 'optimize', requestId, mode, base, options?}` \| `{type: 'compare', requestId, context}` (structured clone : `rules` et `ctx.market` sont des données). |
| `ProductionWorkerMessage` | `progress {done, total, label}` (≤ 1 toutes les `PRODUCTION_PROGRESS_INTERVAL_MS` = 50 ms, plus le dernier), `summary {summary, durationMs}`, `optimization {result, durationMs}`, `comparison {result, durationMs}`, `error {message}` ; tous portent `requestId`. |
| `handleProductionRequest(req, post, now?)` | Traitement pur (testable sans Worker). Annulation : `worker.terminate()`. |

Vérifié dans Chromium (Vite, worker module) : comparaison des 6 modes de Tylezia en ≈ 3,4 s, simulation
Muldo G6 (4 enclos, 45 j, 3 tirages) et repli `compareModesAsync` sur le fil principal sans erreur.

## Validation

- **Conservation** des montures dans tous les modes (tests), reproductibilité par graine.
- **Modèle de naissance** : à G2 sans makina, parents niveau 40, 38–46 % des accouplements G1 × G1 donnent
  la G2 (B = 42 %) ; 2 ressources par G2 extraite.
- **Ordres de grandeur face à l'Optimiseur (`programSim`) et au modèle analytique (`expectedEffort`)**, 6 enclos,
  palier 3, parents 40, 2 sessions/jour, captures illimitées, sans « accoupler avant d'extraire » :

  | Cible | Optimiseur (1 exemplaire) : jours / accouplements | Production : 1re cible (jour) | Production : accouplements par cible en régime permanent | Modèle analytique sans recyclage |
  |---|---|---|---|---|
  | Volkorne Doré G7, Opti partout | 24,8 / 219 | 7,3 | 30 | 132 |
  | Volkorne Doré G7, sans makina | 22,5 / 362 | 13,0 | 139 | 295 |
  | Muldo Prune G7, Opti partout | 19,6 / 138 | 7,3 | 15 | 93 |
  | Dragodinde Émeraude G9, Opti partout | 22,3 / 421 | 21,7 | 69 | 388 |
  | Dragodinde Ivoire G7, sans makina | 10,8 / 273 | 9,7 | 17 | 266 |

  La production remplit toutes les places dès le départ (l'Optimiseur ne construit que ce qu'il faut pour un
  exemplaire) : la première cible arrive plus tôt, et en régime permanent chaque cible coûte bien moins que
  « depuis zéro » (bébés ratés réutilisés, pas de reliquat de clonage, stériles recyclées) — toujours sous
  la borne haute analytique (test).
- **Performances** : ≈ 13 ms par tirage (4 enclos, 60 jours) ; grille complète d'un mode (216 points) ≈ 4–5 s,
  comparaison rapide des 6 modes ≈ 3–6 s (Worker conseillé).

## Repères Tylezia (export HDV du 02/10/2026, règles 3.6)

Rush Volkorne (Cornes), 3 h de jeu/jour (2 sessions), 1 personnage, 60 jours, grille complète, 6 tirages :

| Enclos (niveau d'Éleveur, filet) | Stratégie retenue | Cornes/jour | Bénéfice net/jour (p10–p90) | Montée | Capital |
|---|---|---|---|---|---|
| 1 (niv. 1, universel) | G6 · parents 40 · sans Optimakina · palier 2 · accoupler avant d'extraire | 9,8 | ≈ 172 K (134–215 K) | 47 j | 1,4 M |
| 2 (niv. 40, universel) | G4 · parents 40 · sans Optimakina · palier 2 · accoupler avant d'extraire | 17,9 | ≈ 295 K (248–341 K) | 25 j | 0,7 M |
| 4 (niv. 120, multiplicateur) | G10 · parents 40 · Optimakina auto · palier 2 · accoupler avant d'extraire | 47,1 | ≈ 711 K (319–866 K) | 51 j | 7,5 M |
| 6 (niv. 200, multiplicateur renforcé) | G6 · parents 40 · Optimakina auto · palier 2 · accoupler avant d'extraire | 73,3 | ≈ 1,14 M (0,97–1,25 M) | 33 j | 3,7 M |

Explication : la Corne vaut 26 497 K (médiane 24 h, 10 744 ventes/24 h) et le carburant est bon marché
(un lot de fécondation au palier 2 ≈ 33 K pour 10 montures) : la limite est **la place en enclos**, pas le
prix. Au palier 2, un lot tient dans une session (7 h 15 < 12 h) : 2 lots par enclos et par jour ; le palier 1
(13 h 55) divise le débit par deux, les paliers 3–4 coûtent plus sans aller plus vite à 2 sessions/jour. Les
générations hautes donnent plus de Cornes par place (chaque extraction rend G ressources, clonage et bébés
ratés recyclés) mais demandent une longue montée en charge et du capital (G10 : ≈ 50 jours, ≈ 7 M) et une
part des revenus vient des génétons (≈ 0,36 M/jour en G10, valeur des Petits Parchemins de Chance). Le volume
de Cornes reste minime face au marché (≈ 2 % des ventes quotidiennes ; plafond 15 % = 637/jour).
Comparaison des 6 modes (4 enclos, niveau 120, grilles rapides) : vente de montures ≈ 1,9 M/jour (Muldos
G10, prix « HDV mixte » prudent), Rush Ambre ≈ 0,9 M, Rush Neurone ≈ 0,9 M, Rush Corne ≈ 0,8 M, Brisage
PM ≈ 0,52 M, Brisage PA ≈ 0,39 M (25 brisées/jour, limité par les places au palier 1). Joueur parfait :
compter ×1,5 sur les durées pour un joueur réel (`durationFactor`).

## Limites (non modélisé)

Fenêtres de sérénité réelles des lots (lot typique moyen), heures de jeu réelles (sessions régulières),
couleurs sauvages et sexes réellement disponibles (choix du sexe en déficit supposé possible), Reproducteur,
capacités, Takeza et Almanax, porteurs, achats de montures autres que G1, évolution des prix avec nos propres
ventes (au-delà du plafond de volume), délai de vente à l'HDV. Les prix d'objets-montures sont mélangés
(niveaux, états, séniles) : la vente est une indication prudente, jamais un prix d'achat pour extraire.
