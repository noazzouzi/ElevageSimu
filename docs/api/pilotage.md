# API — tranche « Pilotage » (`src/domain/advisor.ts`, `src/store/planProgress.ts`)

« Que faire maintenant ? » : l'aide compose les autres modules du domaine (plans d'enclos démarrés,
simulation des jauges, Almanax, plan d'accouplement, sort des montures, répartition en enclos,
captures vers l'objectif, métier, prix manquants) en une liste d'actions **ordonnées, datées et
expliquées**, et fournit les briques du plan d'élevage (phase P0–P6, captures restantes, critères de
sortie détectés, repères de stratégie). Module pur (aucun React, aucun store), testé dans
`src/domain/advisor.test.ts` (28 tests, états synthétiques à heure fixe).

Pages associées : `src/ui/pages/HomePage.tsx` (`#/accueil`, page d'accueil) et
`src/ui/pages/PlanPage.tsx` (`#/plan?onglet=chemin|phase|strategie|routines|erreurs`).

## Utilisation type

```ts
const input: AdvisorInput = {
  now: Date.now(), settings, rules: useRules(), mounts, paddocks, paddockPlans,  // stores
  priceCtx: usePriceContext(), mountPrices, genetonValue: usePrices((s) => s.genetonValue), pricedItems,
}
const analysis = useMemo(() => analyzeState({ ...input, now: midi_du_jour }), [/* données, jour */]) // lourd
const advice = adviseNow(input, analysis)            // léger : à rappeler toutes les 30 s
const groups = groupAdvice(advice.filter((a) => !done[a.id]), Date.now())
```

`analyzeState` ne dépend de l'heure que par le jour (Almanax, Takeza) : ≈ 150 ms pour 60 montures,
≈ 25 ms pour `adviseNow` (simulations de jauges comprises).

## Types

| Élément | Rôle |
|---|---|
| `Advice` | `{ id, priority: 1…5, category, title, detail, dueAt?, allDay?, window?, horizon?, link: {page, params?, label}, items?: AdviceItem[], confidence?, amount?: {label, value, complete}, missing?: number[], action? }`. `id` est stable tant que la situation ne change pas (empreinte du contenu) : un conseil « fait » ne revient que pour une nouvelle situation. `amount.complete = false` / `missing` → afficher « coût incomplet » + lien Prix (jamais 0). `action = { kind: 'advance-plan', paddockId, to }` : bouton « Fait » qui valide le changement de jauges (`usePaddockPlans().advance` + `usePaddocks().setActive`). |
| `AdviceItem` | Ligne de checklist `{ id, text, hint?, link?, tone?, done? }` (`done` = détecté d'office). |
| `AdviceCategory` | `'alarme' \| 'almanax' \| 'accouplement' \| 'clonage' \| 'enclos' \| 'carburant' \| 'capture' \| 'vente' \| 'metier' \| 'prix' \| 'objectif'` ; `ADVICE_CATEGORIES` (ordre d'une session), `ADVICE_CATEGORY_LABELS`, `PRIORITY_LABELS`. |
| `AdviceHorizon` | `'maintenant' \| 'heures' \| 'aujourdhui' \| 'semaine'` ; `HORIZONS`, `HORIZON_LABELS`. |
| `AdvisorSettings` | Sous-ensemble structurel de `useSettings` (jobLevel, family, goalSpeciesId, goal, preferredTier, xpFiller, parentTargetLevel, useOptimakina, saleTax, useDefaultPrices). |
| `AdvisorPaddockPlan` | `PlanSchedule & { paddockId, tier, mountIds }` (= `ActivePaddockPlan` du store). |
| `AdvisorInput` | `{ now, settings, rules, mounts, paddocks, paddockPlans, priceCtx, mountPrices, genetonValue?, pricedItems? }`. |
| `AdvisorAnalysis` | `{ day, almanax, unlocked, summary (inventorySummary), fates (recommendFates), pairs (bestDisjointPairs), pairCandidates, assignment (assignPaddocks), freeSlots, goal, capture, job, fertility, genetonValue, expectedGenetons, matingJobXp, missingPrices, unpricedMounts }`. |

## Conseils produits (`adviseNow`)

| Conseil | Priorité | Source |
|---|---|---|
| Premiers pas (aucune monture) / profil à compléter | 1 / 2 | réglages, prix saisis |
| Changement de jauges d'un plan démarré (dû, fenêtre de sérénité, retard) ; plan terminé | 1–3 / 2 | `planProgress` (paddockAssign) |
| Jauge vide, qui va se vider, sous le palier du plan (quel carburant, combien, coût) ; jauge inutile ; niveaux trop anciens | 1–4 | `simulatePaddock` depuis la saisie, `fillPlan` (estimation) |
| Takeza aujourd'hui / à préparer (≤ 14 j), jauge doublée, bébés à capacité | 1–4 | `almanaxOn`, `upcomingAlmanax` |
| Plan d'accouplement (couples disjoints, Optimakina, étable) ; fécondes condamnées à accoupler avant de sortir | 2 | `rankPairs` + `bestDisjointPairs`, `recommendFates` |
| Clonage des stériles ; sorties (vente / extraction / brisage avec valeur) ; montée de niveau avant sortie | 2 / 3 / 4 | `recommendFates` |
| Placement en enclos (poser, jauges à activer/couper, démarrer le plan, montures en attente) | 2 | `assignPaddocks` (les montures à accoupler restent à l'étable) |
| Captures : couleurs et sexes pour l'objectif, places libres, succès de capture, zone/zaap, filet | 2–3 | `captureNeeds`, `captureStatus` |
| Métier : XP jusqu'au prochain enclos, meilleur craft, jalon, Almanax du métier | 3–4 | `bestCraftAt`, `levelingPlan`, `jobMilestones`, `jobAlmanaxDays` |
| Prix manquants qui bloquent les estimations (6 au plus, lien `href('prix', { q })`) | 3–4 | toutes les briques ci-dessus |
| Objectif atteint / à choisir / impossible | 2–3 | `goalStatus` |

## Fonctions

| Signature | Rôle |
|---|---|
| `analyzeState(input: AdvisorInput): AdvisorAnalysis` | Calculs lourds (sort, accouplements, répartition, objectif, métier, prix manquants), indépendants de l'heure. |
| `adviseNow(input: AdvisorInput, analysis?: AdvisorAnalysis): Advice[]` | Liste triée des actions à l'instant `input.now`. |
| `sortAdvice(list): Advice[]` | Priorité, puis heure, puis ordre d'une session. |
| `adviceHorizon(a, now): AdviceHorizon` | `horizon` imposé, sinon `dueAt` (≤ 15 min, ≤ 6 h, même jour, après) ou priorité (1–2, 3, 4–5). |
| `groupAdvice(list, now): { horizon, label, advice }[]` | Groupes non vides dans l'ordre des horizons. |
| `nextTimedAdvice(list, now): Advice \| null` | Prochaine action minutée. |
| `goalStatus(goalId, mounts, { parentLevel, useOptimakina, rules }): GoalStatus \| null` | Recette la moins chère, `expectedEffort` de la stratégie conseillée, captures restantes, `reached`. |
| `strategyEffortOptions(o): EffortOptions` | Parents au niveau visé, Optimakina dès la G6 (si activée), clonage. |
| `captureNeeds(tree, mounts, effort): CaptureNeed[]` | Par couleur G1 : `idealTotal`, `idealRemaining` (une monture fertile/féconde de l'arbre couvre son sous-arbre), `expected` (effort au prorata, ESTIMATION), possédées ♂/♀, répartition ♂/♀ conseillée. |
| `captureStatus(family, jobLevel, ctx): CaptureStatus` | Meilleur filet équipable (`bestNetKind`), `captureCost`, zone (`captureSpot`). |
| `captureSpot(family): CaptureSpot \| null`, `captureSpotText(spot)` | Zone et zaap (Dragodindes : Territoire des dragodindes sauvages, strategy.md §2.1). |
| `bestNetKind(jobLevel): NetKind` | universel < 100 ≤ multiplicateur < 150 ≤ renforcé < 200 ≤ multiplicateur renforcé. |
| `jobStatus(jobLevel, ctx, rules, { family?, todayIso, withPlan? }): JobStatus` | Prochain enclos, XP restante, avancement, prochain jalon (hors makinas), meilleur craft, plan de montée, Almanax du métier (≤ 30 j). |
| `currentPhase(jobLevel, mounts): StrategyPhase` | P0 (niv. ≤ 1 et < 20 montures) … P6 (niv. 200), d'après `STRATEGY.phases`. |
| `evaluateCriterion(text, { jobLevel, mounts }): boolean \| null` | Critère de sortie vérifié automatiquement (« Éleveur ≥ 40 », « ≥ 20 G1 », « première G9 »…) ; `null` = manuel. |
| `strategyHighlights(settings, rules): StrategyHighlight[]` | Repères chiffrés : niveau ~40, Optimakina (Δ du ruleset, seuil C_eff × Δ / p), clonage, palier, organisation des enclos, ordre d'une session. |
| `resolveRuleRefs(text): string` | « M-OPTI-01 » → « règle « Optimakina » » dans les textes de STRATEGY. |
| `levelSumForCertainty(rules, { optimakina, takeza }): number` | Niveaux cumulés pour 100 % de génération cible (400 / 334 / 267 / 200). |
| `nextTakeza(todayIso)`, `daysBetween(a, b)`, `isoToMs(iso)`, `startOfDay(ms)`, `formatIsoDay(iso)`, `relativeTime(at, now)`, `isoWeekKey(ms)`, `hashKey(s)`, `deName(nom)`, `checklistKey(scope, …parts)` | Utilitaires (dates locales, « dans 25 min », semaine ISO, identifiants, élision « d'Abreuvoir »). |

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
Le store est inclus dans la sauvegarde (`elevagesimu:*`).

## Hypothèses et limites (affichées dans les pages)

- Jauges : estimation à partir des niveaux saisis (`usePaddocks`, horodatage `updatedAt`) et des
  montures de l'enclos, sans recharge ; au-delà de 3 jours, on demande une nouvelle saisie.
- Captures restantes : besoin moyen de l'effort attendu au prorata de la recette idéale non couverte.
- Durée du plan : simulation rapide `programSim` (24 tirages, joueur parfait ; × 1,5 à 2 en réel).
- Rentabilité maximale : `crossingRanking` (marge par accouplement, hors coût d'obtention des parents).
