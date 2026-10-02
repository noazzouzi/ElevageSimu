# API — tranche « Enclos » (`src/domain/paddockAssign.ts`, `src/domain/paddockPlanStatus.ts`, `src/store/paddocks.ts`, `src/store/paddockPlans.ts`, `src/ui/alarms.tsx`)

Répartition automatique des montures dans les enclos, plan de fécondité d'un lot sans micro-étapes,
conseils de recharge de carburant, chronologie d'une simulation et suivi d'un plan démarré (heures
absolues, prochain changement de jauges, retard). Module pur (aucun React, aucun store), testé dans
`src/domain/paddockAssign.test.ts`. S'appuie sur `planFertility`/`decideGauges`/`splitLot`
(`fertility.ts`), `simulatePaddock`/`canBenefit` (`paddock.ts` ; `simulatePaddock` borne les niveaux d'entrée au plafond des règles actives, comme `gaugeDrainSeconds`), `fillPlan`/`bestFuel` (`fuel.ts`),
`effectiveFertility` (`mounts.ts`), `SERENITY_SMILEYS` (`mountFate.ts`) et
`STRATEGY.paddockAllocationByCount`.

Projections « maintenant » (jauges vidées depuis la saisie, montures d'un plan démarré) :
`src/domain/projection.ts`, voir [projection.md](projection.md).

Page associée : `src/ui/pages/PaddocksPage.tsx` (`#/enclos`). Paramètres de route : `enclos`
(1…6, enclos affiché) et `onglet=repartition` (répartition automatique).

## Règles appliquées

- 10 places par enclos ; une jauge consomme autant avec 1 ou 10 montures éligibles → viser
  10 éligibles par jauge active (E-FULL-01).
- Lots dans une fenêtre de sérénité de 2 000 au plus (E-GROUP-01), regroupés par phase (même paire de
  jauges, `decideGauges`), lots incomplets fusionnés s'ils partagent une jauge : du même côté de 0
  d'abord, à travers 0 seulement s'il manque des enclos (un lot qui chevauche 0 dure ≈ 2 fois plus).
- Lots pleins placés d'abord, puis les plus proches de la fécondité ; un lot va de préférence dans
  l'enclos où ses montures sont déjà. Les montures déjà en enclos y restent (option `keepCurrent`).
- Places libres complétées par des montures à monter en niveau quand le plan utilise la Mangeoire ;
  un enclos sans lot devient un enclos « Mangeoire ». Fécondes, stériles, séniles et montures
  d'enclos verrouillés sortent vers l'étable (l'accouplement se fait depuis l'étable).

## Rôles et utilitaires

| Signature | Rôle |
|---|---|
| `BATCH_SERENITY_WINDOW = 2000`, `DEFAULT_LEVEL_TARGET = 40` | Largeur max d'un lot ; niveau visé par défaut des parents. |
| `type PaddockRole = 'bleu' \| 'violet' \| 'rouge' \| 'vert' \| 'station-caresseur' \| 'station-baffeur' \| 'finition' \| 'xp' \| 'vide'`, `PADDOCK_ROLE_LABELS` | Rôle d'un enclos et libellé FR (« Groupe bleu :( — Foudroyeur + Abreuvoir »…). |
| `paddockRole(gauges: GaugeId[]): PaddockRole` | Rôle d'après les jauges de la phase en cours. |
| `allocationAdvice(paddocks: number): string \| null` | Organisation conseillée par la recherche pour ce nombre d'enclos. |
| `needsFertility(m: Mount): boolean` | Fertile (pas encore féconde), ni stérile ni sénile, espèce élevable. |
| `toSimMount(m: Mount): SimMount` | Monture du simulateur ; stériles/séniles vues « pleines » (E/M/A max), `canGainXp = niveau < 200`. |
| `toFillerSim(m: Mount): SimMount` | Complément XP : pleine pour le planificateur, profite de la Mangeoire. |
| `xpSeconds(from, to, {tier, rules, ability?, almanaxDoubled?}): number` | Secondes de Mangeoire entretenue pour passer du niveau `from` à `to` (Sage ×2, Almanax ×2). |

## Plan d'un lot

| Signature | Rôle |
|---|---|
| `planPaddock(mounts: SimMount[], opts: FertilityOptions): FertilityPlan` | **À utiliser à la place de `planFertility`** pour un enclos : corrige les traversées de 0 qui alternent toutes les 10 s à 2 min (poussée maintenue jusqu'à ce que tout le lot ait traversé, ou « finir sur place » la statistique que la traversée ferait perdre), puis : paliers par jauge (ci-dessous), étapes consécutives de mêmes jauges **fusionnées** (« Monter l'amour, puis finir l'amour… »), étapes non finales plus courtes que `minStepSeconds` **allongées** quand c'est sans danger (aucune monture ne sort de sa zone ni ne perd son côté de 0 ; plan replanifié ensuite ; refusé si le lot ne finit plus fécond ou si le plan s'allonge de plus de deux fois l'allongement), `converges` et `split`. |
| `compareTiers(mounts, opts, refill: Omit<RefillOptions,'tier'> & {gauges}): TierOption[]` | Paliers 1 à 4 côte à côte : `{tier, plan, refill}` (durée, carburant consommé, socle). Pour le tableau de choix du palier. |
| `DEFAULT_MIN_STEP_SECONDS = 300`, `SOCLE_MIN_SHARE = 0.1` | Durée minimale d'étape par défaut ; part du socle sous laquelle une consommation ne justifie pas de socle. |

`FertilityOptions` (`fertility.ts`) :

```ts
{ tier: FuelTier                      // jauges de statistiques + Mangeoire (settings.preferredTier)
  serenityTier?: FuelTier             // Baffeur/Caresseur, défaut 1 (peu consommées, pas de socle, s'arrêtent seules)
  tierByGauge?: Partial<Record<GaugeId, FuelTier>>   // paliers imposés (jamais rétrogradés)
  withXp?: boolean
  startMs?: number                    // heure absolue du début : Almanax limité aux ticks du jour Almanax (jour de jeu, heure de Paris)
  almanaxDoubled?: GaugeId | null     // sans startMs : doublement sur tout le plan (ancien comportement)
  applyAlmanax?: boolean              // défaut oui au niveau du moteur ; l'appli passe settings.almanaxGaugeDoubling (défaut non : effet non vérifié en jeu)
  maxSeconds?: number; rules?: Ruleset
  minStepSeconds?: number             // planPaddock : défaut 300 ; brancher settings.checkIntervalMinutes × 60
  gaugeLevels?: Partial<Record<GaugeId, number>>     // planPaddock : niveaux actuels (socle utile ou non)
}
```

Paliers : `gaugeTiers(opts)` = `tierByGauge`, sinon `serenityTier ?? 1` pour Baffeur/Caresseur, sinon
`tier`. Puis `planPaddock` rétrograde une jauge non imposée que le plan consomme peu (< 10 % du bas du
palier) et qui est sous le bas du palier (`gaugeLevels`, défaut 0) : pas de socle de 40 000 points pour
800 points consommés (note explicative avec le temps perdu).

`FertilityPlan` : `steps`, `totalSeconds`, `fecundAt`, `consumed`, `warnings`, `mounts`, plus
**`tiers`** (palier par jauge, à passer tel quel à `refillAdvice` et au plan démarré), **`converges`**
(toutes les montures fécondes à la fin ; faux = plan inapplicable : ne pas proposer « Démarrer », pas
d'heure de fécondité ni de total de carburant), **`notes`** (choix de palier, étapes allongées) et
**`split`** (`LotSplit | null` : `{keep, out, groups}` — fenêtres de sérénité ≤ 2 000 d'un seul côté de
0, proposé quand le lot ne converge pas ou dépasse 2 000 d'écart ; `splitLot(sims, withXp)` dans
`fertility.ts`).

Poussées vers la zone de maturité (`planFertility`) : on ne juge que les montures qui ont encore besoin
de maturité (compléments XP et stériles exclus) ; la poussée s'arrête dès que tout le lot tient dans la
zone ([-2 000, -1] ou [0, 2 000]), centré pour garder de la marge des deux côtés. La **fenêtre de
changement** (`switchWindow`) est calculée par simulation de tout le lot : du premier tick où toutes
sont dans la zone au dernier avant que la première n'en sorte. Lot qui ne tient jamais en entier : pas
de fenêtre et avertissement (`wideLotWarning`).

## Répartition automatique

```ts
assignPaddocks(mounts: Mount[], opts: AssignOptions): AssignResult
interface AssignOptions {
  paddocksAvailable: number            // unlockedPaddocks(jobLevel)
  rules: Ruleset; tier: FuelTier       // useRules(), settings.preferredTier
  withXp?: boolean                     // settings.xpFiller
  almanaxDoubled?: GaugeId | null      // almanaxOn(isoDay(now))?.doubledGauge
  includeLeveling?: boolean            // compléments XP (défaut oui) ; une féconde qui a un partenaire
                                       // féconde (même famille, sexe opposé) n'en est jamais un : elle
                                       // s'accouple d'abord (même règle que le plan d'accouplement de l'accueil)
  levelTarget?: number                 // settings.parentTargetLevel (défaut 40)
  xpTargets?: Record<string, number>   // niveaux visés explicites (ex. sort « monter »)
  keepCurrent?: boolean                // laisser en place (défaut oui) — sauf un lot > 2 000 : on garde
                                       // la meilleure fenêtre, le reste est replacé (rationale « Lot scindé »)
  includeInventory?: boolean           // montures de l'inventaire du personnage (défaut non)
  maxPlanSeconds?: number
  serenityTier?: FuelTier              // défaut 1
  startMs?: number; applyAlmanax?: boolean   // Almanax limité au jour Almanax
  minStepSeconds?: number              // settings.checkIntervalMinutes × 60
  paddockGauges?: Record<number, Partial<Record<GaugeId, number>>>   // niveaux par enclos (socle utile ?)
}
interface AssignResult {
  paddocks: PaddockAssignment[]        // un par enclos débloqué (rôle « vide » s'il reste libre)
  moves: MountMove[]                   // {mountId, from, to, reason} — à faire sur une carte d'enclos
  waiting: WaitingMount[]              // {mountId, batch, reason}
  waitingBatches: WaitingBatch[]       // {index, mountIds, serenityRange, role, firstGauges} — lots suivants
  suggestions: string[]                // conseils FR (remplir, captures, Almanax, alarme…)
  allocationAdvice: string | null
  stats: { paddocks, slots, fertility, placed, waiting, fillers }
}
interface PaddockAssignment {
  paddockId; role; mountIds; keptIds; addedIds; fillerIds
  plan: FertilityPlan | null           // planPaddock du lot (compléments compris)
  firstGauges: GaugeId[]; eligible: Partial<Record<GaugeId, number>>
  serenityRange: [number, number] | null; totalSeconds: number
  rationale: string[]; warnings: string[]   // « pourquoi » et rendement (n/10 éligibles)
}
```

## Recharge de carburant

```ts
refillAdvice(state: Pick<PaddockState, 'gauges'>, plan: RefillPlanInput, opts: RefillOptions): RefillAdvice
// RefillItem : {fuelId, name, count, unitPrice, subtotal, complete, canCraft, craftLevel, durability,
//   origin (votre prix, marché, défaut, craft…), market? (date, statistique, volume du marché importé)}
// → la page affiche « (1 384 K l'unité, coût des ingrédients) » ou « (2 872 K l'unité, marché (02/10) ·
//   ≈ 22 vendus/jour (30 j)) », et « volume HDV faible » au-delà de maxMarketShare des ventes quotidiennes.
interface RefillPlanInput { consumed; tiers?; steps? }   // un FertilityPlan convient tel quel
interface RefillOptions { ctx; rules; jobLevel; tier; serenityTier?; tierByGauge?; craftableOnly? }
```

Palier de chaque jauge : `tierByGauge`, sinon `plan.tiers`, sinon `serenityTier ?? 1` (sérénité) ou
`tier` — et, sans palier imposé ni de plan, même règle de socle que le planificateur (< 10 % du bas du
palier consommé et jauge sous le palier → palier inférieur, note). **Passer le plan entier**
(`refillAdvice(state, plan, …)`) pour que socles, recharges et consignes suivent exactement le plan.

Par jauge consommée (`RefillLine`) : `tier`, `base` (socle jusqu'au bas du palier, paliers ≥ 2 — ces
points restent dans la jauge), `initial` (**ce qui manque seulement** : consommation − points
utilisables déjà au-dessus du bas du palier, au plus le plafond), `refillCount` recharges de
`refillFrom` à `refillTo` (`refillPlan`, `lastRefillPlan`), `items` (carburants à acheter/fabriquer :
nombre, prix unitaire, `complete` — « prix à saisir » sinon —, fabricable, niveau de craft), `cost` /
`baseCost` / `runCost`, `complete`, `missing`, **`upperBound`** (coût incomplet : borne haute chiffrée,
souvent un Élixir estimé, à afficher « ≤ » et hors des totaux), `leftover`, **`leftoverByTier`**
(`{tier, points, pointCost}` : le reste découpé par tranche de palier, socle compris, chaque tranche au coût
au point du carburant de SON palier — « Reste dans les jauges » = `pointsValue` de ces tranches ; le socle ne
vaut pas le prix au point du palier entretenu), `pointCost` (`bestFuel`),
`notes` FR. Jauges de sérénité (avec `plan.steps`) : **`stopsByItself`** (une seule étape et dépôt
exact : elle s'arrête d'elle-même) sinon « N points de trop : coupez-la à la fin de l'étape k » ;
**`cutoffs`** `{stepIndex, atSeconds}` pour afficher les heures de coupure (`stepTimes`). Sans
`steps`, jamais « s'arrête d'elle-même ».
`RefillAdvice` totalise `cost`, `baseCost`, `runCost`, `complete`, `missing`, `upperBound`, `tiers`.
**Coût incomplet** : borne basse si une partie est chiffrée, `null` sinon — jamais 0 pour un prix inconnu.

## Simulation avec les jauges saisies

| Signature | Rôle |
|---|---|
| `simulateCurrent(state: Pick<PaddockState, 'gauges' \| 'active'>, mounts: Mount[], {rules, almanaxDoubled?, maxSeconds? = 86 400}): SimulateResult` | Simule l'enclos tel quel (sans recharge) 24 h ou jusqu'à l'arrêt. Lève une erreur si les jauges actives sont invalides (`validateActiveGauges`). |
| `simulationTimeline(res, nameOf: (id) => string, rules): TimelineEntry[]` | Chronologie FR : changement de palier, jauge vide, statistique au max, changement de smiley, féconde(s), arrêt ; événements regroupés par instant. `TimelineEntry = {t, kind, text, tone: 'info'\|'ok'\|'warn'\|'danger', gauge?, mountIds}`. |

## Plan démarré (heures absolues)

| Signature | Rôle |
|---|---|
| `gaugeSwitch(from, to): {off, on, keep, text}` | « désactiver Caresseur, activer Abreuvoir, garder Mangeoire ». |
| `interface PlanSchedule { startedAt; offsetMs?; steps: FertilityStep[]; totalSeconds; acknowledgedStepIndex }` | Forme minimale d'un plan démarré. |
| `stepTimes(s): {startAt, endAt}[]` | Heures (ms) de chaque étape (`startedAt + offsetMs + secondes`). |
| `nextSwitchOf(s): NextSwitch \| null` | Prochain changement : `{index, at, earliest, latest, from, to, text, final}` (`final` = fin du plan, tout couper ; fenêtre = étape de sérénité). Les étapes suivantes qui gardent les mêmes jauges sont sautées : jamais « aucun changement » avant la fin ; `acknowledgeStep` saute aussi. |
| `planProgress(s, now): PlanProgress` | `{index, step, startAt, endAt, scheduledIndex, next, due, late, msToNext, finished, fraction}`. |
| `acknowledgeStep(s, at?)` | Validation du changement : index suivant ; avec `at` (heure réelle), décale la suite du plan. |

## Suivi d'un plan démarré (`src/domain/paddockPlanStatus.ts`, testé dans `paddockPlanStatus.test.ts`)

Module pur (aucun React, aucun store).

| Signature | Rôle |
|---|---|
| `planStatus(s: PlanSchedule, now): PlanStatus` | `{state, progress, lateMs, serenityPush, staleAt, reason}` ; `state` = `'running' \| 'due' \| 'late' \| 'stale' \| 'end-overdue' \| 'finished'`. **`stale`** (plan dépassé) : changement manqué pendant une poussée de sérénité (Baffeur/Caresseur — seules à déplacer la sérénité) au-delà de la fin de fenêtre + max(30 min, 2 × largeur de fenêtre), ou 30 min après l'heure prévue sans fenêtre. Ne jamais afficher « faites-le tout de suite » pour un plan `stale` : relever les sérénités et recalculer. **`end-overdue`** : fin non validée depuis plus d'1 h (tout couper, appliquer au lot). Une étape de statistique en retard reste `due` (« Fait maintenant » décale la suite). `STALE_AFTER_MS`, `END_OVERDUE_MS`. |
| `planYield(plan: {steps, tiers?, tier?}, mounts: SimMount[], {rules, startMs?, almanax?}): PlanYield` | Rejoue le plan tick par tick et compte les montures nourries par jauge : `byGauge[g] = {consumed, averageFed, yield, lostPoints, partialSteps}` ; **`full`** = chaque jauge de statistique (Foudroyeur, Abreuvoir, Dragofesse : `STAT_GAUGES`) nourrit 10 montures à chaque tick où elle consomme — seul cas où afficher « rendement maximal » ; `warnings` FR sinon (« Foudroyeur : 2 étapes à 5/10 montures, ≈ 20 000 points… »). |
| `projectedMountPatches(projected: Record<id, SimMount>, mounts, {fecundToStable?, serenity?, keepStats?}): Record<id, Partial<Mount>>` | Modifications à écrire dans l'inventaire depuis `projectMountsFromPlan(...).byId` : sérénité (ou celle relevée en jeu), E/M/A (jamais en baisse ; jamais pour une stérile/sénile), niveau gagné à la Mangeoire (prudent : depuis le début du niveau enregistré), étable pour les fécondes si demandé. |
| `remainingPlanConsumption(s, now): {consumed, steps}` | Consommation restante d'un plan démarré (étape en cours au prorata du temps qui lui reste) : `refillAdvice(state, {consumed, steps, tiers: plan.tiers}, …)`. |
| `pointsValue(lines: {points, pointCost}[]): {value, complete}` | Valeur en kamas de points de jauge au coût au point (`RefillLine.pointCost`). Prix inconnu ou seulement borné par le haut : jamais 0 → borne basse (`complete = false`) ou `null`. |

## Store `usePaddocks` (`src/store/paddocks.ts`, clé `elevagesimu:paddocks`, version 1)

```ts
interface PaddockRecord extends PaddockState {      // champs ajoutés facultatifs : pas de changement de version
  gaugeUpdatedAt?: Partial<Record<GaugeId, number>>  // saisie jauge par jauge (objet absent : updatedAt)
  gaugeRulesets?: Partial<Record<GaugeId, RulesetId>> // version des règles de chaque saisie (paliers ×2 en 3.7)
  activeChangedAt?: number                           // dernier changement de jauges actives
  activeHistory?: { at: number; active: GaugeId[] }[] // jauges actives depuis la plus ancienne saisie
}
usePaddocks(): {
  paddocks: PaddockRecord[]
  setGauge(paddock, gauge, value, {rulesetId?, at?})  // borné à 0 … plafond de la version ; ne date QUE cette jauge
  setGauges(paddock, levels, {rulesetId?, at?})       // plusieurs jauges en une écriture (démarrage d'un plan)
  setActive(paddock, active, at?)                     // ne touche JAMAIS aux heures de saisie (F7) ; historique
  convertLevels(paddock, to: RulesetId)               // ×2 / ÷2 (même proportion du plafond), heures gardées
  replaceAll(paddocks)
}
paddockProjectionInput(p): { activeSinceMs, gaugeUpdatedAt, activeHistory }   // → projectPaddock / projectGaugeLevels
levelsFromOtherRuleset(p, rulesetId): { gauge, rulesetId }[]                  // niveaux « à vérifier » (R9)
gaugeEnteredAt(p, g); convertGaugeLevel(v, from, to); pruneActiveHistory(h, since); emptyPaddock(id); initialPaddocks()
sanitizePaddocks(raw): Sanitized<{paddocks}>        // lecture normalisée (réhydratation, replaceAll)
```

`updatedAt` reste « dernière saisie d'un niveau » (la plus récente). Pour estimer les niveaux, **utiliser
les heures par jauge** (`paddockProjectionInput`) et l'historique des jauges actives — un conseiller qui
vieillit toutes les jauges depuis `updatedAt` rajeunit les jauges non ressaisies. Persistance sûre
(`persistOptions` : stockage qui ne lève pas, normalisation à la lecture).

## Store `usePaddockPlans` (`src/store/paddockPlans.ts`, clé `elevagesimu:paddockPlans`, version 1)

```ts
interface ActivePaddockPlan {
  paddockId; startedAt; tier; withXp; rulesetId; almanaxDoubled
  mountIds: string[]; steps: FertilityStep[]; totalSeconds; fecundAt: Record<string, number>
  acknowledgedStepIndex: number; offsetMs: number
  tiers?: Partial<Record<GaugeId, FuelTier>>         // FertilityPlan.tiers (projection, carburant)
  levelsAtStart?: Partial<Record<GaugeId, number>>   // niveaux relevés au démarrage
  notified?: string[]                                // alarmes déjà notifiées (alarmKey)
}
usePaddockPlans(): { plans, start(plan), advance(paddockId, at?), stop(paddockId), markNotified(paddockId, keys), replaceAll(plans) }
currentStep(plan, now = Date.now()): PlanProgress      // = planProgress
nextAlarm(plans): { paddockId, switch: NextSwitch } | null   // alarme la plus proche, tous enclos
pendingAlarms(plans, now): { paddockId, kind: 'due' | 'late', key, next }[]   // à notifier, pas encore notifiées
nextAlarmWake(plans, now): number | null               // prochaine heure où une alarme devient due
alarmKey(paddockId, next, kind); sanitizePaddockPlans(raw)
```

`start` suppose la première étape appliquée en jeu ; la page démarre via un dialogue qui enregistre les
niveaux lus (`setGauges`), puis `start({... tiers, levelsAtStart})` et `setActive(first)`. `advance`
élague `notified`. Exemple pour l'accueil : `nextAlarm(usePaddockPlans((s) => s.plans))`.

## Alarmes globales (`src/ui/alarms.tsx`, montées dans `App.tsx`)

- `PlanAlarms` : notification du navigateur à chaque changement dû et à la fin d'une fenêtre de sérénité,
  **sur toutes les pages**, une seule fois (clés notées dans `plan.notified` : ni un changement de page ni
  un rechargement ne répètent). Un minuteur sur `nextAlarmWake`, vérification chaque minute et au retour
  sur l'onglet. Ne fonctionne que tant que l'application est ouverte.
- `DueSwitchBanner({pageId})` : rappel compact (boutons « Fait », lien vers l'enclos ; plan dépassé →
  lien seulement) sur les pages autres que l'accueil et les enclos.
- `useAlarmPrefs` (autorisation, réglage `elevagesimu:enclos-notifications`), `NotificationControl`
  (réglage à afficher, ex. accueil), `notify(title, body, tag)`.
- `usePlanClock(plans)` : horloge réveillée aux heures de changement ; `useAdvancePlan()` : valide un
  changement (plan + jauges actives datées de l'heure réelle) ; `planStatusText(status, now)`.

## Page Enclos (`#/enclos`) — comportements

- Niveaux affichés, carburant et simulation : **niveaux estimés maintenant** (`projectPaddock` avec les
  heures par jauge, l'historique des jauges actives et le plan démarré), valeur saisie à côté ; montures du
  plan démarré estimées (sérénité, E/M/A, « féconde (estimé) »).
- Plan recommandé : `planPaddock` avec `minStepSeconds = settings.checkIntervalMinutes × 60`, `startMs`
  et `applyAlmanax = settings.almanaxGaugeDoubling` (Almanax du calendrier, jour de jeu ; bandeau « au rythme
  normal » tant que le réglage est décoché), `gaugeLevels` (bas de palier atteint). Tableau repliable
  « Comparer les paliers 1 à 4 » (`compareTiers` : durée, fécondes, carburant à acheter, socle ; bouton
  « Choisir le palier N » qui modifie le réglage). `converges = false` → pas de
  « Démarrer », ni heure de fécondité ni carburant ; proposition de découpage (`split`) avec lien
  `#/enclos?onglet=repartition&calcul=1&garder=0` (calcul immédiat, sans « laisser en place »).
- Démarrage : dialogue « remplir les jauges » (dépôt socle + premier dépôt de `refillAdvice`, niveau lu).
- Plan en cours : les étapes validées s'affichent « ✓ fait » (sans heures : « Fait maintenant » décale tout
  le plan, les heures passées recalculées n'ont pas eu lieu). Carte Carburant : « Reste dans les jauges »
  valorisé tranche par tranche (`leftoverByTier`, socle au prix du palier inférieur).
- Plan terminé / arrêté / dépassé : « Appliquer au lot » (`projectedMountPatches`, étable pour les
  fécondes, nouvelle référence des niveaux de jauges, note au journal) puis arrêt du plan.
- Coûts (F15) : « Acheté pour le plan (hors socle) », « Socle », « Total », « Consommé par le plan »
  (points × coût au point, par monture fécondée), « Reste dans les jauges ». Par ligne : `upperBound` affiché
  à part « ≤ X (borne haute) », jamais compté ; jauges de sérénité : heures de coupure (`RefillLine.cutoffs`
  → « ⏰ Coupez Caresseur à HH:MM (fin de l'étape k) ») sauf dépôt exact sur une seule étape.
- Répartition : sérénité modifiable dans la liste des déplacements ; après « Enregistrer les
  déplacements », liste à cocher par destination et liens « Ouvrir l'enclos N et démarrer le plan ».
