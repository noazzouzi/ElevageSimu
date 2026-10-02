# API — tranche « Optimiseur » (`src/domain/programSim.ts`, `src/domain/programSim.worker.ts`)

Simulateur Monte-Carlo d'un **programme d'élevage complet** (captures → fécondations → accouplements →
clonages) jusqu'à la première naissance d'une monture cible, comparaison de stratégies, coût en kamas et
recommandation. Portage TypeScript de `research/raw/strategy-evidence/sim/pyramid_sim.py`
(research/strategy.md §6). Module pur (aucun React, aucun store, aucun `Math.random` : générateur
mulberry32 à graine), testé dans `src/domain/programSim.test.ts` (33 tests, ≈ 3 s). Il s'appuie sur
`breed`/`targetChance` (`genetics.ts`), `cheapestRecipe`/`requiredSpecies` (`breedingPath.ts`),
`bestFuel` (`fuel.ts`), `makinaCost`/`captureCost`/`fertilitySeconds`/`DEFAULT_SERENITY_POINTS`
(`economy.ts`), `mountXpForLevel` (`xp.ts`).

Page associée : `src/ui/pages/OptimizerPage.tsx` (`#/optimiseur`). Sessions par jour par défaut :
`sessionsPerDayFor(settings.hoursPerDay)` (temps de jeu des Réglages, comme le calendrier du Plan) tant que
la page ne les modifie pas. La simulation part d'une étable vide : la page indique la part du programme qui
reste avec vos montures (`advisor.goalStatus(...).remainingShare`, modèle analytique) et l'hypothèse de lot
idéal (`BatchAssumption` : écart avec un lot typique du planificateur).

## Politique simulée (identique à la recherche)

Chaque cycle (= une session de jeu ; 12 h par défaut) : (1) besoin de chaque couleur calculé depuis la
cible (besoin / B, ×½ ou ×¾ avec clonage) ; (2) accouplement des fécondes dont le bébé est en déficit
(sexes opposés, arbres « propres » d'abord) ; (3) clonage des stériles de même génération (même couleur
d'abord) ; (4) bébés de couleurs inutiles écartés ; (5) captures des G1 en déficit, au plus les places
libres ; (6) mise en enclos (génération la plus haute d'abord). Féconde après `ceil(fertilitySeconds(palier)
/ durée du cycle)` cycles (+ XP au-delà du niveau 40 au débit du palier). Recette = la moins chère en
captures. Sexes 50/50. Blocage de sexes → un exemplaire de plus de chaque parent de la recette la plus haute.

## Configuration

| Élément | Rôle |
|---|---|
| `type MakinaPolicy = 'none' \| 'all' \| { fromGeneration: number }` | Optimakina jamais, partout, ou pour les bébés de génération ≥ N. |
| `interface ProgramConfig` | `targetSpeciesId`, `parentLevel` (1–200), `levelByGeneration?` (niveau par génération du parent, prioritaire), `makina`, `cloning`, `paddocks` (1–6), `tier` (palier 1–4 : durée de fécondation, débit d'XP, prix au point), `batchSize` (montures par lot, 1–10 ; places = enclos × lot), `rules` (`useRules()`), `maxDays`, `runs`, `sessionsPerDay?` (défaut 2), `seed?` (défaut 1), `cloneKeepsLevel?` (défaut vrai, hypothèse), `serenityPointsPerBatch?` (défaut 3 200), `kappa?` (défaut 1). |
| `normalizeProgramConfig(cfg): NormalizedProgramConfig` | Bornes et valeurs par défaut (tous les champs optionnels résolus). |
| `paddocksForJobLevel(jobLevel): number` | Enclos débloqués (niv. 1/40/80/120/160/200 → 1…6). |
| `usesOptimakina(policy, generation): boolean`, `makinaPolicyLabel(policy): string` | Politique d'Optimakina ; libellé FR (« Optimakina dès la G6 »). |
| `FREE_XP_LEVEL = 40`, `STAT_POINTS_PER_BATCH = 60 000`, `DEFAULT_SESSIONS_PER_DAY = 2`, `MAX_RUNS = 1000`, `MAX_DAYS = 2000`, `FUEL_GAUGES` | Constantes. |
| `mulberry32(seed): () => number`, `runSeed(base, index): number` | Générateur reproductible ; graine du tirage n° `index`. |

## Simulation

| Signature | Rôle |
|---|---|
| `programPlan(cfg): ProgramStep[]` | Chaîne de croisements retenue (cible → captures) : `speciesId`, `generation`, `crossing` (null = capture), `parentLevels`, `optimakina`, `targetChance` (B). |
| `simulateProgram(cfg, seed): ProgramRun` | Un tirage. `ProgramRun` : `success`, `captures`, `capturesByColor` (id G1 → n), `matings`, `successes` (bébé visé), `fecundations` (passages en enclos), `clones`, `optimakinas`, `makinasByGeneration` (génération de makina requise → n), `cycles`, `days`, `genetons`, `jobXp` (= `jobXpMatings` k × ΣG + `jobXpCaptures` 30 × captures), `fuelPoints` par jauge (consommation partagée par le lot), `statFuelPoints`, `xpFuelPoints` (Mangeoire), `totalFuelPoints`, `mountXp`, `surplusMounts`, `sterileLeft`, `extractResources`, `deadlocks`, `peakHeld` (pic de montures hors enclos, à comparer à `rules.stableSlots`). Lève une erreur pour une monture non élevable ; une G1 = 1 capture. |
| `summarizeProgram(cfg, runs): ProgramSummary` | Agrégat : `metrics[m]` = `DistStat` {`mean`, `p10`, `p90`, `min`, `max`} pour chaque `SUMMARY_METRICS`, `fuelPoints[g]`, `makinasByGeneration[]`, `capturesByColor[]`, `successRate`, `steps`, `family`, `slots`, `cycleHours`, `fecundationCycles`, `config` normalisée. |
| `distStat(values): DistStat` | Moyenne et centiles (convention de la recherche : `v[floor(0,1·(n−1))]`). |
| `runProgram(cfg, { onProgress? }): ProgramSummary` | `cfg.runs` tirages synchrones + agrégat. |
| `runStrategies(jobs: StrategyJob[], { onProgress?, onResult? }): StrategyJobResult[]` | Plusieurs stratégies à la suite (utilisé par le worker). `StrategyJob = { id, label, config }`, `StrategyJobResult = { id, label, summary }`. |
| `runStrategiesAsync(jobs, { onProgress?, onResult?, shouldStop?, sliceMs? }): Promise<StrategyJobResult[] \| null>` | Même chose en rendant la main toutes les ~40 ms (repli sur le fil principal) ; `null` si arrêté. |

## Web Worker (`programSim.worker.ts`)

```ts
const w = new Worker(new URL('../../domain/programSim.worker.ts', import.meta.url), { type: 'module' })
w.postMessage({ type: 'run', requestId, jobs } satisfies ProgramWorkerRequest)
w.onmessage = (e: MessageEvent<ProgramWorkerMessage>) => { /* progress | result | done | error */ }
```

| Élément | Rôle |
|---|---|
| `ProgramWorkerRequest = { type: 'run'; requestId; jobs: StrategyJob[] }` | Requête (structured clone : `rules` est un objet de données). |
| `ProgramWorkerMessage` | `progress {done, total, jobId}` (≤ 1 toutes les `PROGRESS_INTERVAL_MS` = 50 ms, plus le dernier), `result {result}` par stratégie, `done {results, durationMs}`, `error {message}`. Tous portent `requestId`. |
| `handleProgramRequest(req, post, now?)` | Traitement pur (testable sans Worker). Annulation : `worker.terminate()`. |

L'enregistrement du gestionnaire n'a lieu que dans un vrai `WorkerGlobalScope` : importer le module
(types, tests) n'a pas d'effet.

## Stratégies prédéfinies et références

| Élément | Rôle |
|---|---|
| `STRATEGY_PRESETS: StrategyPreset[]` | `n1` (niv. 1 sans makina), `n40`, `n40-opti-g6`, `n40-opti`, `n100-opti`, `mixte` (niv. 40/60/100 selon la génération + Opti dès G8 = `MIXED_LEVELS`), `sans-clonage` (niv. 40). Champs : `label`, `description` (pourquoi), `parentLevel`, `levelByGeneration?`, `makina`, `cloning`, `defaultSelected`, `warning?`. |
| `findPreset(id)`, `presetConfig(preset, base: ProgramBase): ProgramConfig` | `ProgramBase` = config sans niveau/makina/clonage. |
| `RESEARCH_REFERENCES`, `researchReference(speciesId, presetId, rules)`, `researchReferenceSpecies()` | Valeurs de strategy.md §6.2 (Python, 40 tirages, 60 places, cycles de 12 h) : captures, accouplements et, pour les G9/G10, fécondations, Optimakinas, carburant (M), demi-journées, génétons. `rules` : 3.5/3.6 (même bonus d'Optimakina) ou 3.7. |

## Coût en kamas

`estimateProgramCost(summary, { ctx, rules, tier, jobLevel, netKind?, mountsPerCast?, genetonValue?, craftableOnly? }): ProgramCost`
(page Optimiseur et Plan : `genetonValue` = `useGenetonValue().net`, valeur NETTE du généton du profil — marché du
serveur sans valeur saisie —, affichée « nette de taxe »)

- Lignes (`ProgramCostLine`) : une par jauge (`points moyens × bestFuel(g, maintainedTier(g, …, tier)).value` :
  Baffeur et Caresseur au palier 1, comme la page Enclos et Rentabilité), une par génération
  d'Optimakina (`makinaCost('optimakina', famille, G)`), une pour les filets (`captureCost(...).perMount ×
  captures`). Chaque ligne : `quantity`, `unit`, `unitCost`, `cost` (null si inconnu), `complete`, `bound`
  (`'min'` borne basse, `'max'` borne haute : palier supérieur seulement), `estimated` (défaut de la recherche,
  Mangeoire), `missing` (ids à chiffrer → `href('prix', { q: itemName(id) })`), `itemId`.
- `total` = somme des lignes connues hors bornes hautes : exact si `complete`, sinon **borne basse** (jamais
  0 pour un prix inconnu). `byCategory` (`carburant`/`makina`/`capture`), `nonMakinaCost`/`nonMakinaComplete`,
  `makinaCost`/`makinaComplete`, `missing`, `estimated`, `genetonsValue` (non déduite).
- `PROGRAM_COST_LABELS` : libellés FR des catégories.

## Comparaison

`compareStrategies(outcomes: StrategyOutcome[]): StrategyComparison` (`StrategyOutcome = StrategyJobResult & { cost }`)

- `reliable` (réussite ≥ `RELIABLE_SUCCESS_RATE` = 90 %), `fastest`, `fewestCaptures`, `leastFuel` (parmi les fiables).
- `cheapest` : la moins chère des coûts complets, **seulement** si aucune stratégie au coût incomplet n'a
  une borne basse inférieure ; `costComparable` = tous les coûts complets.
- `tradeoffs: MakinaTradeoff[]` : chaque stratégie avec Optimakina face à la même (niveaux, clonage) sans
  makina : captures/accouplements/carburant/jours économisés, `savings` (hors makinas), `breakEvenPrice` =
  économie / makinas (règle « prix < C × Δ / p » à l'échelle du programme), `averageMakinaPrice`, `worthIt`.
- `messages: Recommendation[]` (`tone` ok/info/warn, `title`, `text` en français) : plus rapide (avec
  durée réelle ×1,5–2), moins chère ou « impossible de départager », moins de captures, bilans d'Optimakina,
  « le clonage est indispensable », « monter les parents au niveau 40 », cibles pas toujours atteintes.

## Validation contre la recherche (60 places, palier 3, cycles de 12 h, 40 tirages, graine 1)

Captures / accouplements (recherche entre parenthèses) :

| Cible | Niv. 1 | Niv. 40 | Niv. 40 + Opti dès G6 | Niv. 40 + Opti partout | Niv. 100 + Opti | Mixte |
|---|---|---|---|---|---|---|
| Dragodinde Émeraude (G9) | 596 / 3 184 (638 / 3 394) | 199 / 842 (188 / 821) | 155 / 591 (150 / 591) | 112 / 387 (111 / 378) | 62 / 211 (64 / 217) | 136 / 541 (134 / 514) |
| Dragodinde Turquoise (G7) | 199 / 806 (184 / 726) | 100 / 271 (99 / 278) | — | 64 / 149 (66 / 165) | 37 / 98 (34 / 88) | — |
| Muldo Prune (G7) | 191 / 739 (184 / 714) | 104 / 237 (104 / 259) | — | 62 / 127 (63 / 135) | 47 / 81 (49 / 85) | — |
| Volkorne Doré (G7) | 204 / 959 (204 / 921) | 112 / 373 (101 / 328) | — | 74 / 229 (76 / 238) | 55 / 136 (58 / 140) | — |
| Muldo Corail (G9) | — | 183 / 608 (183 / 617) | — | 109 / 261 (108 / 267) | — | — |
| Volkorne Jade (G9) | — | 199 / 810 (198 / 775) | — | 114 / 379 (106 / 347) | — | — |
| Dragodinde Amande et Émeraude (G10) | — | 255 / 1 162 (247 / 1 130) | — | 130 / 464 (137 / 471) | — | — |

Demi-journées (Émeraude) : 129 (139), 52 (56), 47 (49), 42 (40), 76 (71), et Optimakinas dès G6 : 64 (65).
Sans clonage, niveau 1 : Ébène ≈ 76 captures, Pourpre ≈ 735 / 604, comme la recherche (tests).

**Écarts documentés** (tous dans la tolérance stochastique, ≤ ~14 %) :

- Ordre des tirages et départage des égalités différents (générateur mulberry32, recettes à égalité départagées
  comme `breedingPath.cheapestRecipe`) : mêmes lois, pas les mêmes tirages.
- Sérénité : 3 200 points par lot (`DEFAULT_SERENITY_POINTS` de economy.ts) au lieu de 3 000 → carburant de
  stats +0,3 % (Émeraude niv. 40 : 11,8 M contre 11,4 M, avec un peu plus de fécondations).
- **Mangeoire comptée dès le niveau 1** (coût réel : l'XP jusqu'au niveau 40 est gratuite en *temps*, pas en
  carburant) : `xpFuelPoints` = Σ XP(L) / lot ; la recherche ne comptait que l'XP au-delà de 20 437. Le total
  de carburant est donc plus élevé au niveau 40 (+≈ 2 044 points par nouvelle monture).
- Paramètres en plus : palier (le débit d'XP au-delà du niveau 40 vaut 3 XP/s au palier 3, valeur fixe de la
  recherche), taille du lot, sessions par jour (cycles de fécondation = `ceil(durée du lot / cycle)`), XP de
  tous les niveaux (table complète, la recherche n'avait que 1/20/40/60/80/100/150/200).
- `peakHeld` exclut les stériles quand le clonage est désactivé (vendues/extraites aussitôt).
- La politique de la recherche capture tôt beaucoup de basses générations (le besoin propagé /B gonfle les
  étages bas) : une grosse réserve de fécondes attend en étable (pic ≈ nombre de captures). C'est le
  comportement de référence, conservé tel quel.

Non modélisé : porteurs, achats/ventes, Reproducteur, Takeza, limite d'étable, variabilité des couleurs
sauvages ; joueur parfait (×1,5–2 sur les durées réelles).
