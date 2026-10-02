# API — Estimateur d'investissement (`src/domain/investment.ts`, `src/domain/investment.worker.ts`)

Pour un **budget en kamas** (ex. 20 M), cherche l'allocation qui maximise le **bénéfice net sur l'horizon** —
monter le métier d'Éleveur, stock de départ (G1 achetées), palier de jauge et stratégie, mode de rentabilité —
**sans jamais dépasser le budget** (dépenses du jour 0 + trésorerie engagée avant que les ventes ne paient
≤ budget − réserve), puis en tire un plan d'action daté, une feuille de route, la courbe de trésorerie, le point
mort, les projections à 30/60/90 jours, des alternatives, une sensibilité et les risques. Spécification :
`docs/SPEC-v2.md` §5. Module pur (aucun React, aucun store). Page : `src/ui/pages/InvestmentPage.tsx`
(`#/investissement`). Tests : `src/domain/investment.test.ts` (17 tests, ≈ 7 s, préréglage de Tylezia et
extrait du CSV réel), `src/ui/pages/InvestmentPage.test.tsx` (jsdom : adresse, préférences, calcul sans Worker).

S'appuie sur `levelingPlan`, `paddocksAt`, `jobMilestones`, `recipeCraftCost` (job), `runProduction`,
`simulateProduction`, `productionPlan`, `productionPriceBook`, `profitMode`, `COMPARED_MODES` (production),
`marketDepth`, `exportAgeDays` (market), `marketPrice`, `resolvePrice` (pricing), `jobXpForLevel`,
`jobLevelFromXp` (xp).

## Utilisation

```ts
const ctx = usePriceContext()                       // prix saisis + marché importé du serveur
const result = planInvestment({
  budget: 20_000_000, horizonDays: 60, mode: 'auto',  // ou un ProfitModeId ('rush-corne'…)
  profile: { jobLevel, jobXp, hoursPerDay, characters: settings.accounts, rules, family, onlyFamily },
  levers: { levelJob: true, buyG1: true, buyFuels: true, buyGear: true, resellCrafts: true },
  safetyReserve: 2_000_000,
  prices: { ctx, mountPrices, saleTax, maxMarketShare: server.maxMarketShare, genetonValue },
  today: isoDay(Date.now()),
}, { onProgress })                                  // ≈ 0,5 à 6 s : Web Worker conseillé
```

Dans une page : `new Worker(new URL('../../domain/investment.worker.ts', import.meta.url), { type: 'module' })`,
requête `{ type: 'plan', requestId, input }` → messages `progress {done, total, label}` (≤ 1 toutes les 50 ms,
`INVESTMENT_PROGRESS_INTERVAL_MS`), puis `result {result, durationMs}` ou `error {message}` ; annulation :
`worker.terminate()`. Traitement pur testable : `handleInvestmentRequest(req, post, now?)`. Sans Worker :
`planInvestmentAsync(input, {onProgress, shouldStop, sliceMs})` (null si arrêté).

## Entrées

| Champ | Rôle |
|---|---|
| `budget`, `safetyReserve` | Budget total et réserve jamais engagée ; `available = budget − réserve`. |
| `horizonDays` | Horizon d'optimisation (7 … 365). La simulation dure `max(horizon, 90)` jours (projections). |
| `mode` | `'auto'` (tous les modes comparés, les 2 meilleurs sont approfondis) ou un mode (`rush-corne`, `rush-ambre`, `rush-neurone`, `brisage-pa`, `brisage-pm`, `vente-montures`). `INVESTMENT_MODE_IDS`, `investmentModeLabel(id)`, `investmentModeFamilies(mode, {family, onlyFamily})`. |
| `profile` | `jobLevel`, `jobXp` (XP dans le niveau), `hoursPerDay`, `characters`, `rules`, `family` + `onlyFamily` (« auto » limité à la famille du profil), `sessionsPerDay?`, `captureHoursPerDay?`, `fightsPerHour?`. |
| `levers` (`InvestmentLevers`, défaut `DEFAULT_INVESTMENT_LEVERS`, libellés `LEVER_LABELS`) | `levelJob` (monter le métier en achetant les ingrédients), `buyG1` (G1 achetées à l'HDV), `buyFuels` / `buyGear` (sinon carburants / filets et Optimakinas **fabriqués seulement** : `investmentPriceContext` chiffre chaque recette à portée au coût de ses ingrédients et rend les autres indisponibles, `UNAVAILABLE_PRICE` ; paliers limités par `allowedTiers`), `resellCrafts` (revendre les objets fabriqués). |
| `prices` | `ProductionPrices` (contexte avec marché du serveur, taxe, part du volume vendable, généton, prix de montures). |
| `options` | `craftsPerHour` (défaut **1 500**, ESTIMATION), `craftHoursPerDay` (défaut ½ temps de jeu), `quick` (recherche réduite), `runs` (tirages de l'évaluation finale, 3), `seed`, `jobTargets` (défaut `INVESTMENT_JOB_TARGETS` = 40, 80, 100, 120, 160, 200), `sensitivity` (vrai). |

## Recherche

1. **Métier** : `levelingPlan(niveau, cible, ctx, {metric: 'kamas'})` pour chaque niveau candidat ; écartés : coût >
   budget engageable, coût **incomplet** (ingrédient sans prix : jamais choisi comme s'il était gratuit), crafts
   au-delà de la moitié de l'horizon (`MAX_LEVELING_SHARE`).
2. **Calendrier** (`jobTimeline`) : crafts dès le jour 0 au rythme `craftsPerHour × craftHoursPerDay` ; XP d'élevage
   (captures, accouplements) d'un **tirage témoin** (`simulateProduction`, sans les enclos qu'elle débloque :
   prudent) ; un niveau atteint en fin de journée débloque son enclos le lendemain → `paddocks` + `paddockSchedule`
   du moteur de production. Prix de craft et filet au niveau visé.
3. **« auto »** : chaque mode × {niveau actuel, niveau le plus haut abordable} avec une grille rapide ; les 2 meilleurs
   modes sont approfondis.
4. Pour chaque mode × niveau : génération visée 2 … 10 (brisage : niveaux 45/53/60/80 × paliers 1–2) au palier 2,
   puis paliers 1 et 3 pour les 2 meilleures, puis la variante **G1 achetées** (stock de départ pour remplir les
   enclos ouverts au jour 1, au plus une journée de ventes par couleur, + achats quotidiens plafonnés par le volume).
5. **Finalistes** (3 meilleurs + allocations nommées + plan rentable le moins gourmand) réévalués en Monte-Carlo
   (`runs` tirages, durée complète) ; retenu = **dans le budget**, coûts chiffrés, plus grand bénéfice à l'horizon,
   puis point mort le plus tôt (`better`).
6. **Sensibilité** sur le plan retenu, mêmes graines qu'une référence à 2 tirages : prix de vente −20 % / +20 %,
   coûts +20 %, durées × 1,5 (lots et crafts), liquidité ÷ 2, sans revente des crafts.

## Trésorerie (`cashFlowOf(summary, {day0Fixed, socle, resale})`)

Jour 0 = ingrédients du métier + G1 achetées + socle des jauges des enclos ouverts ; le socle d'un nouvel enclos
est payé le jour de son ouverture (socle compté dans l'investissement à rembourser, il reste dans les jauges) ;
jours 1 … N = coûts et revenus connus de la production (moyenne, 10e et 90e centiles) + revente des objets
fabriqués (`resaleSchedule` : à partir du lendemain, au plus `maxMarketShare` des ventes moyennes par jour de
chaque objet, taxe déduite ; objet absent de l'export → non vendu). **Trésorerie maximale engagée** (`peakOutlay`)
= creux du cumul au 10e centile, les dépenses d'un jour étant payées **avant** ses ventes ; `feasible` ⇔
`peakOutlay ≤ budget − réserve`. **Point mort** = premier jour où le cumul est positif et le reste ; au-delà de la
durée simulée, extrapolé au rythme du régime permanent (`breakEvenEstimated`).

## Résultat (`InvestmentResult`)

| Champ | Contenu |
|---|---|
| `feasible`, `plan` | Plan retenu (`InvestmentEvaluation`) ; budget insuffisant : `feasible: false`, `plan` = plan rentable le moins gourmand, `notes[0]` l'explique, **`minimumBudget`** (≥ trésorerie de ce plan + réserve, arrondi à 100 000 ; avec ce budget un plan tient — test). |
| `plan` | `allocation` (`InvestmentAllocation` : mode, famille, métier `jobFrom → jobTo`, stratégie et libellé, palier, `g1Stock`, `g1PerDay`, `summary`), `day0`, `day0Complete`, `peakOutlay`, `workingCapital`, `profitAtHorizon` (+ `…Low`), `projections` (30/60/90/horizon : cumul, ROI), `breakEvenDay`, `steadyNetPerDay` (+ p10/p90), `roi`, `leveling` (coût, crafts, jours de craft, segments, revente), `levelDays` (jalons du métier : jour, source `craft`/`elevage`), `initialPaddocks`, `schedule`, `g1StockLines`, `socle`, `cashflow: CashFlowPoint[]`, `summary` (`ProductionSummary`), `complete`, `missing`, **`profitStatus`** (`exact`, `borne-haute` = un coût manque « ≤ », `borne-basse` = un revenu manque « ≥ », `inconnu`). |
| `shopping: ShoppingItem[]` | Courses du jour 0 : `metier` (ingrédients), `montures` (G1), `socle`, `fonds` (fonds de roulement) — quantité, prix unitaire, total, origine, `sold24`, `perDayAvg`, **`daysOfVolume`** (quantité ÷ ventes par jour). `investmentShoppingText(items)` : « Nom × quantité ». |
| `actions: InvestmentAction[]` | Plan chronologique en français (`day`, `toDay?`, `kind` : achat, réserve, craft, enclos, production, vente, jalon ; `title`, `details`, `kamas`) : achats du jour 0, crafts jour par jour (niveaux atteints), revente, enclos débloqués et leur socle, lancement de l'élevage, achats quotidiens de G1, premier bébé visé, premières ventes, routine du régime permanent (captures par couleur, accouplements, extractions, ventes, carburant par jauge acheté ou fabriqué), point mort, fin de l'horizon. |
| `roadmap: RoadmapMilestone[]` | Jalons : départ, métier, enclos, première cible, premières ventes, régime permanent, point mort, horizon. |
| `alternatives: AlternativeRow[]` | Retenu + « Tout dans le métier », « Stock de montures », « Sans investissement », autre mode (« auto »), variantes : jour 0, trésorerie, bénéfice, point mort, bénéfice/jour, ROI, dans le budget ou non. |
| `sensitivity: SensitivityRow[]` | Référence + scénarios : bénéfice, écart, point mort, bénéfice/jour, trésorerie. |
| `risks`, `assumptions`, `notes` | Risques (`danger`/`warn`/`info`) : pas de marché, prix datés (`exportAgeDays`, > 14 j), volume produit vs ventes du serveur, saturation des ventes de montures, ingrédients au-delà d'une journée de ventes, revente partielle, brisage corrigeable, HDV mixte, G1 séniles, part des génétons, temps de jeu (durées × 1,5), prix manquants ; hypothèses (dont celles du moteur de production) ; notes (niveaux écartés, budget inutilisé). |
| `unusedBudget`, `evaluated`, `marketDate`, `marketServer`, `craftsPerDay` | Divers. |

## Page `#/investissement`

Entrées : budget (préréglages 5 M / 20 M / 50 M, réserve 10 %), horizon (30/60/90), mode, réserve, leviers,
« seulement la famille du profil » (auto) ; profil (niveau d'Éleveur **estimé** comme la page Métier : saisi + XP
du journal), marché du serveur. Préférences par profil (`profileKey('investissement')`) ; adresse
`?mode=&budget=&horizon=&reserve=` (lien « Calculer avec le minimum utile »). Calcul automatique à l'ouverture
dans un Web Worker (bouton sinon), progression et annulation, résultat signalé périmé si les entrées changent.
Résultats : indicateurs (point mort, bénéfice/jour, bénéfice à l'horizon, jour 0, trésorerie, ROI 30/60/90),
allocation, courbe SVG du cumul (bande 8 tirages sur 10, point mort, horizon, survol et clavier, tableau),
feuille de route, courses du jour 0 (copie), plan jour par jour, alternatives, sensibilité, risques et hypothèses.

## Repères Tylezia (export HDV du 02/10/2026, règles 3.6)

Profil : Éleveur niveau 1, 3 h de jeu/jour (2 passages), 1 personnage, budget **20 M**, réserve 2 M, horizon 60 j :

| Mode | Plan retenu | Jour 0 | Trésorerie max | Point mort | Bénéfice/jour (régime) | Cumul 30 / 60 / 90 j |
|---|---|---|---|---|---|---|
| Rush Volkorne | Métier 1 → 160 (7,44 M d'ingrédients, 8 110 crafts en 4 jours, revente ≈ 5,2 M) · G4 · palier 2 | 7,53 M | 7,76 M | jour 14 | ≈ 935 K (66 Cornes/jour = 1,6 % du marché) | 12,7 / 40,8 / 69,1 M |
| Rush Dragodinde | Métier 1 → 160 · G6 · palier 2 | 7,53 M | 8,12 M | jour 15 | ≈ 1,51 M | 20,0 / 64,0 / 109,5 M |
| Rush Muldo | Métier 1 → 200 · G8 · G1 achetées | 13,28 M | 17,45 M | jour 21 | ≈ 1,74 M | 14,8 / 67,3 / 119,9 M |
| Brisage PA | Métier 1 → 160 · niveau 53 · palier 1 | 7,44 M | 7,60 M | jour 8 | ≈ 774 K | 17,5 / 40,2 / 63,7 M |
| Auto (= Vente, Volkornes) | Métier 1 → 160 · G4 · palier 2 | 7,53 M | 7,76 M | jour 10 | ≈ 1,83 M (prix « HDV mixte » prudents) | 32,8 / 85,4 / 140,7 M |

Rush Volkorne, sensibilité (référence 40,3 M à 60 j) : prix −20 % → 22,0 M (point mort j 20) ; +20 % → 58,6 M ;
coûts +20 % → 30,1 M ; durées × 1,5 → 20,4 M (j 19) ; liquidité ÷ 2 → 39,8 M ; sans revente des crafts → 35,4 M.
Alternatives : « Tout dans le métier » (1 → 200, G8) 34,1 M (trésorerie 16,7 M, j 27) ; « Sans investissement »
10,7 M ; « Stock de montures » 7,5 M (une G1 achetée ≈ 14 K contre ≈ 1,4 K le filet). Environ 10 M du budget
restent inutilisés : au-delà du niveau 160, le 6e enclos arrive de toute façon par l'XP d'élevage (jour 30).
Calcul : ≈ 2 s (un mode), ≈ 5 s (« auto », ≈ 270 simulations) dans le Worker.

## Limites

Rythme de craft et temps d'achat des ingrédients estimés ; ingrédients achetés tous le jour 0 (prix supposés
stables malgré le volume, signalé au-delà d'une journée de ventes) ; XP et temps des crafts de consommables non
comptés ; prix de craft et filet du niveau visé dès le jour 1 ; achat de montures autres que G1 non proposé
(séniles) ; mêmes limites que le moteur de production (`docs/api/production.md`).
