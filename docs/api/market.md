# API — Prix du marché importés (export HDV CSV)

Modules : `src/domain/market.ts` (pur), `src/store/market.ts` (stockage par serveur), intégration dans
`src/domain/pricing.ts` et `src/store/prices.ts` (`usePriceContext`). Interface : `src/ui/MarketImport.tsx`
(Prix › « Marché HDV (CSV) », `#/prix?onglet=hdv`). Script : `scripts/import-hdv-csv.mjs`.
Spécification : `docs/SPEC-v2.md` §1 et §3. Tests : `src/domain/market.test.ts`, `src/domain/pricing.test.ts`,
`src/store/profiles.test.ts`.

**Règles** : un prix 0 = pas de vente = **pas de prix** (jamais compté 0). Chaque serveur a sa propre
économie : l'instantané est stocké **par serveur** (`elevagesimu:s:<serveur>:market`).

## Ordre de résolution d'un prix (`pricing.marketPrice` / `resolvePrice`)

prix saisi par le joueur (serveur) **>** marché importé (serveur, statistique du serveur) **>** défaut de
la recherche (si `useDefaults`) **>** coût de fabrication. `resolvePrice` garde « le moins cher entre le
prix connu et le craft complet » (si le joueur sait fabriquer, `jobLevel`) ; une recette hors de portée prend
le prix du marché (`craftLocked`). Le marché vaut **même sans** les défauts de la recherche. Le conflit
« défaut < vos ingrédients » compte aussi les ingrédients chiffrés au marché.

| Ajout dans `pricing.ts` | Rôle |
|---|---|
| `PriceOrigin` += `'marche'` ; `PRICE_ORIGIN_LABELS` | Origines : `joueur`, `marche`, `defaut`, `craft`, `manquant`. |
| `PriceContext.market?: MarketSource \| null` | Rempli par `usePriceContext()` (serveur du profil ouvert). Absent = ancien comportement. |
| `ResolvedPrice.market?: MarketPriceInfo` | `{exportDate, serverName? (serveur de l'EXPORT), loadedFor? (prix d'un autre serveur : serveur du profil), stat (statistique réellement utilisée), sold24, sold7, sold30, perDayAvg, kamasPerDay, volumeUnknown?}` ; `confidence` = `high` (≥ 5 ventes/24 h ou ≥ 30/30 j), `medium` (≥ 5/30 j), `low`. Afficher avec `priceOriginText` / `<PriceOriginNote>` / `marketPriceTitle` (`src/ui/MarketStatus.tsx`) : « marché (02/10) · N vendus/24 h » (sans vente en 24 h : « ≈ N vendus/jour (30 j) » ; export sans volumes : « volume inconnu »). |
| `marketQuote(id, market)` | Prix du marché d'un objet (null : absent ou sans vente) avec son détail. |

## `src/domain/market.ts`

| Export | Rôle |
|---|---|
| `parseHdvCsv(text): CsvParseResult` | Lecture tolérante : BOM, `;` `,` ou tabulation (détecté), guillemets (doublés, séparateurs et sauts de ligne entre guillemets), en-têtes en majuscules / accentués / alias (`id`/`gid`, `name`/`nom`, `median_30d`, « Médiane 30j »…), nombres avec espaces, apostrophes, virgules ou points (`parseNumberCell`), colonnes facultatives absentes → 0 (`missingColumns`). Lignes vides (`empty`), invalides ou incomplètes (`invalidCount`, détail des 50 premières `{line, reason, text}`) ignorées et comptées ; doublons (`duplicates`) : la ligne au plus grand `vendus_30j` est gardée. `error` si pas d'identifiant ou aucune colonne de prix. |
| `HdvRow`, `MarketTuple` = `[median30, mean30, median24, sold24, sold7, sold30, kamasPerDay]`, `TUPLE` (index) | Ligne lue / ligne compacte. |
| `PriceStat = 'auto' \| 'median30' \| 'median24' \| 'mean30'`, `PRICE_STATS`, `PRICE_STAT_LABELS`, `PRICE_STAT_SHORT`, `AUTO_MIN_SOLD_24H = 5` | Statistique de prix (réglage par serveur). |
| `priceDetail(row, stat)` → `{price, stat} \| null`, `priceFromRow(row, stat)` | `auto` = médiane 24 h si ≥ 5 ventes en 24 h, sinon médiane 30 j, sinon moyenne 30 j. **`median24` : même garde** (≥ 5 ventes en 24 h ; une médiane de 1 à 4 ventes s'écarte souvent de plus de 50 % — Tylezia : 44 objets sur 111, ex. Dragodinde Dorée et Pourpre 61 033 → 495 000 sur 2 ventes), sinon médiane 30 j (repli signalé par `stat`) : `median24` et `auto` coïncident donc, l'option reste pour les réglages existants. `median30` / `mean30` : leur valeur, sinon repli médiane 30 j puis moyenne 30 j. 0 → null. |
| `marketConfidence(row)` | Confiance selon le volume. |
| `relevantItems(): Map<id, MarketCategory>`, `relevantItemIds()`, `marketCategoryIds()`, `MARKET_CATEGORIES`, `MARKET_CATEGORY_LABELS` | Objets utiles (≈ 1 030) : ingrédients (471), carburants (120), makinas (81), filets (10), objets-montures (308), ressources d'extraction (33515/17864/19975), runes de brisage (Ga Pa 1557, Ga Pme 1558 + secondaires des prix par défaut), boutique de génétons (24 parchemins de caractéristique + Tourmaline 15271), Pépite 14635, Parchemin d'Éleveur 34203. |
| `GENETON_SHOP: {id, name, cost, confirmed}[]` | Boutique d'Eugène Éton (objets échangeables) ; `confirmed` = échange reconfirmé après la 3.5 (Puissants Parchemins). |
| `buildSnapshot(parsed \| rows, {serverName, exportDate, source?, importedAt?, ids?, missingColumns?}): MarketSnapshot` | Instantané compact : objets utiles ayant au moins une valeur non nulle, `names` (noms du fichier pour les objets inconnus des données), `stats` `{lines, read, ignored, invalid, duplicates, relevant, recognized, useful, coverage[{category, label, total, present, priced}], missing (≤ 40), missingCount}`, **`missingColumns?`** (colonnes de volume ou de prix absentes du fichier, `MarketColumn` ; libellés `MARKET_COLUMN_LABELS`). ≈ 49 Ko pour Tylezia. |
| `sanitizeSnapshot(raw)` | `{snapshot \| null, issues}` : lignes invalides retirées (jamais remplacées par 0), date illisible signalée, `missingColumns` gardé. |
| `MarketSource {rows, stat, exportDate, serverName?, names?, originServer?, importedAt?, volumeUnknown?}`, `marketSourceOf(snapshot, stat, serverName?)` | Source de prix pour `PriceContext.market`. `serverName` = serveur qui UTILISE les prix (celui du profil) ; **`originServer`** = serveur de l'export (`snapshot.serverName`) ; `importedAt` (clé des résultats des modes) ; `volumeUnknown` (export sans `vendus_30j`). |
| `marketOriginMismatch(src)`, `marketWhere(src)` | Prix d'un autre serveur chargés pour celui-ci (préréglage de Tylezia pour « Mon serveur ») : nom du serveur de l'export, sinon null ; libellé « HDV de Tylezia du 02/10/2026, chargés pour Mon serveur » (bases du généton et des montures, risques de l'estimateur, Rentabilité, Accueil). |
| `snapshotPrice(src, id, stat?)` | Prix d'un objet (null = pas de prix). |
| `volumeKnown(src)` | Faux pour un export sans colonne `vendus_30j` (instantané ou source). |
| `marketDepth(src, id)` → `{sold24, sold7, sold30, perDayAvg (= sold30/30), kamasPerDay} \| null` | **Liquidité** (null = objet absent **ou export sans volumes** : liquidité inconnue — plafonds de vente désactivés et signalés `liquidite-inconnue`, jamais « 0 vente » ; revue MKT-05 : Rush Corne passait de +620 878 à −516 986 K/jour). |
| `unreliableMedian(src, id)`, `UNRELIABLE_MEAN_RATIO = 2` | Médiane 30 j **peu fiable pour un achat** (revue UX2-02) : moins de 5 ventes en 24 h (le prix retenu est la médiane 30 j) et moyenne 30 j > 2 × médiane → `{prudentPrice (moyenne 30 j), median30, mean30, sold24, sold7, reason}`, sinon null. Utilisé par `bestFuel` (carburants). |
| `sellablePerDay(src, id, share = 0.15)`, `DEFAULT_MAX_MARKET_SHARE` | Quantité vendable par jour sans saturer (part du volume moyen ; le réglage du serveur est `ServerEntry.maxMarketShare`). |
| `marketMountReference(src, speciesId, stat?)`, `MOUNT_MARKET_NOTE` | Prix de l'objet-monture : **indication « HDV mixte »** (niveaux, fertile/stérile, séniles mélangés) — plafond de vente prudent au mieux, jamais un prix d'achat pour extraire sans avertissement sénile. |
| `genetonValueFromMarket(src, saleTax = 0.02, stat?, {confirmedOnly = true})` | `{value (brut, K/généton), net, best, lines[], confirmedOnly, optimistic}` = max(prix ÷ coût) sur les **échanges reconfirmés** après la 3.5 (`GENETON_SHOP[].confirmed` : Puissants Parchemins, `CONFIRMED_GENETON_COST` = 160 ; research/README.md §4.3 n° 18) ; `optimistic` = meilleur échange de toute la boutique (capture de la bêta : Petits 10, normaux 50, Grands 100, Tourmaline 130) s'il vaut plus — affiché, jamais compté. `confirmedOnly: false` : toute la boutique. Tylezia 02/10 : Puissant Parchemin d'Agilité 72 683 ÷ 160 ≈ 454 K (optimiste : Petit Parchemin de Chance 5 079 ÷ 10 ≈ 508 K). |
| `KEY_MARKET_IDS`, `keyPrices(src, stat?, ids?)`, `diffPrices(before, after, {ids?, stat?, minChange?, names?})` | Prix clés et variations entre deux imports (triées par variation absolue). `marketItemName` connaît la boutique de génétons, la Tourmaline, la Pépite et le Parchemin d'Éleveur : jamais « Objet #… » pour un prix clé. |
| `importPriceChanges(preview, {snapshot?, history?}, stat)` | Variations de l'aperçu d'import **à statistique égale** : avec l'instantané courant, sa statistique des deux côtés ; sinon les prix clés du dernier import (historique, enregistrés en `auto`) comparés en `auto` (revue MKT-09 : un réimport identique montrait Corne +14 %). |
| `importCoverageDrop(current, incoming)`, `IMPORT_COVERAGE_MIN_RATIO = 0.5` | Fichier partiel (moins de la moitié des objets avec un prix des prix actuels) : remplacement confirmé, « Compléter » proposé. |
| `mergeSnapshots(base, incoming, {importedAt?})` | « Compléter » : les objets du fichier remplacent les anciens, les autres gardent leur ligne ; **date = la plus ancienne** des deux tant que des objets de l'ancien export restent (la fraîcheur ne rajeunit pas) ; origine « … (03/10/2026) — complété par N objets de l'export du 02/10/2026 ». |
| `serverNameInFileName(fileName, names)` | Serveur évoqué par le nom du fichier (« tylezia-2026-10-02.csv » → Tylezia) : présélectionné à l'import, sinon signalé. |
| `MarketHistoryEntry`, `historyEntryOf(snapshot)`, `sanitizeHistory(raw)`, `MARKET_HISTORY_MAX = 30` | Historique des imports (métadonnées + prix clés). |
| `isIsoDay`, `exportAgeDays(exportDate, today)`, `MARKET_STALE_DAYS = 14`, `MARKET_OLD_DAYS = 30`, `frenchDay(iso)`, `slugify(name)`, `marketItemName(id, names?)` | Utilitaires. |

## `src/store/market.ts`

| Export | Rôle |
|---|---|
| `useMarket` | Store persisté (`STORE_KEYS.market`, serveur ouvert) : `snapshot`, `replace(snapshot)`, `clear()`. |
| `useMarketHistory` | Store persisté (`STORE_KEYS['market-history']`) : `entries`, `record(entry)`, `clear()`. |
| `applyMarketSnapshot(serverId, snapshot)` | Remplace le marché d'un serveur + historique. L'instantané est d'abord **enregistré** (`tryWriteText`) : stockage plein (ou donnée du serveur d'une version plus récente) → `{ok: false, error}` (« Enregistrement impossible (stockage plein) : prix du marché inchangés. Libérez de la place… »), stores et historique **inchangés** — jamais de « succès » avec un marché non enregistré. Puis serveur ouvert : stores mis à jour (pages à jour aussitôt) ; autre serveur : historique écrit directement. |
| `clearServerMarket(serverId)`, `serverMarketHistory(serverId)`, `serverMarketSnapshot(serverId)` | Suppression (historique gardé), historique et instantané d'un serveur (n'importe lequel). |
| `mergeMarketSnapshot(serverId, incoming)` | « Compléter les prix actuels » (`mergeSnapshots`), même garantie d'écriture, annulable. |
| `undoMarketImport(serverId)`, `marketUndoFor(serverId)`, `useMarketUndo(serverId?)`, `MARKET_UNDO_PREFIX` | **Annuler le dernier import** (remplacement, complément ou préréglage) : l'instantané remplacé est gardé dans le **sessionStorage** de l'onglet (`elevagesimu-market-undo:<serveur>` : hors quota du localStorage et hors sauvegardes, survit au rechargement de l'onglet ; repli en mémoire), rétabli tel quel (ou « aucun marché ») et l'import retiré de l'historique. Refusé si le marché a changé depuis (autre import). |
| `MARKET_PRESETS`, `presetForServer(name)` | Préréglages versionnés, chargés **à la demande** (`import()`) : Tylezia 02/10/2026 (`src/data/market/tylezia-2026-10-02.json`). |
| `useMarketSource()` / `marketSource()` | `MarketSource` du serveur ouvert (avec sa statistique, `originServer`, `importedAt`, `volumeUnknown`) ou null. |
| `useMarketGeneton(saleTax)` | Valeur du généton d'après le marché du serveur ouvert. |

## Script de préréglage

```bash
node scripts/import-hdv-csv.mjs <fichier.csv> <serveur> <AAAA-MM-JJ> [--out <dossier>]
node scripts/import-hdv-csv.mjs research/raw/hdv/tylezia-2026-10-02.csv Tylezia 2026-10-02
```

Charge `src/domain/market.ts` via Vite (`runnerImport` : même logique que l'application), écrit
`src/data/market/<serveur>-<date>.json` (une ligne par objet, `importedAt` = midi UTC du jour de l'export :
fichier reproductible) et affiche la couverture. Tylezia 02/10/2026 : 9 745 lignes lues, 1 022 objets utiles
sur 1 030 (ingrédients 471/471, carburants 120/120, makinas 74/81, filets 10/10, objets-montures 307/308,
extraction 3/3, runes 11/11, boutique 25/25). Le CSV brut (`research/raw/hdv/`) n'est pas versionné ; le test
qui compare le préréglage au CSV est sauté s'il est absent.

## À faire par les autres tranches

- `economy.mountSalePrice` peut utiliser `marketMountReference` (origine `marche`, badge « HDV mixte »,
  volume) — jamais comme prix de décision sans avertissement.
- `genetonKamasValue` (economy) : proposer la valeur du marché (`useMarketGeneton`) quand le joueur n'a pas
  saisi la sienne (la page Prix propose « Utiliser cette valeur »).
- Pages qui étiquettent l'origine d'un prix : fait (`PriceOriginNote` ; `BreedingPage` distingue `marche`,
  « coût des ingrédients », « votre prix », « prix par défaut (recherche) »).
- Modes / investissement : plafonner les ventes avec `sellablePerDay(src, id, server.maxMarketShare)`.

## Lecture du marché pour l'élevage (`src/domain/marketInsights.ts`)

Module pur ; interface : `src/ui/MarketInsightsPanel.tsx` (Prix › « Marché », `#/prix?onglet=marche`, sections
Prix clés / Fabriquer ou acheter / Montures / Comparer les serveurs, liens vers Rentabilité et Modes). Tests :
`src/domain/marketInsights.test.ts` (extrait réel du CSV de Tylezia + préréglage complet). Un prix absent ou
sans vente vaut `null` (« — »), jamais 0.

`InsightContext = {market, ctx?, rules, jobLevel?, saleTax? (0,02), share? (0,15)}` — `ctx` = contexte de prix
des ingrédients (vos prix > marché > défaut ; défaut : le marché seul), `share` = `ServerEntry.maxMarketShare`.

| Export | Rôle |
|---|---|
| `marketLine(market, id, {saleTax?, share?}): MarketLine` | Prix (statistique du serveur), `stat`, `net`, `sold24/7/30`, `perDayAvg`, `kamasPerDay`, `sellablePerDay`, `confidence`, `absent`. |
| `keyPriceDashboard(ic): KeyPriceDashboard` | (a) `extraction` (Neurone, Ambre, Corne, `perGenerationNet`), `runes` (Ga Pa / Ga Pme, `defaultPrice`, `scale` = facteur des rendements de brisage), `genetons` (`lines` triées par K/généton avec `confirmed`, `best` = meilleur échange **reconfirmé**, `value`, `net`, `optimistic` = meilleur échange non reconfirmé s'il vaut plus ; le panneau marque « non reconfirmé » et affiche la valeur optimiste sans la compter), `others` (Pépite, Parchemin d'Éleveur, Tourmaline), `fuels` (`fuelPointCosts`), `makinas` (prix + craft + `canCraft`), `nets` (`perMount`). |
| `fuelPointCosts(ic): FuelPointRow[]` | Par jauge × palier (24 lignes) : carburant le moins cher au point à l'achat (`buy`) et en fabriquant (`craft`, `canCraft`), `best` (le craft ne compte que s'il est à votre portée), `bestPerPoint` (durabilité du ruleset : ×2 en 3.7). |
| `makinaPriceCurves(rows)` | Séries par famille × type, triées par génération (`price`, `craft`, `sold30`). Tylezia : 74/81 makinas en vente. |
| `craftVsBuy(ic, {kinds?}): CraftVsBuyRow[]`, `CRAFT_KIND_LABELS`, `CRAFT_EQUAL_TOLERANCE = 0.02` | (b) Chaque carburant, makina, filet : `buy` (marché), `craft` (ingrédients), `cheaper` (`craft`/`achat`/`egal`/`inconnu`), `saving`, `margin` = net − craft, `marginPct`, `sellablePerDay`, `ingredientCapPerDay` (crafts/jour que fournit le marché des ingrédients), `profitPerDay` = marge × min(revendables, ingrédients), `xp` (craft à votre niveau). Trié par bénéfice journalier. |
| `craftVsBuySummary(rows)` | Décompte, crafts rentables à votre portée, somme des 5 meilleurs bénéfices journaliers. |
| `mountMarket(ic, family?): MountMarketRow[]` | (c) Par espèce : prix (HDV mixte) et volume, extraction (génération × ressource au prix du serveur), `premium` (vente nette − extraction nette), `ratio`, `sellAboveExtraction`, `possibleSenile` (G5+ < ½ extraction), `extraPerDay` (gain plafonné par la liquidité). |
| `sellRatherThanExtract(rows, {minConfidence?})` | G2+, hors séniles probables, triées par gain journalier. |
| `generationCurves(rows)` | Par famille et génération : `min`, `median`, `max` des couleurs, `sold30`, `perDayAvg`, `extractionGross`, `senileSuspects` (graphique SVG de la page). |
| `compareServers(servers: ServerMarket[], {ids?, today?, saleTax?, stat?})`, `COMPARE_ITEMS`, `COMPARE_DATE_GAP_DAYS = 7` | (d) ≥ 2 serveurs (sinon null) : objets clés côte à côte (`cells`, `cheapest`, `priciest`, `spread`), valeur du généton par serveur, avertissements (exports éloignés de plus de 7 jours, export de plus de 14 jours). **Une seule statistique pour tous** (`stat` : `opts.stat`, sinon celle des serveurs si identique, sinon médiane 30 j ; `serverStats` = les leurs) — revue MKT-08 : comparer « auto » à « médiane 30 j » gonflait l'écart (Corne 48 % au lieu de 30 %). La page propose la statistique (celle du serveur ouvert par défaut) et lit le marché des autres serveurs dans leur stockage (`elevagesimu:s:<serveur>:market`, normalisé par `sanitizeMarketState`). |
| `snapshotFreshness(exportDate, today): Freshness`, `MARKET_OLD_DAYS = 30` | (e) `frais` (≤ 14 j, `MARKET_STALE_DAYS`), `a-rafraichir` (≤ 30 j), `perime`, `inconnu` (date illisible ou future) ; `tone` et `message` prêts à afficher (pages Prix et Rentabilité). |
| `marketInsights(ic, {today?}): MarketInsights` | Tout en un appel (≈ 15 ms sur Tylezia) : `freshness`, `keyPrices`, `craft`, `craftSummary`, `mounts`, `sellRatherThanExtract`, `curves`, `senileSuspects`, `notes`. |

Chiffres de Tylezia (02/10/2026, statistique auto) : Corne 26 497 K (10 744 vendues/24 h, ≈ 637 vendables
par jour à 15 %), Ambre 31 285 K (≈ 360/jour), Neurone 28 987 K (≈ 340/jour) ; Rune Ga Pa 28 598 K (× 0,95 sur
le brisage), Ga Pme 21 509 K (× 1,19) ; généton 507,9 K (Petit Parchemin de Chance) ; 82 crafts moins chers
que l'achat sur 211, 116 moins chers à l'achat ; 43 couleurs G5+ « séniles probables ».

### Intégration dans l'économie (fait)

- `economy.mountSalePrice` / `mountValuation` : prix de l'objet-monture = origine `marche`, badge « HDV mixte :
  niveau/sénilité/état non distingués », volume ; dans les décisions, **plafond de vente seulement** (voir
  docs/api/economy.md). Pages qui le passent : Prix, Rentabilité (`mctx.market = ctx.market`).
- `economy.genetonKamasValue(override, {market, saleTax})` : valeur du marché quand vous n'en avez pas saisi
  (pages Prix et Rentabilité).
- Liquidité : `salesCap`, `absorbablePerDay`, `checkPlannedSales`, `genetonLiquidityCheck` ;
  `cycleProfit().liquidity` et `crossingRanking()[].liquidity` (avertissements quand les ventes prévues
  dépassent `maxMarketShare` du volume moyen).
- Métier : la liste de courses est chiffrée au marché (origine « marché (JJ/MM) », volume du serveur,
  avertissement au-delà d'une journée de ventes).
- Branché partout (revue « marché ») : `MountPriceContext.market` et la valeur du généton du marché
  (`useGenetonValue()`, src/store/prices.ts) sur Accouplement, Mes montures (prix « HDV mixte ≈ … (plafond,
  non compté) » et « sénile probable » sous le sort conseillé), Optimiseur, Plan, Accueil (conseiller),
  Rentabilité, Prix, Modes. Plus aucune page n'utilise le généton par défaut (375 K) quand un export existe.

### État des prix du marché sur les pages (`src/ui/MarketStatus.tsx`)

| Export | Rôle |
|---|---|
| `<MarketStatusCallouts context? />` | Bandeaux sous le titre des pages de conseil (Accueil, Plan, Enclos, Métier, Accouplement, Mes montures, Optimiseur, Investissement, Modes, Rentabilité, Prix) : export **à rafraîchir / périmé** (`snapshotFreshness` : > 14 j avertissement, > 30 j « Prix périmés » en rouge), **prix d'un autre serveur** (« Prix de Tylezia (chargés pour Mon serveur) »), **export sans volumes** (liquidité inconnue). Rien si l'export est récent, du bon serveur et complet. La barre latérale affiche « Prix HDV de Tylezia du … » dans ce cas. `showSource` (Métier, Enclos, Accouplement, Optimiseur, pages qui n'affichent pas l'origine de chaque prix) : une ligne discrète « Prix : HDV de Tylezia du 02/10/2026 (1 022 objets, statistique automatique), après vos prix saisis et avant les défauts de la recherche », ou « aucun export HDV importé pour … ». |
| `priceOriginText(origin, market?)`, `<PriceOriginNote origin market />`, `marketPriceTitle(info)` | Origine d'un prix : « marché (02/10) · N vendus/24 h » (ou « ≈ N vendus/jour (30 j) », « volume inconnu », « … de Tylezia » pour un autre serveur), « coût des ingrédients », « votre prix », « prix par défaut (recherche) » ; infobulle détaillée. Utilisés par Accouplement (makinas), Enclos (carburants à acheter : `RefillItem.origin`/`market`, badge « volume HDV faible » au-delà de `maxMarketShare` des ventes quotidiennes), Rentabilité, Prix, Métier. |

### Import (Prix › Marché HDV)

Aperçu : variations des prix clés à statistique égale (`importPriceChanges`), colonnes absentes (« Volumes
absents : la liquidité sera inconnue… »), serveur évoqué par le nom du fichier (présélectionné ou signalé).
Fichier partiel (`importCoverageDrop`) : avertissement, « Compléter les prix actuels » mis en avant,
« Remplacer » demande une confirmation (« Confirmer : remplacer par N objets seulement »). Après un import :
« Annuler l'import » (et « Annuler le dernier import » dans la carte du serveur tant que l'onglet est ouvert).
