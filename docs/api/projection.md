# API — Projections d'enclos (`src/domain/projection.ts`)

Estimation « maintenant » de l'état d'un enclos, partagée par la page Enclos et le conseiller (accueil),
pour qu'ils affichent les mêmes chiffres : niveaux de jauges vidés depuis leur saisie, et état des
montures d'un plan démarré (les statistiques de l'inventaire ne sont jamais mises à jour par un plan).
Module pur (aucun React, aucun store), testé dans `src/domain/projection.test.ts`. Le doublement
Almanax suit le calendrier tick par tick (`almanaxScheduleFrom`, jour Almanax = **jour de jeu, heure de
Paris**, quel que soit le fuseau du navigateur) ; `almanax: false` le désactive (ce que font la page Enclos
et le conseiller tant que le réglage `almanaxGaugeDoubling` est décoché), une fonction
`(ms) => GaugeId | null` le remplace.

**Toute valeur projetée est une estimation** : l'afficher comme telle (« ≈ 12 300 estimé à 14:05 »),
à côté de la valeur saisie, avec l'invitation à ressaisir depuis le jeu quand `stale`.

## Niveaux de jauges

```ts
projectGaugeLevels(state: Pick<PaddockState,'gauges'|'active'>, activeSinceMs, nowMs, rules,
                   mounts: (Mount | SimMount)[], opts?: GaugeProjectionOptions): GaugeProjection
interface GaugeProjectionOptions {
  almanax?: boolean | ((ms) => GaugeId | null)
  gaugeUpdatedAt?: Partial<Record<GaugeId, number>>   // saisie jauge par jauge (défaut : activeSinceMs)
  activeHistory?: { at: number; active: GaugeId[] }[] // jauges actives successives (défaut : state.active)
  staleAfterSeconds?: number                          // défaut 3 jours
}
interface GaugeProjection {
  levels: Record<GaugeId, number>    // niveaux estimés à nowMs
  mounts: SimMount[]                 // montures après le même temps
  fromMs; elapsedSeconds
  emptiedAt: Partial<Record<GaugeId, number>>   // heure (ms) où une jauge s'est vidée
  events: SimEvent[]                 // t en secondes depuis fromMs
  estimated: boolean                 // un niveau diffère de la saisie
  stale: boolean                     // saisie trop ancienne
}
```

Simulation sans recharge, paliers réels (la jauge ralentit en changeant de palier) ; une jauge ne
consomme rien quand aucune monture n'en profite. `mounts` = montures de l'enclos à l'heure de la saisie.

## Montures d'un plan démarré

```ts
projectMountsFromPlan(plan: ReplayablePlan, mounts: Mount[], nowMs, opts?): PlanProjection
interface ReplayablePlan extends PlanSchedule { tier; tiers?; rulesetId?; mountIds }  // un ActivePaddockPlan convient
interface PlanProjectionOptions { rules?; almanax?; continueCurrentStep? }
interface PlanProjection { mounts; byId; fecundIds; stepIndex; elapsedSeconds; finished; missingIds }
```

Rejoue les étapes validées puis l'étape en cours jusqu'à `nowMs` (jauges entretenues aux paliers du plan
— `tiers`, à défaut `tier` et sérénité au palier 1 —, chaque étape au plus sa durée prévue ; avec
`continueCurrentStep`, l'étape en cours continue tant qu'elle n'est pas validée). Suppose que les
statistiques de l'inventaire datent d'avant le démarrage du plan. Usages : ETA et état réel du lot
pendant un plan, « Marquer le lot fécond » à la fin (`fecundIds`, valeurs de `byId`), conseiller qui ne
doit pas déclarer une jauge « inutile » pendant l'étape qui la sert.

`planActiveHistory(plan): {at, active}[]` : jauges actives prévues par le plan (étapes validées, tout
coupé à la fin) — à passer en `activeHistory`.

## Tout ensemble

```ts
projectPaddock({ state, activeSinceMs, nowMs, rules, mounts, plan?, gaugeUpdatedAt?, activeHistory?, almanax? })
  : { gauges: GaugeProjection; mounts: SimMount[]; plan: PlanProjection | null }
```

Avec un plan démarré : montures à l'heure de la saisie = plan rejoué jusqu'à cette heure, jauges
actives = `planActiveHistory(plan)` (sauf `activeHistory` fourni), montures « maintenant » = plan
rejoué. Sans plan : simulation des jauges saisies. `asSimMounts(mounts)` convertit des `Mount`.
