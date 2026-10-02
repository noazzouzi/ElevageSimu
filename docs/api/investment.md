# API — Estimateur d'investissement (`src/domain/investment.ts`, `src/domain/investment.worker.ts`)

Pour un **budget en kamas** (ex. 20 M), cherche l'allocation qui maximise le **bénéfice net sur l'horizon** —
monter le métier d'Éleveur, stock de départ (G1 achetées), palier de jauge et stratégie, mode de rentabilité —
**sans jamais dépasser le budget** (dépenses du jour 0 + trésorerie engagée avant que les ventes ne paient
≤ budget − réserve), puis en tire un plan d'action daté, une feuille de route, la courbe de trésorerie, le point
mort, les projections à 30/60/90 jours, des alternatives, une sensibilité et les risques. Spécification :
`docs/SPEC-v2.md` §5. Module pur (aucun React, aucun store). Page : `src/ui/pages/InvestmentPage.tsx`
(`#/investissement`). Tests : `src/domain/investment.test.ts` (27 tests, ≈ 10 s, préréglage de Tylezia et
extrait du CSV réel ; blocs « ECO-V2 » et « UX2 » des revues économique et « parcours » v2),
`src/ui/pages/InvestmentPage.test.tsx` (jsdom : adresse, préférences, mode par défaut, calcul sans Worker, « Suivre ce
plan »).

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
  levers: { levelJob: true, buyG1: true, buyFuels: true, buyGear: true, resellCrafts: true, countMixedMountPrices: false },
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
| `profile` | `jobLevel`, `jobXp` (XP dans le niveau), `hoursPerDay`, `characters`, `rules`, `family` + `onlyFamily` (« auto » limité à la famille du profil), `sessionsPerDay?`, `captureHoursPerDay?`, `fightsPerHour?`, **`initialStock?`** (revue UX2-16 : montures possédées, `stockFromInventory(mounts)` — par espèce, état et niveau, séniles et non reproductibles ignorées ; stock de départ de la production en plus des G1 achetées, filtré par famille ; les G1 achetées ne remplissent que les places que vos montures n'occupent pas ; hypothèse « Étable actuelle prise en compte : N montures… » ou « non prise en compte »). |
| `levers` (`InvestmentLevers`, défaut `DEFAULT_INVESTMENT_LEVERS`, libellés `LEVER_LABELS`) | `levelJob` (monter le métier en achetant les ingrédients), `buyG1` (G1 achetées à l'HDV), `buyFuels` / `buyGear` (sinon carburants / filets et Optimakinas **fabriqués seulement** : `investmentPriceContext` chiffre chaque recette à portée au coût de ses ingrédients et rend les autres indisponibles, `UNAVAILABLE_PRICE` ; paliers limités par `allowedTiers`), `resellCrafts` (revendre les objets fabriqués), **`countMixedMountPrices`** (défaut faux : une vente de montures chiffrée au prix « HDV mixte » est spéculative et jamais retenue en mode automatique). |
| `prices` | `ProductionPrices` (contexte avec marché du serveur, taxe, part du volume vendable, généton, prix de montures). |
| `options` | `craftsPerHour` (défaut **1 500**, ESTIMATION, **réglable sur la page**), `craftHoursPerDay` (défaut ½ temps de jeu), `quick` (recherche réduite), `runs` (tirages de l'évaluation finale, 3), `seed`, `jobTargets` (défaut `INVESTMENT_JOB_TARGETS` = 40, 80, 100, 120, 160, 200), `sensitivity` (vrai). |

## Recherche

1. **Métier** : `levelingPlan(niveau, cible, ctx, {metric: 'kamas'})` pour chaque niveau candidat ; écartés : coût >
   budget engageable, coût **incomplet** (ingrédient sans prix : jamais choisi comme s'il était gratuit), crafts
   au-delà de la moitié de l'horizon (`MAX_LEVELING_SHARE`).
2. **Calendrier** (`jobTimeline`) : crafts dès le jour 0 au rythme `craftsPerHour × craftHoursPerDay` ; XP d'élevage
   (captures, accouplements) d'un **tirage témoin** (`simulateProduction`, sans les enclos qu'elle débloque :
   prudent) ; un niveau atteint en fin de journée débloque son enclos et son filet le lendemain → `paddocks` +
   `paddockSchedule` + **`jobLevelSchedule`** (filet du jour : captures par lancer et par heure, coût d'une capture)
   du moteur de production. Pendant les jours de craft, **temps de capture = temps de jeu − crafts − passages aux
   enclos** (`SESSION_HOURS` = 0,25 h par passage, ESTIMATION ; `captureHoursSchedule`). Prix de craft
   (carburants, makinas) au niveau visé dès le jour 1.
3. **« auto »** : chaque mode × {niveau actuel, niveau le plus haut abordable} avec une grille rapide ; les 2 meilleurs
   modes **non spéculatifs** sont approfondis (vente « HDV mixte » : seulement si rien d'autre, ou levier
   `countMixedMountPrices`).
4. Pour chaque mode × niveau : génération visée 2 … 10 (brisage : niveaux 45/53/60/80 × paliers 1–2) au palier 2,
   puis paliers 1 et 3 pour les 2 meilleures, puis la variante **G1 achetées** (stock de départ pour remplir les
   enclos ouverts au jour 1, au plus une journée de ventes par couleur, + achats quotidiens **seulement pour les
   places que les captures ne peuvent pas remplir** : besoin de places d'un tirage témoin aux captures illimitées −
   capacité de capture du jour ; le plus souvent 0, le stock de départ suffit ; libellé « ≤ N/jour » = min(achats
   prévus, plafond du volume des objets-montures)). Le moteur capture d'abord et n'achète que le reste.
5. **Finalistes** (3 meilleurs + allocations nommées + plan rentable le moins gourmand) réévalués en Monte-Carlo
   (`runs` tirages, durée complète) ; retenu (`pickRecommended`) = **dans le budget**, non spéculatif (« auto »),
   coûts chiffrés, plus grand bénéfice à l'horizon — mais deux bénéfices **à égalité** (`profitTie` : écart ≤ 5 %
   du meilleur, `PROFIT_TIE_SHARE`, ou ≤ 2 erreurs types combinées des tirages) se départagent par la **trésorerie
   engagée la plus faible**, puis le point mort le plus tôt. Libellé « Recommandé ».
6. **Sensibilité** sur le plan retenu, mêmes graines qu'une référence à 2 tirages : prix de vente −20 % / +20 %,
   coûts +20 %, durées × 1,5 (lots et crafts), liquidité ÷ 2, **sans génétons** (si le plan en produit), **prix des
   montures −50 %** (si le plan vend des montures), **crafts deux fois plus lents** (si montée du métier), sans
   revente des crafts. **Pire scénario** (`worstCase`) : le plus bas de prix −20 %, durées × 1,5, liquidité ÷ 2, sans
   génétons et prix des montures −50 % — courbe en tirets et valeur à 60 jours à côté du plan. Prix, coûts et liquidité
   gardent la chronologie de la référence (écart = effet du scénario) ; durées et crafts décalent les lots, les tirages ne
   se correspondent plus : `withinNoise` (écart sous `profitTie`, 5 % ou 2 erreurs types) affiche « ≈ » et grise la ligne.

## Trésorerie (`cashFlowOf(summary, {day0Fixed, socle, resale})`)

Jour 0 = ingrédients du métier + G1 achetées + socle des jauges des enclos ouverts ; le socle d'un nouvel enclos
est payé le jour de son ouverture (socle compté dans l'investissement à rembourser, il reste dans les jauges) ;
jours 1 … N = coûts et revenus connus de la production (moyenne et **bande** : 10e–90e centiles interpolés à partir
de 10 tirages, sinon **min–max des tirages**, `bandLabel` « min–max des 3 tirages ») + revente des objets
fabriqués (`resaleSchedule` : à partir du lendemain, au plus `maxMarketShare` des ventes moyennes par jour de
chaque objet, taxe déduite ; objet absent de l'export → non vendu). **Trésorerie maximale engagée** (`peakOutlay`)
= creux du bas de la bande, les dépenses d'un jour étant payées **avant** ses ventes ; `feasible` ⇔
`peakOutlay ≤ budget − réserve`. **Point mort** = premier jour où le cumul est positif et le reste ; au-delà de la
durée simulée, extrapolé au rythme du régime permanent (`breakEvenEstimated`).

## Résultat (`InvestmentResult`)

| Champ | Contenu |
|---|---|
| `feasible`, `plan` | Plan retenu (`InvestmentEvaluation`) ; budget insuffisant : `feasible: false`, `plan` = plan rentable le moins gourmand, `notes[0]` l'explique, **`minimumBudget`** (≥ trésorerie de ce plan + réserve, arrondi à 100 000 ; avec ce budget un plan tient — test). |
| `plan` | `allocation` (`InvestmentAllocation` : mode, famille, métier `jobFrom → jobTo`, stratégie et libellé, palier, `g1Stock`, `g1PerDay` (achats quotidiens réellement possibles), `summary`), `day0`, `day0Complete`, `peakOutlay`, `workingCapital`, `profitAtHorizon` (+ `…Low`), `projections` (30/60/90/horizon : cumul, ROI), `breakEvenDay`, `steadyNetPerDay` (+ `steadyNetP10`/`P90` = bande), **`runs`**, **`bandLabel`**, **`profitSe`**, **`stable`**, **`speculative`**, `roi`, `leveling` (coût, crafts, jours de craft, segments, revente), `levelDays` (jalons du métier : jour, source `craft`/`elevage`), `initialPaddocks`, `schedule`, `g1StockLines`, `socle`, `cashflow: CashFlowPoint[]`, `summary` (`ProductionSummary`), `complete`, `missing`, **`profitStatus`** (`exact`, `borne-haute` = un coût manque « ≤ », `borne-basse` = un revenu manque « ≥ », `inconnu`). |
| `shopping: ShoppingItem[]` | Courses du jour 0 : `metier` (ingrédients), `montures` (G1), `socle`, `fonds` (fonds de roulement) — quantité, prix unitaire, total, origine, `sold24`, `perDayAvg`, **`daysOfVolume`** (quantité ÷ ventes par jour). Objet du socle **à fabriquer** (origine `craft`, revue UX2-10) : **`ingredients`** (`{id, name, qty, unitPrice, origin}` de la recette × quantité) et `craftLevel` (recette au-dessus du niveau de départ : « après la montée du métier — sinon à l’HDV ≈ X »). `investmentShoppingText(items)` : « Nom × quantité », et « Petit Extrait d'Abreuvoir × 100 (à fabriquer : Ortie × 100, Bougie du Mineur Sombre × 100) » pour un objet à fabriquer. |
| `actions: InvestmentAction[]` | Plan chronologique en français (`day`, `toDay?`, `kind` : achat, réserve, craft, enclos, production, vente, jalon ; `title`, `details`, `kamas`) : achats du jour 0, crafts jour par jour (niveaux atteints), revente, enclos débloqués et leur socle (**une action par jour** : « Niveaux 80 et 120 atteints → 3e et 4e enclos », socle du jour compté une fois : Σ socle des actions = `socleTotal`), lancement de l'élevage (capacité de capture de la semaine 1), achats quotidiens de G1 (s'il en faut), premier bébé visé, premières ventes, routine du régime permanent (captures par couleur, accouplements, extractions, ventes, carburant par jauge acheté ou fabriqué), point mort, fin de l'horizon (bande des tirages). |
| `roadmap: RoadmapMilestone[]` | Jalons : départ, métier, enclos, première cible, premières ventes, régime permanent, point mort, horizon. |
| `alternatives: AlternativeRow[]` | Retenu + « Tout dans le métier », « Stock de montures », « Sans investissement », autre mode (« auto »), variantes : jour 0, trésorerie, bénéfice, point mort, bénéfice/jour, ROI, dans le budget ou non. |
| `sensitivity: SensitivityRow[]`, `worstCase: WorstCase \| null` | Référence + scénarios : bénéfice, écart, point mort, bénéfice/jour, trésorerie, `withinNoise` (scénario qui décale la chronologie et dont l'écart tient dans le bruit des tirages) ; pire scénario (`id`, `label`, `cumulative[]`, `profitAtHorizon`, `at60`, `breakEvenDay`, `runs`). |
| `ROI_MIN_OUTLAY` (500 000), `roiIsSignificant(peakOutlay, budget)` | ROI affiché « non significatif » si la trésorerie engagée est < 500 000 K ou < 1 % du budget (revue UX2-09 : « ROI 10 546 % » sur ≈ 93 k engagés). |
| `risks`, `assumptions`, `notes` | Risques (`danger`/`warn`/`info`) : pas de marché, prix datés (`exportAgeDays` : `warn` au-delà de 14 j, **`danger` au-delà de 30 j** — `MARKET_OLD_DAYS`, « prix périmés »), **prix d'un autre serveur** (`prix-autre-serveur` : export de Tylezia chargé pour « Mon serveur », `marketOriginMismatch`), **export sans volumes** (`liquidite-inconnue`), volume produit vs ventes du serveur, saturation des ventes de montures, ingrédients au-delà d'une journée de ventes, revente partielle, brisage corrigeable, HDV mixte, **spéculatif**, G1 séniles, **part des génétons dans le bénéfice net** (> 20 %, avec le résultat « sans génétons »), **régime non stabilisé**, temps de jeu (durées × 1,5), prix manquants, étable saturée, achats au-delà du volume ; hypothèses (dont celles du moteur de production) ; notes (niveaux écartés, budget inutilisé). **Montée du métier écartée faute de prix** (revue UX2-09) : la note « … les investir n’améliore pas le bénéfice » est remplacée par « Montée du métier non chiffrée (niveaux 40, 80… : jusqu’à N ingrédients sans prix) : l’usage des X restants est inconnu — importez l’export HDV… », aussi en tête des risques (`prix-manquants-metier`). |
| `unusedBudget`, `evaluated`, `marketDate`, `marketServer`, `craftsPerDay` | Divers. |

## Page `#/investissement`

Entrées : budget (préréglages 5 M / 20 M / 50 M, réserve 10 %), horizon (30/60/90), mode (**par défaut le mode actif du
profil** s'il se simule ici, sinon « Automatique » — `defaultInvestmentMode`, revue UX2-04 ; « Mode actif du profil : X »
rappelé), réserve, **rythme de craft** (crafts/h, ESTIMATION), leviers (dont « Compter les prix « HDV mixte » des
montures »), « seulement la famille du profil » (auto), **« Partir de mon étable actuelle »** (défaut : oui si l'étable
n'est pas vide) ; profil (niveau d'Éleveur **estimé** comme la page Métier : saisi + XP
du journal), marché du serveur. Préférences par profil (`profileKey('investissement')`) ; adresse
`?mode=&budget=&horizon=&reserve=` (lien « Calculer avec le minimum utile »). Calcul automatique à l'ouverture
dans un Web Worker (bouton sinon), progression et annulation, résultat signalé périmé si les entrées changent.
Résultats : indicateurs (point mort, bénéfice/jour, bénéfice à l'horizon, jour 0, trésorerie, ROI 30/60/90),
allocation, courbe SVG du cumul (bande « min–max des N tirages » sous 10 tirages, **pire scénario en tirets**, point
mort, horizon, survol et clavier, tableau), feuille de route, courses du jour 0 (copie), plan jour par jour,
alternatives (badge « spéculatif (HDV mixte) »), sensibilité, risques et hypothèses ; « Plan retenu » rappelle le pire
scénario à 60 jours. Revue « parcours » v2 : bouton **« Suivre ce plan »** (règle `settings.mode` sur le mode du plan et
épingle sa stratégie et sa routine — `useModePlan.pin`, voir docs/api/modes.md : l'accueil, le Plan et le conseiller
l'appliquent ; changement de famille confirmé) ; plan d'une autre famille que celle du profil signalé ; encadré « Montée
du métier non chiffrée » en tête ; ROI « non significatif » ; ingrédients des objets du socle à fabriquer ; courbe : bas de
l'axe au creux réel (+ 10 %) et **zoom** sur les premiers jours (≥ 14, 1,5 × le point mort) ; feuille de route en échelle
racine carrée, repères d'un même jour regroupés (« 1–2 ») ; ligne « Mode » : classement sur l'horizon (montée comprise),
la page Modes sur le régime permanent.

## Repères Tylezia (export HDV du 02/10/2026, règles 3.6)

Profil : Éleveur niveau 1, 3 h de jeu/jour (2 passages), 1 personnage, budget **20 M**, réserve 2 M, horizon 60 j :

| Mode | Plan retenu | Jour 0 | Trésorerie max | Point mort | Bénéfice/jour (régime) | Cumul 30 / 60 / 90 j |
|---|---|---|---|---|---|---|
| Rush Volkorne | Métier 1 → 120 · G6 · palier 2 | 4,40 M | 5,67 M | jour 17 | ≈ 1,00 M (69 Cornes/jour = 1,6 % du marché) | 6,1 / 32,1 / 62,2 M |
| Rush Dragodinde | Métier 1 → 160 · G6 · palier 2 · 21 G1 au départ | 7,78 M | 8,07 M | jour 17 | ≈ 1,56 M | 16,9 / 59,7 / 106,7 M |
| Rush Muldo | Métier 1 → 160 · G8 · palier 2 (régime non stabilisé : étable saturée) | 7,53 M | 9,34 M | jour 19 | ≈ 1,83 M | 13,3 / 58,7 / 113,8 M |
| Brisage PA | Métier 1 → 160 · niveau 53 · palier 1 | 7,44 M | 7,48 M | jour 9 | ≈ 574 K | 16,7 / 37,5 / 55,0 M |
| Auto (= Rush Dragodinde) | Métier 1 → 160 · Rush Neurone · G6 · 21 G1 au départ | 7,78 M | 8,07 M | jour 17 | ≈ 1,56 M | 16,9 / 59,7 / 106,7 M |

Rush Volkorne, sensibilité (référence 33,3 M à 60 j, 2 tirages) : prix −20 % → 18,4 M (point mort j 29) ; +20 % →
48,3 M ; coûts +20 % → 25,0 M ; durées × 1,5 → 17,4 M (j 30, **pire scénario**) ; liquidité ÷ 2 → 33,3 M ; sans
génétons → 29,6 M ; crafts deux fois plus lents → 23,7 M ; sans revente des crafts → 30,9 M. Alternatives : « Tout dans
le métier » (1 → 200, G4) 36,9 M mais 13,1 M de trésorerie : à égalité dans le bruit des 3 tirages, le plan qui
engage 5,7 M est recommandé ; « Sans investissement » 10,0 M ; « Stock de montures » 9,7 M. Rush Muldo : plus aucun
achat quotidien de G1 (avant la revue : ≈ 10,5 G1/jour achetés à la place de captures possibles, 17,45 M de
trésorerie). Auto : la vente de montures (≈ 59,7 M, prix « HDV mixte ») n'apparaît plus qu'en alternative
« spéculatif » ; avant la revue, elle était retenue avec ≈ 85 M projetés. Calcul : ≈ 0,6 à 3 s (un mode), ≈ 5 s
(« auto », ≈ 280 simulations).

## Limites

Rythme de craft et temps d'achat des ingrédients estimés (rythme réglable) ; ingrédients achetés tous le jour 0
(prix supposés stables malgré le volume, signalé au-delà d'une journée de ventes) ; XP et temps des crafts de
consommables non comptés ; prix de craft (carburants, makinas) du niveau visé dès le jour 1 (le filet, lui, suit le
niveau du jour) ; 3 tirages par plan (bande min–max, égalités larges) ; achat de montures autres que G1 non proposé
(séniles) ; mêmes limites que le moteur de production (`docs/api/production.md`).
