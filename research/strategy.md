# Stratégie d'élevage optimisée et rentable — Dofus 3.5 → 3.6 (live) → 3.7 (bêta)

> Projet ElevageSimu, recherche « stratégie » (rédigée le 2026-10-01).
> Données machine pour le planificateur : [`research/data/strategy.json`](data/strategy.json).
> Preuves (pages, transcriptions YouTube, bundles d'outils, simulateur) : [`research/raw/strategy-evidence/`](raw/strategy-evidence/README.md).
> S'appuie sur les recherches déjà faites : mécaniques et modèle de probabilités ([`mechanics.md`](mechanics.md)), recettes et coûts ([`crafts.md`](crafts.md)), arbres ([`tree-dragodinde.md`](tree-dragodinde.md), [`tree-muldo.md`](tree-muldo.md), [`tree-volkorne.md`](tree-volkorne.md)).

**Confiance** : **high** = donnée du jeu (client, DofusDB), devblog officiel, ou capture in-game ; **medium** = source communautaire fiable ou calcul sur un modèle validé ; **low** = témoignage isolé, hypothèse, extrapolation.
**Versions** : la 3.5 est sortie le 03/03/2026, la **3.6 est live depuis le 23/06/2026** (règles actuelles), la **3.7 est en bêta depuis le 17/09/2026** (devblog du 16/09/2026, date de sortie live inconnue). Tout ce qui concerne l'élevage d'avant la 3.5 est marqué **LEGACY** et ne sert que de contexte.

---

## 0. L'essentiel en 22 règles

| # | Règle | Pourquoi | Source | Conf. |
|---|---|---|---|---|
| 1 | **Toujours 10 montures qui profitent de chaque jauge active.** Rendement d'une jauge = (montures éligibles) / 10. | La jauge se vide à la même vitesse avec 1 ou 10 montures ; chaque point consommé est crédité à chaque monture éligible. | DPLN, devblog II | high |
| 2 | **Grouper les montures par tranche de sérénité de 2 000 de large au plus** (ex. [−2 000 ; −1], [0 ; 2 000]). | Un lot homogène fait 2 statistiques à la fois et traverse 0 sans qu'aucune monture ne sorte de la zone. | DPLN, calcul | high |
| 3 | **Commencer par la phase à 2 statistiques** (endurance + maturité si sérénité ∈ [−2 000 ; −1], maturité + amour si ∈ [0 ; 2 000]), puis une seule traversée de 0, puis la 3e statistique avec la Mangeoire en 2e jauge. | Minimise les points de sérénité et le temps (≈ 2 phases au lieu de 3). | DPLN, mechanics.md §3.4 | high |
| 4 | **Mangeoire en 2e jauge dès qu'un emplacement est libre.** Viser **niveau ~40** (≈ 20 000 XP = la durée d'une phase de 20 000 points) : +12 % de génération cible pour un couple, quasi gratuit en temps. | +0,15 %/niveau/parent ; au-delà de 40, le coût en XP explose (niv. 100 = 8,4× l'XP du niv. 40 pour 2,5× le bonus). | DPLN, dragodinde.fr, Solomonk-e, calcul | high (règle) / medium (seuil 40) |
| 5 | **Ne jamais laisser un Baffeur ou un Caresseur actif sans alarme** ; calculer l'heure d'arrivée et couper à distance. | La sérénité continue de dériver jusqu'à ±5 000 ; on peut (dés)activer les jauges depuis n'importe où. | DPLN | high |
| 6 | **Nuit = palier 1** (remplir les 2 jauges de statistiques à 20 000–40 000 avec des Extraits), **journée = palier 2-3**, **palier 4 seulement en étant présent** (il se vide en 42 min). | 8 h au palier 1 délivrent 20 000–28 800 points : une phase complète ; les Élixirs coûtent le plus cher par point. | DPLN, calcul, guidactik, Solomonk-e | high (durées) / medium (prix) |
| 7 | **Cloner systématiquement** les stériles de même génération (même couleur d'abord). | « 2 pour 2 » : sans clonage, une G7 demande ~15 000 captures contre ~100–200 avec (simulation). | DPLN, simulation | high (règle) / medium (chiffres) |
| 8 | **Optimakina dès que son prix < valeur en jeu × 0,10 / p** (p = chance actuelle). En pratique : sur toutes les générations hautes (≥ 6), et sur les basses si elle est bon marché. | Avec Optimakina partout : −40 à −65 % d'accouplements, de captures et de carburant (simulation). | DPLN, simulation | medium |
| 9 | **Animakina (3.5/3.6) : rarement rentable** (5 % Reproducteur) ; **en 3.7 elle choisit le sexe** : la garder pour corriger les déséquilibres mâles/femelles. | Les capacités ne sont pas héritées et sont perdues au clonage. | DPLN, devblog 3.7 | high |
| 10 | **Utiliser des parents à arbre « propre »** : aucune monture de génération ≥ génération cible dans leurs arbres. | Sinon le bonus est partagé avec ces montures et **0 généton** (ex. 42 % → 36,7 %). | modèle validé, DPLN | high (génétons) / medium (%) |
| 11 | **Exploiter les « porteurs »** : une G1 dont un parent est une G9 (bébé raté d'un croisement G9 × G1) croisée avec une autre couleur donne une **G10 avec la même chance que le croisement standard** (et parfois une G9). | Fait les succès G10 à partir de G1 recyclées ; peu de génétons (2 au lieu de 251). | DPLN (capture EX2), modèle | medium |
| 12 | **Avant d'extraire ou de vendre deux montures fécondes condamnées, accouplez-les entre elles** (bébé gratuit + XP métier), puis extrayez les stériles. | L'extraction donne la même ressource fertile ou stérile. | dragodinde.fr, DPLN | high |
| 13 | **Ordre d'une session** : 1) accouplements, 2) clonages, 3) captures, 4) extractions, 5) rangement (banque/havre-sac). Faire les accouplements **par génération** (G2, puis G4, G6, G8, puis monocolores). | Évite de consommer une monture dont une action suivante a besoin ; moins d'erreurs d'appariement. | dragodinde.fr | medium |
| 14 | **Métier : viser 120 (4 enclos) au plus vite, puis 160/200.** Crafter la taille de carburant qui vient de se débloquer (une tous les 10 niveaux). | L'XP d'une recette = son niveau quand on a le même niveau, puis chute vite. | DPLN, client, crafts.md | high |
| 15 | **Capturer en continu** pour garder les enclos pleins ; **filet multiplicateur au niv. 100**, **renforcé au niv. 150**, **multiplicateur renforcé au niv. 200** (jusqu'à 16 montures par combat). | L'élevage ne s'auto-alimente pas (1 bébé par couple) ; captures = 30 XP chacune. | DPLN, Solomonk-e, Tenmalexis | high |
| 16 | **Équilibrer sexes et couleurs à la capture** selon les recettes visées (ex. Dragodinde : l'Amande et Dorée est le goulot pour Indigo **et** Ébène). | Le sexe des bébés est aléatoire (3.5/3.6) ; une couleur à 80 ♂ / 40 ♀ bloque. | Solomonk-e, dragodinde.fr | medium |
| 17 | **Accumuler (« stacker ») avant de tenter la génération suivante** quand le stock de parents est trop faible (< ~3 tentatives attendues). | Un essai unique à 42 % échoue plus d'une fois sur deux ; mieux vaut grouper les tentatives. | Solomonk-e, Chikkin Sama | medium |
| 18 | **Sortir les G10 de la chaîne** : un dernier accouplement G10 × G10, puis vendre/extraire, et remplacer par des G1. | Une G10 ne rapporte plus de génétons et occupe une place. | dragodinde.fr | medium |
| 19 | **Almanax** : grosses sessions d'accouplement à fort enjeu le **jour Takeza** (+20 % de génération cible ; 12/10/2026, 11/10/2027) ; crafts de montée de métier le **22/10** (+50 % XP Éleveurs) ; bébés à garder le 10/10 (Sage) ; jauges doublées les 10 du mois concernés. | Bonus officiels. | DofusDB almanax, DPLN | high |
| 20 | **Avant la 3.7** : les Animakinas seront converties en « choix du sexe », les carburants doublés, les génétons ≈ doublés (barème 2→500 décalé d'une génération), l'Optimakina passera à +20 %. Garder ses accouplements G8/G9 (gros génétons) **pour après la sortie** si elle est proche. | Devblog 3.7 + client bêta. | devblog 3.7, client bêta | high (contenu bêta) / low (date) |
| 21 | **Revenus complémentaires sans élevage poussé** : Muldos/Volkornes capturés montés vers le niveau 40–60 puis **brisés** (runes Ga PM / Ga PA) ; vente des ressources de carburant très demandées. | Démontré à grande échelle par Solomonk-e (≈ ×4 sur 1 020 Muldos, ≈ ×6,8 sur 10 000 Volkornes). | Solomonk-e | medium |
| 22 | **Saisir ses prix HDV** : aucun prix n'est dans les données du jeu ; toute décision de rentabilité (palier de carburant, Optimakina, niveau, vente/extraction) en dépend. | Les prix varient fortement selon le serveur et le temps. | crafts.md | high |

---

## 1. Ce qui rapporte, ce qui coûte

### 1.1 Sources de revenus

| Source | Détail | Ordres de grandeur rapportés (serveur, date) | Source | Conf. |
|---|---|---|---|---|
| **Vente de montures** | Les hautes générations (G8–G10) et les bonnes couleurs (Muldo PM, Volkorne PA) au niveau 100–200 se vendent cher. | « Muldo [Aigue-]marine 1 PM… 15 millions de kamas » (Solomonk-e, avril 2026 ; « Marine » est la transcription d'**Aigue-marine**, Muldo G9 : « un muldo avec Marine niveau 200 », donc probablement un G10 bicolore) ; G10 « plusieurs dizaines de millions » (Chikkin Sama, avril 2026). | YouTube Solomonk-e z8TYzeV8g-o, Chikkin dhQ0-67UYXs | low (prix) |
| **Génétons** | Gagnés seulement si le bébé dépasse toutes les générations des deux arbres ; montant = barème du parent 1 + barème du parent 2 (1, 2, 4, 8, 15, 30, 60, 120, 250 de G1 à G9 ; en 3.7 bêta ≈ doublé : 2, 4, 8, 15, 30, 60, 120, 250, 500, barème décalé d'une génération, client 3.7.3.3). Échangés chez Eugène Éton [−18,1]. | Boutique : Petits Parchemins 10, Aliton 10, Parchemins 50, Grands Parchemins 100, Tourmaline 130, **Puissants Parchemins 160** (capture DPLN `eugene-eton-genetons.jpg`). Puissant parchemin ≈ 20 000 kamas au lancement de la 3.5, pic 80 000–90 000, **stable ≈ 60 000 kamas** (septembre 2026). | mechanics.md §2 ; Solomonk-e fGqEPyQoBgk | high (barème) / low (prix) |
| **Extraction** | Neurone (Dragodinde), Ambre (Muldo), Corne (Volkorne) : **1 par génération** (G1 = 0, sénile = 1). Utilisées par ~110 recettes d'équipement chacune. | dragodinde.fr évoque « ambres et parchemins puissants vendus autour d'1 M l'unité » (formulation ambiguë, non recoupée). | crafts.md §5.3, dragodinde.fr | high (quantités) / low (prix) |
| **Brisage de montures** (depuis la 3.5, les montures sont des équipements) | Coefficient fixe de 50 % (pas de recette). Muldo → runes Ga PM + Pui + Ré ; Volkorne → runes Ga PA + runes de caractéristiques. Le niveau 40–60 suffit à obtenir des Ga PM/PA. | 1 020 Muldos (surtout niv. 53) → 491 Ga PM (48 %) + 4 566 Pui + ~3 000 Ré, ≈ 12 M pour ≈ 3 M de coût (+300 %). 10 000 Volkornes niv. ~53 → 3 832 Ga PA (≈ 33 000 kamas pièce) + ~143 000 runes de caractéristiques, ≈ 121,7 M pour **≈ 17,9 M de coût** (1 787 kamas par Volkorne : ≈ 13 M d'Extraits de Mangeoire + ≈ 4,5 M de filets ; « presque ×7 »), en ~28 h de capture. | Solomonk-e KFzrg1-MRGQ, fGqEPyQoBgk, 41ka94FXdM0 | medium (mécanique démontrée en vidéo) / low (prix) |
| **Ressources de carburant** | Les recettes de carburants consomment des ressources rares de monstres (souvent 2–10 % de drop) en centaines : leurs prix ont été ×10 au lancement de la 3.5. Les farmer et les vendre (« vendre des pelles aux chercheurs d'or »). | Ex. crâne de Wabbit squelette ≈ 5 400 kamas, boîte de Vétauran ≈ 5 000–6 000 kamas (mars 2026). | Solomonk-e er35rckGDFM | low (prix) |
| **Ressources des montures sauvages** | Moustaches/Ailes/Pics (≈ 42 % de base), Bave/Griffe (7,1 %), Sueur de dragodinde (2 %) : utilisées par les filets, makinas et d'autres métiers. | Ventes faibles en volume (Solomonk). | crafts.md §5.2 | high (taux) |
| **Vente de carburants, filets, makinas** | Le métier d'Éleveur vend ce que les autres consomment. | — | astuces-kamas | low |

**Retour d'expérience global** : « marge de 520 000 à 1 240 000 kamas sur la semaine du 17 au 23 mars 2026 » (dafous, un seul joueur) ; « récolte d'un cycle (étable de 250 muldos) ≈ 3 M kamas, 50 à 110 reproductions par étape, l'élevage ≈ 80 % de mes ventes » (auteur de dragodinde.fr) ; « rentabilité globale en baisse depuis la refonte, surtout côté parchemins » (Solomonk-e, avril 2026). Confiance **low** (témoignages, serveurs inconnus).

### 1.2 Postes de coûts

| Poste | Ordre de grandeur (règles 3.6) | Source | Conf. |
|---|---|---|---|
| Rendre une monture féconde | 60 000 points de statistiques pour un lot de 10 (= **6 000 points par monture** en enclos plein) + les points de sérénité (≈ la distance à 0 de la monture la plus éloignée du lot, si le lot est bien groupé). | DPLN, client | high |
| Monter une monture au niveau L | XP(L) points de Mangeoire **pour tout le lot** (niv. 40 = 20 437 ; 60 = 52 544 ; 100 = 172 668 ; 200 = 867 582). | DPLN (table XP), mechanics.md §6 | high |
| Carburant au point | Prix du carburant / durabilité. Le moins cher est en général l'Extrait (palier 1) ; exemples : Extrait de Mangeoire ≈ 900–1 000 kamas pour 3 000 points ≈ 0,3 kama/point (avril–mai 2026) ; Grande potion de Mangeoire ≈ 6× plus cher au point. | Solomonk-e 41ka94FXdM0, KFzrg1-MRGQ | low (prix) |
| Filets | Universel : 10 Bois de Frêne + 10 Fer (≈ 2 000 kamas, avril 2026) pour 1 monture. Multiplicateur : ≈ 1 000 kamas (si ressources de monture droppées) pour 2. Renforcé : ≈ 2 100–2 200 kamas pour ≈ 6 en moyenne. | Solomonk-e | low (prix) |
| Makinas | 1 ressource de boss + 10 Pépites + (G−1) ressources de monture (10 en G10) ; Optimakina + Sueur/Bave/Griffe. | crafts.md §3 | high (recette) |
| Temps | 2 sessions par jour minimum pour faire tourner les enclos ; captures (≈ 120 Volkornes en 20 min à 4 personnages avec filets multiplicateurs). | Solomonk-e | medium |

### 1.3 Formules pour l'application

```
coût d'un point de monture       = prix_carburant / durabilité / montures_éligibles      (max 10)
coût féconde (par monture)       = (60 000 + points_sérénité_du_lot) / taille_lot × prix_point_moyen
coût XP jusqu'au niveau L        = max(0, XP(L) − XP déjà gagnée) / taille_lot × prix_point_mangeoire
coût capture (par monture)       = prix_filet / montures_par_lancer − valeur_des_drops_du_combat
chance cible p                   = min(1, 0,30 + 0,0015 × (niv_A + niv_B) + opti (0,10 ; 0,20 en 3.7) + takeza (0,20))
coût attendu d'un bébé cible     = (C_A + C_B + makina − R) / p
     C_X = coût d'obtention + coût féconde (+ XP) de chaque parent
     R   = valeur résiduelle attendue : (1 − p) × valeur moyenne du bébé raté + valeur des 2 stériles (clone, extraction ou vente)
valeur d'un généton              = max sur la boutique (prix_HDV_objet / coût_en_génétons)   [sauf objets liés]
valeur d'une stérile             = max(prix_vente, génération × prix_ressource_extraction,
                                       valeur_clone − coût_refécondation, valeur_brisage)
```

### 1.4 Grille de décision pour chaque monture (à appliquer en fin d'étape, dans l'ordre)

| # | Situation | Action | Source | Conf. |
|---|---|---|---|---|
| 1 | Féconde et nécessaire à un croisement du plan, ou partenaire rare | **Garder** (étable) | dragodinde.fr | medium |
| 2 | Féconde sans partenaire utile, et une autre féconde de sexe opposé du même type est aussi condamnée | **Accoupler entre elles** (bébé + XP), puis traiter les stériles | dragodinde.fr | high |
| 3 | Stérile + une autre stérile de même génération | **Cloner** (même couleur d'abord ; sinon couleur utile + couleur inutile → 50 % de chance de garder l'utile) | DPLN, Registre des Abysses | high |
| 4 | Stérile isolée sans usage, G ≥ 2 | **Max(vente, extraction, brisage)** selon les prix | crafts.md, Solomonk-e | medium |
| 5 | G10 « terminée » (succès obtenu) | Dernier accouplement G10×G10, puis vendre ou extraire ; remplacer par des G1 | dragodinde.fr | medium |
| 6 | Bicolore à ratio ♂/♀ bloquant, surplus sans partenaire | **Sortir** (banque/havre-sac si réutilisée plus tard, sinon vente/extraction) | dragodinde.fr | medium |
| 7 | Monture sénile (d'avant la 3.5) | Équiper, monter pour revente, ou extraire (1 ressource) ; jamais d'élevage | DPLN | high |
| 8 | Muldo/Volkorne G1 en surplus (succès de capture faits) | Monter vers le niveau 40–60 avec des Extraits de Mangeoire (niveau 53 = 39 360 XP ≈ 13 Extraits de 3 000 points par lot de 10, ≈ 1 300 kamas par monture en sept. 2026), puis **briser** (Ga PM/Ga PA) | Solomonk-e, table XP DPLN | medium |

---

## 2. Captures

### 2.1 Zones de capture (DofusDB, 3.6)

| Type | Sous-zone (id) | Région | Cartes | Coordonnées | Zaap le plus proche | Monstres (id) | Source | Conf. |
|---|---|---|---|---|---|---|---|---|
| Dragodinde | **Territoire des dragodindes sauvages** (235) | Montagne des Koalaks | 87 | x −23 → −11, y −2 → 9 (anneau autour du Village des Éleveurs) | **Village des Éleveurs [−16,1]** — le même que les enclos | Amande (171), Rousse (200), **Dorée (666, uniquement ici)**, archimonstres Draglida la Disparue (2379) et Dragnoute l'Irascible (2465) | DofusDB, DPLN | high |
| Dragodinde | Plaine des Scarafeuilles (170) | Amakna | 82 | x −6 → 5, y 21 → 32 | [−1,24] | Amande, Rousse (listées par DofusDB ; probablement héritage) | DofusDB | low |
| Muldo | **Bassin des Muldos** (1119) | Baie de Sufokia | 37 | x 16 → 22, y 18 → 23 | Rivage sufokien [10,22] (ou Sufokia [13,26], distance comparable selon l'accès) | Doré (4438), Pourpre (4437), Indigo (4434), Ébène (4435), Orchidée (4436) | DofusDB, DPLN | high |
| Volkorne | **Haras de Brâkmar** (886) | Brâkmar (sud) | 45 | x −33 → −23, y 39 → 45 | La Cuirasse [−26,37] ; sortie sud de Brâkmar [−25,40] | Orchidée (5308), Indigo (5309), Ébène (5311), Pourpre (5313) | DofusDB, DPLN | high |

Accès au Bassin des Muldos : barque du Territoire des Bandits [15,19] puis corde ; échelle face au sous-marin de Sufokia [22,19] ; scaphandre de l'atelier des éleveurs de Sufokia [19,23] (DPLN, high). Le devblog II annonçait « une zone d'environ 40 cartes » pour les Muldos et des groupes **composés uniquement de montures** (high).

### 2.2 Combat

- **Niveaux 62 à 70, 740–1 000 PV** (DofusDB, high). Un seul personnage de bon niveau suffit (DPLN, high).
- Dangers : Dragodindes → désenvoûtement + 120 dégâts (attention aux buffs) ; Muldos → −10 % de dommages finaux, −2 PA en mêlée ; Volkornes → attirance de 7 cases, repoussée de 4, −2 PM/−2 PA, état Pesanteur dès le tour 2, vol de vie, Volkorne pourpre −30 % de dommages finaux en zone et 175 dégâts (DPLN pages espèces, high).
- **Sort « Apprivoisement de monture »** (obtenu en équipant un filet en consommable de combat) : 1 PA, 7 PO, sans ligne de vue, 1 fois par combat et par personnage ; le filet est consommé au lancement ; capture **100 %** si le combat est gagné, perdu si le combat est perdu ; une monture marquée ne peut pas être « volée » par un autre joueur ; **chaque personnage du combat peut lancer son propre filet** (DPLN, devblog II, high).
- Technique : marquer au 1er tour (l'état dure jusqu'à la fin du combat), regrouper les montures avant un filet de zone (cercle de rayon 3) — glyphes/attirances, les Volkornes attirent eux-mêmes ; laisser en vie les cibles du personnage qui n'a pas encore lancé son filet (Solomonk-e, medium).

### 2.3 Groupes, couleurs, réapparition

| Point | Ce qu'on sait | Source | Conf. |
|---|---|---|---|
| Taille des groupes | Jusqu'à **8** montures (« niveau 150 : 8 ; niveau 200 : 16 ») ; en pratique **5 à 8** par lancer de filet renforcé (moyenne prudente 6). | Tenmalexis DPBN9vN5AFE, Laniyelle 9DOVGqb_rXg, Solomonk-e fGqEPyQoBgk | medium |
| Couleurs | Toutes les couleurs G1 de l'espèce sont dans la même sous-zone ; la Dorée n'apparaît que dans le Territoire (235). **Fréquence relative inconnue** (Solomonk suppose une répartition à peu près égale). | DofusDB, Solomonk-e | high (présence) / low (fréquences) |
| Réapparition | Aucune donnée publique ; respawn standard des monstres. | — | low |
| Archimonstres Draglida/Dragnoute | Présents en 235 ; capturabilité inconnue ; drops ×2 des ressources Pic/Queue/Ailes. | DofusDB | low |

L'application doit **journaliser les captures (couleur, sexe)** pour estimer les fréquences réelles par serveur.

### 2.4 Filets : progression et rendement

| Filet | Niv. métier | Effet | Montures par lancer | Coût indicatif (avril–sept. 2026) | Coût par monture | Source | Conf. |
|---|---|---|---|---|---|---|---|
| Filet de capture universel | 1 | 1 cible | 1 | 10 Bois de Frêne + 10 Fer ≈ 2 000 kamas | ≈ 2 000 kamas | DPLN, Solomonk-e | high / low (prix) |
| Filet multiplicateur de [type] | **100** | 1 cible ×2 (couleur identique, sexe non garanti) | 2 | ≈ 1 000 kamas si les ressources de monture sont droppées (5 Bois d'If + 5 Viande/Anguille/Seigle achetés) | ≈ 500 kamas | DofusDB, Solomonk-e | high / low |
| Filet à [type] renforcé | **150** | Toutes les montures dans un cercle de rayon 3 | 5–8 (moy. 6) | ≈ 2 100–2 200 kamas | ≈ 360 kamas | DofusDB, Solomonk-e | high / low |
| Filet multiplicateur de [type] renforcé | **200** | Zone + ×2 | 10–16 | 10 de chaque Aile/Moustache + 2–3 Bave/Griffe/Sueur + rares (Bois de Tremble…) | le plus bas si auto-droppé | DofusDB, Solomonk-e | high / medium |

Captures par combat avec plusieurs personnages : 4 personnages × multiplicateur = **8** ; 1 renforcé + 3 multiplicateurs ≈ **11** ; multiplicateur renforcé = jusqu'à **16** (Solomonk-e, medium). Le devblog II et dofuselevage.fr inversent les niveaux 100/150 : **les données du jeu donnent multiplicateur = 100, renforcé = 150** (high, voir mechanics.md §9).

**Règle de passage** : passer au filet suivant dès que le niveau le permet ; le **multiplicateur (100)** divise le coût par monture par ~4 ; le **renforcé (150)** est le meilleur rapport coût/temps tant que les groupes font ≥ 4 montures ; garder des filets universels pour finir un combat sur une monture isolée (Solomonk-e, medium).

### 2.5 Prospection, ressources, almanax

- Les montures sauvages droppent leurs ressources comme des monstres normaux : **la prospection compte** ; passer les challenges en mode « drop » pendant les captures (DPLN, Solomonk-e ; high/medium).
- Goulots des filets : Griffe de volkorne / Bave de muldo (7,1 %), Sueur de dragodinde (2 %) (crafts.md §5.2, high).
- Almanax : **11/09** +75 % d'XP dans le Territoire des Dragodindes Sauvages ; **01/04** +50 % XP et butin sur les créatures marines (la description DofusDB cite explicitement les « **muldos sauvages** ») ; 29/02 +75 % XP et butin (entrée DofusDB `29/02/*`, mais l'API renvoie « Cadeaux surprises » pour le 29/02/2028 : à vérifier, hors de la fenêtre oct. 2026 – oct. 2027) (DofusDB, high ; low pour le 29/02).
- Chaque capture rapporte **30 XP d'Éleveur** ; DPLN précise « 30 d'XP par monture capturée » y compris avec les filets multiplicateur ou renforcé (DPLN high ; que le doublon compte comme une capture : medium, non vu en jeu).

### 2.6 Multi-compte

- Les enclos et leurs 60 places sont **liés au compte** (le niveau retenu est celui du meilleur personnage du compte) : un 2e personnage du même compte n'ajoute pas de place ; **un 2e compte ajoute 6 enclos** (DPLN, devblog II, high).
- En équipe, chaque personnage lance son filet : captures × nombre de personnages, et drops multipliés (DPLN, high).
- Stratégie de Solomonk-e (medium) : un compte « principal » qui avance les générations ; les autres capturent en masse et produisent les générations N−1 et N−2 en stock, échangées ensuite (les montures sont des objets échangeables).
- Stockage : l'étable fait 250 places (500 en 3.7) ; les surplus vont dans l'inventaire, le havre-sac ou la banque (Solomonk a stocké 10 000 Volkornes sur 3 personnages) (DPLN, Solomonk-e ; high/medium).

### 2.7 Quoi capturer (couleurs et sexes)

1. **Succès de capture d'abord** (5 Muldos, 4 Volkornes, 3 Dragodindes) : 10 minutes (DPLN, high).
2. Capturer selon la **multiplicité des G1 dans l'arbre visé**, pas en parts égales : ex. pour un Muldo Ambre et Azur, Solomonk capture 120 Pourpre, 120 Doré, 40 Ébène (calculateur muldo-calculator, medium). La pyramide du §6 donne les volumes.
3. **Équilibrer les sexes par couleur** ; capturer en priorité le sexe en déficit (dragodinde.fr : « le symbole ♀/♂ indique le sexe en déficit ») (medium).
4. Remplir les places libres de l'étable à chaque cycle (Solomonk : « +21, +20, +17… à chaque itération pour rester proche de 250 ») (medium).

---

## 3. Monter le métier d'Éleveur (jobId 79)

### 3.1 Barème d'XP (3.6)

| Source | XP | Source | Conf. |
|---|---|---|---|
| Craft | `floor(20·L / ((J−L)^1,1 / 10 + 1) × ratio/100)`, ratio = 5 % pour carburants, makinas et filets spécifiques, **50 % pour le Filet de capture universel** → une recette de niveau L faite au niveau L rapporte **L XP**, ≈ 47 % de cela 9 niveaux plus haut et ≈ 44 % 10 niveaux plus haut ; 0 XP si J − 100 > L. | client ; validé sur capture DPLN (mechanics.md §7, crafts.md §6) | high |
| Accouplement | **30 × (génération A + génération B) × nombre de bébés** (10 en 3.5, 30 depuis la 3.6). | client 3.6, DPLN | high |
| Capture | 30 par monture capturée. | DPLN | high |
| Table | XP cumulée(L) = 10·L·(L−1) (seule exception : niv. 3 = 40 et non 60) : niv. 40 = 15 600 ; 100 = 99 000 ; 120 = 142 800 ; 200 = 398 000. | DPLN (`dpln-xp-tables.json`) | high |
| Almanax | **22/10 : +50 % XP Éleveurs** ; 01/05 : +50 % tous métiers ; 10/05 : −15 % d'ingrédients ; 10/08 : 25 % de chances d'un 2e objet. DofusDB liste aussi un bonus saisonnier « +25 % XP tous métiers » couvrant toute l'année (à vérifier en jeu). | DofusDB almanax | high / low (bonus saisonnier) |

Ce que rapporte une chaîne complète (simulation §6, niveau 40, 3.6) : **35 000 à 105 000 XP d'accouplement** pour obtenir une G9 (≈ niv. 1 → 60–100) et 3 000–6 000 XP de capture. Les accouplements comptent beaucoup au début, mais **les crafts restent la voie principale pour 120 puis 200** (medium).

### 3.2 Plan de montée par phase (craft de la taille qui vient de se débloquer)

Simulation de la formule (un seul type de carburant, taille la plus récente ; la répartition entre les 6 jauges ne change pas l'XP). Pack équivalent publié par Tenmalexis/dafous : 26 filets universels + 6 996 carburants (128 → 21 de chaque type par palier) = 23 106 + 520 = 23 626 ressources ; vérifié : il mène de 1 à 200 (≈ 398 380 XP), **mais il manque 1 XP au passage 74 → 75** : prévoir 1 Petit Philtre de plus (arrondi inférieur de la formule).

| Palier | XP à gagner | Recettes à enchaîner | Crafts cumulés | Ressources cumulées | Équivalent captures / accouplements G4×G4 | Ce que débloque le palier |
|---|---|---|---|---|---|---|
| 1 → 5 | 200 | Filet universel (10 XP au niv. 1) | 26 | 520 | 7 captures | Extraits |
| 5 → 15 | 1 900 | Minuscule Extrait (niv. 5) | 790 | 2 048 | 63 captures | Petit Extrait |
| 15 → 40 | 13 500 | Petit (15), Extrait (25), Grand (35) | 1 739 | 3 946 | 450 captures / 56 acc. | **2e enclos (40)** |
| 40 → 55 | 14 100 | Gigantesque Extrait (45) | 2 317 | 5 102 | 470 / 59 | Philtres (palier 2) |
| 55 → 80 | 33 500 | Philtres Minuscule→normal (55–75) | 3 122 | 7 517 | 1 117 / 140 | **3e enclos (80)** |
| 80 → 100 | 35 800 | Grand/Gigantesque Philtre (85–95) | 3 782 | 9 497 | 1 193 / 149 | **Filet multiplicateur (100)** |
| 100 → 120 | 43 800 | Potions Minuscule/Petite (105–115) | 4 434 | 11 903 | 1 460 / 182 | **4e enclos (120)** |
| 120 → 150 | 80 700 | Potions (125–145) | 5 402 | 15 775 | 2 690 / 336 | **Filet renforcé (150)** |
| 150 → 160 | 30 900 | Gigantesque Potion, Minuscule Élixir (145–155) | 5 721 | 17 175 | 1 030 / 129 | Élixirs (155), **5e enclos (160)** |
| 160 → 200 | 143 600 | Élixirs (165–195) | 6 993 | 23 535 | 4 787 / 598 | **6e enclos et filet multiplicateur renforcé (200)** |

Sources : formule client + table DPLN (high) ; dofus-portals.fr publie un autre barème « dofustool » (≈ 500 crafts par palier de 10) non cohérent avec la formule du jeu (low).

### 3.3 Stratégies de montée

| Profil | Méthode | Source | Conf. |
|---|---|---|---|
| **Rush** (kamas disponibles) | Acheter le pack (~23 600 ressources) et tout crafter en quelques minutes ; variante « éco » : crafter 768 fois le Minuscule Extrait le moins cher pour 1→15, puis la recette la moins chère de chaque palier. Le pack « tous types » donne en plus un stock de carburants de chaque jauge. | Tenmalexis DPBN9vN5AFE, dafous | high (XP) |
| **Progressif** (le plus courant) | 1–15 par les captures et quelques filets ; crafter **les carburants dont on a besoin**, au palier débloqué ; accoupler beaucoup (30 XP/génération/parent) ; crafter les Optimakinas dont on a besoin à leur niveau (L XP chacune). | DPLN, Solomonk-e | high |
| Objectif minimal | **Niveau 120 = 4 enclos** (« vrai luxe », DPLN) ; puis 150 pour le filet de zone ; 200 si l'on vise la production de masse. | DPLN | high |
| Optimisations | Crafts massifs le **22/10** (+50 %), le **10/05** (−15 % d'ingrédients) et le **10/08** (25 % de double) ; préférer les Gigantesques (5× moins d'objets par point) quand le prix au point est comparable. | DofusDB, crafts.md §2.2 | high |
| À éviter | Crafter des recettes > 9 niveaux sous son niveau (XP divisée par 2) ; acheter les ingrédients au pic de demande (×10 au lancement de la 3.5). | formule, Solomonk-e | high / medium |

Répartition conseillée des carburants produits pendant la montée (calcul) : chaque lot de 10 montures consomme ≈ 20 000 points de chacune des 3 jauges de statistiques, ≈ 2 500 points de sérénité en moyenne (Baffeur + Caresseur) et 20 000 points de Mangeoire (niveau 40). D'où une proportion d'environ **Foudroyeur 24 % / Abreuvoir 24 % / Dragofesse 24 % / Mangeoire 24 % / Caresseur ≈ 1,5–2 % / Baffeur ≈ 1,5–2 %** (82 500–83 000 points par lot ; medium).

---

## 4. Gestion des enclos

### 4.1 Principes (high, DPLN + client)

- 6 enclos de 10 places au Village des Éleveurs ([−18,0], [−19,0], [−20,0], [−20,2], [−19,2], [−18,2]) débloqués à 1/40/80/120/160/200 ; tous identiques.
- **2 jauges actives maximum** ; Baffeur et Caresseur exclusifs ; tick toutes les 10 s : 10/20/30/40 points selon le palier de la jauge ; chaque monture éligible gagne ce que la jauge perd.
- Une jauge **ne se vide pas** s'il n'y a aucune monture éligible ; le carburant n'est donc pas « perdu », mais **le rendement par point = éligibles / 10**.
- On peut remplir, (dés)activer les jauges, accoupler, cloner et extraire **à distance** ; poser/retirer une monture exige d'être sur **l'une** des 6 cartes d'enclos (Solomonk-e : depuis n'importe quelle carte d'enclos, on gère les 6).

### 4.2 Regroupement par sérénité

| Groupe (sérénité) | Smiley | Statistiques possibles | Jauges à activer | Ensuite |
|---|---|---|---|---|
| [−5 000 ; −2 001] | rouge :C | endurance seule | **Foudroyeur + Caresseur** | dès [−2 000 ; −1] : groupe bleu |
| [−2 000 ; −1] | bleu :( | endurance + maturité | **Foudroyeur + Abreuvoir** | Caresseur (+ Mangeoire) jusqu'à ≥ 0, puis Dragofesse + Mangeoire |
| [0 ; 2 000] | violet :) | maturité + amour | **Dragofesse + Abreuvoir** | Baffeur (+ Mangeoire) jusqu'à ≤ −1, puis Foudroyeur + Mangeoire |
| [2 001 ; 5 000] | vert :D | amour seul | **Dragofesse + Baffeur** | dès [0 ; 2 000] : groupe violet |

Sources : DPLN (high), mechanics.md §3.4 (high). Règles de lot :
- **Largeur ≤ 2 000** : un lot dont les sérénités tiennent dans une fenêtre de 2 000 traverse 0 sans qu'aucune monture ne sorte de la zone utile (calcul, high).
- Sérénité de départ aléatoire à la capture et à la naissance (mechanics.md, distribution inconnue, low) ; au clonage en 3.5/3.6 elle est « réinitialisée » (0 ou aléatoire : non tranché, voir §5.4) ; en 3.7 le clone **garde** la sérénité de l'original (devblog 3.7, high).
- dragodinde.fr conseille de « trier par sérénité croissante et de dédier la moitié des enclos à la montée de sérénité, l'autre à la descente » (medium) ; Solomonk règle la sérénité « 60 par 60 » en passant d'un enclos à l'autre (medium).

### 4.3 Quelle paire de jauges ? (table de décision du planificateur)

| Besoin du lot | Jauge 1 | Jauge 2 |
|---|---|---|
| 2 statistiques possibles dans la zone | les 2 statistiques | — |
| 1 statistique possible + sérénité à déplacer pour la suivante | la statistique | Baffeur/Caresseur **seulement si** la statistique se termine avant que la sérénité ne sorte de la zone ; sinon **Mangeoire** |
| 1 statistique, la sérénité est déjà du bon côté pour la suivante | la statistique | **Mangeoire** |
| Traversée de 0 (déplacement ≤ 2 000) | Baffeur/Caresseur | **Mangeoire** |
| Lot fécond en attente d'accouplement | — | **Mangeoire** seule (ou retirer le lot) |
| Montures pour revente/brisage | **Mangeoire** | — |

### 4.4 Paliers : vitesse, prix, présence

| Palier | Plage | Vidage du palier | 1 statistique (20 000) | Lot groupé complet (2 phases + traversée) | Carburant minimal | Usage conseillé |
|---|---|---|---|---|---|---|
| 1 | 0–40 000 | 11 h 07 | 5 h 33 | ≈ 11 h 23 | Extrait (le moins cher) | **nuit, absences** |
| 2 | 40 000–70 000 | 4 h 10 | 2 h 47 | ≈ 5 h 42 | Philtre | **journée, base** |
| 3 | 70 000–90 000 | 1 h 51 | 1 h 51 | ≈ 3 h 48 | Potion | session active |
| 4 | 90 000–100 000 | 41 min 40 | 1 h 23 | ≈ 2 h 51 | Élixir (le plus cher) | seulement en étant présent, rush |

- Calcul (deterministic-tables.json) : une jauge partie de 40 000 délivre **28 800 points en 8 h** et 40 000 en 12 h ; partie de 100 000 : 64 640 en 8 h. Une nuit au palier 1 suffit donc à une phase complète de 20 000 (high).
- Le prix au point dépend de l'HDV ; Solomonk-e juge le **palier 4 non rentable** et le palier 3 « éventuellement » (medium). Comparer par point : `prix / durabilité` de chaque taille du palier, comme le fait le Registre des Abysses (« la recette première est celle qui revient au moins cher pour 1 000 points »).
- **Remplir chaque palier avec le carburant minimal qui le permet** (Extraits jusqu'à 40 000, Philtres jusqu'à 70 000…) ; le débordement d'un carburant au-delà du plafond n'est pas vérifié (la 3.7 ajoute une confirmation anti-gaspillage) : viser les tailles qui tombent juste (Minuscule, Petit, Gigantesque) (crafts.md §2.3, medium).
- Le devblog II annonçait ≈ 10 h pour une monture féconde au palier 2 moyen et 5 h au palier 4 (high) ; avec le regroupement à 2 statistiques on descend à ≈ 5 h 42 et 2 h 51 (calcul).

### 4.5 Dérive de sérénité et alarmes

```
temps_avant_cible = Σ ticks de 10 s jusqu'à |s_cible − s| points, au rythme du palier courant de la jauge
                    (le palier baisse pendant le vidage : simuler tick par tick, comme l'outil DPLN)
alarme = maintenant + temps_avant_cible − marge (≥ 1 tick)
```
- Une jauge de sérénité **continue de déplacer toutes les montures** (y compris celles déjà arrivées) jusqu'à ±5 000 : la régler sur la **monture la plus éloignée** d'un lot ≤ 2 000 de large, puis couper à distance (DPLN, high).
- 1 000 points de sérénité = 17 min au palier 1, 8 min au palier 2, 4 min au palier 4 (calcul, high).
- Astuce : remplir la jauge de sérénité **juste de ce qu'il faut** (distance à parcourir + marge) pour qu'elle s'arrête d'elle-même ; à combiner avec l'alarme (déduction, medium).

### 4.6 Capacités et almanax

- Amoureuse/Endurante/Précoce doublent un gain **pour cette monture seulement** : utile pour finir plus tôt une monture, sans économie de carburant sauf si **tout le lot** a la même capacité ; Sage double l'XP (montures à vendre ou à briser) (DPLN, high ; déduction medium).
- Jours « effet doublé » (10/01 Abreuvoir, 10/03 Foudroyeur, 10/04 Baffeur, 10/06 Mangeoire, 10/09 Caresseur, 10/12 Dragofesse) : programmer ce jour-là la phase correspondante pour tous les enclos ; modélisé comme gain ×2 à consommation inchangée (DofusDB high ; effet exact **low**). Un simple carburant de palier bas suffit alors à aller deux fois plus vite.
- Jours « tous les bébés naissent avec une capacité » (10/02 Endurante, 10/07 Amoureuse, **10/10 Sage**, 10/11 Précoce) : y faire les accouplements dont on garde/vend les bébés (Sage pour revente au niveau 200) (DofusDB, high).

### 4.7 Répartition des enclos selon leur nombre (recommandation, medium)

| Enclos | Organisation |
|---|---|
| 1 (niv. 1–39) | 1 lot de 10 à la fois, cycle 2 phases ; sérénité réglée lot par lot. Accoupler dès que 2 montures compatibles sont fécondes. |
| 2 (40–79) | E1 = groupe bleu (Foudroyeur + Abreuvoir), E2 = groupe violet (Dragofesse + Abreuvoir) ; les lots changent d'enclos à la traversée de 0. |
| 3 (80–119) | + E3 = « station de sérénité » (Caresseur ou Baffeur + Mangeoire) pour les extrêmes et les traversées. |
| 4 (120–159) | 2 enclos bleus, 1 violet, 1 station ; ou 3 de production + 1 Mangeoire (montures à revendre/briser). |
| 6 (200) | 2 bleus, 2 violets, 1 station Caresseur, 1 station Baffeur ; lots de 60 (dragodinde.fr raisonne en « lots » = 10 × nombre d'enclos). |

---

## 5. Accouplements

### 5.1 Génération cible : règles pratiques (mechanics.md §1–2, high sauf mention)

- Génération cible = génération maximale parmi les montures des deux arbres **et** leurs croisements possibles ; elle reçoit **exactement** B = 30 % + 0,15 %·(niv. A + niv. B) + Optimakina (+10 % ; +20 % en 3.7) + Takeza (+20 %), plafonné à 100 %, partagé entre ses différentes issues selon la généalogie.
- **100 % de cible** : niveaux cumulés ≥ 400 avec Optimakina (3.6) ; ≥ 334 avec Optimakina en 3.7 (deux parents 167 ; 333 donne 99,95 %) ; ≥ 267 avec Optimakina + Takeza (3.6) ; ≥ 200 avec Optimakina 20 % + Takeza (3.7) (calcul, high).
- Génétons : seulement si le bébé dépasse **toutes** les générations des deux arbres.
- La makina doit être de génération **≥ génération cible** (une plus haute convient).

### 5.2 Faut-il monter les parents ?

| Niveau visé | Coût en points de Mangeoire pour un lot de 10 | Bonus d'un couple | Bonus moyen depuis le niv. 1 / marginal (par 1 000 pts) | Recommandation | Source | Conf. |
|---|---|---|---|---|---|---|
| ~40 | 20 437 (≈ la durée d'une phase, donc « gratuit » en temps) | +12 % | 0,59 % / 0,59 % | **Toujours** (Mangeoire en 2e jauge) | dragodinde.fr (calculs « pour des parents montés au niveau 40 », niveau visé 40–90, « monter plus haut que nécessaire fait perdre du temps d'XP »), DPLN, calcul | high/medium |
| 50–60 | 34 365–52 544 | +15–18 % | 0,44–0,34 % / 0,19 % (40 → 60) | Pratique de Solomonk (montée pendant les phases à 1 statistique) ; bon compromis | Solomonk-e | medium |
| 100 | 172 668 (24 h au palier 2) | +30 % | 0,17 % / 0,10 % (60 → 100) | Seulement pour les **parents chers** (G8/G9) ou les montures à vendre | DPLN, simulation | medium |
| 200 | 867 582 (≈ 60–150 h) | +60 % | 0,07 % / 0,04 % (100 → 200) | Montures vendues ou couples G9 × G9 critiques ; rarement rentable | DPLN, devblog II, Solomonk-e | medium |

Règle de décision (à coder) : monter un couple de ΔL niveaux si `coût_XP(ΔL) < C_eff × 0,003·ΔL / p`, où C_eff = coût net des deux parents (obtention + fécondation − valeur résiduelle) et p la chance actuelle. Le niveau d'un parent G1 « bon marché » compte autant que celui d'une G9 : pour un croisement G9 × G1, **monter la G1** (déduction du modèle, medium). Le niveau est-il conservé au clonage ? Inconnu (low) ; si oui, des G1 de niveau élevé recyclées par clonage deviennent des « étalons » réutilisables.

La simulation (§6) montre qu'en régime limité par les places d'enclos, **viser le niveau 40 partout bat le niveau 100** (le temps d'XP immobilise les places) ; le niveau 100 n'est intéressant que si les places ne sont pas le facteur limitant (medium).

### 5.3 Optimakina, Animakina, Kromakina ou rien ?

| Makina | Effet 3.6 | Effet 3.7 (bêta) | Quand l'utiliser | Source | Conf. |
|---|---|---|---|---|---|
| **Optimakina** | +10 % génération cible | **+20 %** | Si `prix < C_eff × Δ / p` (Δ = 0,10 ou 0,20). À p = 42 % : rentable dès qu'elle coûte moins d'environ ¼ de la valeur nette du couple (Δ = 0,10). Systématiquement en G ≥ 6 ; sur les basses générations si les makinas G2–G5 (boss bas niveau) sont bon marché. | DPLN, dafous (« Gen 7+ »), simulation | medium |
| **Animakina** | capacité aléatoire : Amoureuse/Endurante/Précoce 27 %, Sage 14 %, Reproducteur 5 % | **choix du sexe du bébé** (stocks convertis) | 3.6 : rarement (Reproducteur trop rare ; capacités perdues au clonage). 3.7 : sur les bébés de la couleur dont le sexe est en déficit, et sur les G9/G10 dont on a besoin d'un sexe précis. | DPLN, devblog 3.7 | high |
| **Kromakina** | Caméléone 100 % | inchangée | Montures vitrines destinées à la vente. | DPLN, dafous | high |
| Rien | — | 3.7 : capacité aléatoire sans makina (3/6/8/8/8 %) | Basses générations, parents très bon marché. | DPLN, devblog 3.7 | high |

Effet mesuré par la simulation (niveau 40, clonage) : l'Optimakina **à chaque accouplement** réduit de 40 à 65 % les captures, accouplements, fécondations et carburant pour une G9/G10, au prix d'**une makina par accouplement** (267 à 471 makinas pour une G9/G10). Limitée aux cibles G ≥ 6, elle économise 20 à 48 % pour 38 à 77 makinas (§6, medium). Le Registre/dafous recommandent l'Optimakina « sur les croisements haute génération » (medium).

### 5.4 Clonage : le « 2 pour 2 »

- Entrée : 2 montures **de même espèce et de même génération** (stériles, fertiles ou fécondes ; pas séniles). Sortie : **l'une des deux au hasard (50/50)**, fertile, avec sa couleur, son sexe, son nom et sa généalogie ; jauges remises à zéro ; capacité perdue ; sérénité « réinitialisée » en 3.5/3.6 (DPLN ; le devblog II dit « jauges à 0 » ; valeur exacte, 0 ou aléatoire comme une nouvelle monture, **non tranchée**, low), conservée en 3.7 (devblog 3.7, high). Tirage 50/50 : devblog II (high).
- Bilan : un accouplement consomme 2 fertiles et rend 1 bébé + 1 fertile (clone) → **le clone doit être refécondé** (6 000 points de carburant) : le clonage remplace des captures par du carburant (déduction, high).
- Politique : cloner **juste après les accouplements** ; d'abord deux stériles **de même couleur** (résultat certain) ; sinon une couleur utile + une inutile (50 % de garder l'utile) ; ne jamais cloner deux couleurs inutiles ; garder une stérile isolée en attente d'une partenaire de même génération (Registre des Abysses, dragodinde.fr, simulation ; medium).
- Le clonage ne garantit pas la parité mâle/femelle : utiliser deux stériles de même sexe si l'on a besoin d'un sexe précis (Solomonk-e, medium).
- Débat communautaire (Solomonk-e, mars 2026) : le clonage seul ne suffit pas, il faut **continuer à capturer** car les montures se dispersent sur de plus en plus de couleurs. La simulation le confirme : même avec clonage, une G9 demande 100–200 captures au niveau 40 (medium).

### 5.5 Hygiène généalogique

- Les arbres s'arrêtent aux grands-parents : un bébé ne « voit » que ses parents et leurs parents (DPLN, high).
- **Dilution** : une monture dont un parent est de génération ≥ génération cible du croisement partage le bonus et fait perdre les génétons. Exemple calculé : Orchidée × Pourpre (parents Indigo et Pourpre + Orchidée et Pourpre, G6) → Orchidée et Pourpre **36,7 %, 0 généton**, contre **42 %, 30 génétons** avec une Pourpre issue de la recette standard (niv. 40/40 ; modèle, medium).
- Les **doublons** dans les arbres augmentent la probabilité de leur couleur (DPLN, high) : deux parents de même couleur sans arbre donnent cette couleur à coup sûr.
- Nommer les montures selon leur génération/couleur/arbre pour s'y retrouver (le Registre des Abysses génère des noms valides pour le renommage en jeu) (medium).

### 5.6 Les « porteurs » (G10 à partir de G1)

Une monture de basse génération dont **un parent** est une G9 « porte » cette G9 dans son arbre. Croisée avec une monture d'une autre couleur, la génération cible devient G10. Exemples calculés avec le modèle (niveaux 40/40, sans makina ; `sim/carrier-examples.txt`) :

| Couple | Issue cible | Autres issues notables | Génétons |
|---|---|---|---|
| Dragodinde Dorée (parents Dorée + **Émeraude**) × Rousse sauvage | **Émeraude et Rousse (G10) 42 %** | Émeraude (G9) 15,4 % | 2 |
| Émeraude (arbre standard) × Dorée sauvage (croisement standard) | Dorée et Émeraude (G10) 42 % | Dorée 29 %, Émeraude 22,9 % | 251 |
| Muldo Doré (parents Doré + **Corail**) × Pourpre sauvage | **Corail et Pourpre 42 %** | Corail 1,5 % | 2 |
| Muldo Doré (Corail) × Pourpre et Ivoire | Corail et Pourpre 21 % + Corail et Ivoire 21 % | — | 31 |
| Volkorne Pourpre (parents Pourpre + **Jade**) × Indigo sauvage | **Jade et Indigo 42 %** | Jade 5,8 % | 2 |

- Le cas est **validé en jeu** par la capture EX2 du guide DPLN (Muldo Pourpre dont un parent est Corail × Doré et Indigo → Corail et Doré / Corail et Indigo 15,15 % chacun) (high).
- Les porteurs naissent tout seuls : **≈ 29 % des tentatives G9 × G1 donnent la G1 avec la G9 comme parent** (= (1 − p)/2 à p = 42 % ; recalculé avec le modèle pour Émeraude × Dorée, Corail × Pourpre/Doré et Jade × Indigo/Pourpre : 29,0 % dans les trois espèces) ; ils se recyclent par clonage (même génération, généalogie conservée).
- Usage : **succès G10** (19 Dragodindes, 50 Muldos, 50 Volkornes) à bas coût. **Pas pour les génétons** (2 à 31 par bébé).
- Les Dragodindes G9 ont un poids génétique de 90 (monocolores) : un porteur Dragodinde redonne même parfois la G9 (15 %) ; les Muldos G9 (poids 20) presque jamais (1,5 %) (mechanics.md §1.1, high).

### 5.7 Maximiser les génétons

- Génétons par réussite = barème(A) + barème(B) : G1+G1 = 2 ; G2+G2 = 4 ; G4+G4 = 16 ; G6+G6 = 60 ; G8+G8 = 240 ; **G9 + G1 = 251** ; **G9 + G9 = 500** (high). En 3.7 bêta (≈ ×2, barème 2/4/8/15/30/60/120/250/500) : G4+G4 = 30, G8+G8 = 500, G9+G1 = 502, G9+G9 = 1 000 (client 3.7.3.3, high pour la bêta).
- Un accouplement G9 × G9 (deux monocolores G9 différentes → G10) rapporte le double d'un G9 × G1 mais consomme deux G9 : il n'est intéressant que si l'on a un surplus de G9 (déduction, medium).
- Sur une chaîne complète jusqu'à une G9, la simulation donne **≈ 1 500 à 3 000 génétons** (niveau 40), soit ≈ 9–19 Puissants Parchemins (≈ 0,6–1,1 M kamas au prix de septembre 2026) : **les génétons seuls ne paient pas le carburant d'une chaîne** ; la marge vient surtout de la vente des G8–G10, de l'extraction et du brisage (calcul, low à cause des prix).
- dragodinde.fr propose un mode « Optimisation génétons » qui maximise les « bébés rentables » au lieu de viser des couleurs (medium).
- Statut des génétons : liés au compte selon DPLN et le devblog ; DofusDB les marque « échangeables » avec un effet « Échangeable : <date> » (983) et dragodinde.fr parle de les revendre : **à vérifier en jeu** (conflit, low).

### 5.8 Organisation d'une session d'accouplement

1. Rendre féconde une **étable entière** (lot = 10 × nombre d'enclos) avant de reproduire ; ne garder dans l'étable que des fécondes (dragodinde.fr, medium).
2. Accoupler **par génération** : mettre en inventaire tout ce qui n'est pas G2, faire les G2, puis G4, G6, G8, puis les monocolores (dragodinde.fr, medium). Les deux montures doivent être **dans l'étable** (pas dans l'inventaire ni dans un enclos) (DPLN, high).
3. Lire les pourcentages affichés et l'XP de la fenêtre d'accouplement ; vérifier la génération de la makina (DPLN, high).
4. Cloner, capturer, extraire, ranger (règle 13).
5. Resynchroniser le plan sur les naissances réelles (les naissances sont aléatoires en couleur et en sexe) : « plan → jeu → resynchronisation » (dragodinde.fr, Registre des Abysses ; medium).

### 5.9 Choix des couples

- Maximiser le **nombre de couples utiles** de la session (appariement mâles/femelles) plutôt que de choisir au hasard (Registre des Abysses « GPS », medium).
- Identifier les **goulots** : couleurs utilisées par plusieurs recettes (Dragodinde : Amande et Dorée pour Indigo et Ébène, Ébène et Indigo pour Orchidée et Pourpre, Orchidée et Pourpre pour Ivoire et Turquoise, Ivoire et Turquoise pour Prune et Émeraude) et en produire davantage (Solomonk-e, arbres, medium).
- Pour Muldos/Volkornes (plusieurs recettes par monocolore impaire), choisir la recette **à base de couleurs capturables** (moins de captures) ; la simulation utilise la recette la moins chère en captures (tree-muldo.md §6, medium).
- Priorité aux tentatives de la génération la plus haute quand le stock le permet ; sinon « stacker » (règle 17).

### 5.10 Calendrier et 3.7

| Date | Événement | Conseil |
|---|---|---|
| 10/10/2026 | Benjo : bébés Sage | accouplements dont on garde/vend les bébés (XP ×2) |
| **12/10/2026** | **Takeza : +20 % de génération cible** | préparer en avance un maximum de couples féconds de haute génération (stocker dans l'étable) |
| **22/10/2026** | +50 % XP Éleveurs | grosse session de crafts de montée |
| 10/11/2026 | Otoul : bébés Précoce | — |
| 10/12/2026 | Foya : Dragofesse ×2 | phases d'amour pour tous les lots |
| 10/01/2027 | Trôma : Abreuvoir ×2 | phases de maturité |
| 10/02/2027 | Meash : bébés Endurante | — |
| 10/03/2027 | Inndo : Foudroyeur ×2 | phases d'endurance |
| 01/04/2027 | créatures marines +50 % XP et butin | captures de Muldos (probable) |
| 10/04/2027 | Nunu : Baffeur ×2 | descentes de sérénité |
| 01/05 et 10/05/2027 | +50 % XP métiers ; −15 % d'ingrédients | crafts |
| 10/06/2027 | Jibejan : Mangeoire ×2 | XP des montures à vendre/briser |
| 10/07/2027 | Jihelair : bébés Amoureuse | — |
| 10/08/2027 | Rigamix : 25 % de double craft | crafts de makinas/carburants chers |
| 10/09/2027 | Mau : Caresseur ×2 | montées de sérénité |
| 11/09/2027 | +75 % XP au Territoire des Dragodindes | captures de Dragodindes |
| 11/10/2027 | Takeza | idem 2026 |

Sources : DofusDB `almanax-calendars` (high).
**3.7 (bêta, date live inconnue ; les saisons 2026 annoncent la 3.8 en novembre–décembre, donc la 3.7 est probablement prévue autour d'octobre — low)** : carburants ×2 (le coût d'une fécondation est divisé par 2), jauges ×2 (le palier 1 dure 22 h 13 : une nuit ne vide plus la jauge), génétons ×2, Optimakina +20 %, Animakina = choix du sexe, capacités aléatoires sans makina, étable 500, clone qui garde la sérénité, recettes de makinas revues (ressources de boss chères remplacées) (devblog 3.7 + client bêta, high pour le contenu). Conséquences : (1) **ne pas brûler les Animakinas** avant la 3.7, elles deviendront des outils de choix du sexe (high) ; (2) les accouplements G8/G9 à gros génétons valent **2×** après la sortie (high) ; (3) les stocks de carburants devraient voir leur durabilité doublée si l'effet est porté par le modèle d'objet (déduction, low).

---

## 6. La pyramide : combien de captures, d'accouplements et de temps ?

### 6.1 Méthode

Simulateur Monte-Carlo (`raw/strategy-evidence/sim/pyramid_sim.py`, 40 tirages par cas) :
- probabilités de naissance du **modèle validé sur 4 captures in-game** (mechanics.md §1) ; recette la moins chère en captures pour chaque couleur ;
- politique « pilotée par la demande » : à chaque cycle, calcul du besoin de chaque couleur à partir de la cible ; accouplement des couples en déficit (sexes opposés, arbres propres en priorité) ; clonage systématique des stériles (même couleur d'abord) ; **captures de G1 seulement pour remplir les places libres** ;
- **1 cycle = une demi-journée (~12 h) = un lot rendu fécond** ; 60 places (6 enclos) sauf mention ; XP jusqu'au niveau ~40 obtenue pendant la fécondation, au-delà 3 XP/s en moyenne ;
- carburant = 6 300 points par fécondation (60 000 + ~3 000 de sérénité par lot de 10) + XP au-delà du niveau 40.
Limites : joueur parfait (2 sessions/jour sans retard), pas de vente/achat de montures, pas de porteurs, sexe 50/50, sérénité non modélisée finement. **Multiplier les durées par ~1,5–2 pour un joueur réel** (low).

### 6.2 Résultats (moyennes ; « C » = captures G1, « Acc » = accouplements, « Féc » = fécondations, « Cyc » = demi-journées)

**Effet du clonage et du niveau (60 places, sans Optimakina sauf mention)** :

| Cible | Niv. 1 sans clonage | Niv. 1 + clonage | Niv. 40 + clonage | Niv. 40 + clonage + Optimakina partout | Niv. 100 + Optimakina |
|---|---|---|---|---|---|
| Dragodinde Ébène (G3) | C 76 · Acc 34 | C 20 · Acc 32 | C 13 · Acc 14 | C 13 · Acc 13 | C 10 · Acc 9 |
| Dragodinde Pourpre (G5) | C 735 · Acc 604 | C 83 · Acc 170 | C 38 · Acc 78 | C 28 · Acc 53 | C 19 · Acc 32 |
| Dragodinde Turquoise (G7) | **C ~17 000 · Acc ~15 000** | C 184 · Acc 726 | C 99 · Acc 278 | C 66 · Acc 165 | C 34 · Acc 88 |
| Dragodinde Émeraude (G9) | (explose) | C 638 · Acc 3 394 | C 188 · Acc 821 | C 111 · Acc 378 | C 64 · Acc 217 |
| Muldo Prune (G7) | C ~14 000 | C 184 · Acc 714 | C 104 · Acc 259 | C 63 · Acc 135 | C 49 · Acc 85 |
| Volkorne Doré (G7) | C ~18 000 | C 204 · Acc 921 | C 101 · Acc 328 | C 76 · Acc 238 | C 58 · Acc 140 |

**Politiques réalistes pour une G9 et la G10 la moins chère (60 places)** — `pyramid-results-v2.json` :

| Cible | Politique | Captures | Accouplements | Optimakinas | Fécondations | Carburant (M de points) | Demi-journées (p90) | Génétons gagnés en route |
|---|---|---|---|---|---|---|---|---|
| Dragodinde Émeraude (G9) | niv. 1, rien | 638 | 3 394 | 0 | 7 393 | 46,6 | 139 (173) | 5 260 |
| | **niv. 40, rien** | 188 | 821 | 0 | 1 813 | 11,4 | 56 (80) | 2 991 |
| | niv. 40, Opti dès G6 | 150 | 591 | 65 | 1 318 | 8,3 | 49 (68) | 2 399 |
| | **niv. 40, Opti partout** | **111** | **378** | 378 | **855** | **5,4** | **40 (58)** | 2 198 |
| | niv. 40/60/100 selon la génération, Opti dès G8 | 134 | 514 | 10 | 1 148 | 7,7 | 71 (106) | 2 233 |
| | 3.7 : niv. 40, Opti 20 % dès G6 | 117 | 426 | 44 | 958 | 6,0 | 47 (73) | 2 034 (×2 en 3.7) |
| Dragodinde Amande et Émeraude (G10) | niv. 40, rien | 247 | 1 130 | 0 | 2 487 | 15,7 | 58 (73) | 4 093 |
| | niv. 40, Opti partout | 137 | 471 | 471 | 1 064 | 6,7 | 48 (63) | 3 169 |
| Muldo Corail (G9) | niv. 40, rien | 183 | 617 | 0 | 1 382 | 8,7 | 41 (64) | 2 081 |
| | niv. 40, Opti partout | 108 | 267 | 267 | 624 | 3,9 | 36 (55) | 1 586 |
| Muldo Corail et Doré (G10) | niv. 40, rien | 228 | 818 | 0 | 1 818 | 11,5 | 47 (65) | 3 346 |
| | niv. 40, Opti partout | 119 | 322 | 322 | 744 | 4,7 | 39 (65) | 2 269 |
| Volkorne Jade (G9) | niv. 40, rien | 198 | 775 | 0 | 1 722 | 10,9 | 46 (63) | 2 021 |
| | niv. 40, Opti partout | 106 | 347 | 347 | 784 | 4,9 | 52 (84) | 1 507 |
| Volkorne Jade et Pourpre (G10) | niv. 40, rien | 281 | 1 208 | 0 | 2 659 | 16,8 | 57 (71) | 3 493 |
| | niv. 40, Opti partout | 124 | 417 | 417 | 940 | 5,9 | 46 (70) | 2 216 |

Avec **20 places** (2 enclos), niveau 40 sans makina : Émeraude ≈ 86 demi-journées (43 jours), Muldo Corail ≈ 63, Volkorne Jade ≈ 91 (grille 1).

### 6.3 Enseignements (medium)

1. **Le clonage est indispensable** : sans lui la pyramide explose dès la G7 (×80 à ×100 de captures).
2. **Niveau 40 « gratuit »** : divise par 2 à 5 les captures, accouplements et carburant d'une G9 par rapport au niveau 1 (Muldo ÷2–3, Dragodinde/Volkorne ÷3–5 ; jusqu'à ÷6 pour les G10).
3. **Optimakina partout** : encore −41 à −65 % sur les captures, accouplements, fécondations et carburant (pas sur la durée : de −28 % à +13 % de demi-journées), au prix d'une makina par accouplement → à décider selon le prix des makinas basses générations ; limitée aux cibles ≥ G6 : −20 à −48 % pour 38 à 77 makinas.
4. Monter les parents au niveau 100 réduit les captures mais **ralentit** (places immobilisées par l'XP) : à réserver aux derniers étages ou aux joueurs qui ne sont pas limités par les places.
5. **Ordre de grandeur pour une G9** : ~105–200 captures, ~270–820 accouplements, ~4–11 millions de points de carburant, ~18–28 jours de jeu optimal à 6 enclos (36–56 demi-journées ; ×1,5–2 en réel ; 32–46 jours à 2 enclos sans makina).
6. **G10 la moins chère** = G9 + 1 étage (croisement avec une G1) : +10 à +25 % de captures/accouplements/carburant avec Optimakina partout, +25 à +56 % sans makina ; durée −12 % à +23 %.

### 6.4 Comparaison avec les témoignages

| Témoignage | Contenu | Source | Conf. |
|---|---|---|---|
| Solomonk-e (avril 2026) | Après 1 mois à ~1 h/jour, 3–4 enclos : Muldos en G6–G7, seulement 811 génétons. | z8TYzeV8g-o | low |
| Solomonk-e (mars 2026) | Plan « full succès Dragodindes » : 249 G1 au départ (83 de chaque), parents ~niv. 60 (48 %), recaptures à chaque itération ; G4–G5 atteintes vers l'itération 4–5. | Yoz63BNQZ0o | medium |
| Calculateur muldo (Chikkin Sama) | Muldo Ambre et Azur G10 : ~280 G1 (40 Ébène, 120 Pourpre, 120 Doré) avec clonage, parents ~niv. 60 ; Corail et Émeraude : 348 G1 pour 3 tentatives finales au niv. 93 avec Optimakina. | MSFc68m3JYg, dhQ0-67UYXs | medium |
| dofuselevage.fr « génération en génération » | Succès complet Dragodindes à 90 % de cible : 275 captures initiales (92/92/91), 536 accouplements, 1 072 montures à préparer, 6,4 M de points de carburant. | outil dofuselevage | medium |
| DPLN | Succès de toutes les générations des 3 types : « plusieurs mois au minimum ». | guide DPLN | high |

---

## 7. Routines

### 7.1 Journée type (2 sessions, recommandé)

| Moment | Actions (≈ 15–30 min) |
|---|---|
| **Matin** | Retirer les fécondes et faire les accouplements (par génération, makinas) → clonages → reposer bébés/clones/captures en enclos par sérénité → traversées de 0 sur les lots qui ont fini leur phase double (Caresseur/Baffeur + Mangeoire, avec **alarme**) → dès l'arrivée : 3e statistique + Mangeoire, palier 2–3 pour la journée. |
| **Midi** (option) | Couper les jauges de sérénité arrivées (à distance), recharger les paliers 2–3, capturer si des places se libèrent. |
| **Soir** | Accouplements des lots finis, clonages → nouveaux lots groupés par sérénité en **phase double**, jauges remplies à **20 000–40 000 en Extraits (palier 1)** pour la nuit → vérifier qu'aucune jauge de sérénité n'est active la nuit. |

### 7.2 Semaine

- Audit carburants (par jauge et par palier) et filets ; craft ou achat en conséquence.
- Audit des lignées : couleurs goulots, sexes en déficit, stériles isolées, G10 à sortir.
- Session(s) de capture ciblée (couleurs/sexes manquants).
- Revente : G8–G10, ressources d'extraction, runes, ressources de monstres recherchées.
- Planification almanax du mois (le 10, Takeza, 22/10).
Sources : dafous (checklists quotidienne/hebdomadaire), dragodinde.fr, DPLN (medium).

---

## 8. Phases du planificateur (résumé de `strategy.json → phases`)

| Phase | Niveau d'Éleveur | Objectif | Sortie de phase |
|---|---|---|---|
| P0 Préparation | 0–1 | choisir l'espèce et l'objectif (succès, génétons, revente, brisage), budget, filets universels, premiers carburants | ≥ 20 G1 capturées, carburants palier 1 |
| P1 Démarrage | 1–40 | succès de capture, G2–G3, montée métier (captures, Minuscules/Petits Extraits), niveau ~40 des montures | Éleveur 40 (2e enclos) |
| P2 Montée en régime | 40–80 | Gigantesques Extraits (nuits), Philtres (palier 2), G3–G5, clonage systématique | Éleveur 80 (3e enclos), première G5 |
| P3 Production | 80–120 | filet multiplicateur (100), Potions (105), G5–G7, Optimakina sur G ≥ 6 | **Éleveur 120 (4 enclos)**, première G7 |
| P4 Haute génération | 120–160 | filet renforcé (150), Élixirs (155), G7–G9, porteurs | Éleveur 160, première G9 |
| P5 Maîtrise | 160–200 | 6 enclos, multiplicateur renforcé, G10, génétons ×2 en 3.7 | Éleveur 200, succès G10 |
| P6 Croisière/rentabilité | 200 | boucle capture → génération → vente/extraction/brisage → recapture ; G10 sorties | marge positive stable |

---

## 9. Erreurs fréquentes

| Erreur | Conséquence | Source |
|---|---|---|
| Laisser un Baffeur/Caresseur actif sans surveillance | montures à ±5 000, tout à refaire | DPLN |
| Enclos à moitié vide avec une jauge active | rendement du carburant divisé (éligibles/10) | DPLN, dafous, Solomonk-e |
| Jauge incompatible avec la sérénité du lot | jauge inutile (elle ne consomme pas, mais rien n'avance) | dafous |
| Lot hétérogène en sérénité (> 2 000 d'écart) | certaines montures sortent de la zone pendant la traversée | calcul |
| Palier 4 permanent, Élixirs pour tout | coût au point maximal ; jauge vide en 42 min | DPLN, Solomonk-e |
| Monter tous les parents au niveau 200 | des centaines d'heures d'XP, places bloquées | DPLN, devblog II, simulation |
| Ne pas cloner / vendre toutes les stériles | pyramide de captures ×80 à ×100 | DPLN, simulation |
| Extraire ou vendre une monture encore utile à une lignée | rupture de chaîne, goulot | dafous, DPLN |
| Extraire deux fécondes sans les accoupler d'abord | bébé et XP perdus | dragodinde.fr |
| Oublier l'Optimakina sur les croisements haute génération | jusqu'à ~2× plus de tentatives | dafous, simulation |
| Makina de génération inférieure à la génération cible | inutilisable | DPLN |
| Parents dont l'arbre contient une génération ≥ cible | bonus partagé, 0 généton | DPLN, modèle |
| Tenter une génération avec 1 seul couple | ~58 % d'échec à 42 % | Chikkin, Solomonk |
| Ignorer les sexes à la capture | couleurs bloquées (80 ♂ / 40 ♀) | dragodinde.fr |
| Garder ses G10 une fois les succès faits | places bloquées, plus de génétons | dragodinde.fr |
| Accoupler depuis l'inventaire ou un enclos | impossible : les montures doivent être dans l'étable | DPLN |
| Acheter les ressources de filets ou de carburants au prix fort | rentabilité détruite | Solomonk-e |
| Croire les vieux tutoriels (gestation, fatigue, énergie, « 2 reproductions par monture », dorées 5× plus lentes) | erreurs de planification | DPLN (changements 3.5) ; erreurs relevées sur dragodinde.fr (guide Muldo) et next-stage |
| Compter sur les montures d'avant la 3.5 | séniles : ni accouplement ni clonage | DPLN |

---

## 10. Outils communautaires (revue)

| Outil | Ce qu'il fait | Idées à reprendre | Limites / erreurs |
|---|---|---|---|
| **DPLN – Gestion d'enclos** (`gestion-d-enclos.html`, JS lu et désobfusqué) | 6 enclos × 10 montures ; choix de 2 jauges (Baffeur/Caresseur exclusifs) ; valeur de chaque jauge avec boutons « T1/T2/T3/T4 max » ; valeur de départ par monture ; capacité par monture (×2) ; sérénité cible (Caresseur, défaut 0 ; Baffeur, défaut −1) ; niveau cible pour la Mangeoire (table XP 1–200 embarquée) ; **simulation tick par tick** (gain 10/20/30/40 selon le palier, ×2 capacité, ×2 almanax) ; compte à rebours en temps réel, heure d'arrivée, alerte sonore, « ⚠ Jauge vide avant la fin. Max atteint : … » ; bannière almanax (bonus actif + à venir) ; sauvegarde locale. | simulation tick par tick, boutons de palier, alerte, almanax, avertissement « jauge vide avant la fin » | ne vérifie pas l'éligibilité (zones de sérénité), un seul objectif par jauge, pas de coût, pas de planification de lots ni d'accouplements |
| **dragodinde.fr** (planner Dragodinde/Muldo/Volkorne) | étable par compteurs de couleurs (total + mâles) ; **import par capture d'écran via un LLM** ; modes « Succès » (couleurs à cocher) et « Génétons » ; plan par étapes : tableau « Reproduire » (♂ × ♀ × nombre), « Plan d'action » (couleurs/sexes/proportions à capturer, montures à retirer), taux de réussite ; banque IN/OUT ; resynchronisation ; suppose des parents niv. 40. | modes d'objectif, proportions de capture par sexe, colonne « retirer », boucle plan → jeu → resynchronisation | raisonne sur des compteurs, pas sur les généalogies (le site le reconnaît) ; guide Muldo partiellement erroné (énergie, « 2 reproductions ») ; « maturité entre −1 000 et +1 000 » (le jeu dit ±2 000) |
| **Registre des Abysses** (registre-des-abysses.pages.dev) | cheptel avec généalogie ; synchronisation par OCR ; **GPS** = appariement ♂/♀ maximisant les couples utiles d'une session, recalcul après chaque accouplement ; assistant de clonage (suggère des paires) ; noms générés pour le renommage en jeu ; calculateur de carburant (recette la moins chère pour 1 000 points, rentabilité/heure) ; valeur du cheptel avec prix communautaires par serveur ; partage public, forum. | GPS d'appariement, assistant de clonage, prix communautaires, suivi généalogique par noms | modèle de probabilités « Registre » équivalent au nôtre ; reste de l'ancien système (« fatigue ») dans le code |
| **muldo-calculator** (Chikkin Sama, open source) | cascade de bébés attendus depuis un stock de G1 ; paramètres niveau/Optimakina/clonage/Reproducteur par génération ; « Veilleur des Enclos » (jauges en temps réel). | vue « tentatives attendues par étage », seuil ≥ 3 tentatives | branches indépendantes, p fixe, pas de couleurs ratées recyclées, Muldos seulement |
| **dofuselevage.fr** | guide ; simulateur de reproduction ; **roadmap « succès génération en génération »** (captures initiales, accouplements, carburant) ; calculateur de fécondité (ordre optimal des statistiques, conversion en carburants) ; calculateur d'XP. | roadmap de succès complète, conversion points → nombre de carburants par taille | niveaux de filets 100/150 inversés ; « amour entre 1 et 5 000 » (0 en jeu) ; modèle de probabilités approximatif |
| **dafous.app** | guide très complet + simulateur en cascade (boule de neige), arbres, enclos & carburants, almanax ; checklists quotidiennes/hebdomadaires ; pack métier 1→200 ; journal d'élevage .xls. | checklists, matrices de décision, journal | partage « égal » entre cibles multiples (faux) ; XP d'accouplement 10/génération (3.5, pas 3.6) |
| **FabEnclos** (enclos.le-fab.fr) | plan de captures et de croisements vers une cible selon l'enclos ; plusieurs éleveurs isolés. | multi-éleveurs | affirme que le niveau ne change pas la couleur du bébé (faux : il change la chance de cible) |
| **dofus-portals.fr** | guide de montée par paliers de 10 (barème générique) ; « timer d'élevage » orienté ancien système. | — | barème non conforme à la formule du jeu |

**Manques communs** (ce que l'application doit apporter) : modèle de probabilités exact par généalogie (pas par compteurs) ; coût complet en kamas (carburants au point selon l'HDV, makinas, filets) ; décision par monture (garder/cloner/vendre/extraire/briser) ; ordonnancement des lots par sérénité sur N enclos avec alarmes ; porteurs ; calendrier almanax intégré au plan ; bascule des règles 3.6 / 3.7.

---

## 11. Désaccords entre sources

| Sujet | Version A | Version B | Retenu |
|---|---|---|---|
| Niveau idéal des parents | dragodinde.fr : calculs pour des parents « montés au niveau 40 », niveau visé 40–90, « monter plus haut que nécessaire fait perdre du temps d'XP » | next-stage : « au moins jusqu'au niveau 100 … non négociable » ; Solomonk : 50–60 | **40 par défaut** (simulation), 100 pour les parents chers |
| Zone de maturité | dragodinde.fr, next-stage : −1 000/+1 000 (formulations) | client, DPLN, devblog II : −2 000/+2 000 | **±2 000** (−1 000/+1 000 = cible d'organisation, astuces-kamas) |
| Niveaux des filets | devblog II, dofuselevage : renforcé 100, multiplicateur 150 | jeu, DPLN : multiplicateur 100, renforcé 150 | **jeu** |
| XP d'accouplement | dafous, next-stage : 10/génération/parent | DPLN, client 3.6 : 30 | **30 (3.6)** |
| Génétons échangeables ? | DPLN, devblog : liés au compte | DofusDB (exchangeable, effet 983), dragodinde.fr | **à vérifier** ; l'app doit gérer les deux |
| Clonage et effectif | « le clonage suffit à pérenniser » (un camp) | Solomonk : il faut capturer en continu | **les deux** : clonage indispensable + captures continues |
| Brisage des montures | devblog II : « pas possible » | Solomonk-e : démontré sur 11 000 montures (avril–sept. 2026) | **possible en 3.5/3.6** (vidéos) |
| Optimakina | dafous : « uniquement Gen 7+ » | simulation : rentable partout si bon marché | **règle de prix** (§5.3) |
| Barème de crafts 1→200 | dofus-portals (dofustool) : ~320–770 crafts par palier | formule du jeu : ~7 000 crafts au total | **formule** |

---

## 12. Questions ouvertes (à vérifier en jeu)

1. Fréquence d'apparition de chaque couleur sauvage ; taille des groupes et vitesse de réapparition.
2. XP de capture avec un filet multiplicateur (le doublon rapporte-t-il 30 XP ?).
3. Le niveau est-il conservé au clonage ? (stratégie « étalons » recyclés).
4. Génétons : liés au compte ou échangeables après un délai ?
5. Effet exact des jours « effet doublé » (gain ×2 seulement ?) et cumul avec une capacité.
6. Les archimonstres Draglida/Dragnoute sont-ils capturables ?
7. Date de sortie de la 3.7 ; conversion des stocks de carburants (durabilité doublée ?) et des Animakinas.
8. Prix réels (HDV) des makinas basses générations : décide de « Optimakina partout ».
9. Le PNJ de guilde vendant des « ressources d'élevage » à 15 (30 en 3.7) : réponse partielle, DPLN MAJ 3.5 indique des **Neurones de dragodinde chez l'Amateur de Guildaton à 15 Guildatons** (3 achats/semaine, 6 si la guilde est niveau 13) ; reste à confirmer que ce sont bien eux que vise la 3.7 et s'il y en a d'autres (medium).
11. Sérénité d'un clone en 3.5/3.6 : remise à 0 ou tirée au hasard ? (DPLN « réinitialisée », devblog II « jauges à 0 »).
10. Rendement du brisage selon le niveau (Solomonk : optimum 40–60 pour les Muldos, ~53 pour les Volkornes) et selon la couleur.

---

## 13. Sources

**Guides et données**
- [S1] Dofus pour les Noobs, *Guide de l'éleveur (édition 2026)*, MAJ 02/03/2026 — https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html (texte : `raw/guide-eleveur-dpln.txt`)
- [S2] DPLN, *Gestion d'enclos* (outil) — https://www.dofuspourlesnoobs.com/gestion-d-enclos.html ; JS : `raw/strategy-evidence/enclos-calculator(.deobf).js`
- [S3] DPLN, *Les Dragodindes*, *Les Muldos*, *Les Volkornes* ; *MAJ 3.5*, *MAJ 3.6* — https://www.dofuspourlesnoobs.com/les-dragodindes.html, …/les-muldos.html, …/les-volkornes.html, …/mise-a-jour-305.html, …/mise-a-jour-306.html
- [S4] Ankama, devblog élevage II (28/04/2025) et devblog 3.7 (16/09/2026) — textes dans `raw/mechanics-evidence/texts/`
- [S5] DofusDB API (monsters, subareas, map-positions, items, effects, almanax-calendars) — https://api.dofusdb.fr
- [S6] Recherches internes : `research/mechanics.md` (+ `raw/mechanics-evidence/breeding_model_reference.py`), `research/crafts.md`, `research/tree-*.md`
- [S7] dragodinde.fr (planner, guides « Gagner des kamas », « Faire ses succès », « Mode d'emploi », guides Muldos/Dragodindes/Volkornes) — https://dragodinde.fr/ (texte extrait des bundles : `raw/strategy-evidence/dragodinde-fr/`)
- [S8] dofuselevage.fr (guide, outils) — https://dofuselevage.fr/guide, https://dofuselevage.fr/tools/generation-en-generation, …/caracteristiques, …/xp
- [S9] dafous.app (guide éleveur, outil) — https://dafous.app/en/guides/guide-eleveur.html, https://dafous.app/elevage
- [S10] Registre des Abysses — https://registre-des-abysses.pages.dev/
- [S11] FabEnclos — https://enclos.le-fab.fr/
- [S12] Muldo breeding calculator (Chikkin Sama) — https://tt405907.github.io/muldo-calculator/
- [S13] dofus-portals.fr, *Comment monter Éleveur* — https://dofus-portals.fr/comment-monter-eleveur/
- [S14] Next Stage, *Tuto élevage de dragodinde* (04/2026) — https://www.next-stage.fr/2026/04/tuto-elevage-dragodinde-dofus-guide-complet-a-z.html
- [S15] Guidactik, *Guide complet de l'élevage sur DOFUS 3* ; *Roadmap 2026* — https://guidactik.com/dofus/guide-complet-de-lelevage-sur-dofus-3/, https://guidactik.com/dofus/roadmap-des-mises-a-jour-de-dofus-en-2026/
- [S16] Astuces Kamas, *Éleveur : construisez un élevage rentable* (14/09/2026) — https://dofus-astuces-kamas.com/blog/astuces-kamas-eleveur

**Vidéos (transcriptions TubeLab dans `raw/strategy-evidence/youtube/`)**
- [Y1] Solomonk-e, *Le meilleur outil pour optimiser ton élevage (de Muldos)* (15/03/2026) — https://www.youtube.com/watch?v=MSFc68m3JYg
- [Y2] Solomonk-e, *Si je voulais faire le full succès élevage…* (03/2026) — https://www.youtube.com/watch?v=Yoz63BNQZ0o
- [Y3] Solomonk-e, *Des millions de kamas (presque) sans jouer avec les Muldos* (04/2026) — https://www.youtube.com/watch?v=41ka94FXdM0
- [Y4] Solomonk-e, *Ma technique (pas si) secrète pour faire des kamas après la refonte* (03/2026) — https://www.youtube.com/watch?v=er35rckGDFM
- [Y5] Solomonk-e, *Je brise 10 000 Volkornes* (09/2026) — https://www.youtube.com/watch?v=fGqEPyQoBgk
- [Y6] Solomonk-e, *Je brise 1 000 Muldos* (05/2026) — https://www.youtube.com/watch?v=KFzrg1-MRGQ
- [Y7] Solomonk-e, *Mon avis honnête après un mois* (04/2026) — https://www.youtube.com/watch?v=z8TYzeV8g-o
- [Y8] Solomonk-e, *L'impact économique de la refonte sur les parchemins* (02/2026) — https://www.youtube.com/watch?v=a_Meh5-rqWk
- [Y9] Solomonk-e, *Aventure Muldo #1 et #2* (03–04/2026) — https://www.youtube.com/watch?v=EfTZZYsSVeY, https://www.youtube.com/watch?v=mp7KT-LVgjY
- [Y10] Solomonk-e, *Ankama répond (encore) à la communauté élevage* (05/2026) — https://www.youtube.com/watch?v=9IkAMTg4lw8
- [Y11] Tenmalexis, *Le PACK pour monter Éleveur 200* (01/03/2026) — https://www.youtube.com/watch?v=DPBN9vN5AFE
- [Y12] Laniyelle, *Guide ultime de l'élevage* (04/03/2026) — https://www.youtube.com/watch?v=9DOVGqb_rXg
- [Y13] Chikkin Sama, *Élevage = contenu de bot ?* (04/2026) — https://www.youtube.com/watch?v=dhQ0-67UYXs

**Simulation de cette recherche** : `raw/strategy-evidence/sim/` (pyramid_sim.py, pyramid-results.json, pyramid-results-v2.json, carrier-examples.txt, deterministic-tables.json).

**Non accessibles** : Reddit r/Dofus (bloqué), forum officiel dofus.com (défi anti-bot), JOL (seulement des sujets d'avant la 3.5, non utilisés).

---

## Vérification

> Vérification adversariale du 2026-10-02 (strategy.md + `data/strategy.json`). J'ai refait les calculs et recoupé les faits avec d'autres sources : l'API DofusDB directement (`subareas`, `monsters`, `items`, `effects`, `map-positions`, `hints`, `almanax`), le guide DPLN lu en entier, les devblogs II et 3.7, les constantes client par version, les tables d'XP DPLN, les recettes, le modèle de probabilités de référence et les transcriptions YouTube. `strategy.json` reste un JSON valide (contrôlé avec Python) et garde sa forme : j'ai seulement ajouté des champs (`params`, `tokensPerParentByGeneration`, `alternativeZaap`, `mapsNote`, `otherMonsters`, `fuelMixNote`, `meta.verification`, 2 points de prix, 2 désaccords, 1 source `dpln_maj35`, 1 question ouverte). **`build_strategy_json.py` n'a pas été modifié** : le relancer effacerait ces corrections.

### Ce qui a été vérifié et tient (46 points)

| # | Affirmation | Méthode / source indépendante | Résultat |
|---|---|---|---|
| 1 | Sous-zones 235 / 1119 / 886 / 170 : 87 / 37 / 45 / 82 cartes et monstres listés | API DofusDB `subareas/{id}` | ✔ (la 235 liste aussi le Dragodingo 4275, niv. 80 : ce n'est pas une monture, ajouté au JSON) |
| 2 | Coordonnées x/y des 4 zones | API `map-positions?subAreaId=` | ✔ (5 cartes de chaque zone sont en [0,0], sans coordonnées) |
| 3 | Zaaps Village des Éleveurs [−16,1], Rivage sufokien [10,22], La Cuirasse [−26,37] | API `hints` (catégorie zaap) + `subareas` | ✔ ; il existe aussi le zaap de Sufokia [13,26], à distance comparable du Bassin des Muldos (ajouté) |
| 4 | Montures sauvages niveaux 62–70 ; PV 740–900 (Dragodindes) et 820–1 000 (Muldos/Volkornes) | API `monsters` (grades) | ✔ |
| 5 | Draglida et Dragnoute sont des archimonstres qui droppent ×2 | API `monsters` (`isMiniBoss`, drops 88 % contre 44 %) | ✔ |
| 6 | Taux de drop : ressource de couleur 41–44 %, Bave/Griffe 7,1 %, Sueur 2 % | API `monsters` drops + `items` | ✔ |
| 7 | Niveaux des filets 1/100/150/200 et leurs recettes | `recipes-eleveur.slim.json` + guide DPLN | ✔ ; le devblog II inverse bien 100 et 150 |
| 8 | Recettes d'Optimakina : 10 Pépites + 1 ressource de boss + (G−1) Pics (10 en G10) | recettes | ✔ |
| 9 | Paliers de jauge 40k/70k/90k/100k, ticks 10/20/30/40, durées 11 h 07 / 4 h 10 / 1 h 51 / 41 min 40 | DPLN + calcul | ✔ (DPLN tronque : 11 h 06, 4 h 09) |
| 10 | Points délivrés en 8 h (28 800 depuis 40 000 ; 64 640 depuis 100 000) | recalcul tick par tick | ✔ |
| 11 | Durées d'un lot groupé (11 h 23 / 5 h 42 / 3 h 48 / 2 h 51) | recalcul (40 000 points + ≈ 1 000 de sérénité) | ✔ |
| 12 | XP de monture : niv. 40 = 20 437, 50 = 34 365, 60 = 52 544, 100 = 172 668, 200 = 867 582 | `dpln-xp-tables.json` | ✔ (le devblog II donnait ≈ 868 900 pour le niveau 200) |
| 13 | Table d'XP du métier 10·L·(L−1) et les 10 paliers du §3.2 | table DPLN | ✔, sauf au niveau 3 (40 au lieu de 60) |
| 14 | Plan de montée du §3.2 : crafts et ressources cumulés à chaque palier | re-simulation indépendante avec la formule client | ✔ chiffre pour chiffre (26 / 790 / 1 739 / … / 6 993 crafts ; 23 535 ressources) |
| 15 | 26 filets universels pour passer de 1 à 5 | re-simulation | ✔ (204 XP) |
| 16 | Pack Tenmalexis = 6 996 carburants, 23 626 ressources, niveau 200 | re-simulation | ✔ pour le total ; il manque 1 XP au passage 74 → 75 (nuance ajoutée) |
| 17 | XP d'accouplement 10 en 3.5, 30 en 3.6 | constantes client 3.5.3.1 → 3.6.12.16 | ✔ |
| 18 | Barème des génétons 1…250 et exemples 251 / 500 | DPLN, devblog II, client | ✔ |
| 19 | Boutique d'Eugène Éton (10 / 10 / 50 / 100 / 130 / 160) | capture `eugene-eton-genetons.jpg` | ✔ |
| 20 | Puissant parchemin à 20 000 au lancement puis stable à 60 000 | transcription fGqEPyQoBgk | ✔ (le pic est de 80 000–90 000, corrigé) |
| 21 | Chance cible 30 % + 0,15 %/niveau + Optimakina + Takeza, et seuils 400 / 267 / 200 | DPLN + calcul | ✔ |
| 22 | Règle de rentabilité de l'Optimakina (prix < C·Δ/p ; ≈ ¼ de C à p = 42 %) | dérivation | ✔ |
| 23 | Takeza le 12/10/2026, le 11/10/2027 et le 09/10/2028 | API `almanax` (liste `dates`) | ✔ |
| 24 | Almanax du 22/10 (+50 % XP Éleveurs), 11/09, 01/05, 10/05, 10/08 et 10/10 (Sage) | API `almanax?date=` | ✔ |
| 25 | Bonus du 10 de chaque mois (jauges ×2, capacités offertes) | DPLN | ✔ |
| 26 | Bonus « de saison » +25 % XP tous métiers | `dofusdb-almanax-breeding-and-jobs.json` | ✔ pour les données ; l'effet en jeu reste low |
| 27 | Enclos 1/40/80/120/160/200 avec leurs cartes ; liés au compte ; c'est le meilleur personnage du compte et du serveur qui compte | DPLN + devblog II | ✔ |
| 28 | Clonage : même génération, tirage 50/50, pas de monture sénile | devblog II + DPLN | ✔ |
| 29 | Animakina 27/27/27/14/5 % ; en 3.7, capacités sans makina 3/6/8/8/8 % ; Optimakina +20 % ; étable de 500 ; le clone garde sa sérénité ; carburants et jauges ×2 (palier 1 = 80 000 = 22 h 13) | DPLN, devblog 3.7, mechanics.md | ✔ |
| 30 | Le devblog II prévoyait le brisage « pas possible » et des génétons liés au compte ; féconde en ≈ 10 h au palier 2 et 5 h au palier 4 | texte du devblog II | ✔ |
| 31 | Généton marqué « exchangeable » avec l'effet 983 | API `items` + `effects/983` (« Échangeable : #1 ») | ✔ ; le conflit est bien réel et reste « à vérifier » |
| 32 | Tableaux de simulation du §6.2 (grilles 1 et 2) | relecture de `pyramid-results.json` et `-v2.json` | ✔ toutes les valeurs reproduites |
| 33 | Exemples de porteurs et de dilution du §5.6 (42 %, 15,4 %, 1,5 %, 5,8 %, 36,7 %, génétons 2/31/251) | `carrier-examples.txt` + modèle relancé | ✔ |
| 34 | ≈ 29 % de G1 porteuses | modèle relancé sur les 3 espèces | ✔ (= (1 − p)/2) |
| 35 | Poids génétiques 90/20/1 | mechanics.md (client) | ✔ |
| 36 | 19 G10 Dragodindes, 50 Muldos, 50 Volkornes ; générations des montures citées (Turquoise G7, Muldo Prune G7, Volkorne Doré G7, Corail/Jade G9…) | `tree-*.json` | ✔ |
| 37 | Goulots Dragodinde (Amande et Dorée → Indigo et Ébène ; … ; Ivoire et Turquoise → Prune et Émeraude) | croisements de `tree-dragodinde.json` | ✔ |
| 38 | Brisage de 1 020 Muldos → 491 Ga PM, 4 566 Pui, ≈ 12 M pour ≈ 3 M | transcription KFzrg1-MRGQ | ✔ |
| 39 | Ga PM ≈ 13 400 kamas ; Grande potion ≈ 6× le prix au point de l'Extrait ; filet universel ≈ 2 000 kamas | transcription 41ka94FXdM0 | ✔ |
| 40 | ≈ 120 Volkornes en 20 min à 4 personnages ; filets à 1 000 et 2 100 kamas ; 10 000 Volkornes répartis sur 3 personnages | transcription fGqEPyQoBgk | ✔ |
| 41 | Témoignages : 811 génétons (Solomonk), 249 G1 (83 × 3), 280 G1 (40/120/120) | transcriptions z8TYzeV8g-o, Yoz63BNQZ0o, MSFc68m3JYg | ✔ |
| 42 | dofuselevage : 275 captures, 536 accouplements, 1 072 montures, 6 432 000 points, 90 % | page `dofuselevage-gen-en-gen` | ✔ |
| 43 | dafous : marge de 520 000 à 1 240 000 (17–23/03) ; dragodinde.fr : ≈ 3 M par cycle, 50 à 110, ≈ 80 %, « ambres… ≈ 1 M » | pages et bundles | ✔ |
| 44 | dragodinde.fr : sérénité « entre −1 000 et +1 000 » ; next-stage : niveau 100 « non négociable » | bundles et pages | ✔ |
| 45 | Sorts des montures sauvages (Volkornes : attirance 7, poussée 4, Pesanteur, Volkéclat −30 %, 175 dégâts ; Muldos : −10 % de dommages finaux, −2 PA ; Dragodindes : désenvoûtement + 120) | pages espèces DPLN | ✔ |
| 46 | Neurone, Ambre et Corne utilisés dans ≈ 110 recettes chacun | crafts.md §5.3 (DofusDB) | ✔ |

### Corrections apportées

| # | Avant | Après | Source |
|---|---|---|---|
| C1 | Brisage de 10 000 Volkornes : « ≈ 121 M pour ≈ 3,1 M de coût » | **≈ 121,7 M pour ≈ 17,9 M** (1 787 kamas par Volkorne, dont ≈ 13 M d'Extraits de Mangeoire), « presque ×7 » ; règle 21 « ×3 à ×7 » devient « ≈ ×4 (Muldos) et ≈ ×6,8 (Volkornes) » | transcription fGqEPyQoBgk (« 1,787 per Volcorn », « almost a x7 ») |
| C2 | JSON `C-BREAK-01` : « 1 extrait de 3 000 points ≈ 1 000 k par lot de 10 » | ≈ **13 Extraits** de 3 000 points (39 360 XP = niveau 53) par lot de 10, soit ≈ 1 300 kamas par monture ; même précision ajoutée au §1.4 | table XP DPLN ; coût Solomonk |
| C3 | « Muldo Marine » (couleur inexistante) | Muldo avec **Aigue-marine** (G9 ; « Marine » vient de la transcription) | `tree-muldo.json`, transcription z8TYzeV8g-o |
| C4 | 3.7 : « génétons doublés » | barème exact du client 3.7.3.3 : 2/4/8/15/30/60/120/250/500 (décalé d'une génération, ≈ ×2) ; G9+G1 = 502, G9+G9 = 1 000 | `breeding-constants-by-client-version.json` |
| C5 | 100 % en 3.7 avec Optimakina : « ≥ 333 » | **≥ 334** (333 donne 99,95 %) | calcul |
| C6 | Almanax 01/04 : « inclut probablement les Muldos » (low) | « muldos sauvages » est **cité** dans la description → high | API DofusDB `almanax?date=2027-04-01` |
| C7 | 29/02 « +75 % XP et butin partout » (high) | l'entrée existe, mais l'API renvoie « Cadeaux surprises » pour le 29/02/2028 → low | API DofusDB |
| C8 | XP de capture avec un multiplicateur « non vérifiée » | DPLN écrit explicitement « 30 d'XP par monture capturée » avec les filets multiplicateur ou renforcé → medium | guide DPLN §II |
| C9 | XP de craft « 45 % 9 niveaux plus haut » | ≈ 47 % à +9, ≈ 44 % à +10, 0 si J − 100 > L | formule client |
| C10 | Répartition des carburants pendant la montée : 23/23/23/23/4/4 | 24/24/24/24/≈ 1,5–2/≈ 1,5–2 (cohérent avec les ≈ 2 500–3 000 points de sérénité indiqués par lot) | calcul |
| C11 | Pack Tenmalexis « mène bien de 1 à 200 » | total juste, mais 1 XP manque au passage 74 → 75 : prévoir 1 Petit Philtre de plus | re-simulation |
| C12 | Tableau §5.2 : colonne « coût marginal » qui mélangeait moyenne et marginal (0,3 ; 0,12) | moyenne depuis le niv. 1 et marginal séparés (0,59 / 0,44–0,34 / 0,17 / 0,07 ; marginal 0,19 / 0,10 / 0,04) | table XP |
| C13 | Citation « dragodinde.fr : ne monte pas au-delà de 40 » (introuvable) | texte réel : calculs « pour des parents montés au niveau 40 », niveau visé 40–90, « monter plus haut que nécessaire fait perdre du temps d'XP » | bundles dragodinde.fr (`ToolGuide`, `MuldoGuide`) |
| C14 | Clone : « sérénité remise à zéro » (§5.4) mais « aléatoire » (§4.2), deux affirmations contradictoires | « réinitialisée » (DPLN) ; 0 ou aléatoire non tranché (low) ; ajouté aux questions ouvertes | DPLN, devblog II |
| C15 | §6.3 : niveau 40 « ÷3 à ÷4 » | ÷2 à ÷5 pour une G9 (Muldo ÷2–3), jusqu'à ÷6 pour une G10 | `pyramid-results-v2.json` |
| C16 | §6.3 : Optimakina « −40 à −65 % sur tout » | sur captures, accouplements, fécondations et carburant uniquement ; la durée varie de −28 % à +13 % | `pyramid-results-v2.json` |
| C17 | §6.3 : G9 « ~110–190 captures, ~400–800 accouplements, ~5–11 M, ~20–30 jours » | ~105–200 / ~270–820 / ~4–11 M / ~18–28 jours (36–56 demi-journées) | `pyramid-results-v2.json` |
| C18 | §6.3 : G10 « +10–30 % » | +10 à +25 % avec Optimakina partout, +25 à +56 % sans makina ; durée −12 % à +23 % | `pyramid-results-v2.json` |
| C19 | Pic du Puissant parchemin « 60 000–90 000 » | 80 000–90 000 (montée à 60 000, puis 80 000–90 000, puis stable à 60 000) | transcription fGqEPyQoBgk |
| C20 | Question ouverte 9 (PNJ de guilde) | réponse partielle : Neurones de dragodinde chez l'Amateur de Guildaton, 15 Guildatons, 3 par semaine (6 si guilde niv. 13) | page DPLN MAJ 3.5 (`pages/dpln-maj35.txt`), crafts.md §5.3 |

### Doutes restants (non corrigés faute de source)

- La taille des groupes (8) et les fréquences des couleurs restent des observations communautaires (medium/low) ; le zaap « le plus proche » du Bassin des Muldos dépend de l'accès utilisé.
- Les porteurs et la dilution reposent sur le modèle reconstitué ; le facteur κ pour un enfant monocolore n'est pas validé en jeu (mechanics.md §10). Les pourcentages exacts sont donc **medium**, même si l'EX2 du DPLN valide le principe.
- La simulation suppose un joueur parfait, des sexes à 50/50 et aucun porteur : les durées sont des bornes basses.
- Le statut des génétons (liés au compte ou échangeables après une date, effet 983) reste ouvert.
- Les prix sont tous des témoignages isolés (serveurs Salar/Orukam pour Solomonk-e) : low.
