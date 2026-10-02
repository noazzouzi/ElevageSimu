# API — tranche « Montures » (`src/domain/mountFate.ts`, `src/ui/MountEditor.tsx`)

Sort conseillé de chaque monture possédée, et utilitaires d'inventaire (emplacements, places
d'enclos, captures groupées, clonage, extraction). Module pur (aucun React, aucun store), testé dans
`src/domain/mountFate.test.ts` (23 tests). Page associée : `src/ui/pages/MountsPage.tsx` (`#/montures`).

L'ascendance d'un objectif est `ancestorsOf(goalId)` de `breedingPath.ts` (déjà existante, réutilisée).

## Sort conseillé

La grille `STRATEGY.mountFateGrid` est appliquée **dans l'ordre** :

1. **garder** : monture visée, ou fertile/féconde utile au plan (recette, autre chemin, porteuse) ;
2. **accoupler d'abord** : deux fécondes « condamnées » (hors plan) de sexes opposés et de même famille
   → bébé gratuit + XP, puis sortie des stériles (ligne 5 si G10 × G10). Si vendre les deux fécondes
   rapporte plus que (stériles ensuite + bébé + génétons), on vend ;
3. **cloner** : stériles de même famille et même génération, même couleur d'abord, puis deux couleurs
   utiles, puis utile + inutile (50 %) ; jamais deux inutiles. Stérile utile isolée → garder en attente ;
4. **monter en niveau** : palier proche (≤ `maxLevelingXp`) parmi les relevés de brisage de la famille
   et les tranches de prix 100/200, si le gain net de carburant dépasse `minLevelingGain` × valeur actuelle ;
5. sinon **max(vente, extraction, brisage)** (net de taxe) ; aucun prix → `'a-chiffrer'`.
   Sénile : ligne 7 (jamais d'élevage, extraction = 1).

Sans objectif (ou pour une autre famille que celle de l'objectif) : toute G1–G9 est « parent possible »
(gardée si fertile/féconde, clonée si une paire existe) ; les G10 sont sorties.

| Signature | Rôle |
|---|---|
| `recommendFates(ctx: FateContext): Map<string, MountFate>` | Sort de chaque monture de `ctx.inventory` ; partenaires d'accouplement/clonage appariés sans doublon (réciproques). Valorisations mises en cache. |
| `recommendFate(mount: Mount, ctx: FateContext): MountFate` | Même résultat pour une seule monture (ajoutée à l'inventaire si absente). |
| `goalPlan(goalSpeciesId: number \| null \| undefined): GoalPlan \| null` | Recette la moins chère (`recipe`) + ascendance (`ancestors`) de l'objectif, mémorisé. |
| `mountUsefulness(m: Mount, plan: GoalPlan \| null): Usefulness` | `kind` : `'objectif' \| 'recette' \| 'ascendance' \| 'porteur' \| 'progression' \| 'aucune'`, `useful`, `detail` (FR), `crossings` (partenaire → enfant, les plus utiles d'abord), `carried` (porteuse). |
| `fateState(m: Mount): { state: MountState; senile: boolean }` | État de prix pour `mountValuation` (sénile = stérile + 1 ressource). |
| `levelTargets(family: FamilyId): { level: number; kind: 'brisage' \| 'vente' }[]` | Paliers de valeur (relevés de brisage de la recherche + tranches 100/200). |
| `FATE_ACTIONS`, `FATE_ACTION_LABELS` | Actions et libellés FR. |
| `DEFAULT_MAX_LEVELING_XP = 40 000`, `DEFAULT_MIN_LEVELING_GAIN = 0,1` | Seuils (heuristiques documentées) de la règle « monter ». |

```ts
interface FateContext {
  inventory: Mount[]; goalSpeciesId: number | null; rules: Ruleset
  valuation: ValuationFn                       // (id, level, {state, senile}) => FateValuation — en pratique mountValuation
  levelCost?: LevelCostFn                      // (from, to, mount) => {cost|null, complete, seconds?} — en pratique levelingCost().costPerMount
  genetonValue?: number                        // kamas par généton (bébé gratuit)
  maxLevelingXp?: number; minLevelingGain?: number
}
type FateAction = 'garder' | 'accoupler' | 'cloner' | 'monter' | 'vente' | 'extraction' | 'brisage' | 'a-chiffrer'
interface MountFate {
  mountId: string; action: FateAction; label: string; reason: string   // FR, « pourquoi » complet
  value: number | null; valueNote: string      // kamas en suivant le conseil (voir ci-dessous)
  floor: number | null                         // meilleure sortie immédiate (plancher)
  confidence: 'high' | 'medium' | 'low'; complete: boolean             // complete=false → « coût incomplet »
  rule: number                                 // ligne de STRATEGY.mountFateGrid (0 = cas particulier)
  partnerId?: string; targetLevel?: number; exit?: FateKind; usefulness: Usefulness; hint?: string
}
```

`value` : sortie → net de taxe ; monter → valeur au palier − carburant ; accoupler → valeur de la
stérile ensuite + ½ (bébé attendu + génétons) ; garder / cloner → `null` (afficher `floor`).
`FateValuation` = `Pick<MountValuation, 'best' | 'bestKind' | 'complete' | 'confidence' | 'sale' | 'extraction' | 'brisage'>`.

Branchement type (page) :

```ts
const valuation: ValuationFn = (id, level, o) => mountValuation(id, level, { ctx, mountPrices: mctx, saleTax, state: o.state, senile: o.senile })
const levelCost: LevelCostFn = (from, to, m) => {
  const c = levelingCost(from, to, { tier: preferredTier, batchSize: 10, sage: m.ability === 'sage', ctx, rules, jobLevel })
  return { cost: c.costPerMount, complete: c.complete, seconds: c.secondsPerBatch }
}
const fates = recommendFates({ inventory: mounts, goalSpeciesId, rules, valuation, levelCost, genetonValue })
```

## Inventaire

| Signature | Rôle |
|---|---|
| `SERENITY_SMILEYS`, `SERENITY_BANDS`, `serenitySmiley(serenity)` | Smileys du jeu : rouge :C (< −2 000), bleu :( (−2 000…−1), violet :) (0…2 000), vert :D (> 2 000). |
| `SERENITY_BAND_MIDPOINT` | Valeur approchée d'une zone quand seul le smiley est connu (ESTIMATION : −3 500 / −1 000 / 1 000 / 3 500). |
| `locationKey(loc)`, `parseLocationKey(key)`, `locationLabel(loc)` | `'etable' \| 'inventaire' \| 'enclos-N'` ↔ `MountLocation` ; libellé FR. |
| `unlockedPaddocks(jobLevel): number` | Enclos débloqués (niveaux 1/40/80/120/160/200). |
| `paddockOccupancy(mounts): Map<number, number>` | Montures par enclos 1…6. |
| `moveBlockers(mounts, ids, dest, {jobLevel, stableSlots}): string[]` | Enclos verrouillé, 10 places par enclos (les montures déjà présentes ne comptent pas deux fois), étable pleine. |
| `captureBlockers(lines: CaptureLine[]): string[]`, `capturedMounts(lines, {serenity?, location?})` | Captures groupées : G1 capturables seulement ; crée des G1 niveau 1, jauges à 0 (`CaptureLine = {speciesId, males, females}`). |
| `clonePatch(kept, rules)` | Après clonage : fertile, E/M/A à 0, capacité perdue, sérénité 0 (ou conservée si `rules.cloneKeepsSerenity`). |
| `extractionQuantity(m)`, `extractionResource(m)` | Génération (G1 = 0, sénile = 1, spéciale = 0) ; Neurone / Ambre / Corne. |
| `inventorySummary(mounts): InventorySummary` | Totaux par famille, statut, génération ; couples ♂/♀ féconds ; fécondes en enclos ; occupation ; étable ; inventaire. |

## Composants (`src/ui/MountEditor.tsx`)

| Export | Rôle |
|---|---|
| `MountEditor({ mount?, initial?, onSave(data: NewMount, id \| null), onCancel, onDelete? })` | Fenêtre de création/modification : couleur, sexe, niveau, capacité, statut (féconde déduite des jauges, bouton « Rendre féconde »), sérénité (curseur + smileys), E/M/A (0–20 000, « 0 » / « Max »), deux parents, emplacement (enclos limités au niveau d'Éleveur et à 10 places), nom, notes ; validation en français. La persistance revient à l'appelant (`useInventory().add/update`). |
| `Modal({ title, onClose, children, footer?, wide? })` | Fenêtre modale accessible (Échap). |
| `SerenitySmiley({ serenity, withValue? })`, `GaugeBars({ mount })`, `StatusBadge({ status })` | Affichages réutilisables. |

Liens entrants vers la page : `#/montures?famille=muldo&statut=feconde&lieu=enclos-1&generation=3&sort=cloner&q=…`,
`?ajout=1` (ouvre l'éditeur), `?captures=1` (ouvre les captures), `?id=<monture>` (édite une monture).
