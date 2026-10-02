# Mécaniques d'élevage Dofus 3.5+ — spécification implémentable

> Projet ElevageSimu — recherche « mécaniques » — rédigé le 2026-10-01.
> Données machine : [`research/data/mechanics.json`](data/mechanics.json).
> Implémentation de référence du modèle de probabilités (Python, testée) : [`research/raw/mechanics-evidence/breeding_model_reference.py`](raw/mechanics-evidence/breeding_model_reference.py).
> Preuves (captures in-game, extraits de devblogs, données client par version) : `research/raw/mechanics-evidence/`.

**Légende de confiance** — **high** : donnée du client Ankama, devblog officiel, ou reproduit exactement des captures in-game · **medium** : source communautaire fiable (DPLN…) ou déduction cohérente · **low** : hypothèse non vérifiée.

**Versions** (au 2026-10-01) :

| Jeu de règles | Période | Statut |
|---|---|---|
| `3.5` | live du 03/03/2026 au 22/06/2026 (patchs 3.5.3.1 → 3.5.6.7) | historique |
| `3.6` | live depuis le 23/06/2026 (client 3.6.12.16) | **règles actuelles** |
| `3.7beta` | bêta depuis le 17/09/2026 (client 3.7.3.3), devblog du 16/09/2026 | à venir, pas encore live |

Tout ce qui précède la 3.5 (« ancien élevage », jusqu'à 3.4) est marqué **LEGACY** et ne doit pas servir à simuler la 3.5+.

---

## 0. Ce qui a été trouvé (résumé)

1. **La formule exacte des probabilités d'accouplement n'a jamais été publiée par Ankama.** Je l'ai **reconstituée** à partir de 4 captures in-game du guide DPLN et du champ `geneticWeight` des données client (`RidesData`). Le modèle reproduit **les 24 pourcentages visibles des 5 captures (EX1 sans et avec Optimakina, EX2, EX3, EX4) et les génétons à 0,01 % près** (voir §1.4). Pour EX3 et EX4, l'arbre d'un parent et la somme des niveaux sont **déduits** des pourcentages eux-mêmes (2 paramètres ajustés pour 6 valeurs) : seuls EX1 et EX2 (16 valeurs) sont des prédictions sans paramètre libre. Un outil communautaire indépendant (« Registre des Abysses ») utilise un modèle mathématiquement équivalent.
2. Le modèle descend directement de l'ancien système (poids de position 10/6/3/1 du Dofus Mag 5, poids génétique par couleur ≈ ancien « PGC »), comme l'annonçait le devblog II (« le calcul basé sur l'arbre généalogique sera conservé, les croisements également », + 30 % de génération cible).
3. Constantes vérifiées dans **8 versions du client** (3.5.3.1 → 3.6.12.16) et dans la **bêta 3.7.3.3** : jauges, sérénité, poids génétiques, génétons, XP d'accouplement, carburants, makinas.
4. **Changements post-3.5 trouvés** : XP d'accouplement ×3 en 3.6 (10 → 30 par génération et par parent ; le guide DPLN, écrit sur la bêta, donnait déjà 30) ; la 3.7 (bêta) double les jauges, les carburants et les génétons, passe l'Optimakina à +20 %, transforme l'Animakina en « choix du sexe » et rend les capacités possibles sans makina.
5. Tables complètes : XP monture 1→200, XP métier 1→200, formule d'XP de craft (validée sur 3 recettes), liste Almanax officielle.

---

## 1. Probabilités du bébé (cœur du simulateur)

### 1.1 Ce que disent les sources

| Source | Affirmation | Confiance |
|---|---|---|
| Guide DPLN | Génération cible = génération la plus haute atteignable (arbres compris). +30 % pour la génération cible, répartis entre ses possibilités « en fonction de la généalogie » ; +0,15 %/niveau (somme des 2 parents) ; +10 % Optimakina ; +20 % Almanax Takeza. Le reste est réparti entre les autres issues : couleurs des deux arbres ou croisements entre les deux arbres ; les parents pèsent plus que les grands-parents ; les doublons augmentent la probabilité ; « plus la génération est élevée, moins on a de chance ». | high pour les bonus, medium pour le reste |
| Devblog II (28/04/2025) | « Le calcul basé sur l'arbre généalogique sera conservé ; les croisements également ; il sera ajouté à ce calcul 30 % de chance d'obtenir la génération cible » ; +0,15 %/niveau. | high |
| Données client `RidesData` | `geneticWeight` par monture : Dragodinde et Muldo **monocolores 90**, **bicolores 20**, **Dragodinde Dorée 20**, **Muldos G9 (Aigue-marine, Ambre, Azur, Corail) 20**, **Volkornes tous 1**, spéciales G0 (armure, plumes) 20. Identique de 3.5.3.1 à 3.7.3.3. | high |
| Captures in-game DPLN | 4 interfaces d'accouplement avec tous les pourcentages (§1.4). | high |
| dafous.app | Partage « égal » entre plusieurs cibles. | **contredit** (le partage est proportionnel aux poids naturels ; égal seulement si symétrique) |
| dofuselevage.fr (simulateur) | Poids 8/3, facteur 1/gen^0,55. | **contredit** par les captures (approximation) |

La phrase de DPLN « plus la génération est élevée, moins on a de chance » est une approximation : le vrai facteur est le `geneticWeight` (monocolore 90 contre bicolore 20, soit 4,5×). Exemple : l'Émeraude (G9, 90) est **plus** probable que l'Ivoire et Turquoise (G8, 20) à position égale.

### 1.2 Modèle retenu (spécification)

Notations : pour un accouplement A × B, chaque parent X a un « arbre » = X lui-même + ses deux parents (les grands-parents du futur bébé). Une monture capturée (G1) n'a pas de parents.

```
ENTRÉES : A, B (rideId, niveau, parents[0..2]), optimakina?, takeza?, ruleset
1. Poids brut des membres d'un arbre X :
      w(m) = POS(position) × GW(m)       POS(self)=10, POS(parent)=6
      GW = RidesData.geneticWeight ; les doublons s'additionnent
      (ex. Muldo Pourpre dont un parent est Pourpre : 10×90 + 6×90)
2. Normalisation par arbre : pX(m) = w(m) / Σ w      (chaque arbre « pèse » 1)
3. Masse naturelle W :
      pour m ∈ arbre A : W[m] += pA(m)
      pour m ∈ arbre B : W[m] += pB(m)
      pour chaque (a ∈ A, b ∈ B), a ≠ b, si croisement(a,b) = c existe :
            W[c] += pA(a) × pB(b) × κ        κ = 1
      (aucun croisement interne à un même arbre)
4. D = W / Σ W                                (distribution « naturelle »)
5. G = max génération des issues de D (membres ET croisements)
   T = issues de génération G (cible) ; O = autres issues
6. B = min(1, 0,30 + 0,0015 × (niv_A + niv_B) + opti + takeza)
      opti = 0,10 (3.5/3.6) | 0,20 (3.7beta) ; takeza = 0,20 le jour Takeza
   si O est vide : B = 1
7. P(t ∈ T) = B × D(t) / D(T)
   P(o ∈ O) = (1 − B) × D(o) / D(O)
8. Affichage : arrondi à 2 décimales (zéros finaux masqués : « 2,1 % »)
```

- Croisements : table `RidesData.parents` (chaque paire non ordonnée donne au plus **un** enfant ; l'enfant est toujours de génération max(parents)+1 — vérifié sur les 382 paires).
- `POS` = poids du Dofus Mag 5 (10 base, 6 parents, 3 grands-parents, 1 arrière-grands-parents) **tronqués à deux niveaux** ; le rapport 10/6 = 5/3 est contraint à ±0,5 % par les captures.
- **Équivalence** : le modèle du site communautaire « Registre des Abysses » (u = (9 si génération impaire sinon 2, **avec une liste d'exceptions forcées à 2** — code `p=h=>d.includes(h)?2:o(h)%2===1?9:2` dans `assets/index-*.js`, vérifié le 2026-10-02 ; indispensable pour la Dragodinde Dorée et les Muldos G9, dont le GW client est 20) × (5 self / 3 parent) ; chaque couple ajoute u(a)·u(b) aux deux membres et au croisement) donne exactement les mêmes probabilités. Sans cette liste d'exceptions, la règle « impair = 9 » donnerait un mauvais résultat pour EX2 (Corail G9).
- Implémentation de référence testée : `research/raw/mechanics-evidence/breeding_model_reference.py`.

Confiance : **high** pour la structure et les constantes (validées sur 4 cas) ; **medium** pour les cas listés en §1.5.

### 1.3 Pourquoi ce modèle (dérivation, résumée)

- EX1 : la Pourpre sans arbre prend exactement 50,0 % de la masse « non cible » → chaque arbre pèse autant (normalisation par arbre).
- Dans l'arbre de l'Émeraude : Émeraude / Ivoire et Turquoise = 7,49 = (10×90)/(6×20) → poids position × geneticWeight.
- EX2 : Pourpre (self+parent) / Corail = 12,0 = (10+6)×90/(6×20) ; Doré et Indigo / Doré = 200/540 ; croisements non-cibles (Doré et Pourpre) = pA(Doré)×pB(Pourpre) exactement.
- EX1 avec et sans Optimakina : les « autres » gardent les mêmes proportions, seul le facteur (1−B) change → la cible vaut exactement B (pas « naturel + B »).
- EX3/EX4 : même Ivoire et Turquoise (arbre {Ivoire et Turquoise, Ivoire et Pourpre}, seul arbre compatible avec les ratios exacts 4/11 – 7/11 et 8/3).

### 1.4 Exemples de validation (captures in-game du guide DPLN)

Captures copiées dans `research/raw/mechanics-evidence/screenshots/`.

**EX1** — Dragodinde Pourpre ♀ (G5, niv. 200, sans arbre) × Dragodinde Émeraude ♂ (G9, niv. 1, parents Ivoire et Turquoise + Ivoire et Pourpre). B = 30 + 30,15 = 60,15 %.

| Issue | Gén. | Observé | Modèle | Avec Optimakina : observé / modèle |
|---|---|---|---|---|
| Émeraude et Pourpre (cible, 265 génétons) | 10 | 60,15 | 60,150 | 70,15 / 70,150 |
| Pourpre | 5 | 19,92 | 19,925 | 14,92 / 14,925 |
| Émeraude | 9 | 15,73 | 15,730 | 11,78 / 11,783 |
| Ivoire et Turquoise | 8 | 2,1 | 2,097 | 1,57 / 1,571 |
| Ivoire et Pourpre | 8 | 2,1 | 2,097 | 1,57 / 1,571 |

**EX2** — Muldo Doré et Indigo ♂ (G2, niv. 1, parents Doré + Indigo) × Muldo Pourpre ♀ (G1, niv. 1, parents Pourpre + Corail), Reproducteur (×2). B = 30,3 %.

| Issue | Gén. | Observé | Modèle |
|---|---|---|---|
| Corail et Doré (cible, 3 génétons) | 10 | 15,15 | 15,150 |
| Corail et Indigo (cible, 3 génétons) | 10 | 15,15 | 15,150 |
| Pourpre | 1 | 23,15 | 23,153 |
| Indigo | 1 | 10,58 | 10,582 |
| Doré | 1 | 10,58 | 10,582 |
| Indigo et Pourpre | 2 | 9,77 | 9,768 |
| Doré et Pourpre | 2 | 9,77 | 9,768 |
| Doré et Indigo | 2 | masqué (≈ 3,9 par complément) | 3,919 |
| Corail | 9 | 1,93 | 1,929 |

XP affichée +60 = (20 + 10) × 2 bébés → barème de 10 XP par génération (bêta/3.5), cf. §7.

**EX3** — Ivoire et Turquoise ♂ (G8, arbre inféré) × Ivoire et Pourpre ♀ (G8, sans arbre), somme des niveaux 144 (déduite) → Émeraude 51,6 (240 génétons) / Ivoire et Pourpre 30,8 / Ivoire et Turquoise 17,6 : modèle identique.

**EX4** — même Ivoire et Turquoise × Pourpre (G5), somme des niveaux 272 (déduite). Cohérence (vérification) : si cette Pourpre est celle d'EX1 (niv. 200, sans arbre), l'Ivoire et Turquoise est niv. 72, donc l'Ivoire et Pourpre d'EX3 est aussi niv. 72 (144 − 72) : les deux sommes déduites sont compatibles. La génération cible est 8 (= génération max déjà présente dans les arbres) : le bonus s'applique quand même, mais **0 généton**. Ivoire et Turquoise 51,49 / Ivoire et Pourpre 19,31 / Pourpre 29,2 : modèle 51,491 / 19,309 / 29,200.

### 1.5 Cas non couverts et paramètres réglables

| Point | Défaut proposé | Confiance |
|---|---|---|
| Poids κ d'un croisement dont l'enfant est **monocolore** (GW 90, générations impaires, ex. Ambre/Indigo G3) | κ = 1 (pas de facteur GW de l'enfant). Validé seulement pour des enfants bicolores (GW 20). Garder κ configurable. | medium |
| Si la part naturelle de la cible D(T) > B (ex. parents déjà de la génération cible et nombreux) | P(T) = B exactement (option `max(B, D(T))` en paramètre) | medium |
| Reproducteur (2 bébés) | 2 tirages indépendants dans la même distribution ; XP × 2 (confirmé) ; génétons par bébé ? inconnu | low |
| Sexe du bébé | 50/50 ; en 3.7 choisi via Animakina | medium |
| Deux parents de même couleur sans arbre | une seule issue → 100 % | high (déduction) |

### 1.6 LEGACY — ancien système (jusqu'à 3.4), pour mémoire seulement

Source : <http://felis-silvestris.lescigales.org/genetique-des-dragodindes.html> (d'après Dofus Mag 5, BillFR et les forums JOL ; empirique) — **low/medium**, **obsolète**.

- Arbre de 3 niveaux. Poids de position : monture de base **10** (20 si « Prédisposée génétique »), parents **6**, grands-parents **3**, arrière-grands-parents **1**.
- Étape 1 (sélection) : une couleur tirée dans l'arbre de chaque parent, proportionnellement à ces poids.
- Étape 2 (combinaison), avec un « poids génétique de combinaison » PGC par couleur (Dorée = 20, Ivoire et Pourpre = 20 d'après Dofus Mag 5) : couleurs incompatibles P(x) = PGC(x)/(PGC(c1)+PGC(c2)) ; compatibles P(x) = PGC(x)/(PGC(c1)+PGC(c2)+0,5·PGC(c3)) et P(c3) = 0,5·PGC(c3)/(…). Estimation communautaire : PGC(x) = 100·V(x)/(2 − S(x) mod 2).
- Portée : 1 (62,5 %), 2 (31,25 %), 3 (6,25 %) bébés, +1 avec Reproductrice, + bonus d'énergie depuis 2.16 ; capacités héritées à 10 %, spontanées à 5 % ; gestation, fatigue, énergie, consanguinité.
- Lien avec la 3.5 : la 3.5 garde les poids 10/6 (tronqués) et un poids par couleur (`geneticWeight` 90/20, qui reprend le PGC 20 de la Dorée et des bicolores), mais remplace la combinaison par paire par le mélange par arbre décrit en §1.2, plus le bonus de génération cible.

---

## 2. Génération cible et génétons

- **Génération cible** = génération maximale parmi **toutes** les issues possibles (membres des deux arbres + croisements entre arbres). Elle peut être égale à la génération max déjà présente (EX4) ou plus haute (EX1-3). Exemple du devblog II : deux G1 dont un arbre contient une G8 → cible 8. — high
- **Génétons** (objet 33512, liés au compte) — high :
  - gagnés **seulement si le bébé obtenu est de génération strictement supérieure à toutes les montures des deux arbres** (2 parents + 4 grands-parents) ; sinon 0, même pour un bébé de la génération cible (EX4).
  - montant = valeur du parent 1 + valeur du parent 2, **selon la génération de chaque parent** :

| Génération du parent | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| 3.5 / 3.6 | 1 | 2 | 4 | 8 | 15 | 30 | 60 | 120 | 250 | 0 |
| 3.7 bêta | 2 | 4 | 8 | 15 | 30 | 60 | 120 | 250 | 500 | 0 |

  - Exception (client 3.5 → 3.7) : Volkorne Prune et Roux et Volkorne Prune et Ivoire (G6) valent 0 (bug de données probable).
  - Exemples vérifiés : G5 + G9 → 265 (EX1) ; G2 + G1 → 3 (EX2) ; G8 + G8 → 240 (EX3).
- **Boutique Eugène Éton [-18,1]** (capture DPLN) : Petits Parchemins ×6 = 10, Aliton 10, Parchemins ×6 = 50, Grands Parchemins ×6 = 100, Tourmaline 130, Puissants Parchemins ×6 = 160. En 3.7 : + cosmétiques colorisables. — high

---

## 3. Enclos, jauges, sérénité, fécondité

### 3.1 Enclos et étable — high
- 6 enclos de 10 places au Village des Éleveurs, débloqués aux niveaux d'Éleveur **1 / 40 / 80 / 120 / 160 / 200** ([-18,0], [-19,0], [-20,0], [-20,2], [-19,2], [-18,2]). Tous identiques (pas de bonus par enclos, contrairement au devblog I).
- Enclos liés au **compte** : on prend le niveau d'Éleveur le plus haut des personnages du compte sur le serveur (devblog II).
- Étable : **250** places (3.5/3.6) → **500** (3.7 bêta, devblog). Le devblog I parlait de 60 par type (abandonné).
- Il faut être sur une carte d'enclos pour ajouter ou retirer des montures ; tout le reste (carburants, activation, accouplement, clonage, extraction) se fait à distance. L'accouplement exige les deux montures **dans l'étable**.

### 3.2 Jauges d'enclos — high (données client)

6 jauges : Baffeur (sérénité −), Caresseur (sérénité +), Foudroyeur (endurance), Abreuvoir (maturité), Dragofesse (amour), Mangeoire (XP). **2 jauges actives au maximum** ; **Baffeur et Caresseur sont exclusifs**.

| Palier | 3.5 / 3.6 : plage | Consommation / 10 s | Vidage du palier | 3.7 bêta : plage | Vidage 3.7 |
|---|---|---|---|---|---|
| 1 | 0 – 40 000 | 10 | 11h06m40 | 0 – 80 000 | 22h13m20 |
| 2 | 40 001 – 70 000 | 20 | 4h10m | 80 001 – 140 000 | 8h20m |
| 3 | 70 001 – 90 000 | 30 | 1h51m07 | 140 001 – 180 000 | 3h42m13 |
| 4 | 90 001 – 100 000 | 40 | 41m40 | 180 001 – 200 000 | 1h23m20 |
| **Total** | 100 000 | | **17h49m** | 200 000 | **35h38m** |

(DPLN : 11h06, 4h09, 1h51, 42 min, 17h48 — même calcul, arrondis.) La 3.7 double les capacités mais **pas** la consommation par tick (client 3.7.3.3) ; le devblog écrit « 80 000, 60 000, 40 000 et 20 000 selon l'enclos » : il s'agit de la largeur de chaque palier.

**Règle de tick** (toutes les 10 s, pour chaque jauge active) :
```
tier(v) = plus petit i tel que v ≤ tierMax[i]        (40 000 → palier 1 ; 40 001 → palier 2)
si v > 0 et ∃ monture éligible :
    c = min(rate[tier(v)], v) ;  v -= c
    chaque monture éligible gagne c × (2 si capacité correspondante) [× 2 jour Almanax ?]
```
- La consommation est **la même avec 1 ou 10 montures** : remplir l'enclos (10 montures qui ont besoin de la jauge) maximise l'efficacité. — high
- **Pas de consommation** si l'enclos est vide ou si aucune monture ne peut en profiter (stat déjà au max — devblog II ; sérénité hors zone — DPLN, confiance medium ; sérénité déjà à ±5000 pour Baffeur/Caresseur ; niveau 200 pour la Mangeoire).
- Éligibilité : Foudroyeur → endurance < 20 000 et sérénité ∈ [−5000, −1] ; Abreuvoir → maturité < 20 000 et sérénité ∈ [−2000, 2000] ; Dragofesse → amour < 20 000 et sérénité ∈ [0, 5000] ; Baffeur → sérénité > −5000 ; Caresseur → sérénité < 5000 ; Mangeoire → niveau < 200.
- Sérénité bornée à [−5000, +5000] ; elle **ne bouge plus** quand la monture gagne endurance, maturité ou amour (changement de la 3.5).

### 3.3 Statistiques de la monture et fécondité — high

- Endurance, maturité et amour : max **20 000** chacune (client `RideGauges`, toutes espèces, couleurs et générations).
- Zones de sérénité (client) : endurance **[−5000, −1]** ; maturité **[−2000, 2000]** ; amour **[0, 5000]** (le client stocke maxMood 5001). dofuselevage.fr écrit « amour entre 1 et 5000 » : contredit par le client (0 est inclus).
- Deux stats en même temps : endurance + maturité si sérénité ∈ [−2000, −1] ; maturité + amour si sérénité ∈ [0, 2000].
- Pictogrammes : vert :D amour seul (> 2000) ; violet :) amour + maturité ; bleu :( endurance + maturité ; rouge :C endurance seule (< −2000).
- **Féconde** quand les 3 stats valent 20 000. Pas de fatigue, pas d'énergie, pas de niveau minimum (l'ancienne condition « niveau 5 » est supprimée).
- Naissance ou capture : niveau 1, stats à 0, **sérénité aléatoire** (distribution inconnue, supposée uniforme sur [−5000, 5000] — low).
- Temps pour remplir une stat de 0 à 20 000 : palier 1 = 5h33m20 · palier 2 = 2h46m40 · palier 3 = 1h51m10 · palier 4 = 1h23m20 (moitié avec la capacité correspondante). Devblog II : environ 10 h pour une monture féconde en palier 2 moyen, 5 h en palier 4.
- États : Fertile → Féconde → (accouplement) Stérile ; Sénile = montures d'avant la 3.5.

### 3.4 Procédure optimale par monture (pour le module « que faire maintenant »)

Le coût en **points de jauge** d'une stat est fixe : 20 000 points consommés font monter de 20 000 **toutes** les montures éligibles de l'enclos. Pour un lot de 10 montures bien groupées : 60 000 points (endurance, maturité, amour) + le déplacement de sérénité. Le palier ne change que la **vitesse** et le **prix par point** (élixirs plus chers). La Mangeoire comme 2e jauge « gratuite » en temps fait gagner des niveaux (+0,15 %/niveau de génération cible).

| Sérénité de départ s | Phase 1 (2 jauges) | Transition | Phase 2 |
|---|---|---|---|
| s < −2000 | Foudroyeur + Caresseur (l'endurance monte pendant que s remonte) | jusqu'à s ∈ [−2000, −1] | Foudroyeur + Abreuvoir, puis Caresseur jusqu'à s ≥ 0, puis Dragofesse (+ Mangeoire) |
| −2000 ≤ s ≤ −1 | Foudroyeur + Abreuvoir (fin simultanée) | Caresseur de \|s\| points | Dragofesse (+ Mangeoire) |
| 0 ≤ s ≤ 2000 | Dragofesse + Abreuvoir | Baffeur de s+1 points | Foudroyeur (+ Mangeoire) |
| s > 2000 | Dragofesse + Baffeur | jusqu'à s ∈ [0, 2000] | Abreuvoir (+ Dragofesse), puis Baffeur jusqu'à s ≤ −1, puis Foudroyeur |

Regrouper les montures d'un enclos par tranche de sérénité (conseil DPLN) ; surveiller les enclos en Baffeur ou Caresseur, sinon les montures dérivent vers ±5000 (vitesse = 10/20/30/40 points de sérénité par 10 s selon le palier).

---

## 4. Carburants — high (client + DofusDB)

- 6 jauges × 4 familles × 5 tailles = 120 carburants (liste complète avec identifiants dans `mechanics.json → fuels.items`).
- Familles (palier max atteignable, ou « cap ») et niveaux de craft par taille (Minuscule, Petit, normal, Grand, Gigantesque) :

| Famille | Cap 3.5/3.6 | Cap 3.7 bêta | Niveaux de recette |
|---|---|---|---|
| Extrait | 40 000 | 80 000 | 5 / 15 / 25 / 35 / 45 |
| Philtre | 70 000 | 140 000 | 55 / 65 / 75 / 85 / 95 |
| Potion | 90 000 | 180 000 | 105 / 115 / 125 / 135 / 145 |
| Élixir | 100 000 | 200 000 | 155 / 165 / 175 / 185 / 195 |

- Quantité par taille : Minuscule 1000 · Petit 2000 · normal 3000 · Grand 4000 · Gigantesque 5000 ; **doublée en 3.7** (2000 → 10 000).
- Noms exacts en jeu (DofusDB, vérifié) : la taille « normale » n'a pas de préfixe (« Extrait de Dragofesse », « Élixir d'Abreuvoir ») et les Potions s'accordent au féminin (« Petite Potion de … », « Grande Potion de … »). Utiliser `fuels.items[].name` pour l'affichage.
- Règle d'usage : utilisable seulement si la jauge est sous le cap de la famille ; nouvelle valeur = min(cap, valeur + quantité). L'écrêtement du surplus est probable (effet « Jauge +X (Max cap) », fenêtre de confirmation anti-gaspillage ajoutée en 3.7) — medium. Un carburant d'une famille supérieure peut remplir les paliers inférieurs. Aucun niveau de métier n'est requis pour **utiliser** un carburant (DPLN).
- Encodage client : effets 3810/3812/3814/3816/3818/3820 (Baffeur, Caresseur, Foudroyeur, Abreuvoir, Dragofesse, Mangeoire) ; `value` = quantité ; `diceSide` × 100 = cap (Élixir : pas de cap).
- **PNJ Adèle Vage [-18,1]**, monnaie « Poussière d'élevage » (33511), ne vend que les Gigantesques : Extrait **50**, Philtre **200**, Potion **800**, Élixir **3200** poussières, soit 0,01 / 0,04 / 0,16 / 0,64 poussière par point de jauge (prix 3.7 non annoncés). La poussière ne vient que de la compensation 3.5 : 0,55 poussière par point de durabilité restant des anciens objets (arrondi au supérieur). — high
- 3.7 : les carburants sont renommés selon l'effet (« Élixir de dragofesse » → « Élixir d'amour », « Élixir de foudroyeur » → « Élixir d'endurance »).

---

## 5. Capacités, makinas, Reproducteur, clonage, stérilité, extraction

### 5.1 Capacités — high
Amoureuse (amour ×2), Endurante (endurance ×2), Précoce (maturité ×2), Sage (XP ×2), Reproducteur (+1 bébé, mâle ou femelle, ne se cumule pas), Caméléone (cosmétique). Elles ne sont **pas héritées** et sont **perdues au clonage**. Les capacités Infatigable, Porteuse et Prédisposée génétique ont disparu.

### 5.2 Makinas — high
- Une seule makina par accouplement, facultative ; une makina par espèce et par génération 2..10 ; **génération de la makina ≥ génération cible** (une makina plus haute est acceptée).
- **Animakina** — 3.5/3.6 : capacité aléatoire Amoureuse 27 %, Endurante 27 %, Précoce 27 %, Sage 14 %, Reproducteur 5 % (effets client 3840–3844) ; **3.7 bêta : choix du sexe** (effet 4069 ; stock existant converti).
- **Kromakina** : Caméléone 100 %.
- **Optimakina** : +10 % de génération cible (3.5/3.6) → **+20 %** (3.7 bêta, effet 3838 = 20 dans le client).
- 3.7 bêta : capacité aléatoire **sans makina** : Reproductrice 3 %, Sage 6 %, Précoce 8 %, Amoureuse 8 %, Endurante 8 % (67 % sans capacité) — devblog, pas encore vérifiable dans le client.
- Niveaux de recette : pour g = 2..8, Kromakina Dragodinde/Volkorne/Muldo, Animakina D/V/M, Optimakina D/V/M = 20(g−2) + 17, 19, 21, 23, 25, 27, 29, 31, 33 ; g = 9 : 155 → 171 ; g = 10 : 173 → 189. 74 recettes de makinas changent en 3.7 bêta (`raw/mechanics-evidence/client-data/eleveur-recipes-3.7.3.3-beta.json`).

### 5.3 Accouplement, Reproducteur, stérilité — high
1 bébé (2 avec Reproducteur sur l'un des parents) ; naissance immédiate ; les **deux parents deviennent stériles**. Bébé : niveau 1, stats 0, sérénité aléatoire, sexe aléatoire, Fertile ; son arbre = ses 2 parents.

### 5.4 Clonage — high sauf mention
- Entrée : 2 montures de **même espèce et même génération** (couleurs différentes possibles), stériles, fertiles ou fécondes, **pas séniles**.
- Sortie : **une des deux, au hasard (50/50, devblog II)**, Fertile, qui conserve couleur, sexe, nom et généalogie (texte in-game) ; jauges remises à zéro ; capacité perdue.
- Sérénité : réinitialisée en 3.5/3.6 (DPLN) ; **conservée en 3.7** (devblog).
- Niveau après clonage : non précisé par le jeu ; hypothèse « conservé » — low.
- Intérêt (« 2 pour 2 ») : un accouplement donne 1 bébé + 2 stériles ; 2 stériles de même génération donnent 1 fertile.

### 5.5 Extraction — high (client `extractionRewardQuantity`)
Détruit la monture. Neurone de dragodinde (33515) / Ambre de muldo (17864) / Corne de volkorne (19975). Quantité = **génération** (G1 = 0, donc non extractible ; G10 = 10) ; sénile = 1 ; spéciales G0 = 0.

### 5.6 Capture (rappel) — high
Filet universel (niv. 1, toutes espèces, 1 cible) ; **multiplicateur niv. 100** (1 cible ×2, sexe pas forcément identique) ; **renforcé niv. 150** (cercle de rayon 3) ; multiplicateur renforcé niv. 200 (zone ×2). Niveaux confirmés par les recettes DofusDB et le client ; le devblog II et dofuselevage.fr inversaient 100 et 150. Sort : 1 PA, 7 PO sans ligne de vue, une fois par combat, filet consommé au lancer, capture à 100 % si le combat est gagné. Monture capturée = G1. Les montures sauvages sont de niveau 60.

---

## 6. XP des montures — medium-high

- Source : table « XP Monture » de DPLN (<https://www.dofuspourlesnoobs.com/tableaux-dexpeacuterience.html>), identique à la table embarquée dans leur outil « Gestion d'enclos ». Elle recoupe 172 668 XP au niveau 100 et 867 582 XP au niveau 200 (le devblog II annonçait environ 172 900 et 868 900, chiffres d'avant-projet). Table complète 1 → 200 (XP cumulée pour atteindre le niveau) dans `mechanics.json → mountXp.cumulativeXpToReachLevel`. Premiers niveaux : 0, 19, 49, 96, 161, 246, 353, 481, 633, 809…
- Aucune table XP de monture n'existe dans le client (calcul serveur) ; les deux `EvolutiveItemTypes` du client concernent familiers et montiliers.
- Gain : Mangeoire 10/20/30/40 XP par 10 s selon le palier (×2 avec Sage), pour chaque monture de l'enclos. Plus d'XP en combat.
- Minimum (palier 4 permanent) : niveau 100 en 12h00 ; niveau 200 en 216 896 s = **60h15** (DPLN écrit 60h24 : erreur d'arrondi).
- Valeur pour l'élevage : chaque niveau d'un parent = +0,15 % de génération cible (niv. 100 = +15 %, niv. 200 = +30 % par parent).

---

## 7. Métier d'Éleveur (jobId 79)

- **Table d'XP** : XP cumulée(L) = **10 × L × (L − 1)** ; passer de L à L+1 coûte 20 × L (niv. 100 = 99 000 ; niv. 200 = 398 000). Formule des métiers Dofus 2.29+ (dofuswiki), identique à la table DPLN sauf au niveau 3 (DPLN 40, formule 60). — medium-high
- **XP de craft** : `floor(20 × niveauRecette × r/100 / (1 + 0,1 × (niveauMétier − niveauRecette)^1,1))`, 0 si l'écart dépasse 100 ; r = craftXpRatio de l'objet, sinon du type : **5** pour carburants (326), makinas (323) et filets (99), **50** pour le Filet de capture universel (32521). À niveau égal, une recette rapporte donc L XP (10 XP pour le filet universel au niveau 1). *(Libellé corrigé par la critique de complétude du 2026-10-02 : l'ancienne formulation « ratio = craftXpRatio/100 (−1 → 1 ; Filet universel = 50) » donnait 50 XP au filet universel et contredisait `crafts.json` et `strategy.json` ; les valeurs validées ci-dessous sont inchangées.)* Validée **exactement** sur la capture DPLN : Optimakina niv. 109 → 99 XP, Animakina niv. 107 → 80 XP, Animakina niv. 105 → 66 XP. Le niveau de métier (110) n'est **pas affiché** sur la capture : il est déduit, et c'est le seul niveau entre 105 et 130 qui reproduit les trois valeurs (vérifié). Formule publiée dans <https://github.com/Wallaka/dofus-efficiency/pull/56> (« XP/craft = floor(recipeLevel / (1 + 0.1·gap^1.1)) », PR consultée le 2026-10-02). — high
- **XP d'accouplement** = (XP du parent 1 + XP du parent 2) × nombre de bébés, avec XP du parent = k × génération : **k = 10 en 3.5** (clients 3.5.3.1 → 3.5.6.7 ; **revérifié indépendamment** sur le client 3.5.6.7 retéléchargé depuis le CDN Ankama : `breedingExperienceRewardQuantity` = 10 × génération), **k = 30 depuis la 3.6** (clients 3.6.2.1 → 3.6.12.16 et bêta 3.7). Les **deux** captures DPLN datent de la bêta 3.5 (guide publié le 27/02/2026, avant la sortie du 03/03/2026) et montrent les deux barèmes : « +60 » pour G2 × G1 avec 2 bébés (EX2 → k = 10) et « +300 » pour deux G5 (→ k = 30, valeur aussi écrite dans le texte DPLN). Le barème a donc changé pendant la bêta ; la 3.5 live utilisait 10. La capture « +300 » n'est **pas** une capture 3.6, mais elle correspond au barème 3.6. Formule (XP parent 1 + XP parent 2) × nombre de bébés : devblog II. — high (valeur affichée par le client ; le serveur fait foi)
- **XP de capture** : 30 par monture capturée (DPLN ; cas du filet multiplicateur non précisé). — medium
- **Déblocages** : enclos 1/40/80/120/160/200 ; filets 1/100/150/200 ; Extraits 5–45, Philtres 55–95, Potions 105–145, Élixirs 155–195 (une taille tous les 10 niveaux) ; makinas G2 dès le niveau 17 jusqu'à G10 au niveau 189. Un filet ne peut être équipé qu'avec le niveau de métier requis.
- **Bonus Almanax métiers** (DofusDB `almanax-calendars`) : 22/10 +50 % XP Éleveurs (avec Bûcherons, Mineurs, Alchimistes) ; 01/05 et 29/02 +50 % tous métiers ; 10/05 −15 % d'ingrédients (Éleveurs) ; 10/08 25 % de chances d'un second objet (Éleveurs). — high
- **Bonus « de saison »** (corrigé par la vérification) : DofusDB contient 4 entrées de catégorie 2 « Challenges augmentés et expérience des métiers » (+75 % challenges, **+25 % XP tous métiers**), une par saison, qui couvrent **chaque jour** de la saison : 21/06 → 21/09, 22/09 → 20/12, 21/12 → 19/03, 20/03 → 20/06, donc toute l'année. L'ancienne lecture « 20–22/03, 21–23/06, 22–24/09, 21–23/12 » ne gardait que les 3 premières dates de chaque liste et était fausse. Que ce bonus soit réellement actif tous les jours en jeu (bonus permanent de saison affiché à côté du bonus du jour) n'est pas confirmé par une autre source. — medium (données) / low (application en jeu)

---

## 8. Almanax élevage et évolutions post-3.5

### 8.1 Bonus Almanax élevage (texte officiel via DofusDB `almanax-calendars`) — high
| Date | Méryde du jour (et non le mois ; vérifié dans `meriaDescription` DofusDB) | Effet |
|---|---|---|
| 10/01 | Trôma | Abreuvoirs : effet doublé |
| 10/02 | Meash | Tous les bébés du jour : Endurante |
| 10/03 | Inndo | Foudroyeurs : effet doublé |
| 10/04 | Nunu | Baffeurs : effet doublé |
| 10/05 | Loumi | Éleveurs : 15 % d'ingrédients économisés |
| 10/06 | Jibejan | Mangeoires : effet doublé |
| 10/07 | Jihelair | Bébés : Amoureuse |
| 10/08 | Rigamix | Éleveurs : 25 % de chances d'un second objet |
| 10/09 | Mau | Caresseurs : effet doublé |
| 10/10 | Benjo | Bébés : Sage |
| **12/10/2026** (variable : 11/10/2027, 09/10/2028, 08/10/2029, 14/10/2030) | Takeza | **+20 % de génération cible** |
| 10/11 | Otoul | Bébés : Précoce |
| 10/12 | Foya | Dragofesses : effet doublé |

Liés à la capture : 11/09 +75 % XP dans le Territoire des Dragodindes Sauvages ; 01/04 +50 % XP et butin sur les créatures marines (dont les muldos sauvages). « Effet doublé » est modélisé comme gain ×2, consommation inchangée (non vérifié — low).

### 8.2 Chronologie des changements

| Date | Version | Changement d'élevage | Source | Confiance |
|---|---|---|---|---|
| 27/02/2025 | devblog I | Pistes (généalogie supprimée, bonus par enclos, étable 60/type…) — **en grande partie abandonnées** | devblog Ankama | high |
| 28/04/2025 | devblog II | Design final (base des règles 3.5) | devblog Ankama | high |
| 11/02/2026 | bêta 3.5 | — | news Ankama (non revérifiée : dofus.com renvoie 403 au vérificateur) | medium |
| **03/03/2026** | **3.5 live** | Refonte complète | news Ankama ; DPLN 3.5 (« jusqu'au mardi 3 mars avant la maintenance ») | high |
| 03→06/2026 | 3.5.3.1 → 3.5.6.7 | Aucune modification des données client d'élevage | 4 clients décodés | high |
| **23/06/2026** | **3.6 live** | XP d'accouplement ×3 (10 → 30 par génération et par parent ; seule différence de `RidesData` entre 3.5.6.7 et 3.6.12.16, revérifiée) ; succès **de monstres** (bestiaire) « Muldos sauvages » et « Volkornes sauvages » ; rien d'autre côté client. La page DPLN 3.6 ne mentionne aucun changement d'élevage. | client 3.6.2.1, news Ankama, DPLN 3.6 (« Vulkania le 1er juillet, une semaine après la sortie ») | high |
| 16/09/2026 | devblog 3.7 | Ajustements, détaillés ci-dessous | devblog Ankama | high |
| 17/09/2026 | bêta 3.7 (3.7.3.3) | Confirmés dans le client : jauges 200 000 (80k/140k/180k/200k, ticks inchangés), carburants ×2, génétons ×2, Optimakina 20 %, Animakina = sexe, 74 recettes de makinas modifiées | client bêta (index CDN `cytrus.json` du 2026-10-02 : beta = 6.0_3.7.3.3, live = 6.0_3.6.12.16) ; date : jeuxend.com | high |

**3.7 (bêta, pas encore live)** — devblog du 16/09/2026 : Animakina → choix du sexe ; capacités aléatoires sans makina (3/6/8/8/8 %) ; Optimakina +20 % ; carburants ×2 ; jauges ×2 ; génétons de 2 (parent G1) à 500 (parent G9) — le devblog écrit « de 2 génétons pour la génération 2 jusqu'à 500 génétons pour la génération 10 », c'est-à-dire la génération du bébé visé, ce qui concorde avec le client ; recettes de makinas revues (ressources de boss coûteuses remplacées) ; prix des ressources d'élevage au PNJ de guilde 15 → 30 ; fenêtre de confirmation au remplissage ; ressources d'élevage retirées des cadeaux de Nowel ; étable 500 places ; le clonage conserve la sérénité ; carburants renommés ; trophée dans le tableau génétique ; cosmétiques contre génétons. Filtres et ergonomie : filtre « Aucune capacité », combinaisons de fertilité, relance rapide d'un accouplement ou d'un clonage, transfert automatique entre enclos, renommage après naissance, bouton « tout vers l'extraction ».

---

## 9. Désaccords entre sources (et arbitrage)

| Sujet | Version A | Version B | Retenu |
|---|---|---|---|
| Niveau des filets multiplicateur et renforcé | devblog II, dofuselevage : renforcé 100, multiplicateur 150 | DPLN, DofusDB, client : multiplicateur 100, renforcé 150 | **DofusDB/client** |
| Amour : borne basse de sérénité | dofuselevage : 1 | client et DPLN : 0 | **0** |
| XP d'accouplement | DPLN : 30/génération | client 3.5 : 10 ; client 3.6+ : 30 | **dépend de la version** |
| Partage entre plusieurs cibles | dafous : égal | DPLN : pondéré par la généalogie | **pondéré** (modèle §1.2) |
| « Plus la génération est haute, moins c'est probable » | DPLN | client : geneticWeight 90/20 | **geneticWeight** |
| XP monture niv. 100/200 | devblog II : ~172 900 / ~868 900 | DPLN : 172 668 / 867 582 | **DPLN** (table complète) |
| Temps jusqu'au niv. 200 au palier 4 | DPLN 60h24 / devblog 60h20 | calcul : 60h15 | **60h15** |
| Table XP métier niv. 3 | DPLN : 40 | formule : 60 | **formule** |
| Clone obtenu | DPLN : « une des deux » | devblog II : 50/50 aléatoire | **50/50** |
| Jauges 3.7 « selon l'enclos » | texte du devblog | client : par palier | **par palier** |
| Étable | devblog I : 60 par type | devblog II et DPLN : 250 ; 3.7 : 500 | **250 → 500** |
| Issues de Rousse (arbre A/R, A/R) × Dorée (arbre A/D, A/D) | devblog II : Dorée, Rousse, Amande et Dorée, Amande et Rousse, Indigo | modèle §1.2 + client (Rousse × Dorée → Dorée et Rousse, G2) : les mêmes **plus** Dorée et Rousse (≈ 10,6 % à niv. 1) | **modèle** (le devblog, antérieur à l'implémentation, omet probablement ce croisement ; non vérifié en jeu — medium) |
| Bonus de saison +25 % XP métiers | ancienne version de ce fichier : 3 jours par saison | DofusDB : chaque jour de chaque saison | **DofusDB** (application en jeu non confirmée) |
| Nom de la capacité « +1 bébé » | DPLN : Reproducteur | devblog 3.7 et dofuselevage.fr : Reproductrice | non tranché (texte client non extrait) : afficher « Reproducteur » et accepter les deux |

---

## 10. Questions ouvertes (à vérifier en jeu)

1. Poids κ d'un croisement dont l'enfant est monocolore (GW 90) : capture d'un accouplement Amande et Dorée × Amande et Rousse (→ Indigo G3) ou Doré et Pourpre × Doré et Orchidée (→ Roux) à obtenir.
2. Cas où la part naturelle de la cible dépasse B : B exact ou max(B, naturel) ?
3. Reproducteur : 2 tirages indépendants ? génétons par bébé ?
4. Distribution de la sérénité aléatoire (naissance, capture, clonage en 3.5/3.6).
5. Niveau conservé au clonage ?
6. Almanax « effet doublé » : consommation doublée aussi ? cumul avec une capacité ?
7. Ordre dans un tick quand une jauge de sérénité et une jauge de stat sont actives ensemble.
8. Date de sortie live de la 3.7 ; prix d'Adèle Vage en 3.7 ; XP de capture avec un filet multiplicateur.

---

## 11. Sources

- Guide DPLN (édition 2026, MAJ 02/03/2026) : <https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html> (texte : `raw/guide-eleveur-dpln.txt` ; captures : `raw/mechanics-evidence/screenshots/`)
- DPLN, mises à jour 3.5 et 3.6 : <https://www.dofuspourlesnoobs.com/mise-a-jour-305.html>, <https://www.dofuspourlesnoobs.com/mise-a-jour-306.html> ; tableaux d'expérience : <https://www.dofuspourlesnoobs.com/tableaux-dexpeacuterience.html>
- Devblog élevage I (27/02/2025) : <https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1761570-devblog-elevage-monture>
- Devblog élevage II (28/04/2025) : <https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1762596-devblog-elevage-monture-partie-ii>
- Devblog 3.7 (16/09/2026) : <https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1771790-maj-3-7-confort-jeu-lisibilite-ajustements>
- News Ankama : bêta 3.5 <https://www.dofus.com/fr/mmorpg/actualites/news/1767498-maj-3-5-disponible-serveur-beta> ; 3.5 live <https://www.dofus.com/fr/mmorpg/actualites/news/1767665-maj-3-5-ligne> ; 3.6 live <https://www.dofus.com/fr/mmorpg/actualites/news/1770358-maj-3-6-raid-not-dead-maintenant-ligne>
- Client Dofus 3 (CDN cytrus d'Ankama) : 3.5.3.1, 3.5.4.2, 3.5.5.3, 3.5.6.7, 3.6.2.1, 3.6.4.3, 3.6.6.6, 3.6.9.9, 3.6.12.16, bêta 3.7.3.3 — RidesData, PaddockGauges, RideGauges, Items, Recipes, Constants, LuaFormulas (aucune formule d'élevage côté Lua). Synthèse : `raw/mechanics-evidence/client-data/`.
- DofusDB : `items`, `recipes`, `effects`, `almanax-calendars` (<https://api.dofusdb.fr>)
- LEGACY : <http://felis-silvestris.lescigales.org/genetique-des-dragodindes.html> ; JOL <https://forums.jeuxonline.info/showthread.php?t=1352108>
- Outils communautaires comparés : <https://dofuselevage.fr/guide>, <https://dofuselevage.fr/tools/reproduction/muldo>, <https://registre-des-abysses.pages.dev/>, <https://dafous.app/elevage>, <https://dafous.app/en/guides/guide-eleveur.html>
- Formule d'XP de craft : <https://github.com/Wallaka/dofus-efficiency/pull/56> ; table des métiers : <https://dofuswiki.fandom.com/wiki/Profession>
- Non utilisés : forum officiel (patch notes derrière un challenge anti-bot AWS WAF), X/Twitter (402), vidéos YouTube (aucune ne donne de formule chiffrée).

---

## Vérification

> Vérification adversariale du 2026-10-02 (agent vérificateur). Le but était de réfuter le contenu. Chaque point a été recoupé avec une **source différente** de celle de l'auteur quand c'était possible. Fichiers vérifiés : ce fichier et `data/mechanics.json` (JSON revalidé avec Python après modification).

### Ce qui a été vérifié (34 points)

| # | Affirmation | Méthode / source indépendante | Résultat |
|---|---|---|---|
| 1 | Pourcentages EX1 (avec et sans Optimakina), EX2, EX3, EX4 | Lecture directe des 5 captures dans `raw/mechanics-evidence/screenshots/` + exécution de `breeding_model_reference.py` | ✔ 24/24 valeurs à 0,01 % près ; génétons 265/265/3/3/240/0/0 ✔ |
| 2 | Unicité de l'arbre déduit de l'Ivoire et Turquoise (EX3) | Test des arbres possibles {I&T,I&T}, {I&P,I&P}, {I&T,I&P}, {Ivoire,Turquoise} | ✔ seul {I&T, I&P} donne 4:7 et seulement 3 issues |
| 3 | Rapports internes (Émeraude/I&T = 7,5 ; Pourpre/Corail = 12 ; D&I/Doré = 200/540 ; D&P/Doré = 0,923) | Recalcul à la main | ✔ |
| 4 | Doré et Indigo masqué ≈ 3,9 % (EX2) | Complément à 100 des valeurs visibles | ✔ 3,92 |
| 5 | `geneticWeight` 90/20/1, Dorée 20, Muldos G9 20, G0 20 | `raw/dofus-client/rides-3.6.12.16.json` et client **3.5.6.7 retéléchargé** par le vérificateur depuis le CDN Ankama | ✔ identique dans 3.5.6.7, 3.6.12.16 et 3.7.3.3 ; `geneticWeightByRideId` = 308/308 montures, aucun écart |
| 6 | Table des croisements : 382 paires, un seul enfant par paire, enfant = max(gén. parents)+1 | Analyse de `RidesData.parents` et `children` | ✔ 382 paires uniques, 0 violation, 0 croisement inter-espèces, `children` cohérent |
| 7 | XP d'accouplement 10/gén. en 3.5, 30/gén. en 3.6 | Client 3.5.6.7 retéléchargé (manifeste `6.0_3.5.6.7`) | ✔ 10 × génération en 3.5.6.7 ; seule différence de `RidesData` avec 3.6.12.16 |
| 8 | Formule (XP mère + XP père) × nb bébés | Devblog II (ligne « expérience gagnée = … ») + capture EX2 (+60) | ✔ |
| 9 | Paliers de jauge 40k/70k/90k/100k, 10/20/30/40 par tick | `PaddockGaugesData` de 3.5.6.7 retéléchargé + devblog II + DPLN | ✔ ; 3.7 bêta 80k/140k/180k/200k ✔ |
| 10 | Durées de vidage (11h06m40, 4h10, 1h51m07, 41m40, 17h49 ; 3.7 : 35h38) et de remplissage d'une stat | Recalcul | ✔ (simulation par ticks entiers : 6 416 ticks = 17h49m20) |
| 11 | Zones de sérénité et maximum 20 000 | `RideGauges` client + DPLN | ✔ (maxMood 5001 pour l'amour : borne exclusive probable, sans effet pratique) |
| 12 | Génétons par génération (1…250 ; 3.7 : 2…500) et exception Volkornes Prune et Roux / Prune et Ivoire = 0 | Client 3.6.12.16 et 3.7.3.3 ; 3.5.6.7 retéléchargé ; devblog II (liste 1…250, exemple 120 + 8 = 128) | ✔ |
| 13 | Quantités et plafonds des 120 carburants, niveaux 5…195 | DofusDB `items.possibleEffects` (effets 3810…3820) et `recipes` (jobId 79) | ✔ 120/120 noms, niveaux, quantités, plafonds |
| 14 | 81 makinas : noms, niveaux (formule 20(g−2)+17…), effets | DofusDB `recipes` et `items` | ✔ 81/81, 0 écart à la formule de niveau |
| 15 | Animakina 27/27/27/14/5 % ; Optimakina +10 % (+20 % en 3.7) ; Animakina 3.7 = effet 4069 | DofusDB (3840 = 5, 3841 = 14, 3842…3844 = 27, 3838 = 10) + effets client bêta | ✔ |
| 16 | 74 recettes de makinas modifiées en 3.7 | Diff recettes bêta 3.7.3.3 / recettes DofusDB live | ✔ 74, toutes de type 323 (makinas) |
| 17 | Niveaux des filets 1/100/150/200 ; devblog II et dofuselevage.fr inversés | DofusDB `recipes` ; texte du devblog II ; page dofuselevage.fr/guide | ✔ |
| 18 | Amour « entre 1 et 5000 » chez dofuselevage.fr | Page dofuselevage.fr/guide | ✔ (citation exacte), contredit par le client et DPLN |
| 19 | IDs : Poussière d'élevage 33511, Généton 33512, Neurone 33515, Ambre de muldo 17864, Corne de volkorne 19975 | DofusDB `items` | ✔ |
| 20 | Prix Adèle Vage 50/200/800/3200 et boutique Eugène Éton | Captures `adele-vage-poussiere.jpg`, `eugene-eton-genetons.jpg` | ✔ |
| 21 | Clonage : conserve couleur, genre, nom, généalogie ; jauges remises à 0 ; capacité perdue ; 50/50 | Capture `clonage-interface.jpg` ; devblog II | ✔ |
| 22 | Table XP monture 1→200 (172 668 / 867 582) | Script `xpData.monture` de <https://www.dofuspourlesnoobs.com/tableaux-dexpeacuterience.html> | ✔ 200/200 valeurs identiques |
| 23 | Table XP métier = 10·L·(L−1), différente de DPLN au seul niveau 3 | `xpData.metier` DPLN | ✔ 199/200 identiques (niveau 3 : DPLN 40, formule 60) |
| 24 | 60h15 au lieu de 60h24 ; devblog II 60h20 ; 172 900 / 868 900 | Recalcul ; texte du devblog II | ✔ |
| 25 | Formule d'XP de craft | Recalcul sur la capture ; PR <https://github.com/Wallaka/dofus-efficiency/pull/56> consultée | ✔ mais le niveau 110 est **déduit** (seul niveau de 105 à 130 qui colle) — précisé |
| 26 | Enclos liés au compte (niveau d'Éleveur le plus haut du compte sur le serveur), étable 250, devblog I à 60 par type | Textes des devblogs I et II | ✔ |
| 27 | Devblog II : ≈ 10 h (palier 2) / 5 h (palier 4) pour une monture féconde | Texte du devblog II | ✔ |
| 28 | Takeza +20 %, dates 12/10/2026, 11/10/2027, 09/10/2028, 08/10/2029, 14/10/2030 | DofusDB `almanax-calendars` id 47 | ✔ |
| 29 | Bonus Almanax élevage du 10 de chaque mois | DofusDB `almanax-calendars` | ✔ effets ; ✘ la colonne « Mois » contenait les noms des **Mérydes** → corrigé |
| 30 | Bonus Almanax métiers « 20–22/03, 21–23/06, 22–24/09, 21–23/12 » | DofusDB `almanax-calendars` ids 2, 129, 130, 131 (catégorie 2) | ✘ **faux** : chaque entrée couvre toute la saison → corrigé |
| 31 | Équivalence avec « Registre des Abysses » | Code source `assets/index-*.js` du site | ✔ avec une **liste d'exceptions** à GW 2 que le texte omettait → précisé |
| 32 | Versions : live 3.6.12.16, bêta 3.7.3.3 | `https://cytrus.cdn.ankama.com/cytrus.json` + DofusDB `/version` | ✔ |
| 33 | Dates 3.5 live 03/03/2026, 3.6 live 23/06/2026, bêta 3.7 17/09/2026 | Pages DPLN MAJ 3.5 et 3.6 ; jeuxend.com | ✔ ; bêta 3.5 (11/02/2026) non revérifiable (dofus.com renvoie 403) → medium |
| 34 | Contenu du devblog 3.7 | Le site officiel renvoie 403 et la recherche web ne trouve rien ; les points vérifiables sont confirmés par le client bêta (jauges, carburants, génétons, Optimakina, Animakina, recettes) | ✔ pour ces points ; capacités sans makina, étable 500, sérénité au clonage et renommages restent « devblog seul » |

### Ce qui a été corrigé

1. §0 : « 12 pourcentages » → **24 pourcentages sur 5 captures**. Ajout : EX3/EX4 reposent sur 2 paramètres déduits (arbre, somme des niveaux), donc seules les 16 valeurs d'EX1/EX2 sont des prédictions sans paramètre libre. Même correction dans `breeding.offspringModel.status`.
2. §1.2 et `communityModelsCompared` : l'équivalence avec le Registre des Abysses n'est vraie **qu'avec sa liste d'exceptions** (Dorée, Muldos G9 forcés à 2).
3. §1.4 EX4 et `validationExamples` : ajout d'un contrôle de cohérence des niveaux déduits (Pourpre niv. 200 d'EX1 → I&T niv. 72 → I&P niv. 72).
4. §7 et `breeding.jobXp.note` : la capture « +300 XP » n'est **pas** une capture 3.6. Les deux captures DPLN sont de la bêta 3.5 et montrent les deux barèmes (10 et 30). Ajout de la revérification du client 3.5.6.7.
5. §7 et `breederJob.craftXp.validation` : le niveau de métier 110 est déduit, pas affiché.
6. §7 et `breederJob.almanaxJobXpBonuses` : bonus de saison +25 % XP tous métiers sur **toute la saison** (donc toute l'année), et non 3 jours par saison. Confiance medium pour les données, low pour l'application en jeu.
7. §8.1 et `almanax.breedingBonuses` : Trôma, Meash… sont des **Mérydes**, pas des mois. La clé `month` contient désormais le vrai mois et une clé `meryde` a été ajoutée.
8. §8.2 et `timeline` : bêta 3.5 rétrogradée en medium ; sources ajoutées pour la 3.5 live, la 3.6 live et la bêta 3.7 ; les succès « Muldos/Volkornes sauvages » sont des succès de monstres.
9. §8.2 : la formulation du devblog 3.7 sur les génétons (« génération 2 → 10 » = génération du bébé) est rapprochée des valeurs client (parent G1 → G9).
10. §4 et `fuels.sizeNameNote` : noms exacts des tailles (pas de préfixe pour la taille normale ; « Petite/Grande Potion »).
11. §9 : trois désaccords ajoutés (exemple Rousse × Dorée du devblog II, bonus de saison, Reproducteur/Reproductrice) ; `abilities.nameVariants` ajouté ; deux questions ajoutées à `openQuestions` ; bloc `meta.verification` ajouté.

### Ce qui n'a pas pu être réfuté mais reste fragile

- **Modèle de probabilités** : la structure (normalisation par arbre, croisements pA·pB, cible = B exactement, partage proportionnel) tient sur toutes les captures, et l'exemple du devblog II est compatible à une omission près. Le facteur κ des croisements à enfant monocolore (GW 90) **n'est pas testé** : dans EX3, l'Émeraude est la seule cible et reçoit B quel que soit son poids naturel. Le cas D(T) > B n'est pas testé non plus. À valider avec une capture en jeu (voir §10).
- **Exemple du devblog II** (Rousse × Dorée) : le modèle prédit en plus une Dorée et Rousse (≈ 10,6 % avec deux parents niv. 1), que le devblog ne liste pas. Probable omission d'un texte antérieur à l'implémentation, mais à contrôler en jeu.
- **XP et génétons** : les valeurs viennent du client (affichage) ; le serveur fait foi. Les captures DPLN montrent que le barème d'XP a déjà changé une fois sans annonce.
- **Bonus de saison +25 % XP métiers** : la donnée DofusDB est sûre, son application quotidienne en jeu ne l'est pas.
- Je n'ai pas vérifié la description du simulateur dofuselevage.fr (« poids 8/3, 1/gen^0,55 »). Elle sert seulement de contre-exemple.
