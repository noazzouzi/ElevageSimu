# API — Économie (`src/domain/pricing.ts`, `src/domain/fuel.ts`, `src/domain/economy.ts`)

Logique pure (aucun React, aucun store). Les pages construisent les contextes depuis les stores :

```ts
const ctx = usePriceContext()                                  // PriceContext (prix objets + niveau d'Éleveur, jobLevel inclus)
const mctx: MountPriceContext = {                              // prix des montures
  mountOverrides: usePrices((s) => s.mounts),
  generationOverrides: usePrices((s) => s.generations),
  useDefaults: useSettings((s) => s.useDefaultPrices),
  market: ctx.market,                                          // facultatif : prix HDV mixte = plafond de vente
}
const rules = useRules(); const jobLevel = useSettings((s) => s.jobLevel)
const g = genetonKamasValue(usePrices((s) => s.genetonValue), { market: ctx.market, saleTax })  // g.value (brut), g.origin, g.net
// Dans une page : useGenetonValue() (src/store/prices.ts) = la même valeur partout (Accouplement, Montures,
// Optimiseur, Plan…), `net` toujours rempli ; genetonOriginLabel(g) → « votre valeur » | « marché (…) » | « valeur par défaut ».
```

**Règle commune** : un prix inconnu n'est jamais 0. Les fonctions renvoient `complete: false`, une
valeur partielle (borne basse) ou `null`, et la liste `missing` des ids d'objets à chiffrer
(lien : `href('prix', { q: itemName(id) })`). La page Prix accepte aussi `onglet=carburants|makinas|filets|ingredients|montures|masse`.
Un montant dont des prix manquent s'affiche en **intervalle** (`Range {low, high}`, borne inconnue =
`null`) : « X à Y », « ≤ Y », « ≥ X » ou « inconnu » — jamais un montant signé présenté comme certain.

## `pricing.ts` — résolution des prix

| Export | Rôle |
|---|---|
| `PriceContext` | `{overrides, useDefaults, jobLevel?}`. **`jobLevel`** (facultatif) : une recette de niveau supérieur n'est pas fabricable → son prix HDV prime ; sans prix HDV, le coût des ingrédients est retenu mais signalé `craftLocked` (estimation du prix HDV). Absent : tout est supposé fabricable (ancien comportement). Les fonctions d'`economy.ts` qui reçoivent `jobLevel` l'ajoutent elles-mêmes au contexte. |
| `marketPrice(id, ctx)` | Prix joueur, sinon **marché importé** (`ctx.market` : export HDV du serveur, origine `marche`, détail `market` = date, statistique, volume), sinon défaut (sans craft). `PriceContext.market` est rempli par `usePriceContext()` — voir docs/api/market.md. |
| `craftCost(recipeId, ctx)` | Σ ingrédients (`complete`, `missing`, `lines`). |
| `resolvePrice(id, ctx): ResolvedPrice` | joueur > min(défaut, craft complet fabricable) > craft (incomplet = borne basse). Champs ajoutés : **`craftLocked?: number`** (niveau requis, joueur trop bas) et **`conflict?: PriceConflict`** quand un prix par défaut (autre serveur, daté) est ≥ `PRICE_CONFLICT_RATIO` (1,5) × un craft complet chiffré avec au moins un prix d'ingrédient du joueur : le défaut reste retenu, mais `conflict.message` (« Prix par défaut 1 000 K < vos ingrédients 3 000 K : saisissez le prix HDV de votre serveur. ») est à afficher. |
| `canCraftRecipe(id, {jobLevel})` | Le joueur peut-il fabriquer la recette ? |
| `netSale(price, tax)` | Prix net de taxe. |

## `fuel.ts` — carburants

| Export | Rôle |
|---|---|
| `FUEL_TIERS`, `FUEL_SIZE_LABELS` | Paliers 1-4, libellés des tailles. |
| `fuelDurability(fuel, rules): number` | Durabilité × `rules.fuelDurabilityFactor` (×2 en 3.7). |
| `tierCap(tier, rules): number` | Plafond de dépôt du palier (`rules.gaugeTierMax`). |
| `canDeposit(v, fuel, rules)` / `depositFuel(v, fuel, rules): {value, added, wasted} \| null` | Règle de dépôt : seulement sous le plafond ; `min(plafond, v + durabilité)`, excédent perdu. |
| `fuelsOf(gauge, tier?)`, `findFuel(gauge, tier, size)`, `fuelTierName(tier)` | Accès aux 120 carburants. |
| `fuelOption(fuel, ctx, {jobLevel, rules}): FuelOption` | Prix retenu (`resolvePrice` : joueur > défaut > craft), durabilité, `costPerPoint`, `market`, `craft`, `canCraft`, `craftPriceOnly`. `opts.jobLevel` est ajouté au contexte s'il n'y figure pas : une recette hors de portée prend le prix HDV (sinon craft signalé `craftPriceOnly`). |
| `optimakinaHeuristicUse(targetGeneration, goalRelevant): boolean` | Heuristique unique de la recherche quand la règle de prix est indécidable (utilisée par `decideOptimakina` et `pairing.adviseOptimakina`). Constantes `OPTIMAKINA_HEURISTIC_GENERATION = 6`, `OPTIMAKINA_GOAL_STEP_GENERATION = 4`. |
| `fuelOptions(gauge, tier, ctx, opts): FuelOption[]` | Les 5 tailles d'une jauge/palier. |
| `bestFuel(gauge, tier, ctx, opts & {exactTier?, craftableOnly?, liquidity?}): GaugePointCost` | Carburant le moins cher au point pour entretenir ce palier (paliers ≥ acceptés). `complete` seulement si un carburant du palier est chiffré ; sinon `bound: 'max'` (palier supérieur) ou `'min'` (ingrédients partiels) et `toPrice` = carburant à chiffrer. Repli « estimation » (`estimated: true`) sur `valuation.fuelCostPerGaugePointDefaults` pour la **Mangeoire seulement**. **`liquidity: {pointsPerDay, share}`** : un carburant **acheté à l'HDV** dont le besoin (points ÷ durabilité) dépasse `share` × ses ventes par jour est écarté au profit du suivant ou d'un craft (gardé s'il n'y a pas d'autre carburant chiffré au palier) ; `liquidityLimited: FuelLiquidityLimit[]` (`fuelId`, `name`, `itemsPerDay`, `perDayAvg`, `share`, `kept`) liste ceux qui auraient été moins chers. **Prix du marché peu fiable** (revue UX2-02, `FuelOption.unreliable` = `market.unreliableMedian`) : un carburant au prix de la médiane 30 j sans vente récente (< 5 ventes en 24 h) et dont la moyenne 30 j dépasse 2 × la médiane est choisi et chiffré **à la moyenne 30 j** (Tylezia : Grand Élixir d'Abreuvoir 2 872 → 9 145 K) ; `fuelOption` garde le prix affiché et expose `unreliable {prudentPrice, reason}`. |
| `costPerGaugePoint(...)` | Alias de `bestFuel`. |
| `defaultMangeoirePointCost(tier, rules)` | Coût au point par défaut de la recherche (÷ facteur de durabilité). |
| `fillPlan(gauge, from, to, ctx, opts): FillPlan` | Plan de dépôts de `from` à `to` respectant les plafonds. **Chaque tranche est remplie avec la famille minimale** (`sliceTier(niveau, rules)` : Extrait sous le plafond du palier 1, Philtre jusqu'au palier 2…). Une famille supérieure n'entre dans une tranche que si elle est chiffrée **et** pas plus chère au point qu'un carburant chiffré de la famille de la tranche (à défaut, d'une famille inférieure) — jamais parce qu'elle serait la seule chiffrée. Si la famille de la tranche n'a pas de prix, le plan la garde (`complete: false`, objets « prix à saisir » dans `missing`, `cost` = borne basse ou `null`) et **`upperBound`** donne le même remplissage entièrement chiffré (souvent un Élixir estimé) : **borne haute**, à afficher « ≤ … », jamais comme le coût. Critères (Dijkstra lexicographique) : objets chiffrés, kamas, gaspillage, dépassement de l'objectif, nombre d'objets, coût partiel connu (départage). `craftableOnly` : un prix « craft » hors de portée du métier compte comme non chiffré (l'objet reste proposé). `steps` dans l'ordre, `items` agrégés, `cost`, `complete`, `waste`, `overshoot`, `upperBound`. |
| `sliceTier(level, rules): FuelTier` | Famille minimale pour déposer à ce niveau (plus petit palier dont le plafond est au-dessus). |
| `dustOption(gauge, tier, rules): DustOption \| null` | Gigantesque contre poussière chez Adèle Vage (`legacy: true`, aucune nouvelle source). |

## `economy.ts` — prix et valeur des montures

| Export | Rôle |
|---|---|
| `MOUNT_BANDS`, `MOUNT_BAND_LEVEL`, `mountBand(level)` | Niveaux d'ancrage 1 / 100 / 200 ; `mountBand` = tranche la plus proche (affichage seulement). |
| `defaultPriceIssue(row): DefaultPriceIssue \| null` | Une ligne par défaut est-elle un prix de **décision** ? `null` = oui (observée ou dérivée, confiance ≥ moyenne, de moins de `MOUNT_PRICE_STALE_DAYS` = 120 j avant le dernier relevé de la recherche). Sinon `'plancher'`, `'estimation'`, `'peu-fiable'`, `'ancien'` ou `'a-verifier'` (`excludeFromDefaults` du pipeline, ou note « Ne pas utiliser comme défaut »). `DEFAULT_PRICE_ISSUE_LABELS`. |
| `mountSalePrice(speciesId, level, mctx, {state?}): MountSalePrice` | Prix **brut** : ancrages aux niveaux 1/100/200 (votre prix couleur > votre prix génération > relevé par défaut fiable par nom > par génération), **interpolés** entre deux ancrages (`method: 'interpolation'`, `estimated`), prix du palier inférieur au-dessus du dernier (`'palier-inferieur'`, estimation prudente), **jamais** un prix de niveau supérieur appliqué en dessous (`price: null`). Planchers, relevés anciens/peu fiables : `price: null` et `references[]` (`{price, net, level, kind, reason}`), affichées « à saisir / non comptées ». `isFloor` est obsolète (toujours faux). **Avec `mctx.market`** (export HDV) : le prix de l'objet-monture s'intercale entre vos prix et les défauts — `market` (`MountMarketQuote` : prix, statistique, date, `sold24/7/30`, `perDayAvg`, `kamasPerDay`, `confidence`, `badge` « HDV mixte : niveau/sénilité/état non distingués »), `ceiling` = ce prix ; vos prix priment (jamais plafonnés) ; un relevé par défaut plus cher est ramené au prix du marché (`origin: 'marche'`, `cappedFrom {price, origin}`) ; sans autre prix : `origin: 'marche'`, `method: 'marche'`, `estimated` (indication, **non comptée seule** par `mountValuation`). |
| `mountMarketQuote(speciesId, market)`, `MOUNT_MARKET_BADGE` | Prix de marché de l'objet-monture (null sans marché ni vente). |
| `possibleSenile(gen, marketPrice, extractionGross)`, `SENILE_MIN_GENERATION = 5`, `SENILE_PRICE_RATIO = 0.5` | G5+ vendue sous ½ × sa valeur d'extraction : ventes probablement tirées par des montures séniles (extraction = 1). |
| `REFERENCE_KIND_LABELS` | Libellés de toutes les natures de référence (`DefaultPriceIssue`, `niveau-superieur`, `marche`). |
| `defaultGenerationPrice(family, gen, band, state?)`, `defaultSpeciesPrice(id, band)` | Ligne de prix par défaut (affichage ; plancher ramené à la revente de base). |
| `extractionValue(speciesId, ctx, {senile?})` | `qty` (= génération ; G1 = 0 ; sénile = 1) × prix Neurone/Ambre/Corne (brut) : votre prix > **marché importé** (`ctx.market`, `market` = date, statistique, volume) > défaut. |
| `brisageValue(family, level, ctx?)` | Rendements observés interpolés (45/53/100/200), extrapolés de 0 (niv. 35) à 45, mis à l'échelle de la rune Ga (Ga Pa 1557, Ga Pme 1558) : votre prix > **marché importé** > défaut ; `runePrice`, `runeOrigin`, `runeMarket` (avec `ctx`). Dragodindes : `possible: false`. `BRISAGE_RISK_NOTE`. |
| `mountValuation(speciesId, level, {ctx, mountPrices, saleTax, state?, senile?}): MountValuation` | `sale`, `extraction`, `brisage` (nets de taxe), `best`, `bestKind`, `confidence`, `complete`, **`estimated`**. Vente sans prix de décision : `sale.net = null`, **`sale.reference`** `{net, kind, reason}` (jamais comptée) → `complete: false`, `best` = borne basse. À égalité : extraction > brisage > vente. **Marché (`mountPrices.market`) = plafond de vente prudent** : un défaut plafonné (`cappedFrom`) est compté au prix du marché ; le prix du marché **seul** n'est pas compté (`sale.reference.kind = 'marche'`, `sale.ceiling` net, `sale.market`) mais donne **`bestHigh`** = max(meilleure valeur connue, plafond) quand extraction et brisage sont chiffrés (bornes hautes de `cycleProfit` / `crossingRanking`) ; vos prix ne sont jamais plafonnés ; **`marketWarning`** si `possibleSenile` (G5+ < ½ extraction : jamais acheter pour extraire sans vérifier). |
| `genetonKamasValue(override?, {market?, saleTax?})` | Valeur **brute** d'un généton : la vôtre, sinon **le marché du serveur** (`origin: 'marche'` : max(prix ÷ coût) sur les **échanges reconfirmés** de la boutique d'Eugène Éton — Puissants Parchemins, 160 génétons ; `market` = détail, `basis` = « Puissant Parchemin d'Agilité … ÷ 160 (HDV de Tylezia du 02/10/2026…) — échange reconfirmé après la 3.5 ; 508 K par généton avec Petit Parchemin de Chance (boutique de la bêta, non reconfirmée) »), sinon 375 K (plage 125-725). `net` = brute × (1 − `saleTax`) si fourni ; les calculs la comptent nette de la taxe (parchemin revendu). Tylezia 02/10 : ≈ 454 K brut (Puissant d'Agilité ; le Petit Parchemin de Chance, 508 K, n'est qu'une valeur optimiste). Pages : `useGenetonValue()` (prix saisi > marché du serveur > défaut, taxe du profil) ; montants affichés **nets** (Plan, Optimiseur, Accueil, Modes, Rentabilité), valeur brute seulement pour les fonctions qui appliquent la taxe elles-mêmes (`crossingRanking`, `matingEconomics`). |
| `genetonLiquidValue(market, genetonsPerDay, {share?, saleTax?})` | Valeur d'une production de génétons selon le volume de la boutique (échanges reconfirmés) : meilleur échange d'abord (dans la limite de `share` de son volume moyen), puis le suivant ; `perGeneton`, `net`, `absorbed`, `surplus` (non valorisé), `lines`. |

## `economy.ts` — lots, coûts d'enclos, socle

| Export | Rôle |
|---|---|
| `batchProfile(model, tier, rules, serenity?): BatchProfile` | `'ideal'` : 20 000 pts par statistique + sérénité, toutes les jauges au palier, `fertilitySeconds` (minimum théorique). **`'typique'`** : moyennes du planificateur d'enclos (`TYPICAL_BATCH`, 200 lots de 10 montures de sérénité proche ; ≈ 23-24 k pts par statistique, ≈ 7 h 15 au palier 2), sérénité au palier 1 (comme `planPaddock`). `BatchProfile = {model, tier, points, tiers, seconds, serenityPoints, label, note}`. `BATCH_MODEL_LABELS`. |
| `batchProfileFromPlans(plans, tier)` | Profil « vos lots » : moyenne de `FertilityPlan`s (`{consumed, totalSeconds, tiers}`, ex. `assignPaddocks(...).paddocks[].plan`) ; `null` sans plan. |
| `maintainedTier(gauge, points, tier, rules)` | Palier réellement entretenu (sérénité → 1 ; jauge peu consommée < `SOCLE_MIN_SHARE` du socle → 1), même règle que le planificateur. |
| `DEFAULT_SERENITY_POINTS = 3200`, `fertilitySeconds(tier, rules, ser?)`, `xpOverlapPoints(tier, xpTier, rules, lovePoints?)` | Modèle idéal (compatibilité ; le Takeza et l'Optimiseur devraient passer à `batchProfile('typique', …).seconds`). |
| `FERTILITY_POINT_COST_HINTS`, `gaugePointCost(gauge, tier, ctx, opts)` | `bestFuel` + repli **« estimation »** signalé pour une jauge de fécondité sans prix quand la recherche a un indice (Dragofesse T1 ≈ 13 K/pt, ÷ facteur de durabilité ; prix par défaut activés). |
| `fertilityCost({tier, batchSize, ctx, rules, jobLevel?, model?, profile?, serenityPointsPerMount?})` | Lignes par jauge (`tier`, `pointsPerBatch`, `pointCost`, `costPerBatch`, `upperPerBatch`, `estimated`), `perBatch`/`perMount` (bornes basses), **`perBatchHigh`/`perMountHigh`**, `complete`, `estimated`, `secondsPerBatch`, `profile`. Défaut `model: 'ideal'` (compatibilité). |
| `levelingCost(from, to, {tier, batchSize, sage?, ctx, rules, jobLevel?})` | XP monture, points de Mangeoire du lot, coût, `costPerBatchHigh`, `estimated`, durée. |
| `socleInvestment(consumed, tiers, paddocks, {ctx, rules, jobLevel, tier}): InitialInvestment` | Socle des paliers ≥ 2 par enclos (jauge vide → bas du palier), **même calcul que la page Enclos** (`refillAdvice`) : `lines[] {gauge, tier, pointsPerPaddock, paddocks, items, cost, complete, upperBound}`, `total`, `low`, `high`. Investissement unique : il reste dans les jauges. |
| `captureCost(family, netKind, ctx, {mountsPerCast?, jobLevel?})` | Prix du filet / montures par lancer, `canEquip`, `craftLocked?`. `findNet`, `NET_KIND_LABELS`, `DEFAULT_MOUNTS_PER_CAST`. |
| `makinaCost(kind, family, gen, ctx, rules?)` | Prix HDV ou craft (bêta 3.7) ; avec `ctx.jobLevel`, une makina hors de portée est payée au prix HDV (`craftLocked` sinon). Origine `marche` : `market` (`MarketPriceInfo` : date, statistique, volume) pour l'étiquette « marché (02/10) · N vendus/24 h » (Accouplement, `PriceOriginNote`). |
| `unlockedPaddockCount(jobLevel)` | Enclos débloqués (1 … 6). |

## `economy.ts` — Optimakina, accouplement, cycle, classement

| Export | Rôle |
|---|---|
| `OptimakinaMode = 'auto' \| 'toujours' \| 'jamais'`, `optimakinaMode(v)` | `true` (réglage « Optimakina ») = `'auto'`, `false` = `'jamais'`. `OPTIMAKINA_MODE_LABELS`. |
| `decideOptimakina({mode, base, withOpti, price, priceComplete, coupleCost, goalRelevant?}): OptimakinaDecision` | Même règle que l'Accouplement : prix < C_eff × Δ / p (C_eff = obtention + fécondation + XP − stériles, par couple) ; prix incomplet déjà au-dessus du seuil → non ; sinon heuristique **partagée** `optimakinaHeuristicUse` : cible ≥ `OPTIMAKINA_HEURISTIC_GENERATION` (6), ou étape G`OPTIMAKINA_GOAL_STEP_GENERATION` (4)–G5 de l'objectif ; jamais G2–G3 sans prix (même sur l'objectif). `{use, basis, gain, threshold, coupleCost, reason}` (raison commençant par « Optimakina … » / « Pas d'Optimakina … »). **Réutilisable par pairing/advisor.** |
| `matingEconomics(breedResult, {valueOf, makinaCost?, genetonValue, saleTax?})` | Valeur attendue des bébés (niv. 1), génétons (× (1 − `saleTax`) si fourni ; défaut 0 = ancien comportement), makina, net. |
| `sterileValue(id, level, refecund {low, high}, val, force?)` | max(vente, extraction, brisage, **½ × (clone fertile niv. 1 − refécondation)**) par stérile ; `force: 'cloner'` impose le clonage. |
| `assumedParents(speciesId)` | Arbre supposé « propre » : premier croisement connu. |
| `cycleProfit(cfg: CycleConfig): CycleResult` | Voir ci-dessous. |
| `crossingRanking(family, opts)` | Marge par accouplement = bébés + génétons nets + **valeur ajoutée aux parents** (stériles − valeur de départ, si `includeSteriles`, défaut vrai) − fécondité (lot typique par défaut) − XP − Optimakina (`optimakina: true` = règle auto). Lignes : `parentStartValue`, `parentDelta`, `parentComplete`, `optimakina` (décision), **`marginRange`** (afficher « ≤ » / fourchette / « inconnue »), `estimated`. Options : `batchModel`, `batchProfile`, `goalPath`. |
| `unpricedSignature(r)`, `cyclesComparable(a, b)` | Deux variantes ne se comparent que si elles ont les mêmes postes non chiffrés (badge « non comparable »). |
| `fullRateMatingsPerDay({jobLevel, batchSize, tier, xpTier?, parentLevel, parentStartLevel?, profile, rules})` | Accouplements par jour à plein régime : enclos débloqués × ⌊lot ÷ 2⌋ couples par tour (fécondité du lot + XP restante, même calcul que `cycleProfit`). |
| `COST_CATEGORY_LABELS`, `CASH_CATEGORIES`, `FATE_LABELS`, `MOUNT_PRICE_ORIGIN_LABELS` | Libellés FR. |

`CycleConfig` (en plus des champs historiques) : `optimakina: boolean | OptimakinaMode` (`true` = auto),
`batchModel` (défaut `'typique'`), `batchProfile` (vos lots), `parentValue: 'opportunite' | 'hors'`
(défaut : parents engagés comptés), `genetonOrigin` (`'joueur' | 'marche' | 'defaut'`), `goalPath`,
`serenityPointsPerMount` (défaut : celle du modèle), **`maxMarketShare`** (part du volume vendable, défaut
0,15 ; réglage du serveur `ServerEntry.maxMarketShare`).

`RankingOptions` : en plus, `maxMarketShare` et `matingsPerDay` (défaut `fullRateMatingsPerDay`). Avec un
marché (`ctx.market`), chaque `CrossingRank` porte **`liquidity`** (ventes à ce rythme : bébés et stériles
selon leur meilleur devenir, génétons), **`liquidityExceeded`** et `matingsPerDay`.

`CycleResult` :
- `materials` (catégories `fecondite`, `xp`, `makina`, `capture`, **`parents`** = valeur actuelle des
  parents non capturés, coût d'opportunité ; une ligne de carburant bornée par un palier supérieur garde
  l'objet du palier entretenu, « prix à saisir », `upperBound` hors total ; `craftLocked`) — chaque ligne
  porte `low`/`high` ;
- `totalCost` (parents compris), **`materialCost`** (dépenses), `costByCategory` (`high`), `revenue`
  (bébés `target`, stériles, génétons nets de taxe et `estimated` ; `reference` = vente non comptée) ;
- **`ranges`** `{cost, revenue, profit, kamasPerHour, roi}` et **`profitStatus`** (`'exact' | 'intervalle' |
  'borne-haute' | 'borne-basse' | 'inconnu'` — « inconnu » dès qu'une jauge de fécondité n'a aucun prix ni
  borne), **`unpricedFertility`** `{points, totalPoints, share, unboundedPoints, gauges, unboundedGauges}` ;
- **`initial`** (socle, `socleInvestment` × enclos utilisés) et **`firstCycleCash`** (dépenses + socle) ;
  le socle n'entre ni dans le bénéfice ni dans le ROI ;
- `seconds` (`fertility` du modèle de lot, `idealFertility`), `kamasPerHour`, `roi` (bénéfice / coûts),
  `costPerTargetBaby` (**brut** : dépenses ÷ bébés cibles), **`netCostPerTargetBaby`** = (coûts − bébés
  ratés − stériles) ÷ bébés cibles (formule strategy.json) et `netCostComplete` ;
- `optimakina` (décision), `batch`, `paddocks`/`paddocksUsed`/**`unlockedPaddocks`** (avertissement si plus
  d'enclos que débloqués), `estimated` + `estimates[]`, `assumptions`, `warnings`, `breedWithout` ;
- **`liquidity: LiquidityCheck[]`** (vide sans marché) : ventes par jour du cycle répété en continu
  (ressources extraites, montures vendues, runes Ga en équivalent de valeur, génétons écoulés en
  parchemins) face au volume du serveur ; un dépassement ajoute un avertissement « Liquidité (cycle répété en
  continu) — … » à `warnings` ; le revenu d'**un** cycle n'est pas modifié (ses ventes peuvent s'étaler) ;
- **ventes plafonnées** (cycle répété en continu, SPEC §3) : `profitCapped`, `kamasPerHourCapped`,
  `ranges.profitCapped`, `ranges.kamasPerHourCapped` et `cappedSales: CappedSale[]` (`itemId`, `name`, `kind`,
  `excessShare` = 1 − plafond ÷ ventes prévues, `removed`, `fallback`, `fallbackUnknown`) : la part au-delà de la
  part vendable du volume ne se vend pas au prix prévu — une **monture** en trop est extraite (génération ×
  ressource, taxe déduite ; une G1 ne rend rien ; ressource sans prix : repli non compté, borne haute = bénéfice
  non plafonné), une **ressource**, une **rune** ou un **généton** au-delà du plafond ne rapporte rien. Égal au
  bénéfice brut sans marché ou sans dépassement. La page Rentabilité affiche « Bénéfice plafonné (cycle en
  continu) » et « Kamas par heure plafonnés » à côté des valeurs brutes ;
- `revenue[].reference.kind` (`'marche'` : vente seulement plafonnée par l'HDV mixte).

## `economy.ts` — marché importé et liquidité

Le marché du serveur vient de `ctx.market` (`usePriceContext()`) ; aucune fonction n'en a besoin
(compatibilité). Règle des montures : **le prix d'un objet-monture (HDV mixte) n'est qu'un plafond de vente**
— voir `mountSalePrice` et `mountValuation` ci-dessus.

| Export | Rôle |
|---|---|
| `MarketLike` | `MarketSource` ou contexte de prix (`{market}`). |
| `salesCap(id, src, share = 0.15): SalesCap \| null` | Ce que le marché absorbe d'un objet par jour : `perDay` (fractionnaire = `share` × vendus_30j ÷ 30), `perDayFloor`, `kamasCap`, `perDayAvg`, `sold24`, `sold30`, `kamasPerDay`, `price`. null = objet absent (liquidité inconnue). Tylezia : Corne ≈ 636,7/jour. |
| `absorbablePerDay(id, src, share?)` | `salesCap(...).perDay` ou null. |
| `PlannedSale {itemId, perDay, kind?}`, `SaleKind`, `LiquidityCheck` | Ventes prévues et vérification (`cap`, `marketPerDay`, `marketShare`, `exceeds`, `message`). |
| `checkPlannedSales(sales, src, share?)` | Regroupe par objet, compare au plafond ; objet absent → `cap: null` avec message « liquidité inconnue » ; dépassements en premier. Sans marché : `[]`. |
| `genetonLiquidityCheck(genetonsPerDay, src, share?)` | Génétons face aux échanges reconfirmés de la boutique (Puissants Parchemins, `share` du volume de chacun), en génétons. |
| `genetonLiquidValue(...)` | Voir ci-dessus. |

## `economy.ts` — saisie des prix

| Export | Rôle |
|---|---|
| `normalizeName(s)` | Comparaison de noms (casse, accents, œ, apostrophes). |
| `findItemIdByName(name)`, `isKnownItem(id)` | Index des objets (ingrédients, recettes, objets à prix). |
| `parseKamas(s): number \| null` | « 12 000 », « 12.000 », « 12k », « 1,5 M », « 950 K » (symbole). |
| `parseBulkPrices(text): {entries, errors}` | Collage « Nom;Prix » / « id;prix » / « Nom prix ». |
| `buildPriceExport(snapshot, server, now?)`, `parsePriceExport(json)` | Export/import JSON des prix (format `elevagesimu-prix` v1, ou état brut du store). |
| `priceFileServerMismatch(fileServer, activeServerName)` | Le fichier de prix vient d'un **autre serveur** que celui du profil ouvert (noms comparés sans casse ni accents ; fichier sans serveur : non signalé). Prix › masse › « Importer un fichier… » demande alors confirmation (les prix saisis sont partagés par tous les profils du serveur, nommés dans la question). |
| `priceCoverage(ctx): CoverageStat[]` | Objets au prix complet : carburants, makinas, filets, ingrédients, ressources d'extraction. |
