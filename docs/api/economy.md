# API — Économie (`src/domain/pricing.ts`, `src/domain/fuel.ts`, `src/domain/economy.ts`)

Logique pure (aucun React, aucun store). Les pages construisent les contextes depuis les stores :

```ts
const ctx = usePriceContext()                                  // PriceContext (prix objets + niveau d'Éleveur, jobLevel inclus)
const mctx: MountPriceContext = {                              // prix des montures
  mountOverrides: usePrices((s) => s.mounts),
  generationOverrides: usePrices((s) => s.generations),
  useDefaults: useSettings((s) => s.useDefaultPrices),
}
const rules = useRules(); const jobLevel = useSettings((s) => s.jobLevel)
const g = genetonKamasValue(usePrices((s) => s.genetonValue))  // g.value (brut), g.origin
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
| `marketPrice(id, ctx)` | Prix joueur, sinon défaut (sans craft). |
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
| `bestFuel(gauge, tier, ctx, opts & {exactTier?, craftableOnly?}): GaugePointCost` | Carburant le moins cher au point pour entretenir ce palier (paliers ≥ acceptés). `complete` seulement si un carburant du palier est chiffré ; sinon `bound: 'max'` (palier supérieur) ou `'min'` (ingrédients partiels) et `toPrice` = carburant à chiffrer. Repli « estimation » (`estimated: true`) sur `valuation.fuelCostPerGaugePointDefaults` pour la **Mangeoire seulement**. |
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
| `mountSalePrice(speciesId, level, mctx, {state?}): MountSalePrice` | Prix **brut** de décision : ancrages aux niveaux 1/100/200 (votre prix couleur > votre prix génération > relevé par défaut fiable par nom > par génération), **interpolés** entre deux ancrages (`method: 'interpolation'`, `estimated`), prix du palier inférieur au-dessus du dernier (`'palier-inferieur'`, estimation prudente), **jamais** un prix de niveau supérieur appliqué en dessous (`price: null`). Planchers, relevés anciens/peu fiables : `price: null` et `references[]` (`{price, net, level, kind, reason}`), affichées « à saisir / non comptées ». `isFloor` est obsolète (toujours faux). |
| `defaultGenerationPrice(family, gen, band, state?)`, `defaultSpeciesPrice(id, band)` | Ligne de prix par défaut (affichage ; plancher ramené à la revente de base). |
| `extractionValue(speciesId, ctx, {senile?})` | `qty` (= génération ; G1 = 0 ; sénile = 1) × prix Neurone/Ambre/Corne (brut). |
| `brisageValue(family, level, ctx?)` | Rendements observés interpolés (45/53/100/200), extrapolés de 0 (niv. 35) à 45, mis à l'échelle de la rune Ga. Dragodindes : `possible: false`. `BRISAGE_RISK_NOTE`. |
| `mountValuation(speciesId, level, {ctx, mountPrices, saleTax, state?, senile?}): MountValuation` | `sale`, `extraction`, `brisage` (nets de taxe), `best`, `bestKind`, `confidence`, `complete`, **`estimated`**. Vente sans prix de décision : `sale.net = null`, **`sale.reference`** `{net, kind, reason}` (jamais comptée) → `complete: false`, `best` = borne basse. À égalité : extraction > brisage > vente. |
| `genetonKamasValue(override?)` | Valeur **brute** d'un généton : 375 K par défaut (plage 125-725) ou la vôtre ; les calculs la comptent nette de la taxe (parchemin revendu). |

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
| `makinaCost(kind, family, gen, ctx, rules?)` | Prix HDV ou craft (bêta 3.7) ; avec `ctx.jobLevel`, une makina hors de portée est payée au prix HDV (`craftLocked` sinon). |
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
| `COST_CATEGORY_LABELS`, `CASH_CATEGORIES`, `FATE_LABELS`, `MOUNT_PRICE_ORIGIN_LABELS` | Libellés FR. |

`CycleConfig` (en plus des champs historiques) : `optimakina: boolean | OptimakinaMode` (`true` = auto),
`batchModel` (défaut `'typique'`), `batchProfile` (vos lots), `parentValue: 'opportunite' | 'hors'`
(défaut : parents engagés comptés), `genetonOrigin`, `goalPath`, `serenityPointsPerMount` (défaut : celle
du modèle).

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
  d'enclos que débloqués), `estimated` + `estimates[]`, `assumptions`, `warnings`, `breedWithout`.

## `economy.ts` — saisie des prix

| Export | Rôle |
|---|---|
| `normalizeName(s)` | Comparaison de noms (casse, accents, œ, apostrophes). |
| `findItemIdByName(name)`, `isKnownItem(id)` | Index des objets (ingrédients, recettes, objets à prix). |
| `parseKamas(s): number \| null` | « 12 000 », « 12.000 », « 12k », « 1,5 M », « 950 K » (symbole). |
| `parseBulkPrices(text): {entries, errors}` | Collage « Nom;Prix » / « id;prix » / « Nom prix ». |
| `buildPriceExport(snapshot, server, now?)`, `parsePriceExport(json)` | Export/import JSON des prix (format `elevagesimu-prix` v1, ou état brut du store). |
| `priceCoverage(ctx): CoverageStat[]` | Objets au prix complet : carburants, makinas, filets, ingrédients, ressources d'extraction. |
