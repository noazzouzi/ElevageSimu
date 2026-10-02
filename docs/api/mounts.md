# API — tranche « Montures » (`src/domain/mountFate.ts`, `src/ui/MountEditor.tsx`)

Sort conseillé de chaque monture possédée, et utilitaires d'inventaire (emplacements, places
d'enclos, captures groupées, clonage, extraction). Module pur (aucun React, aucun store), testé dans
`src/domain/mountFate.test.ts` (39 tests ; `src/ui/MountEditor.test.tsx` : 3 tests jsdom). Page associée : `src/ui/pages/MountsPage.tsx` (`#/montures`).

L'ascendance d'un objectif est `ancestorsOf(goalId)` de `breedingPath.ts` (déjà existante, réutilisée).

## Sort conseillé

La grille `STRATEGY.mountFateGrid` est appliquée **dans l'ordre** :

0. **plan d'accouplement** (`ctx.plannedPartners`, p. ex. `bestDisjointPairs(rankPairs(...))`) : une
   monture sans usage prévue au plan reçoit « Accoupler (plan) puis <sortie> » (`action: 'accoupler'`,
   `partnerId`, `exit` et `value` = sortie de la **stérile** après l'accouplement, raison « Après
   l'accouplement : … Ne la sortez pas avant ») — jamais une sortie immédiate ; une monture utile prévue
   au plan reste « Garder » avec la mention « Prévue au plan d'accouplement avec X » ;
1. **garder** : monture visée, ou fertile/féconde utile au plan (porteuse, recette, autre chemin). Le
   croisement proposé est **vérifié avec `breed()` sur l'arbre réel** de la monture (et de la partenaire
   trouvée) : si l'arbre détourne la génération cible, on prend un autre croisement dont la cible est bien
   l'enfant visé, sinon le texte dit « Arbre ≥ cible » ; la phrase donne la chance de l'enfant visé ;
2. **accoupler d'abord** : deux fécondes « condamnées » (hors plan) de sexes opposés et de même famille
   → bébé gratuit + XP, puis sortie des stériles (ligne 5 si G10 × G10). On ne vend les deux fécondes que
   si leurs prix sont des prix de décision **fiables** (les vôtres, ou un relevé de confiance moyenne ou
   haute) et rapportent plus que (stériles ensuite + bébé + génétons) ; la fiche dit alors « la vendre
   féconde rapporte plus que l'accoupler avec X » ;
3. **cloner** : stériles de même famille et même génération, même couleur d'abord (**même sexe et même
   arbre en priorité**, `pairForCloning` ; une porteuse ou un arbre propre n'est apparié à un autre arbre
   qu'à défaut d'alternative), puis deux couleurs utiles, puis utile + inutile (50 %) ; jamais deux
   inutiles. Texte : « résultat certain » seulement si couleur, sexe et arbre sont identiques, sinon
   « couleur certaine ; sexe et généalogie : ceux de la monture gardée (50/50) ». Stérile utile isolée →
   garder en attente. Objectif « profit » (`ctx.goal`) sans monture visée (ou autre famille) : une G1–G2
   n'est clonée que si le clone fertile vaut plus que les deux stériles (comparaison dans la raison ;
   prix incomplets → pas de clonage, sortie conseillée) ; dès `PROFIT_CLONE_MIN_GENERATION` (G3), on clone ;
4. **monter en niveau** : palier proche (≤ `maxLevelingXp`) parmi les relevés de brisage de la famille
   et les tranches de prix 100/200, si le gain net de carburant dépasse `minLevelingGain` × valeur actuelle.
   Le coût dépend du **lot réel** : candidates regroupées par (famille, palier), coût recalculé avec
   lot = min(10, taille du groupe) jusqu'à stabilité, puis réévaluation seule (lot de 1) ; la raison dit
   « si vous montez N montures ensemble ». Valeur actuelle incomplète → gain « au plus », `complete: false` ;
5. sinon **max(vente, extraction, brisage)** (net de taxe) ; aucun prix → `'a-chiffrer'`.
   Sénile : ligne 7 (jamais d'élevage, extraction = 1).

Sans objectif (ou pour une autre famille que celle de l'objectif) : toute G1–G9 qui peut encore
progresser est « parent possible » (gardée si fertile/féconde, clonée si une paire existe, sauf la règle
« profit » ci-dessus) ; les G10 sont sorties ; une couleur sans descendance de génération supérieure est
une **impasse** (« Impasse : aucune espèce de génération supérieure… », pas « G10 »).

| Signature | Rôle |
|---|---|
| `recommendFates(ctx: FateContext): Map<string, MountFate>` | Sort de chaque monture de `ctx.inventory` ; partenaires d'accouplement/clonage appariés sans doublon (réciproques). Valorisations mises en cache. |
| `recommendFate(mount: Mount, ctx: FateContext): MountFate` | Même résultat pour une seule monture (ajoutée à l'inventaire si absente). |
| `goalPlan(goalSpeciesId: number \| null \| undefined): GoalPlan \| null` | Recette la moins chère (`recipe`) + ascendance (`ancestors`) de l'objectif, mémorisé. |
| `mountUsefulness(m: Mount, plan: GoalPlan \| null): Usefulness` | `kind` : `'objectif' \| 'recette' \| 'ascendance' \| 'porteur' \| 'progression' \| 'aucune'`, `useful`, `detail` (FR), `crossings` (partenaire → enfant, les plus utiles d'abord), `carried` (porteuse). La porteuse est testée **avant** la recette et l'ascendance : ses croisements utiles sont ceux de l'espèce portée. |
| `cloneTreeKind(m): 'porteur' \| 'propre' \| 'ordinaire'` | Arbre d'une monture pour le clonage. |
| `pairForCloning(items, mountOf): { pairs, leftovers }` | Appariement de clonage d'une liste : même sexe et même arbre, puis arbres précieux entre eux, puis arbres ordinaires, puis le reste. Réutilisé par `pairing.sterileClonePairs`. |
| `PROFIT_CLONE_MIN_GENERATION = 3` | Objectif « profit » sans monture visée : clonage sans comparaison à partir de cette génération. |
| `fateState(m: Mount): { state: MountState; senile: boolean }` | État de prix pour `mountValuation` (sénile = stérile + 1 ressource). |
| `levelTargets(family: FamilyId): { level: number; kind: 'brisage' \| 'vente' }[]` | Paliers de valeur (relevés de brisage de la recherche + tranches 100/200). |
| `FATE_ACTIONS`, `FATE_ACTION_LABELS` | Actions et libellés FR. |
| `DEFAULT_MAX_LEVELING_XP = 40 000`, `DEFAULT_MIN_LEVELING_GAIN = 0,1` | Seuils (heuristiques documentées) de la règle « monter ». |

```ts
interface FateContext {
  inventory: Mount[]; goalSpeciesId: number | null; rules: Ruleset
  valuation: ValuationFn                       // (id, level, {state, senile}) => FateValuation — en pratique mountValuation
  levelCost?: LevelCostFn                      // (from, to, mount, batchSize) => {cost|null, complete, seconds?, tier?, batchSize?} — levelingCost(..., { batchSize }).costPerMount ; une fonction à 3 paramètres est supposée chiffrer un lot de 10 (texte « 10 montures ensemble »)
  genetonValue?: number                        // kamas par généton (bébé gratuit)
  maxLevelingXp?: number; minLevelingGain?: number
  plannedPartners?: Map<string, string>        // plan d'accouplement retenu : monture → partenaire
  goal?: 'profit' | 'succes' | 'mixte'         // settings.goal (règle de clonage « profit » sans monture visée)
}
type FateAction = 'garder' | 'accoupler' | 'cloner' | 'monter' | 'vente' | 'extraction' | 'brisage' | 'a-chiffrer'
interface MountFate {
  mountId: string; action: FateAction; label: string; reason: string   // FR, « pourquoi » complet
  value: number | null; valueNote: string      // kamas en suivant le conseil (voir ci-dessous)
  floor: number | null                         // meilleure sortie immédiate (plancher)
  floorComplete: boolean                       // toutes les sorties possibles chiffrées ; sinon `floor` est un
                                               // minimum (ex. G1 niv. 1 : brisage 0, vente sans prix) → « ≥ » ou
                                               // « prix de vente à saisir », jamais « ≈ »
  confidence: 'high' | 'medium' | 'low'; complete: boolean             // complete=false → « coût incomplet »
  rule: number                                 // ligne de STRATEGY.mountFateGrid (0 = cas particulier)
  partnerId?: string; targetLevel?: number; exit?: FateKind; usefulness: Usefulness; hint?: string
}
```

`value` : sortie → net de taxe ; monter → valeur au palier − carburant (lot réel) ; accoupler → valeur de
la stérile ensuite + ½ (bébé attendu + génétons) ; accoupler (plan) → valeur de la stérile ensuite (hors
bébé) ; garder / cloner → `null` (afficher `floor`, « ≥ » ou « prix à saisir » si `!floorComplete` ; la
« Valeur de sortie » de Mes montures compte les montures sans prix de vente et n'affiche jamais 0 K comme certain).
`FateValuation` = `Pick<MountValuation, 'best' | 'bestKind' | 'complete' | 'confidence' | 'sale' | 'extraction' | 'brisage'>`.

Branchement type (page) :

```ts
const valuation: ValuationFn = (id, level, o) => mountValuation(id, level, { ctx, mountPrices: mctx, saleTax, state: o.state, senile: o.senile })
// Surplus : lot réel (batchSize fourni par recommendFates) et palier le moins cher (1 = Extraits, C-BREAK-01).
const levelCost: LevelCostFn = (from, to, m, batchSize) => {
  const c = levelingCost(from, to, { tier: 1, batchSize, sage: m.ability === 'sage', ctx, rules, jobLevel })
  return { cost: c.costPerMount, complete: c.complete, seconds: c.secondsPerBatch, tier: 1 }
}
const plan = bestDisjointPairs(rankPairs(mounts, pairingOpts))
const plannedPartners = new Map(plan.flatMap((p) => [[p.a.id, p.b.id], [p.b.id, p.a.id]]))
const fates = recommendFates({ inventory: mounts, goalSpeciesId, rules, valuation, levelCost, genetonValue, plannedPartners, goal: settings.goal })
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
| `captureBlockers(lines: CaptureLine[]): string[]`, `capturedMounts(lines, {serenity?, serenities?, location?})` | Captures groupées : G1 capturables seulement ; crée des G1 niveau 1, jauges à 0 (`CaptureLine = {speciesId, males, females}`). `serenities` : sérénité de **chaque** monture (ordre de `captureSlots`, null = valeur commune `serenity`). |
| `captureSlots(lines): CaptureSlot[]` | Montures d'une session de capture dans l'ordre de création (`{line, speciesId, gender, index, key}`) : sert à saisir la sérénité monture par monture. |
| `clonePatch(kept, rules)` | Après clonage : fertile, E/M/A à 0, capacité perdue, sérénité 0 (ou conservée si `rules.cloneKeepsSerenity`). |
| `extractionQuantity(m)`, `extractionResource(m)` | Génération (G1 = 0, sénile = 1, spéciale = 0) ; Neurone / Ambre / Corne. |
| `inventorySummary(mounts): InventorySummary` | Totaux par famille, statut, génération ; couples ♂/♀ féconds ; fécondes en enclos ; occupation ; étable ; inventaire. |

## Composants (`src/ui/MountEditor.tsx`)

| Export | Rôle |
|---|---|
| `MountEditor({ mount?, initial?, onSave(data: NewMount, id \| null), onCancel, onDelete? })` | Fenêtre de création/modification : couleur, sexe, niveau, capacité, statut (féconde déduite des jauges, bouton « Rendre féconde »), sérénité (curseur + smileys), E/M/A (0–20 000, « 0 » / « Max »), deux parents, emplacement (enclos limités au niveau d'Éleveur et à 10 places), nom, notes ; validation en français. La persistance revient à l'appelant (`useInventory().add/update`). |
| `Modal({ title, onClose, children, footer?, wide? })` | Fenêtre modale accessible (Échap). Focus sur le premier champ **à l'ouverture seulement**, rendu à l'élément précédent à la fermeture ; un nouveau rendu du parent (nouvelle fonction `onClose`) ne déplace plus le focus. |
| `SmileyPicker({ value, onChange, label, allowUnknown?, mixed? })` | Choix rapide de la sérénité d'après le smiley (milieu de la zone, valeur exacte gardée si même zone ; « ? » = inconnue). |
| `SerenitySmiley({ serenity, withValue? })`, `GaugeBars({ mount })`, `StatusBadge({ status })` | Affichages réutilisables. |

Page `MountsPage.tsx` : le sort conseillé reçoit le plan d'accouplement (mêmes réglages que l'Accueil),
`settings.goal` et un coût d'XP par lot réel au palier de Mangeoire le moins cher (1 ou votre palier) ;
les captures se saisissent avec le smiley de **chaque** monture (ou une valeur exacte, « Appliquer à
toutes ») ; le bouton « Sérénité rapide » du tableau remplace la sérénité de chaque ligne par des boutons
smiley. Actions groupées (sélection affichée seulement), chacune en **une** écriture (`updateMany` /
`removeMany`) : Déplacer…, **Marquer féconde** (fertiles : E/M/A au maximum, lot rendu fécond en jeu),
Marquer stérile, **Définir le niveau…** (niveau lu en jeu, 1–200), Cloner…, Extraire…, Vendre…, Supprimer….

Liens entrants vers la page : `#/montures?famille=muldo&statut=feconde&lieu=enclos-1&generation=3&sort=cloner&q=…`,
`?ajout=1` (ouvre l'éditeur), `?captures=1` (ouvre les captures), `?id=<monture>` (édite une monture).
