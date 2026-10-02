# Recherche ElevageSimu : index, spécification de référence, lacunes

> Point d'entrée de toute la recherche du projet **ElevageSimu** (simulateur et optimiseur d'élevage de montures, Dofus 3, système 3.5+).
> Rédigé le 2026-10-02 par la **critique de complétude**, après lecture de tous les fichiers de `research/` (et `research/data/`) et des contrôles croisés automatiques décrits au §3.

**Versions du jeu au 2026-10-02.** `cytrus.json` (CDN Ankama), relu le 2026-10-02 :

| Canal | Version | Statut |
|---|---|---|
| `dofus3` | 3.6.12.16 | **règles actuelles, jeu de règles par défaut de l'application** |
| `beta` | 3.7.3.3 | bêta depuis le 17/09/2026 ; devblog du 16/09/2026 ; date de sortie inconnue |
| `experimental` | 3.6.12.20 | — |

La recherche web du 2026-10-02 n'a trouvé aucune date de sortie pour la 3.7.

**Légende de confiance** (commune à tous les fichiers) :
- **high** : donnée du client Ankama, devblog officiel, ou reproduit exactement des captures in-game.
- **medium** : source communautaire fiable (DPLN, outils) ou déduction cohérente.
- **low** : hypothèse, témoignage isolé ou extrapolation.

**Héritage.** Tout ce qui précède la 3.5 (avant le 03/03/2026 : gestation, fatigue, énergie, certificats, « Sauvage ») est marqué **LEGACY / Héritage pré-3.5**. Ces informations ne doivent jamais servir aux calculs.

**À ne pas manquer (calendrier, source DofusDB `almanax-calendars`, high).**
- **Lundi 12/10/2026, Takeza** : +20 % de chance d'obtenir la génération cible. Préparer à l'avance un maximum de couples féconds de haute génération.
- **10/10/2026** : tous les bébés nés ce jour-là ont la capacité Sage.
- **22/10/2026** : +50 % d'XP pour le métier d'Éleveur (crafts de montée).

---

## 1. Index des fichiers

### 1.1 Documents de synthèse (lisibles) et données machine

Le couple .md + .json ci-dessous est la source de vérité. Chaque fait y porte une source et une confiance.

| Sujet | Document | Données machine | Contenu clé pour l'application |
|---|---|---|---|
| **Index et spécification** | `README.md` (ce fichier) | — | Constantes finales (§2), contrôles croisés (§3), lacunes (§4) |
| **Mécaniques** | [`mechanics.md`](mechanics.md) | [`data/mechanics.json`](data/mechanics.json) | Enclos, jauges, ticks, sérénité, fécondité ; **modèle de probabilités du bébé** (reconstitué, validé sur 24 % in-game) ; génétons, clonage, extraction, capture ; tables d'XP monture et métier, XP de craft ; Almanax ; chronologie 3.5 → 3.6 → 3.7 ; désaccords et questions ouvertes |
| Arbre Dragodindes | [`tree-dragodinde.md`](tree-dragodinde.md) | [`data/tree-dragodinde.json`](data/tree-dragodinde.json) | 66 élevables + 2 spéciales G0 ; croisements, stats niv. 1/50/100/150/200, objet HDV, récompenses par génération |
| Arbre Muldos | [`tree-muldo.md`](tree-muldo.md) | [`data/tree-muldo.json`](data/tree-muldo.json) | 120 Muldos ; 162 croisements dont 57 de générations impaires ; stats |
| Arbre Volkornes | [`tree-volkorne.md`](tree-volkorne.md) | [`data/tree-volkorne.json`](data/tree-volkorne.json) | 120 Volkornes ; 157 croisements ; stats ; `minCapturesIdeal` |
| **Crafts Éleveur** | [`crafts.md`](crafts.md) | [`data/crafts.json`](data/crafts.json) | 211 recettes (120 carburants, 81 makinas, 10 filets) ; 471 ingrédients avec leur provenance (récolte, drop, taux) ; ressources de montures ; XP de craft ; recettes bêta 3.7 (`beta_3_7`) |
| **Économie** | [`economy.md`](economy.md) | [`data/prices-default.json`](data/prices-default.json) | Prix par défaut datés et sourcés (montures, ressources, runes, carburants, filets) ; génétons → kamas ; brisage ; valorisation d'une stérile ; taxe d'HDV ; coût du métier ; **couverture des prix** (`coverage`) |
| **Stratégie** | [`strategy.md`](strategy.md) | [`data/strategy.json`](data/strategy.json) | Phases P0 → P6 du planificateur ; règles d'enclos, d'accouplement et de capture (DSL `when`) ; formules de décision ; grille du sort d'une monture ; routines ; calendrier Almanax ; résultats de simulation « pyramide » ; revue des outils communautaires ; erreurs fréquentes |

### 1.2 Données brutes (`raw/`)

> **Dépôt git** : les copies de contenus tiers (texte du guide DPLN, captures d'écran, devblogs, pages web, scripts d'autres sites, transcriptions YouTube) ne sont **pas versionnées** (droits réservés, voir `.gitignore`). Elles restent citées par URL dans chaque document ; seules nos données dérivées, les tables du client et notre propre code sont versionnés.

| Chemin | Contenu | Remarque |
|---|---|---|
| `raw/guide-eleveur-dpln.txt` | Texte intégral du guide DPLN « Guide de l'éleveur (édition 2026) », MAJ du 02/03/2026 | Référence 3.5 ; rédigé sur la bêta 3.5 |
| `raw/mounts.json`, `mount-families.json`, `mount-behaviors.json` | Extraits de DofusDB `/mounts` (266 entrées : familyId 1 = Dragodinde, 5 = Muldo, 6 = Volkorne) | `/mounts` s'arrête à l'id 296 : les Muldos 297-350 (G9/G10) en sont **absents** ; il contient aussi les entrées « Sauvage » héritées |
| `raw/recipes-eleveur.json` (+ `.slim.json`) | Les 211 recettes du métier Éleveur (jobId 79), DofusDB | `slim` = version utilisée par `scripts/build-data.mjs` |
| `raw/items-eleveur.json` | Objets des recettes (nom, niveau, type, `price` interne, droppeurs…) | Le `price` DofusDB n'est **pas** un prix d'HDV |
| `raw/dofus-client/` ([README](raw/dofus-client/README.md)) | Tables du **client officiel** 3.6.12.16 et 3.7.3.3 bêta : `rides-*` (générations, croisements, geneticWeight, objet lié, extraction, génétons, XP), `evolutive-effects-*` (progression des stats), `paddock-gauges-*`, `ride-gauges-*`, `ride-species-*`, `evolutive-item-types-*` ; outils `tools/` (cytrus.py, fetchfile.py, dumpbundle.py) | Source primaire (high) |
| `raw/mechanics-evidence/` ([README](raw/mechanics-evidence/README.md)) | `breeding_model_reference.py` (implémentation de référence ; `python3` reproduit les 5 captures) ; `client-data/` (constantes par version du client 3.5.3.1 → 3.7.3.3, effets des objets, recettes bêta, Almanax, tables d'XP DPLN) ; `screenshots/` (captures in-game) ; `texts/` (devblogs I, II, 3.7, page LEGACY) | — |
| `raw/strategy-evidence/` ([README](raw/strategy-evidence/README.md)) | Pages communautaires (`pages/`), transcriptions YouTube (`youtube/`), simulateur Monte-Carlo (`sim/`), bundles d'outils (`tools/`, `dragodinde-fr/`), zones et monstres de capture (`wild-mount-*.json`), `build_strategy_json.py` | **Ne pas relancer `build_strategy_json.py`** : il écraserait les corrections du vérificateur. `forum-rentabilite.html` est vide (0 octet) ; les `dragodinde-fr-*.txt` sont vides, leur texte est dans `dragodinde-fr/*.js` |

---

## 2. Spécification de référence (ce que l'application doit implémenter)

Les valeurs ci-dessous sont les **constantes finales**, après arbitrage des désaccords. La colonne « Où » donne le chemin exact dans les données. Sauf mention contraire, le jeu de règles est **3.6** (live).

### 2.1 Jeux de règles (sélecteur 3.5 / 3.6 / 3.7 bêta)

| Paramètre | 3.5 (03/03 → 22/06/2026) | **3.6 (défaut)** | 3.7 bêta | Conf. | Où |
|---|---|---|---|---|---|
| XP métier par accouplement, par génération et par parent (k) | 10 | **30** | 30 | high | `mechanics.json → breeding.jobXp` |
| Génétons par parent G1..G9 (G10 = 0) | 1/2/4/8/15/30/60/120/250 | **1/2/4/8/15/30/60/120/250** | 2/4/8/15/30/60/120/250/500 | high | `genetons.perParentGeneration` |
| Bonus Optimakina | +10 % | **+10 %** | +20 % | high | `makinas.optimakinaBonus` |
| Animakina | capacité aléatoire 27/27/27/14/5 % | **idem** | choix du sexe (stocks convertis) | high | `makinas.types` |
| Capacité sans makina | non | **non** | Reproductrice 3 %, Sage 6 %, Précoce 8 %, Amoureuse 8 %, Endurante 8 % (devblog seul) | high (annonce) / medium (valeurs finales) | `makinas.naturalAbilityOdds_3_7beta` |
| Paliers de jauge (bornes hautes) | 40k/70k/90k/100k | **40k/70k/90k/100k** | 80k/140k/180k/200k | high | `gauges.tiers` |
| Consommation par tick, paliers 1→4 | 10/20/30/40 | **10/20/30/40** | 10/20/30/40 (inchangée) | high | `gauges.tiers` |
| Durabilité des carburants, Minuscule → Gigantesque | 1000/2000/3000/4000/5000 | **idem** | ×2 (2000 → 10 000) ; renommés (« … d'Amour », « … d'Expérience de monture »…) | high | `crafts.json → fuels[].durability`, `beta_3_7` |
| Recettes de makinas | live | **live** | 74/81 modifiées | high | `crafts.json → makinas[].beta_3_7` |
| Étable | 250 | **250** | 500 | high | `paddock.stableCapacity` |
| Sérénité après clonage | « réinitialisée » | **idem** | conservée | medium / high | `cloning.serenityAfter` |
| Neurones chez l'Amateur de Guildaton | 15 guildatons | **15** | 30 (devblog : « ressources d'élevage ») | high / medium | `crafts.md` §5.3 |

### 2.2 Espèces, arbres, montures

- **Espèces.** Les identifiants diffèrent selon la source, ne pas les confondre (high) :

  | Espèce | Client (`speciesId`, effet makina 3837) | DofusDB `/mounts` (`familyId`) | Ressource d'extraction |
  |---|---|---|---|
  | Dragodinde | 1 | 1 | Neurone de dragodinde (33515) |
  | Muldo | 2 | 5 | Ambre de muldo (17864) |
  | Volkorne | 3 | 6 | Corne de volkorne (19975) |

  Bonus commun : Dragodinde = Vitalité (sauf la Dragodinde en armure) ; Muldo = 1 PM à partir du niveau 100 ; Volkorne = 1 PA à partir du niveau 100.
- **Montures élevables** (client `RidesData`, high) : 66 Dragodindes, 120 Muldos, 120 Volkornes. Génération maximale : 10.
  - Dragodindes par génération G1..G10 : 3/3/2/7/2/11/2/15/2/19.
  - Muldos : 5/10/2/11/2/15/2/19/4/50.
  - Volkornes : 4/6/4/22/2/17/1/10/4/50.
  - Les 2 Dragodindes spéciales (en armure, à Plumes) ont `generation = 0`, `breedable = false` : ni accouplement ni extraction.
  - Les entrées DofusDB « X Sauvage » sont héritées : elles sont exclues (`excludedLegacyVariants`).
- **G1 capturables** (`captureMonsterId`, DofusDB) :
  - Dragodinde : Amande 171, Rousse 200, Dorée 666 (Territoire des dragodindes sauvages, sous-zone 235).
  - Muldo : Indigo 4434, Ébène 4435, Orchidée 4436, Pourpre 4437, Doré 4438 (Bassin des Muldos, sous-zone 1119).
  - Volkorne : Orchidée 5308, Indigo 5309, Ébène 5311, Pourpre 5313 (Haras de Brâkmar, sous-zone 886).
- **Croisements** : 382 paires non ordonnées (63 Dragodinde, 162 Muldo, 157 Volkorne). Source : client `RidesData.parents`, recopié en noms dans `tree-*.json → mounts[].crossings` (high).
  - Chaque paire donne **au plus un** enfant, de génération max(parents) + 1.
  - Bicolore « X et Y » = X × Y, croisement unique.
  - Dragodindes : un seul croisement par monture.
  - Muldos et Volkornes : les monocolores de génération impaire ont plusieurs croisements (de 2 à 12 selon la couleur).
- **Noms affichés** : utiliser `name` des arbres. Ce sont les noms exacts en jeu (accents compris : Ébène, Émeraude).
- **Stats d'une monture de niveau L** (client `EvolutiveEffects`) :
  - Formule : `v(L) = floor(p1 × min(L,100) + p2 × max(0, L−100))`, avec `statsRaw[].progressionPerLevel = [[100,p1],[200,p2]]`. Taux : high ; arrondi `floor` aux niveaux intermédiaires : medium.
  - Calculer en **décimal exact** : le client stocke 0,01 sous la forme 0,0099999998, ce qui donnerait 0 PM/PA au niveau 100 en virgule flottante.
  - Valeurs prêtes à l'emploi : `statsRaw[].valueLevel100` et `valueLevel200`, et `statsByLevel` aux niveaux 1/50/100/150/200 (identiques pour les 3 arbres).
  - **Piège** : `valueDofusDB` vaut la valeur niveau 100 chez les Dragodindes mais la valeur niveau 200 chez les Muldos et Volkornes. Toujours lire `valueDofusDBLevel`, ou utiliser `valueLevel100` / `valueLevel200`.
- **Objet-monture** (prix HDV, équipement) : `itemId` (Dragodinde typeId 331, Muldo 332, Volkorne 333), niveau d'équipement 60 (`equipMinLevel`, DofusDB) (high).
- **Valeurs par monture issues du client** : `geneticWeight`, `extractionQty`, `breederXpWhenParent` (barème 3.6), `genetonsWhenParent{3.6.12.16, 3.7.3.3-beta}` (high).

### 2.3 Enclos, jauges, ticks (`mechanics.json → paddock`, `gauges` ; high)

- **6 enclos de 10 places**, débloqués aux niveaux d'Éleveur 1/40/80/120/160/200. Ils sont tous identiques et liés au compte : c'est le meilleur niveau d'Éleveur du compte qui compte.
- On peut tout faire à distance (remplir, (dés)activer les jauges, accoupler, cloner, extraire), **sauf** poser ou retirer une monture d'un enclos. L'accouplement exige les deux montures **dans l'étable**.
- **6 jauges** : Baffeur (sérénité −), Caresseur (sérénité +), Foudroyeur (endurance), Abreuvoir (maturité), Dragofesse (amour), Mangeoire (XP). Au plus **2 jauges actives** ; Baffeur et Caresseur s'excluent.
- **Tick toutes les 10 s**, pour chaque jauge active, s'il existe au moins une monture éligible : `c = min(rate(tier(v)), v) ; v −= c`. Chaque monture éligible gagne `c` (×2 si elle a la capacité correspondante ; ×2 le jour Almanax de la jauge, medium).
  - `tier(v)` = plus petit palier dont la borne haute est ≥ v. Exemple : 40 000 → palier 1 ; 40 001 → palier 2.
  - La consommation est **la même avec 1 ou 10 montures** : il faut 10 montures éligibles par jauge active.
- **Éligibilité :**
  - Foudroyeur : endurance < 20 000 et sérénité ∈ [−5000, −1].
  - Abreuvoir : maturité < 20 000 et sérénité ∈ [−2000, 2000].
  - Dragofesse : amour < 20 000 et sérénité ∈ [0, 5000].
  - Baffeur : sérénité > −5000. Caresseur : sérénité < 5000.
  - Mangeoire : niveau < 200.
  - Sans monture éligible, la jauge ne consomme rien (medium pour le cas « sérénité hors zone »).
- **Vidage complet** (3.6) : 6 416 ticks = 17 h 49 min 20 s (`gauges.fullDrainTicksExact`). En 3.7 : 12 833 ticks.
- **Remplir une stat de 0 à 20 000** à palier constant : 5 h 33 min 20 s au palier 1, 2 h 46 min 40 s au palier 2, 1 h 51 min 10 s au palier 3, 1 h 23 min 20 s au palier 4 ; deux fois moins avec la capacité correspondante.

### 2.4 Monture : sérénité, fécondité, états (`mountStats` ; high)

- Endurance, maturité et amour vont jusqu'à **20 000**. La sérénité est bornée à [−5000, 5000] et ne bouge plus quand la monture gagne une stat.
- Smileys : rouge :C = endurance seule (< −2000) ; bleu :( = endurance + maturité ; violet :) = maturité + amour ; vert :D = amour seul (> 2000).
- **Féconde** = les 3 stats à 20 000. États : Fertile → Féconde → (accouplement) Stérile ; Sénile = monture d'avant la 3.5 (ni accouplement ni clonage).
- Pas de fatigue, pas d'énergie, pas de niveau minimum. Bébé ou capture : niveau 1, stats à 0, sérénité aléatoire (distribution inconnue, voir §4).
- **Procédure de fécondation selon la sérénité de départ s** (`mechanics.json → planning.serenityPlanByStartBucket`, `strategy.md` §4.2-4.3) :

  | Sérénité de départ | Procédure |
  |---|---|
  | s < −2000 | Foudroyeur + Caresseur → Foudroyeur + Abreuvoir → Caresseur jusqu'à s ≥ 0 → Dragofesse (+ Mangeoire) |
  | −2000 ≤ s ≤ −1 | Foudroyeur + Abreuvoir → Caresseur → Dragofesse (+ Mangeoire) |
  | 0 ≤ s ≤ 2000 | Dragofesse + Abreuvoir → Baffeur → Foudroyeur (+ Mangeoire) |
  | s > 2000 | symétrique du premier cas (Dragofesse + Baffeur…) |

  Grouper les lots dans une fenêtre de sérénité de 2 000 de large au plus. Mettre une alarme sur toute jauge de sérénité active.
- **Points de jauge par lot de 10** : 60 000 points de stat, plus |Δsérénité| points de Baffeur ou Caresseur. Le palier ne change que la vitesse et le prix au point.

### 2.5 Accouplement et probabilités du bébé (`mechanics.json → breeding` ; implémentation : `raw/mechanics-evidence/breeding_model_reference.py`)

- **Conditions** : 2 montures fécondes, de sexes opposés, de même espèce, toutes deux dans l'étable. L'accouplement donne 1 bébé, ou 2 si l'un des parents est Reproducteur (non cumulable). Naissance immédiate ; les deux parents deviennent stériles. Bébé : niveau 1, sexe aléatoire (50/50 supposé), arbre = ses 2 parents et les parents de ceux-ci. (high)
- **Modèle** (reconstitué ; reproduit les 24 pourcentages des 5 captures in-game DPLN à 0,01 % près ; high pour la structure) :
  1. Arbre de chaque parent X = X (poids de position 10) + ses 2 parents (poids 6 chacun). Une G1 capturée n'a pas de parents.
  2. Poids brut d'un membre : `w(m) = POS × geneticWeight(m)`. Les doublons s'additionnent. GW = 90 pour les monocolores Dragodinde/Muldo, sauf Dorée = 20 et Muldos G9 = 20 ; 20 pour les bicolores et les spéciales ; 1 pour tous les Volkornes.
  3. Normalisation par arbre : `pX(m) = w(m)/Σw`.
  4. Masse naturelle W :
     - chaque membre m de A reçoit pA(m), chaque membre de B reçoit pB(m) ;
     - pour chaque paire (a ∈ A, b ∈ B, a ≠ b) qui a un croisement c : `W[c] += pA(a) × pB(b) × κ`, avec κ = 1.
  5. `D = W / ΣW`.
  6. **Génération cible G** = génération max parmi toutes les issues de D. T = issues de génération G ; O = les autres.
  7. `B = min(1, 0,30 + 0,0015 × (niv_A + niv_B) + opti + takeza)`, avec opti = 0,10 (3.6) ou 0,20 (3.7) et takeza = 0,20 le jour Takeza. Si O est vide, B = 1.
  8. `P(t∈T) = B × D(t)/D(T)` ; `P(o∈O) = (1−B) × D(o)/D(O)`. L'affichage en jeu arrondit à 2 décimales.
- **Makina** : une seule par accouplement, facultative, de la même espèce, de génération **≥ génération cible**. (high)
- **XP d'Éleveur** = `k × (G_A + G_B) × nombre de bébés`, avec k = 30 en 3.6 (10 en 3.5). (high)
- **Génétons** : `barème(G_A) + barème(G_B)`, seulement si le bébé obtenu est d'une génération **strictement supérieure à toutes** les montures des deux arbres (2 parents + 4 grands-parents). Sinon 0, même si c'est la génération cible.
  - Exception client : Volkorne Prune et Roux (287) et Prune et Ivoire (288) valent 0.
  - Les génétons sont liés au compte (DPLN) ; DofusDB les marque échangeables (voir §4).
  - Exemples validés : G5 + G9 → 265 ; G8 + G8 → 240.
- **Seuils de 100 % de génération cible** : niveaux cumulés ≥ 400 avec Optimakina (3.6) ; ≥ 334 avec Optimakina en 3.7 ; ≥ 267 avec Optimakina + Takeza (3.6). (calcul, high)

### 2.6 Clonage, extraction, capture (high sauf mention)

- **Clonage** :
  - Entrée : 2 montures de même espèce **et même génération**, non séniles (couleurs différentes possibles).
  - Sortie : l'une des deux au hasard (50/50), Fertile. Elle garde couleur, sexe, nom et généalogie ; ses jauges sont remises à 0 ; elle perd sa capacité.
  - Niveau conservé ? Inconnu (low).
- **Extraction** : détruit la monture. Quantité de ressource = génération (G1 = 0 : non extractible ; sénile = 1 ; spéciale G0 = 0).
- **Capture** :
  - Le filet équipé en consommable donne le sort « Apprivoisement de monture » : 1 PA, 7 PO sans ligne de vue, une fois par combat et par personnage, filet consommé au lancer, capture à 100 % si le combat est gagné.
  - Filets : universel (niv. 1, 1 cible) ; multiplicateur (niv. 100, ×2, sexe du doublon non garanti) ; renforcé (niv. 150, cercle de rayon 3) ; multiplicateur renforcé (niv. 200). Équiper un filet demande le niveau d'Éleveur correspondant.
  - Monture capturée : G1, niveau 1. Montures sauvages : grades 62-70 selon DofusDB, « niveau 60 » selon DPLN.
  - **30 XP d'Éleveur par monture capturée.**

### 2.7 XP (monture, métier, craft)

| Élément | Règle | Conf. | Où |
|---|---|---|---|
| XP monture | Table cumulée niv. 1 → 200 (DPLN, absente du client) : niv. 40 = 20 437 ; 53 = 39 360 ; 100 = 172 668 ; 200 = 867 582. Gain : Mangeoire 10/20/30/40 par tick, ×2 avec Sage | medium-high | `mountXp.cumulativeXpToReachLevel` |
| XP métier Éleveur | `XP_cumulée(L) = 10 × L × (L − 1)` : niv. 40 = 15 600 ; 80 = 63 200 ; 120 = 142 800 ; 160 = 254 400 ; 200 = 398 000 (DPLN diffère au seul niveau 3 : 40 au lieu de 60) | medium-high | `breederJob.xpTable` |
| XP de craft | `floor(20 × L × r/100 / (1 + 0,1 × (J − L)^1,1))`, 0 si J − L > 100 ; r = 5 pour carburants, makinas et filets, 50 pour le Filet de capture universel (32521). Donne **L XP** à J = L | high (validée sur 3 valeurs in-game) | `breederJob.craftXp`, `crafts.json → *.xp` |
| Autres sources d'XP métier | Accouplement (§2.5), capture (30/monture) | high | — |

### 2.8 Carburants, makinas, filets (`crafts.json` ; high)

- **Carburants** : 6 jauges × 4 familles × 5 tailles = 120.
  - Familles, plafond de remplissage (3.6) et palier : Extrait 40 000 (palier 1), Philtre 70 000, Potion 90 000, Élixir sans plafond.
  - Niveau de recette = `5 + 10 × (5 × (palier − 1) + indice_taille)`, indice de 0 (Minuscule) à 4 (Gigantesque).
  - Chaque recette = 1 ressource de base (récolte ; viande pour la Dragofesse) + 1 à 4 ressources de monstres, toutes ×1.
  - Règle de dépôt : utilisable seulement si la jauge est sous le plafond de la famille ; nouvelle valeur = `min(plafond, v + durabilité)`. L'excédent est **probablement perdu** (medium) : n'utiliser que des dépôts qui tombent juste.
  - Aucun niveau de métier n'est requis pour **utiliser** un carburant.
  - Coût d'un point pour une monture = `prix / durabilité / montures_éligibles`.
  - PNJ Adèle Vage [−18,1] : ne vend que les Gigantesques, contre de la poussière d'élevage (non échangeable, plus aucune source depuis la 3.5). Extrait 50, Philtre 200, Potion 800, Élixir 3 200.
- **Makinas** : 3 types × 3 espèces × générations 2 à 10 = 81.
  - Recette = 1 ressource de boss + 10 Pépites + des ressources de monture sauvage, par couleur : G − 1 de G2 à G9, 10 en G10. Les Optimakinas ajoutent de la Sueur, de la Bave ou une Griffe : ×1 de G2 à G8, ×2 en G9, ×3 en G10.
  - Niveaux : `20(g−2) + 17 … 33` de G2 à G8 (Kromakina Dragodinde, puis Volkorne, puis Muldo, puis Animakina, puis Optimakina, par pas de 2) ; 155 → 171 en G9 ; 173 → 189 en G10.
  - Effets : Kromakina = Caméléone 100 % ; Animakina = §2.1 ; Optimakina = §2.1.
- **Filets** : 10 recettes ; universel = 10 Bois de Frêne + 10 Fer.

### 2.9 Économie et rentabilité (`prices-default.json`, `economy.md` §3.3 et §9.2, `strategy.json → formulas`)

| Formule / valeur | Définition | Conf. |
|---|---|---|
| Taxe d'HDV | 2 % à la mise en vente, +1 % à chaque modification de prix | medium |
| Valeur plancher d'une stérile | `max(G × prix_ressource_extraction, valeur_brisage, revente)`, chaque terme net de taxe, plus l'option clonage (`valeur_clone − coût_refécondation`) | medium |
| Ressources d'extraction (défauts) | Ambre 18 000 · Neurone 8 000 · Corne 15 000 (estimation) | medium / low / low |
| Valeur d'un généton | max sur la boutique d'Eugène Éton de `prix_HDV / coût` ; défaut **375 kamas** (Puissant Parchemin ≈ 60 000 / 160), plage 125 → 725 | medium (prix Salar) |
| Boutique d'Eugène Éton [−18,1] | Petits Parchemins 10, Aliton 10 (non échangeable), Parchemins 50, Grands 100, Tourmaline 130, Puissants 160 (génétons) | high (capture de la bêta 3.5 ; seul le Puissant est reconfirmé après la sortie) |
| Coût d'un bébé de la génération cible | `(C_A + C_B + makina − R) / p`, avec R = valeur résiduelle attendue | medium |
| Optimakina rentable si | `prix < C_eff × Δ / p` (Δ = 0,10, ou 0,20 en 3.7) | high (algèbre) |
| Monter les deux parents de ΔL niveaux si | `coût_XP(ΔL) < C_eff × 0,003 × ΔL / p` | high (algèbre) |
| Brisage | Possible en 3.5 et 3.6, coefficient 50 %. **Utiliser les rendements observés** (`valuation.brisage.observedYields`), pas la formule communautaire. Défaut : 12 000 / 30 000 / 45 000 par monture aux niveaux 53 / 100 / 200 pour Muldos et Volkornes | medium (risque de correctif) |
| Prix manquants | `null` → saisie par l'utilisateur. Pour un carburant, une makina ou un filet : `min(prix_HDV, Σ ingrédients)` ; si un ingrédient manque, afficher le coût comme **incomplet**, jamais 0 (`prices-default.json → coverage.rule`) | — |

### 2.10 Stratégie et « que faire maintenant » (`strategy.json` ; medium sauf mention)

- **Phases du planificateur** (`phases`, avec objectifs, actions et critères de sortie) :

  | Phase | Niveau d'Éleveur | Contenu |
  |---|---|---|
  | P0 | 0-1 | Préparation |
  | P1 | 1-40 | Démarrage |
  | P2 | 40-80 | Montée en régime |
  | P3 | 80-120 | Production |
  | P4 | 120-160 | Haute génération |
  | P5 | 160-200 | Maîtrise |
  | P6 | 200 | Croisière et rentabilité |

  Objectif minimal : **niveau 120 = 4 enclos** (DPLN, high).
- **Règles à coder**, avec des conditions au format DSL `when` (`meta.conditionDsl`) : `paddockRules` (15), `matingRules` (20), `captureRules` (12), `mountFateGrid` (8 cas, dans l'ordre : garder → accoupler entre condamnées → cloner → max(vente, extraction, brisage)…).
- **Règles clés** :
  - 10 montures éligibles par jauge active (high).
  - Lots de 2 000 de sérénité au plus (high).
  - Mangeoire en 2e jauge et parents vers le niveau ~40 (+12 % de chance cible par couple).
  - Cloner systématiquement (sans clonage, la pyramide explose dès la G7).
  - Optimakina selon la règle de prix (§2.9).
  - Parents à arbre « propre » : aucune génération ≥ génération cible dans leurs arbres (high pour les génétons).
  - « Porteurs » pour les succès G10.
  - Ordre d'une session : accoupler → cloner → capturer → extraire → ranger.
- **Ordres de grandeur pour une G9** (simulation à 60 places, niveau 40) : ≈ 105 à 200 captures, 270 à 820 accouplements, 4 à 11 M de points de carburant, ≈ 18 à 28 jours de jeu optimal ; compter ×1,5 à 2 pour un joueur réel (`strategy.md` §6, medium/low).

---

## 3. Cohérence entre fichiers : contrôles faits et corrections

### 3.1 Contrôles automatiques (tous passés après correction)

- **Arbres ↔ client `RidesData` 3.6.12.16** : 308/308 montures. Concordent : générations, ensembles de croisements (382 paires), `geneticWeight`, `itemId`/`linkedItemGid`, extraction, XP, génétons (3.6 et bêta). **0 écart.**
- **`itemId` des 68 Dragodindes** ↔ noms DofusDB `items` typeId 331 : 68/68. Toutes les montures-objets (typeId 331/332/333) sont de niveau 60.
- **Stats** : `statsByLevel` recalculé depuis `progressionPerLevel` (décimal exact, `floor`) pour 4 425 valeurs, niveaux 50/150 des Muldos compris : 0 écart. La seule divergence avec DofusDB `/mounts` (valeur héritée) est la Dragodinde à Plumes, déjà documentée.
- **Makinas ↔ arbres** : les familles (`Dragodinde`/`Muldo`/`Volkorne`), le `speciesId` (1/2/3) et les générations 2 à 10 correspondent à `maxGeneration = 10` des trois arbres.
- **Prix ↔ crafts** : identifiants et noms des objets de `prices-default.json` = `crafts.json`. Hors crafts, et c'est normal : runes, Généton, Poussière.
- **Constantes communes** (paliers, consommation, génétons, Optimakina, XP, Almanax, Takeza) : `mechanics.json`, `strategy.json`, `crafts.json`, `prices-default.json` et `economy.md` concordent.
- **Code existant** : `src/domain/constants.ts` reprend les constantes 3.6 de cette spécification (paliers, débits, étable 250, enclos, durabilités, poussière, Animakina, 30 % + 0,15 %/niv., génétons, XP 30). Aucun écart, mais il n'y a pas encore de bascule 3.7.
- **Modèle de référence** : `breeding_model_reference.py`, relancé, reproduit EX1, EX1 avec Optimakina, EX2, EX3 et EX4.

### 3.2 Incohérences trouvées et corrigées

1. **Formule d'XP de craft** dans `mechanics.json` (`breederJob.craftXp.formula`) et `mechanics.md` §7.
   - L'ancien libellé « ratio = craftXpRatio/100 … Filet universel = 50 » donnait 50 XP au filet universel au niveau 1, au lieu de 10.
   - Il contredisait `crafts.json` et `strategy.json`.
   - Réécrit, avec revérification : 99 / 80 / 66 / 10 XP. L'ancien libellé est conservé dans `formulaPrevious`.
2. **Schémas d'arbres hétérogènes.**
   - L'arbre Dragodinde n'avait ni `itemId`, ni `geneticWeight` (paramètre indispensable au modèle de probabilités), ni extraction, XP, génétons ou `statScaling`.
   - Les Muldos n'avaient que les niveaux 1/100/200.
   - `valueDofusDB` n'a pas le même sens d'un fichier à l'autre (niveau 100 ou 200).
   - Correction : champs communs ajoutés aux 3 arbres (`breedable`, `extractionQty`, `captureMonsterId`, `valueLevel100`, `valueLevel200`, `harmonizedSchema`, niveaux 50/150 pour les Muldos, `excludedLegacyVariants` pour les Dragodindes, alias `dofusdbId` pour les Muldos). Aucune valeur existante n'a été modifiée.
3. **Niveau des montures sauvages** : `mechanics.json` ne donnait que 60 (DPLN). Ajout de `wildMonsterLevelDofusDB = [62,70]` et des `captureMonsterIds`, alignés sur `crafts.json` et `strategy.json`.
4. **Durée de vidage** : `fullDrainSeconds` (64 167 s, valeur continue) n'était pas la valeur par ticks citée dans `mechanics.md` (6 416 ticks). Ajout de `gauges.fullDrainTicksExact` (6 416 en 3.6, 12 833 en 3.7).
5. **Rôle de `geneticWeight`** décrit comme « inconnu » dans `tree-dragodinde.md` et `tree-volkorne.md`, alors que `mechanics.md` §1.2 l'a établi. Renvoi ajouté.
6. **`crafts.md` §6** : « XP ≈ 45 % à +9 niveaux » devient 47 %, en accord avec le tableau du même fichier et `strategy.md` §3.1.
7. **Prix** : 4 ressources de capture Dragodinde n'avaient pas de prix (Queue de dragodinde sauvage, Aile de dragodinde, Aile de dragodinde rousse sauvage, Aile de dragodinde dorée). Ajout d'estimations par analogie de taux de drop (`priceType: estimate`, low) et d'un bloc `coverage`.

---

## 4. Lacunes connues

Les lacunes sont classées par impact sur l'application. Pour chacune : comment l'application doit la traiter.

### 4.1 Bloquantes pour la rentabilité : à faire saisir par l'utilisateur

1. **Prix d'HDV des intrants presque absents.** Couverture : 35/471 ingrédients, 5/120 carburants, **0/81 makinas**, 5/10 filets.
   - Il n'existe aucune API publique de prix : DofusDB n'en a pas, et les prix communautaires du Registre des Abysses demandent un compte (« pas d'API officielle »).
   - L'application doit proposer une saisie rapide des prix par objet et par serveur, avec date. Elle calcule le coût depuis les ingrédients quand le produit fini n'a pas de prix, et signale tout coût incomplet.
2. **Coût au point des jauges de fécondité inconnu.** Les défauts T1 à T4 de `valuation.fuelCostPerGaugePointDefaults` ne valent que pour la **Mangeoire**. Le seul indice pour la Dragofesse est ≈ 13 kamas/pt (Minuscule Extrait, Herbe Folle), soit 40 fois le T1 de la Mangeoire. Calculer par jauge, depuis les ingrédients.
3. **Prix de vente des montures** par couleur, génération, niveau et capacité : 2 relevés seulement (Muldo Doré niv. 100 ≈ 50 k ; Muldo Aigue-marine niv. 200 ≈ 15 M, prix affiché). Le reste de la table est un plancher calculé. Aucun prix pour les capacités (Reproducteur, Sage…).
4. **Prix très dépendants du serveur et de la date.** Les relevés viennent surtout de Salar, entre mars et septembre 2026. Afficher la date et la source de chaque prix par défaut.

### 4.2 Modèle de probabilités et simulation : paramètres réglables

5. **κ** (poids d'un croisement dont l'enfant est **monocolore**, GW 90) : non testé. Défaut 1, à garder configurable.
6. **Cas où la part naturelle de la cible dépasse B** : le jeu impose-t-il B ou max(B, D(T)) ? Défaut : B exact.
7. **Reproducteur** : deux tirages indépendants ? Génétons comptés par bébé ? Inconnu. L'XP est bien ×2.
8. **Sexe** du bébé et des captures supposé 50/50. Fréquence de chaque couleur sauvage, taille des groupes (5 à 8, medium) et réapparition : inconnues. Journaliser les captures pour estimer ces valeurs.
9. **Sérénité initiale** (capture, naissance, clone en 3.5/3.6) : distribution inconnue. Supposer une loi uniforme sur [−5000, 5000] et faire saisir la valeur réelle.
10. **Niveau conservé au clonage** : inconnu (low). Cela change la stratégie des « étalons ».
11. **Ordre dans un tick** quand une jauge de sérénité et une jauge de stat sont actives ensemble (éligibilité testée avant ou après le déplacement de sérénité).
12. **Jour Almanax « effet doublé »** : seul le gain double (supposé) ? Se cumule-t-il avec une capacité ? Et pour les bébés « Almanax », la capacité remplace-t-elle celle de l'Animakina ?
13. **Débordement d'un carburant au-delà du plafond** : excédent perdu (probable) ou dépôt refusé ?
14. **Arrondi des stats aux niveaux intermédiaires** : `floor` (medium). Les ancrages aux niveaux 1, 100 et 200 ne départagent pas floor et arrondi.

### 4.3 Barèmes, versions et données secondaires

15. **3.7** : date de sortie inconnue (bêta 3.7.3.3 au 2026-10-02). Les valeurs bêta peuvent changer. Inconnus aussi : la conversion des stocks de carburants (durabilité doublée ?), les prix d'Adèle Vage en 3.7, et les capacités sans makina, absentes des tables client extraites. Les Animakinas seront converties.
16. **Génétons liés au compte** (DPLN, devblog) **ou échangeables** (DofusDB `exchangeable`, effet 983) : à vérifier en jeu. Gérer les deux cas.
17. **Génétons à 0** pour les Volkornes Prune et Roux et Prune et Ivoire (G6) : donnée client, probable bug, effet en jeu non confirmé.
18. **Boutique d'Eugène Éton** : liste tirée d'une capture de la bêta 3.5. Seul le Puissant (160) est reconfirmé. Cosmétiques 3.7 : coût inconnu.
19. **Formule d'XP de craft** : formule du client Dofus 2, validée sur 3 valeurs in-game avec un niveau de métier déduit. **Table d'XP métier** : niveau 3 = 40 (DPLN) ou 60 (formule).
20. **XP de capture** avec un filet multiplicateur : le doublon rapporte-t-il 30 XP ? Le bonus de saison « +25 % XP métiers » est-il actif tous les jours ? La quête quotidienne « Aller Hue » (1 à 2 niveaux d'Éleveur) n'est pas vérifiée.
21. **Brisage** : Ankama avait écrit en 2025 qu'il serait impossible, donc un correctif reste possible. Aucune formule ne colle à tous les relevés : utiliser les rendements observés.
22. **Pépite** (10 par makina) : provient du recyclage (article Dofus 2, 2022-2023) ; non revérifié pour Dofus 3. **Poussière d'élevage** : aucune source depuis la 3.5.
23. **Dragodinde à Plumes** au niveau 100 : client 300 Vit / 30 renvoi, DofusDB 100 / 10 (valeur héritée). Les **archimonstres** Draglida et Dragnoute sont-ils capturables ?
24. **Table d'XP des montures** : elle vient de DPLN (172 668 / 867 582) et n'existe pas dans le client (calcul serveur). Le devblog II annonçait ≈ 172 900 / 868 900.
25. **Noms ambigus** : « Reproducteur » (DPLN) ou « Reproductrice » (devblog 3.7, dofuselevage) ; « Caméléone » (DPLN) ou « Caméléon » (descriptions d'objets). Afficher « Reproducteur » et « Caméléone », et accepter les deux graphies.
26. **Sources inaccessibles** : forum officiel dofus.com (anti-bot), Reddit, Discord ; le devblog 3.7 renvoie 403 aux requêtes automatiques (lu depuis la copie locale). Les témoignages communautaires restent concentrés sur quelques joueurs.

---

## 5. Sources principales (détail et URL dans chaque document)

- Guide DPLN, édition 2026 : https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html (texte : `raw/guide-eleveur-dpln.txt`). Pages espèces, MAJ 3.5 et 3.6, tableaux d'XP sur dofuspourlesnoobs.com.
- Client officiel Dofus 3 : `https://cytrus.cdn.ankama.com/cytrus.json`, manifestes 3.6.12.16 et 3.7.3.3 (`raw/dofus-client/`).
- Devblogs Ankama : élevage I (27/02/2025), II (28/04/2025), 3.7 (16/09/2026). Copies dans `raw/mechanics-evidence/texts/`.
- DofusDB : https://api.dofusdb.fr (`mounts`, `items`, `recipes`, `monsters`, `subareas`, `almanax-calendars`, `achievements`).
- Communauté : dofuselevage.fr, dafous.app, dragodinde.fr, Registre des Abysses, muldo-calculator, guidactik ; vidéos Solomonk-e, Tenmalexis, Laniyelle, Chikkin Sama, Qays, HumaGo, Melcgame, Maxma (transcriptions dans `raw/strategy-evidence/youtube/`).
