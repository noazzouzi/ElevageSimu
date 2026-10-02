# API — Économie (`src/domain/fuel.ts`, `src/domain/economy.ts`)

Logique pure (aucun React, aucun store). Les pages construisent les contextes depuis les stores :

```ts
const ctx = usePriceContext()                                   // PriceContext (prix objets)
const mctx: MountPriceContext = {                              // prix des montures
  mountOverrides: usePrices((s) => s.mounts),
  generationOverrides: usePrices((s) => s.generations),
  useDefaults: useSettings((s) => s.useDefaultPrices),
}
const rules = useRules(); const jobLevel = useSettings((s) => s.jobLevel)
const genetonValue = genetonKamasValue(usePrices((s) => s.genetonValue)).value
```

**Règle commune** : un prix inconnu n'est jamais 0. Les fonctions renvoient `complete: false`, une
valeur partielle (borne basse) ou `null`, et la liste `missing` des ids d'objets à chiffrer
(lien : `href('prix', { q: itemName(id) })`). La page Prix accepte aussi `onglet=carburants|makinas|filets|ingredients|montures|masse`.

## `fuel.ts` — carburants

| Export | Rôle |
|---|---|
| `FUEL_TIERS`, `FUEL_SIZE_LABELS` | Paliers 1-4, libellés des tailles. |
| `fuelDurability(fuel, rules): number` | Durabilité × `rules.fuelDurabilityFactor` (×2 en 3.7). |
| `tierCap(tier, rules): number` | Plafond de dépôt du palier (`rules.gaugeTierMax`). |
| `canDeposit(v, fuel, rules)` / `depositFuel(v, fuel, rules): {value, added, wasted} \| null` | Règle de dépôt : seulement sous le plafond ; `min(plafond, v + durabilité)`, excédent perdu. |
| `fuelsOf(gauge, tier?)`, `findFuel(gauge, tier, size)`, `fuelTierName(tier)` | Accès aux 120 carburants. |
| `fuelOption(fuel, ctx, {jobLevel, rules}): FuelOption` | Prix retenu (`resolvePrice` : joueur > défaut > craft), durabilité, `costPerPoint`, `market`, `craft`, `canCraft`, `craftPriceOnly`. |
| `fuelOptions(gauge, tier, ctx, opts): FuelOption[]` | Les 5 tailles d'une jauge/palier. |
| `bestFuel(gauge, tier, ctx, opts & {exactTier?, craftableOnly?}): GaugePointCost` | Carburant le moins cher au point pour entretenir ce palier (paliers ≥ acceptés). `complete` seulement si un carburant du palier est chiffré ; sinon `bound: 'max'` (palier supérieur) ou `'min'` (ingrédients partiels) et `toPrice` = carburant à chiffrer. Repli « estimation » (`estimated: true`) sur `valuation.fuelCostPerGaugePointDefaults` pour la **Mangeoire seulement**. |
| `costPerGaugePoint(...)` | Alias de `bestFuel`. |
| `defaultMangeoirePointCost(tier, rules)` | Coût au point par défaut de la recherche (÷ facteur de durabilité). |
| `fillPlan(gauge, from, to, ctx, opts): FillPlan` | Plan de dépôts le moins cher de `from` à `to` respectant les plafonds (Dijkstra lexicographique : objets chiffrés, kamas, gaspillage, nombre). `steps` dans l'ordre, `items` agrégés, `cost`, `complete`, `waste`, `overshoot`. |
| `dustOption(gauge, tier, rules): DustOption \| null` | Gigantesque contre poussière chez Adèle Vage (`legacy: true`, aucune nouvelle source). |

## `economy.ts` — valeur des montures

| Export | Rôle |
|---|---|
| `mountBand(level): '1' \| '100' \| '200'`, `MOUNT_BANDS` | Tranche de prix la plus proche. |
| `mountSalePrice(speciesId, level, mctx, {state?}): MountSalePrice` | Prix brut : joueur couleur `${id}\|${band}` > joueur génération `${family}\|${gen}\|${band}` > défaut nom exact > défaut famille/génération. Les planchers de la recherche (`isFloor`) sont ramenés à la revente de base (déjà nette de taxe) pour ne pas recompter extraction/brisage. `state`: `'fertile'` (défaut), `'feconde'`, `'sterile'`. |
| `defaultGenerationPrice(family, gen, band, state?)`, `defaultSpeciesPrice(id, band)` | Ligne de prix par défaut (affichage). |
| `extractionValue(speciesId, ctx, {senile?}): ExtractionValue` | `qty` (= génération ; G1 = 0 ; sénile = 1) × prix Neurone/Ambre/Corne (brut). |
| `brisageValue(family, level, ctx?): BrisageValue` | Rendements observés interpolés (45/53/100/200), extrapolés de 0 (niv. 35) à 45, mis à l'échelle du prix de la rune Ga (`BRISAGE_RUNE`). Dragodindes : `possible: false`. `BRISAGE_RISK_NOTE` = risque de correctif. |
| `mountValuation(speciesId, level, {ctx, mountPrices, saleTax, state?, senile?}): MountValuation` | `sale`, `extraction`, `brisage` (nets de taxe), `best`, `bestKind`, `confidence`, `complete`. À égalité : extraction > brisage > vente. |
| `genetonKamasValue(override?): GenetonValue` | 375 K par défaut (plage 125-725), ou la valeur saisie. |

## `economy.ts` — coûts

| Export | Rôle |
|---|---|
| `DEFAULT_SERENITY_POINTS = 3200` | Points Baffeur + Caresseur par lot (moyenne du planificateur, sérénité de départ uniforme ; ESTIMATION). |
| `fertilitySeconds(tier, rules, serenity?)` | ≈ (40 000 + ½ sérénité) / débit × 10 s (calé sur `planFertility`). |
| `xpOverlapPoints(tier, xpTier, rules)` | Points de Mangeoire gagnés pendant la phase d'amour. |
| `fertilityCost({tier, batchSize, serenityPointsPerMount?, ctx, rules, jobLevel?}): FertilityCost` | 20 000 pts Foudroyeur/Abreuvoir/Dragofesse + sérénité (½ Baffeur, ½ Caresseur) par lot ; `lines` par jauge (`pointCost` = `bestFuel`), `perBatch`, `perMount`, `complete`, `missing`, `secondsPerBatch`. |
| `levelingCost(from, to, {tier, batchSize, sage?, ctx, rules, jobLevel?}): LevelingCost` | XP monture (table DPLN), points de Mangeoire du lot (÷2 Sage), coût par lot/monture, durée. |
| `captureCost(family, netKind, ctx, {mountsPerCast?, jobLevel?}): CaptureCost` | Prix du filet / montures par lancer (`DEFAULT_MOUNTS_PER_CAST`), `canEquip`, 30 XP/capture. `findNet`, `NET_KIND_LABELS`. |
| `makinaCost(kind, family, gen, ctx, rules?): MakinaCost` | Prix HDV ou craft (recette bêta en 3.7) ; génération bornée 2-10. |

## `economy.ts` — rentabilité

| Export | Rôle |
|---|---|
| `matingEconomics(breedResult, {valueOf(id, level), makinaCost?, genetonValue}): MatingEconomics` | Valeur attendue des bébés (niv. 1), génétons, makina, net, `missingSpecies`. |
| `assumedParents(speciesId): number[]` | Arbre supposé « propre » : premier croisement connu (G1 : aucun). |
| `cycleProfit(cfg: CycleConfig): CycleResult` | Calculateur « Rentabilité d'un cycle » : `materials` (carburants par jauge en objets entiers, makinas, filets), `costByCategory`, `totalCost`, `revenue` (bébés par espèce, stériles « meilleur » ou « cloner », génétons), `profit`, `seconds`, `kamasPerHour`, `roi`, `expectedTargetBabies`, `costPerTargetBaby`, `jobXp`, `missingItems`, `missingSpecies`, `assumptions`, `warnings`, `complete`. Lots : `ceil(2·couples / batchSize)` (un lot incomplet coûte autant). |
| `crossingRanking(family, opts: RankingOptions): CrossingRank[]` | Marge attendue par accouplement pour chaque croisement (bébés + génétons + stériles − fécondité − XP − Optimakina), drapeaux de complétude, trié par marge. |
| `COST_CATEGORY_LABELS`, `FATE_LABELS`, `MOUNT_PRICE_ORIGIN_LABELS` | Libellés FR. |

## `economy.ts` — saisie des prix

| Export | Rôle |
|---|---|
| `normalizeName(s)` | Comparaison de noms (casse, accents, œ, apostrophes). |
| `findItemIdByName(name)`, `isKnownItem(id)` | Index des objets (ingrédients, recettes, objets à prix). |
| `parseKamas(s): number \| null` | « 12 000 », « 12.000 », « 12k », « 1,5 M », « 950 K » (symbole). |
| `parseBulkPrices(text): {entries, errors}` | Collage « Nom;Prix » / « id;prix » / « Nom prix ». |
| `buildPriceExport(snapshot, server, now?)`, `parsePriceExport(json)` | Export/import JSON des prix (format `elevagesimu-prix` v1, ou état brut du store). |
| `priceCoverage(ctx): CoverageStat[]` | Objets au prix complet : carburants, makinas, filets, ingrédients, ressources d'extraction. |
