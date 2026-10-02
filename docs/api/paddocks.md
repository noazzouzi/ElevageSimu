# API — tranche « Enclos » (`src/domain/paddockAssign.ts`, `src/store/paddockPlans.ts`)

Répartition automatique des montures dans les enclos, plan de fécondité d'un lot sans micro-étapes,
conseils de recharge de carburant, chronologie d'une simulation et suivi d'un plan démarré (heures
absolues, prochain changement de jauges, retard). Module pur (aucun React, aucun store), testé dans
`src/domain/paddockAssign.test.ts` (31 tests). S'appuie sur `planFertility`/`decideGauges`
(`fertility.ts`), `simulatePaddock`/`canBenefit` (`paddock.ts`), `fillPlan`/`bestFuel` (`fuel.ts`),
`effectiveFertility` (`mounts.ts`), `SERENITY_SMILEYS` (`mountFate.ts`) et
`STRATEGY.paddockAllocationByCount`.

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
| `planPaddock(mounts: SimMount[], opts: FertilityOptions): FertilityPlan` | **À utiliser à la place de `planFertility`** pour un enclos : même résultat quand le plan de base est propre ; sinon corrige les traversées de 0 qui alternent toutes les 10 s à 2 min (poussée maintenue jusqu'à ce que tout le lot ait traversé, ou « finir sur place » la statistique que la traversée ferait perdre). Sur 189 lots d'essai : 0 plan inachevé (contre 63 pour `planFertility`, dont 30 lots de captures fraîches), ≈ 5 fois moins d'étapes de moins de 5 min, rarement plus long (3/189, ≤ 7 %). |

## Répartition automatique

```ts
assignPaddocks(mounts: Mount[], opts: AssignOptions): AssignResult
interface AssignOptions {
  paddocksAvailable: number            // unlockedPaddocks(jobLevel)
  rules: Ruleset; tier: FuelTier       // useRules(), settings.preferredTier
  withXp?: boolean                     // settings.xpFiller
  almanaxDoubled?: GaugeId | null      // almanaxOn(isoDay(now))?.doubledGauge
  includeLeveling?: boolean            // compléments XP (défaut oui)
  levelTarget?: number                 // settings.parentTargetLevel (défaut 40)
  xpTargets?: Record<string, number>   // niveaux visés explicites (ex. sort « monter »)
  keepCurrent?: boolean                // laisser en place (défaut oui)
  includeInventory?: boolean           // montures de l'inventaire du personnage (défaut non)
  maxPlanSeconds?: number
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
refillAdvice(state: Pick<PaddockState, 'gauges'>, plan: { consumed: Partial<Record<GaugeId, number>> }, opts: RefillOptions): RefillAdvice
interface RefillOptions { ctx: PriceContext; rules: Ruleset; jobLevel: number; tier: FuelTier; craftableOnly?: boolean }
```

Par jauge consommée : `base` (socle jusqu'au bas du palier, paliers ≥ 2 — ces points restent dans la
jauge), `initial` (juste ce que le plan consomme, au plus le plafond), `refillCount` recharges de
`refillFrom` à `refillTo` (`refillPlan`, `lastRefillPlan`), `items` (carburants à acheter/fabriquer :
nombre, prix unitaire, fabricable, niveau de craft), `cost` / `baseCost` / `runCost`, `complete`,
`missing`, `leftover`, `pointCost` (`bestFuel`), `notes` FR (alarme pour Baffeur/Caresseur…).
`RefillAdvice` totalise `cost`, `baseCost`, `runCost`, `complete`, `missing`. **Coût incomplet** :
borne basse si une partie est chiffrée, `null` sinon — jamais 0 pour un prix inconnu.

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
| `nextSwitchOf(s): NextSwitch \| null` | Prochain changement : `{index, at, earliest, latest, from, to, text, final}` (`final` = fin du plan, tout couper ; fenêtre = étape de sérénité). |
| `planProgress(s, now): PlanProgress` | `{index, step, startAt, endAt, scheduledIndex, next, due, late, msToNext, finished, fraction}`. |
| `acknowledgeStep(s, at?)` | Validation du changement : index suivant ; avec `at` (heure réelle), décale la suite du plan. |

## Store `usePaddockPlans` (`src/store/paddockPlans.ts`, clé `elevagesimu:paddockPlans`)

```ts
interface ActivePaddockPlan {
  paddockId; startedAt; tier; withXp; rulesetId; almanaxDoubled
  mountIds: string[]; steps: FertilityStep[]; totalSeconds; fecundAt: Record<string, number>
  acknowledgedStepIndex: number; offsetMs: number
}
usePaddockPlans(): { plans: Record<string, ActivePaddockPlan>, start(plan), advance(paddockId, at?), stop(paddockId), replaceAll(plans) }
currentStep(plan, now = Date.now()): PlanProgress      // = planProgress
nextSwitchAt(plan): number | null                      // heure du prochain changement (fin comprise)
nextSwitch(plan): NextSwitch | null
nextAlarm(plans): { paddockId, switch: NextSwitch } | null   // alarme la plus proche, tous enclos
```

`start` suppose la première étape appliquée en jeu (la page reporte aussi ses jauges dans
`usePaddocks().setActive`). Exemple pour l'accueil : `nextAlarm(usePaddockPlans((s) => s.plans))`.
