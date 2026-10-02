# API — tranche « Pilotage » (`src/domain/advisor.ts`, `src/store/planProgress.ts`, `src/ui/useGoalSimulation.ts`)

« Que faire maintenant ? » : l'aide compose les autres modules du domaine (plans d'enclos démarrés,
projection des jauges et des montures, Almanax, plan d'accouplement, sort des montures, répartition en
enclos, captures vers l'objectif, métier, prix manquants) en une liste d'actions **ordonnées, datées et
expliquées**, et fournit les briques du plan d'élevage (phase P0–P6, captures restantes, calendrier depuis
l'étable, critères de sortie détectés, repères de stratégie). Module pur (aucun React, aucun store), testé
dans `src/domain/advisor.test.ts` (47 tests, états synthétiques à heure fixe) et
`src/domain/advisor.errors.test.ts` (section en panne, `vi.mock`).

Pages associées : `src/ui/pages/HomePage.tsx` (`#/accueil`, page d'accueil) et
`src/ui/pages/PlanPage.tsx` (`#/plan?onglet=chemin|phase|strategie|routines|erreurs`).

## Utilisation type

```ts
const input: AdvisorInput = {
  now: Date.now(), settings, rules: useRules(), mounts, paddocks, paddockPlans,  // stores (enregistrements tels quels)
  priceCtx: usePriceContext(), mountPrices, genetonValue: usePrices((s) => s.genetonValue), pricedItems,
  journalXp: { xp: journalJobXp(useJournal((s) => s.entries), settings.jobLevelUpdatedAt).xp },
  goalSim: useGoalSimulation(goalProgramConfig(settings, rules)).summary,        // null pendant le calcul
}
// Lourd (≈ 0,3 à 1 s pour 250 montures) : mémorisé d'une visite à l'autre (mêmes références de stores, même jour).
const analysis = analyzeStateCached({ ...input, now: midi_du_jour, paddocks: [], paddockPlans: {} })
const advice = adviseNow(input, analysis)            // léger : à rappeler toutes les 30 s
const groups = groupAdvice(advice.filter((a) => !done[a.id]), Date.now())
```

L'analyse ne dépend de l'heure que par le jour (Almanax, Takeza) et ne lit ni les plans d'enclos ni les
niveaux de jauges (lus par `adviseNow`). La simulation de l'objectif s'applique dans `adviseNow`
(`withGoalSimulation`) : son arrivée ne relance pas l'analyse.

## Types

| Élément | Rôle |
|---|---|
| `Advice` | `{ id, priority: 1…5, category, title, detail, dueAt?, allDay?, window?, horizon?, link: {page, params?, label}, items?: AdviceItem[], confidence?, amount?: {label, value, complete}, missing?: number[], action? }`. `id` est stable tant que la situation ne change pas. `amount.complete = false` / `missing` → « coût incomplet » + lien Prix (jamais 0). `action = { kind: 'advance-plan', paddockId, to }` : bouton « Fait » (jamais pour un plan dépassé). |
| `AdviceItem` | Ligne de checklist `{ id, text, hint?, link?, tone?, done? }`. |
| `AdviceCategory` | `'erreur' \| 'alarme' \| 'almanax' \| 'accouplement' \| 'clonage' \| 'enclos' \| 'carburant' \| 'capture' \| 'vente' \| 'metier' \| 'prix' \| 'objectif'` ; `ADVICE_CATEGORIES` (ordre d'une session), `ADVICE_CATEGORY_LABELS`, `PRIORITY_LABELS`. `'erreur'` = section indisponible. |
| `AdviceHorizon` | `'maintenant' \| 'heures' \| 'aujourdhui' \| 'semaine'` ; `HORIZONS`, `HORIZON_LABELS`. |
| `AdvisorSettings` | Sous-ensemble structurel de `useSettings` (jobLevel, family, goalSpeciesId, goal, preferredTier, xpFiller, parentTargetLevel, useOptimakina, saleTax, useDefaultPrices) + facultatifs **`accounts`** (captures par combat), **`hoursPerDay`** (passages par jour du calendrier), **`checkIntervalMinutes`** (durée minimale d'une étape : `minStepSeconds` de la répartition, comme la page Enclos), **`almanaxGaugeDoubling`** (doublement Almanax des jauges appliqué aux plans/projections ; défaut non). |
| `AdvisorPaddockPlan` | `PlanSchedule & { paddockId, tier, mountIds, tiers?, rulesetId? }` (= `ActivePaddockPlan` du store). |
| `AdvisorPaddock` | `PaddockState & { gaugeUpdatedAt?, activeHistory?, gaugeRulesets? }` (= `PaddockRecord` du store) : saisie jauge par jauge, jauges actives successives, version des règles de chaque saisie (niveaux d'une autre version → conseil « niveaux de jauges à vérifier », ni recharge ni « jauge vide »). |
| `AdvisorInput` | `{ now, settings, rules, mounts, paddocks, paddockPlans, priceCtx, mountPrices, genetonValue?, pricedItems?, journalXp?, goalSim? }`. `journalXp = { xp }` : XP d'Éleveur du journal depuis `settings.jobLevelUpdatedAt`. `goalSim` : `ProgramSummary` de la simulation de l'objectif. |
| `AdvisorAnalysis` | `{ day, almanax, unlocked, summary, fates, pairs, pairCandidates, waiting, assignment, freeSlots, goal, capture, job, fertility, genetonValue, expectedGenetons, matingJobXp, missingPrices, unpricedMounts, errors }`. `waiting: WaitingPartner[]` = montures de l'objectif mises de côté (`{mountId, partnerId, targetSpecies}`, `PairSuggestion.waitFor`). `errors: AdvisorSectionError[]` = `{section, label, message}` des sections en panne. `expectedGenetons` = Σ `result.expectedGenetons` (bébés déjà comptés). |
| `AdvisorSection`, `ADVISOR_SECTION_LABELS` | `'summary' \| 'pairs' \| 'fates' \| 'assignment' \| 'goal' \| 'job' \| 'costs' \| 'onboarding' \| 'alarms' \| 'gauges' \| 'almanax' \| 'mating' \| 'exits' \| 'placement' \| 'captures' \| 'prices'` et libellés FR. |

## Analyse (`analyzeState`) : ordre et branchements

1. **Plan d'accouplement** : `rankPairs` avec C_eff (`economyCoupleCost`, mêmes paramètres que la page
   Accouplement) → la règle de prix de l'Optimakina décide dès que prix et C_eff sont connus, quel que
   soit l'objectif (heuristique G6 / G4–G5 de l'objectif sinon) ; `bestDisjointPairs` ; `waiting` depuis
   les `waitFor` des couples écartés.
2. **Sort des montures** avec `plannedPartners` (plan retenu) : une monture prévue au plan reçoit
   « Accoupler (plan) puis … », jamais une sortie immédiate ; montée de niveau chiffrée au **lot réel**
   (`batchSize` fourni par `recommendFates`) au palier de Mangeoire le moins cher (1 ou préféré).
3. **Répartition** (`assignPaddocks`, `minStepSeconds = checkIntervalMinutes × 60`, `startMs`).
4. **Objectif** (`goalStatus`), filets, métier (avec `journalXp`), coûts, prix manquants.

Le « jour » de l'analyse est le **jour de jeu** (`serverDay`, heure de Paris) ; l'accueil ancre l'analyse à
midi du jour de jeu. Les échéances « toute la journée » (`allDay`) valent `serverDayStart(date)` et
s'affichent avec `serverDay(dueAt)`.

Chaque section est dans un `try` : une exception est notée dans `errors` (et `console.error`), les autres
sections restent calculées. `adviseNow` fait de même pour chaque générateur et ajoute un conseil
« Section indisponible : … » (`category: 'erreur'`, priorité 2, message en `items[0]`) — l'accueil les
regroupe dans un encadré avec « Télécharger une sauvegarde ».

## Conseils produits (`adviseNow`)

| Conseil | Priorité | Source |
|---|---|---|
| Premiers pas / profil à compléter | 1 / 2 | réglages, prix saisis |
| Changement de jauges (dû, fenêtre, retard) | 1–3 | `planStatus` (paddockPlanStatus) |
| **Plan dépassé** (`stale`) : « relevez les sérénités et recalculez » — ni « faites-le tout de suite » ni bouton « Fait » | 1 | `planStatus` |
| **Plan terminé** / fin non validée : « Appliquer au lot » (lien Enclos, fécondes estimées par `projectMountsFromPlan`) ; pour cet enclos : ni « démarrer le plan », ni recharge | 2 | `planStatus`, `projectMountsFromPlan` |
| Jauge vide, qui va se vider, sous le palier du plan ; jauge inutile ; saisie trop ancienne (jauge par jauge) ; niveaux saisis sous une autre version des règles | 1–4 | `projectPaddock` (comme la page Enclos : heures par jauge, jauges actives successives, montures du plan rejoué), `fillPlan` au **palier de la jauge** (`plan.tiers[g]` du plan démarré ou planifié, sérénité au palier 1). **Plan démarré** : recharge dimensionnée sur ce qu'il reste à consommer (`remainingPlanConsumption`, comme la carte Carburant de l'Enclos), aucune si le plan n'a plus besoin de la jauge ; passer sous le palier pour un retard < 15 min (`NEGLIGIBLE_DELAY_S`) ne déclenche pas de recharge ; une jauge de l'étape en cours n'est jamais « inutile » (traversée de 0, ou l'alarme de changement la coupe déjà) |
| Fin de plan due : ligne « Enregistrer le lot fécond » avec son lien « Appliquer au lot » (pas de second « Voir l'enclos ») | 1 | `nextSwitchOf` |
| Takeza (seuil `TAKEZA_PRIORITY_GENERATION`, partagé avec l'Accouplement ; durée du plus long lot planifié, sinon d'un lot typique, et heure limite « démarrez-le au plus tard … » pour être fécond à minuit, heure de Paris), jauge doublée, bébés à capacité | 1–4 | `almanaxOn`, `upcomingAlmanax`, `typicalBatchSeconds` |
| Plan d'accouplement : Optimakina (règle et seuil, ou heuristique), génétons, XP, étable, **M-STACK-01** (`stackAttempts` < 3, avertissement), croisement qui consomme une monture de l'objectif, **« ensuite : vendre/extraire/briser … stérile »** (sortie après l'accouplement) ; **« Attendre que X soit féconde »** (`waiting`) | 2 / 3 | `rankPairs`, `recommendFates` |
| Clonage ; sorties immédiates (jamais une monture du plan) ; montée de niveau (lot réel) | 2 / 3 / 4 | `recommendFates` |
| Placement en enclos (poser, jauges, démarrer le plan seulement sans plan et si `converges`) | 2 | `assignPaddocks` |
| Captures : couleurs et sexes (♂ puis ♀), **≈ N combats** (`accounts × montures par lancer`), zone, filet. Titre « Capturer ≈ N » (simulation) ou « jusqu'à ≈ N » (borne haute analytique, confiance basse) | 2–3 | `withGoalSimulation`, `captureStatus` |
| Métier : niveau estimé d'après le journal (« nouvel enclos probablement débloqué » : priorité 2), XP restante (journal déduit), meilleur craft, jalon, Almanax | 2–4 | `jobStatus` |
| Prix manquants, objectif atteint / à choisir / impossible | 2–4 | — |

## Fonctions

| Signature | Rôle |
|---|---|
| `analyzeState(input): AdvisorAnalysis` | Calculs lourds, indépendants de l'heure (sauf le jour). |
| `analyzeStateCached(input): AdvisorAnalysis` | Même résultat mémorisé (dernier appel) : même objet tant que le jour, `rules`, `mounts` (références), `settings`/`priceCtx`/`mountPrices` (comparaison superficielle), `genetonValue` et `journalXp.xp` ne changent pas. `analysisCacheStats()`, `clearAnalysisCache()`. |
| `adviseNow(input, analysis?): Advice[]` | Liste triée des actions à `input.now` (simulation de l'objectif appliquée). |
| `sortAdvice`, `adviceHorizon`, `groupAdvice`, `nextTimedAdvice` | Tri, horizon, groupes, prochaine action minutée. |
| `goalStatus(goalId, mounts, { parentLevel, useOptimakina, rules, sim? }): GoalStatus \| null` | Recette, `effort` (depuis zéro, analytique = borne haute), `remaining` (avec vos montures : `expectedEffort(…, { owned })`), `supply` (`ownedRecipeSupply`), `captures`, `capturesRemaining`, **`captureBasis`** (`'simulation' \| 'analytique'`), `sim`, **`remainingShare`** (accouplements restants ÷ depuis zéro). |
| `withGoalSimulation(goal, mounts, sim, rules?)` | Recalcule les captures d'un `GoalStatus` avec (ou sans) la simulation — léger. Une simulation d'un autre objectif est ignorée. |
| `ownedRecipeSupply(tree, mounts, { rules? }): RecipeSupply` | Vos montures utiles à la recette : `counts` (espèce → exemplaires), `roles` (monture → espèce tenue), `notes` (FR). **Porteuse** : compte pour l'espèce portée si `breed()` confirme la cible avec la partenaire du croisement. **Sexes** : pour un croisement x × y dont les espèces ne servent qu'à lui, seuls les couples ♂/♀ comptent ; restes de même sexe des deux côtés → une seule couleur comptée. |
| `captureNeeds(tree, mounts, remaining, { full?, sim?, supply?, rules? }): CaptureNeed[]` | Par couleur G1 : `idealTotal`, `idealRemaining` (recette idéale non couverte si tout réussit), `expected` (entier, **arrondi au plus fort reste** : Σ = arrondi du total, jamais > effort), `expectedRaw`, possédées ♂/♀, répartition ♂/♀. Avec `sim` : restant analytique × (simulé ÷ analytique depuis zéro), couleur par couleur. |
| `largestRemainder(values): number[]` | Arrondi au plus fort reste. |
| `capturesPerFight(accounts, mountsPerCast)` | Captures par combat (un filet par personnage). |
| `sessionsPerDayFor(hoursPerDay)` | Passages par jour du calendrier : < 1 h → 1 ; 1–4 h → 2 (recherche) ; 4–8 h → 3 ; ≥ 8 h → 4 (hypothèse). |
| `goalProgramConfig(settings, rules, { runs? }): ProgramConfig \| null` | Simulation de la stratégie conseillée (parents au niveau visé, Optimakina dès la G6, clonage, enclos débloqués, palier, lots de 10, `sessionsPerDayFor`). `programConfigKey(cfg)` : clé du cache partagé. |
| `remainingProgram(goal, sim?): RemainingProgram \| null` | Calendrier **depuis l'étable** : `share`, `captures`, `matings` (simulation × part restante), `days {mean, p10, p90}` (simulation × part restante, au moins un cycle de fécondation), `basis`. La simulation part de zéro (ProgramConfig n'a pas d'inventaire initial) : ESTIMATION. |
| `strategyEffortOptions(o): EffortOptions` | Parents au niveau visé, Optimakina dès la G6 (si activée), clonage. |
| `captureStatus`, `captureSpot`, `captureSpotText`, `bestNetKind` | Filet, coût, zone (`captureSpot` lit `FAMILIES[f].captureZone` pour toutes les familles, notes des monstres comprises : « Dragodinde dorée sauvage : uniquement ici », archimonstres). |
| `typicalBatchSeconds(tier, rules)` | Durée d'un lot typique du planificateur (`economy.batchProfile('typique')`), même hypothèse que la Rentabilité et l'Enclos (texte « Palier » de la stratégie, préparation du Takeza). |
| `jobStatus(jobLevel, ctx, rules, { family?, todayIso, withPlan?, xpGained? }): JobStatus` | `level` (saisi), **`estimatedLevel`**, **`xpGained`**, prochain enclos et `xpToNext` / `progress` depuis le niveau estimé (XP du journal déduite), **`paddockUnlockedSinceEntry`**, jalon, meilleur craft, plan de montée (`startXp`), Almanax, `error?` (plan incalculable : section signalée). `estimatedJobLevel(level, xp)`. |
| `currentPhase`, `evaluateCriterion`, `strategyHighlights`, `resolveRuleRefs`, `levelSumForCertainty`, `nextTakeza`, utilitaires de dates (`daysBetween`, `isoToMs`, `startOfDay`, `formatIsoDay`, `relativeTime`, `isoWeekKey`), `hashKey`, `deName`, `checklistKey` | Inchangés. |

## Simulation partagée (`src/ui/useGoalSimulation.ts`)

`useGoalSimulation(cfg | null) → { summary, status: 'idle'|'running'|'done'|'error', progress, error }` :
lance `runStrategiesAsync` (par tranches, ≈ 0,1–0,3 s pour 24 tirages) une fois par `programConfigKey`,
garde les 12 derniers résultats en mémoire (non persistés) et les partage entre le Plan et l'accueil.
`ensureGoalSimulation(cfg)`, `cachedGoalSimulation(cfg)`.

## Pages

- **Accueil** : `analyzeStateCached` ; simulation de l'objectif (si non atteint) ; KPI « Niveau d'Éleveur »
  au niveau estimé (« saisi : niv. N, +X XP au journal ») ; objectif « ≈ N captures restantes (simulation) »
  ou « jusqu'à ≈ N (borne haute) » ; « Prochaine alarme » signale un plan terminé à appliquer ; encadré
  « Une partie des conseils n'a pas pu être calculée » (sections `erreur`) avec sauvegarde.
- **Plan** : effort attendu en deux colonnes — **simulation (retenue)** et **modèle analytique (référence,
  borne haute)** — avec « Pourquoi deux chiffres ? » ; calendrier **depuis votre étable**
  (`remainingProgram`, passages par jour d'après le temps de jeu, coût matériel restant au prorata) ;
  badge de l'objectif sans « recette couverte » ; tableau des captures ♂ / ♀ dans les deux colonnes,
  notes de `supply` (porteuses, sexes), combats ; phase et critères au niveau estimé.

## Store `usePlanProgress` (`src/store/planProgress.ts`, clé `elevagesimu:planProgress`)

```ts
usePlanProgress(): {
  checked: Record<string, number>      // case → instant où elle a été cochée
  done: Record<string, number>         // id de conseil → instant « fait »
  setChecked(key, value, at?), toggle(key, at?), markDone(id, at?), undoDone(id),
  clearPrefix(prefix), prune(before), replaceAll({ checked, done })
}
isChecked(state, key): boolean
PLAN_PROGRESS_RETENTION_MS = 30 jours  // l'accueil purge au chargement : conseils faits, cases routine/semaine/item
```

Clés (`checklistKey`) : `phase:P2:goals|actions|exit:i`, `objectif:<espèce visée>:<espèce de la recette>`,
`routine:<AAAA-MM-JJ>:<moment>:i`, `semaine:<AAAA-Www>:i`, `item:<id du conseil>:<id de la ligne>`.

## Hypothèses et limites (affichées dans les pages)

- Jauges : projection depuis les niveaux saisis jauge par jauge, sans recharge ; au-delà de 3 jours
  (jauge active la plus ancienne), on demande une nouvelle saisie.
- Captures restantes : effort restant avec vos montures (une monture du haut de l'arbre couvre une partie
  de la demande attendue, pas tout son sous-arbre), calibré par la simulation ; sans elle, borne haute.
- Calendrier : simulation depuis zéro ramenée à la part restante du programme (estimation) ; joueur parfait
  (× 1,5 à 2 en réel).
- Niveau estimé : plancher (bonus Almanax du journal non comptés) ; les enclos débloqués restent ceux du
  niveau saisi jusqu'à sa mise à jour.
