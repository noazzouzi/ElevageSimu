# Arbre d'élevage des Muldos (système 3.5+)

Fichier de données associé : `research/data/tree-muldo.json` (120 montures, 57 croisements de générations impaires).
Recherche faite le 2026-10-01. Les données de jeu DofusDB utilisées ont été mises à jour le 2026-06-23 (contenu 3.6). **Vérifié le 2026-10-01 contre les données du client officiel Dofus 3.6.12.16 (live) et 3.7.3.3 (bêta) : arbre, générations et stats identiques (voir § Vérification).**

## 1. Résumé

| Fait | Valeur | Source | Confiance |
|---|---|---|---|
| Nombre de Muldos élevables | **120** | DofusDB (120 objets `typeId 332` « Muldo ») ; DPLN « Il existe un total de 120 muldos » | high |
| Génération maximale | **10** | succès DofusDB « Muldo : Dixième génération » (id 9014) ; makinas Muldo « de Génération 2 » à « 10 » | high |
| Muldos capturables (gén. 1) | **5** : Doré, Pourpre, Indigo, Ébène, Orchidée | DPLN (guide + page Muldos) ; monstres DofusDB 4434-4438 | high |
| Avant la 3.5 | 8 générations, 66 Muldos | succès 1490-1496 (anciens) ; JOL ; outil DofusDB (66 Muldos) | high |
| Nouveautés 3.5 | G9 : Ambre, Corail, Azur, Aigue-marine ; G10 : 50 bicolores | succès 9013 / 9014 ; DPLN | high |
| Générations paires | bicolores « X et Y » = croisement des monocolores X × Y, **1 seul croisement** | guide DPLN ; noms ; DPLN Muldos | high |
| Générations impaires | monocolores obtenus en croisant **2 bicolores de la génération précédente**, **plusieurs croisements** | client officiel 3.6.12.16 / 3.7.3.3-bêta (`RidesData.parents`) ; guide DPLN ; DPLN Muldos | high |
| Stats niveau 100 | valeurs DofusDB `/mounts` (inchangées) ; client `EvolutiveEffects` pour les 120 | DofusDB ; client ; guide DPLN (Doré niv. 100 = 1 PM + 50 Puissance) | high (120 Muldos) |
| Stats niveau 200 | valeurs des objets DofusDB `typeId 332` | DofusDB ; DPLN (identiques pour les 120) ; guide (Doré niv. 200 = 70 Puissance) | high |
| Stats entre deux paliers | progression linéaire par niveau (pente p1 jusqu'à 100, p2 de 101 à 200), arrondie à l'inférieur | client `EvolutiveEffects` (pentes) ; « 1 PM à partir du niveau 100 » (arrondi) | medium (arrondi non mesuré) |

## 2. Nombre de montures par génération

| Gén. | Nb | Type | Contenu |
|---|---|---|---|
| 1 | 5 | monocolores capturables | Doré, Pourpre, Indigo, Ébène, Orchidée |
| 2 | 10 | bicolores | toutes les paires des 5 couleurs G1 |
| 3 | 2 | monocolores | Roux, Amande |
| 4 | 11 | bicolores | Roux ou Amande × (5 couleurs G1) + Roux et Amande |
| 5 | 2 | monocolores | Ivoire, Turquoise |
| 6 | 15 | bicolores | Ivoire ou Turquoise × (7 couleurs précédentes) + Turquoise et Ivoire |
| 7 | 2 | monocolores | Prune, Émeraude |
| 8 | 19 | bicolores | Prune ou Émeraude × (9 couleurs précédentes) + Prune et Émeraude |
| 9 | 4 | monocolores (nouveaux 3.5) | Ambre, Corail, Azur, Aigue-marine |
| 10 | 50 | bicolores (nouveaux 3.5) | 4 couleurs G9 × (11 couleurs précédentes) = 44, + 6 paires entre couleurs G9 |
| **Total** | **120** | | 15 couleurs : 15 monocolores + C(15,2) = 105 bicolores |

Source de l'appartenance aux générations : objectifs des succès DofusDB « Muldo : Deuxième génération » … « Dixième génération » (chaque objectif = « Avoir fait naître » une monture, critère `EB>idMonture`). DPLN et guidactik.com donnent exactement la même répartition, et le client officiel 3.6.12.16 / 3.7.3.3-bêta (`RidesData.generation`) aussi (120/120, vérification 2026-10-01). Confiance high.

## 3. Comment fonctionne le croisement (règles 3.5)

Règles générales (guide de l'éleveur DPLN, édition 2026, confiance high) :

- Un accouplement = 2 montures **fécondes**, de sexe opposé, du même type ; un seul bébé (2 si un parent a la capacité Reproducteur) ; les deux parents deviennent stériles.
- La couleur du bébé dépend des parents **et des grands-parents** (l'arbre s'arrête aux grands-parents). Les parents pèsent plus que les grands-parents ; plus une couleur est de génération élevée, moins elle a de chance de sortir.
- **Génération cible** = la plus haute génération atteignable avec les deux arbres. Bonus : +30 % de base, +0,15 % par niveau de chaque parent (deux parents niv. 200 : +60 %), +10 % avec une Optimakina (de génération ≥ cible). Si plusieurs montures de la génération cible sont possibles, ce bonus est partagé entre elles.
  - **3.7 (annoncée, en bêta au 2026-10-01)** : l'Optimakina passera de +10 % à **+20 %**, l'Animakina permettra de choisir le sexe du bébé, et les capacités pourront apparaître sans makina (Reproductrice 3 %, Sage 6 %, Précoce 8 %, Amoureuse 8 %, Endurante 8 %). Source : devblog 3.7 du 16/09/2026 (`research/raw/mechanics-evidence/texts/devblog-3.7-elevage-2026-09-16.txt`). Confiance medium. Les croisements Muldo ne changent pas : le client bêta 3.7.3.3 est identique au live.
- **Générations paires** : une seule recette (« Les montures de génération paires n'ont qu'un seul croisement possible »).
- **Générations impaires** : pour les Muldos et Volkornes, plusieurs croisements possibles (« il y a, par exemple, 8 croisements possibles pour obtenir le Muldo Emeraude ») ; pour les Dragodindes un seul.
- L'interface **Génétique** du jeu (bouton en bas de l'interface d'élevage, ou clic droit > Afficher la génétique) liste tous les croisements ; c'est la référence à consulter en cas de doute.

Ce que montrent les données Muldo (vérifié par script sur les 120 entrées, puis confronté au client officiel : `RidesData.parents` liste exactement ces croisements) :

- Chaque bicolore « Muldo X et Y » de génération n s'obtient par **X × Y** ; sa génération = génération max(X, Y) + 1. Exemple : « Muldo Ambre et Doré » = Ambre (G9) × Doré (G1) → G10.
- Chaque monocolore de génération impaire n s'obtient en croisant **deux bicolores de génération n−1**. Les recettes connues (57 au total) : Roux 6, Amande 3, Ivoire 8, Turquoise 8, Prune 4, Émeraude 8, Ambre 5, Corail 5, Azur 5, Aigue-marine 5.
- Aucune paire de parents n'apparaît dans deux recettes différentes : une paire de bicolores vise au plus une couleur de la génération suivante.
- Motifs visibles (utile pour repérer une erreur de saisie) :
  - **Roux** = deux bicolores « Doré et X » quelconques (les 6 paires possibles parmi Doré-Pourpre, Doré-Indigo, Doré-Ébène, Doré-Orchidée).
  - **Amande** = deux bicolores sans Doré et sans couleur commune (les 3 partitions de {Pourpre, Indigo, Ébène, Orchidée}).
  - **Ivoire** = (Roux et Doré **ou** Roux et Amande) × (X et Amande, X ∈ {Pourpre, Indigo, Ébène, Orchidée}).
  - **Turquoise** = (Doré et Amande **ou** Roux et Amande) × (Roux et X, X ∈ {Pourpre, Indigo, Ébène, Orchidée}).
  - **Prune** = X et Ivoire × Turquoise et σ(X), avec σ : Ébène↔Pourpre, Indigo↔Orchidée.
  - **Émeraude** = 8 paires parmi les bicolores Turquoise/Ivoire avec Doré, Roux, Amande (liste sans motif simple).
  - **Génération 9** : on associe chaque couleur à un « partenaire » : Pourpre↔Roux, Orchidée↔Amande, Indigo↔Ivoire, Ébène↔Turquoise, et Doré↔(Prune ou Émeraude).
    - Ambre = X et Émeraude × partenaire(X) et Émeraude ;
    - Corail = Prune et X × Prune et partenaire(X) ;
    - Azur = X et Émeraude × Prune et partenaire(X) ;
    - Aigue-marine = Prune et X × partenaire(X) et Émeraude.
    - Pour Azur et Aigue-marine, le 5e croisement (celui avec Doré) ne peut pas suivre le motif. Le motif donnerait en effet exactement les recettes déjà prises par l'Ambre (Doré et Émeraude × Prune et Émeraude) et le Corail (Prune et Doré × Prune et Émeraude). DPLN donne « Doré et Émeraude × Prune et Ivoire » (Azur) et « Prune et Doré × Turquoise et Émeraude » (Aigue-marine). Ces deux recettes réutilisent un bicolore déjà présent dans une autre recette de la même couleur. Elles sont atypiques **mais figurent telles quelles dans les données du client officiel** (`RidesData.parents`, 3.6.12.16 et 3.7.3.3-bêta) : confiance **high** (relevée de low à la vérification).

## 4. Arbre complet par génération

Notation : « A × B » = accoupler A avec B (sexes opposés). Les stats sont celles de `statsByLevel` (100 et 200). *(client)* signale un niveau 100 absent de DofusDB `/mounts` pour les 54 nouveaux Muldos, d'abord déduit puis confirmé par le client officiel (`EvolutiveEffects`, voir §5).

### Génération 1 (5 Muldos)

| Muldo | id monture | id objet | Croisement | Stats niv. 100 | Stats niv. 200 |
|---|---|---|---|---|---|
| Muldo Orchidée | 90 | 33096 | capture (Bassin des Muldos) | 1 PM, 16% Résistance Feu | 1 PM, 18% Résistance Feu |
| Muldo Ébène | 91 | 33080 | capture (Bassin des Muldos) | 1 PM, 16% Résistance Air | 1 PM, 18% Résistance Air |
| Muldo Indigo | 92 | 33088 | capture (Bassin des Muldos) | 1 PM, 16% Résistance Eau | 1 PM, 18% Résistance Eau |
| Muldo Pourpre | 93 | 33101 | capture (Bassin des Muldos) | 1 PM, 16% Résistance Terre | 1 PM, 18% Résistance Terre |
| Muldo Doré | 94 | 33072 | capture (Bassin des Muldos) | 1 PM, 50 Puissance | 1 PM, 70 Puissance |

### Génération 2 (10 Muldos)

| Muldo | id monture | id objet | Croisement | Stats niv. 100 | Stats niv. 200 |
|---|---|---|---|---|---|
| Muldo Doré et Pourpre | 101 | 33079 | Doré × Pourpre | 1 PM, 40 Puissance, 8% Résistance Terre | 1 PM, 60 Puissance, 10% Résistance Terre |
| Muldo Indigo et Pourpre | 102 | 33093 | Indigo × Pourpre | 1 PM, 8% Résistance Eau, 8% Résistance Terre | 1 PM, 10% Résistance Eau, 10% Résistance Terre |
| Muldo Ébène et Pourpre | 103 | 33086 | Ébène × Pourpre | 1 PM, 8% Résistance Air, 8% Résistance Terre | 1 PM, 10% Résistance Air, 10% Résistance Terre |
| Muldo Orchidée et Pourpre | 104 | 33100 | Orchidée × Pourpre | 1 PM, 8% Résistance Feu, 8% Résistance Terre | 1 PM, 10% Résistance Feu, 10% Résistance Terre |
| Muldo Doré et Orchidée | 105 | 33078 | Doré × Orchidée | 1 PM, 40 Puissance, 8% Résistance Feu | 1 PM, 60 Puissance, 10% Résistance Feu |
| Muldo Indigo et Orchidée | 106 | 33092 | Indigo × Orchidée | 1 PM, 8% Résistance Eau, 8% Résistance Feu | 1 PM, 10% Résistance Eau, 10% Résistance Feu |
| Muldo Ébène et Orchidée | 107 | 33085 | Ébène × Orchidée | 1 PM, 8% Résistance Air, 8% Résistance Feu | 1 PM, 10% Résistance Air, 10% Résistance Feu |
| Muldo Doré et Indigo | 108 | 33076 | Doré × Indigo | 1 PM, 40 Puissance, 8% Résistance Eau | 1 PM, 60 Puissance, 10% Résistance Eau |
| Muldo Ébène et Indigo | 109 | 33083 | Ébène × Indigo | 1 PM, 8% Résistance Air, 8% Résistance Eau | 1 PM, 10% Résistance Air, 10% Résistance Eau |
| Muldo Doré et Ébène | 110 | 33074 | Doré × Ébène | 1 PM, 40 Puissance, 8% Résistance Air | 1 PM, 60 Puissance, 10% Résistance Air |

### Génération 3 (2 Muldos)

**Muldo Roux** (id 95, objet 33116) — niv. 200 : 1 PM, 50 Tacle — 6 croisements (confiance high : client officiel + DPLN) :

- Doré et Pourpre × Doré et Indigo
- Doré et Pourpre × Doré et Ébène
- Doré et Pourpre × Doré et Orchidée
- Doré et Orchidée × Doré et Indigo
- Doré et Orchidée × Doré et Ébène
- Doré et Ébène × Doré et Indigo

**Muldo Amande** (id 96, objet 33069) — niv. 200 : 1 PM, 50 Fuite — 3 croisements (confiance high : client officiel + DPLN) :

- Indigo et Pourpre × Ébène et Orchidée
- Ébène et Pourpre × Indigo et Orchidée
- Orchidée et Pourpre × Ébène et Indigo


### Génération 4 (11 Muldos)

| Muldo | id monture | id objet | Croisement | Stats niv. 100 | Stats niv. 200 |
|---|---|---|---|---|---|
| Muldo Roux et Pourpre | 111 | 33124 | Roux × Pourpre | 1 PM, 30 Tacle, 8% Résistance Terre | 1 PM, 40 Tacle, 10% Résistance Terre |
| Muldo Roux et Orchidée | 112 | 33123 | Roux × Orchidée | 1 PM, 30 Tacle, 8% Résistance Feu | 1 PM, 40 Tacle, 10% Résistance Feu |
| Muldo Roux et Indigo | 113 | 33121 | Roux × Indigo | 1 PM, 30 Tacle, 8% Résistance Eau | 1 PM, 40 Tacle, 10% Résistance Eau |
| Muldo Roux et Ébène | 114 | 33119 | Roux × Ébène | 1 PM, 30 Tacle, 8% Résistance Air | 1 PM, 40 Tacle, 10% Résistance Air |
| Muldo Roux et Doré | 115 | 33118 | Roux × Doré | 1 PM, 30 Tacle, 40 Puissance | 1 PM, 40 Tacle, 60 Puissance |
| Muldo Roux et Amande | 116 | 33117 | Roux × Amande | 1 PM, 30 Tacle, 30 Fuite | 1 PM, 40 Tacle, 40 Fuite |
| Muldo Pourpre et Amande | 117 | 33102 | Pourpre × Amande | 1 PM, 8% Résistance Terre, 30 Fuite | 1 PM, 10% Résistance Terre, 40 Fuite |
| Muldo Orchidée et Amande | 118 | 33097 | Orchidée × Amande | 1 PM, 8% Résistance Feu, 30 Fuite | 1 PM, 10% Résistance Feu, 40 Fuite |
| Muldo Indigo et Amande | 119 | 33089 | Indigo × Amande | 1 PM, 8% Résistance Eau, 30 Fuite | 1 PM, 10% Résistance Eau, 40 Fuite |
| Muldo Ébène et Amande | 120 | 33081 | Ébène × Amande | 1 PM, 8% Résistance Air, 30 Fuite | 1 PM, 10% Résistance Air, 40 Fuite |
| Muldo Doré et Amande | 121 | 33073 | Doré × Amande | 1 PM, 40 Puissance, 30 Fuite | 1 PM, 60 Puissance, 40 Fuite |

### Génération 5 (2 Muldos)

**Muldo Ivoire** (id 97, objet 33094) — niv. 200 : 1 PM, 50 Esquive PA — 8 croisements (confiance high : client officiel + DPLN) :

- Roux et Doré × Ébène et Amande
- Roux et Doré × Indigo et Amande
- Roux et Doré × Orchidée et Amande
- Roux et Doré × Pourpre et Amande
- Roux et Amande × Ébène et Amande
- Roux et Amande × Pourpre et Amande
- Roux et Amande × Indigo et Amande
- Roux et Amande × Orchidée et Amande

**Muldo Turquoise** (id 98, objet 33125) — niv. 200 : 1 PM, 50 Esquive PM — 8 croisements (confiance high : client officiel + DPLN) :

- Doré et Amande × Roux et Ébène
- Doré et Amande × Roux et Orchidée
- Doré et Amande × Roux et Pourpre
- Doré et Amande × Roux et Indigo
- Roux et Amande × Roux et Ébène
- Roux et Amande × Roux et Indigo
- Roux et Amande × Roux et Orchidée
- Roux et Amande × Roux et Pourpre


### Génération 6 (15 Muldos)

| Muldo | id monture | id objet | Croisement | Stats niv. 100 | Stats niv. 200 |
|---|---|---|---|---|---|
| Muldo Pourpre et Ivoire | 122 | 33104 | Pourpre × Ivoire | 1 PM, 8% Résistance Terre, 30 Esquive PA | 1 PM, 10% Résistance Terre, 40 Esquive PA |
| Muldo Orchidée et Ivoire | 123 | 33099 | Orchidée × Ivoire | 1 PM, 8% Résistance Feu, 30 Esquive PA | 1 PM, 10% Résistance Feu, 40 Esquive PA |
| Muldo Indigo et Ivoire | 124 | 33091 | Indigo × Ivoire | 1 PM, 8% Résistance Eau, 30 Esquive PA | 1 PM, 10% Résistance Eau, 40 Esquive PA |
| Muldo Ébène et Ivoire | 125 | 33084 | Ébène × Ivoire | 1 PM, 8% Résistance Air, 30 Esquive PA | 1 PM, 10% Résistance Air, 40 Esquive PA |
| Muldo Doré et Ivoire | 126 | 33077 | Doré × Ivoire | 1 PM, 40 Puissance, 30 Esquive PA | 1 PM, 60 Puissance, 40 Esquive PA |
| Muldo Roux et Ivoire | 127 | 33122 | Roux × Ivoire | 1 PM, 30 Tacle, 30 Esquive PA | 1 PM, 40 Tacle, 40 Esquive PA |
| Muldo Amande et Ivoire | 138 | 33071 | Amande × Ivoire | 1 PM, 30 Fuite, 30 Esquive PA | 1 PM, 40 Fuite, 40 Esquive PA |
| Muldo Turquoise et Ivoire | 139 | 33131 | Turquoise × Ivoire | 1 PM, 30 Esquive PM, 30 Esquive PA | 1 PM, 40 Esquive PM, 40 Esquive PA |
| Muldo Turquoise et Pourpre | 140 | 33133 | Turquoise × Pourpre | 1 PM, 30 Esquive PM, 8% Résistance Terre | 1 PM, 40 Esquive PM, 10% Résistance Terre |
| Muldo Turquoise et Indigo | 141 | 33130 | Turquoise × Indigo | 1 PM, 30 Esquive PM, 8% Résistance Eau | 1 PM, 40 Esquive PM, 10% Résistance Eau |
| Muldo Turquoise et Ébène | 142 | 33128 | Turquoise × Ébène | 1 PM, 30 Esquive PM, 8% Résistance Air | 1 PM, 40 Esquive PM, 10% Résistance Air |
| Muldo Turquoise et Roux | 143 | 33134 | Turquoise × Roux | 1 PM, 30 Esquive PM, 30 Tacle | 1 PM, 40 Esquive PM, 40 Tacle |
| Muldo Turquoise et Amande | 144 | 33126 | Turquoise × Amande | 1 PM, 30 Esquive PM, 30 Fuite | 1 PM, 40 Esquive PM, 40 Fuite |
| Muldo Turquoise et Doré | 145 | 33127 | Turquoise × Doré | 1 PM, 30 Esquive PM, 40 Puissance | 1 PM, 40 Esquive PM, 60 Puissance |
| Muldo Turquoise et Orchidée | 165 | 33132 | Turquoise × Orchidée | 1 PM, 30 Esquive PM, 8% Résistance Feu | 1 PM, 40 Esquive PM, 10% Résistance Feu |

### Génération 7 (2 Muldos)

**Muldo Prune** (id 99, objet 33105) — niv. 200 : 1 PM, 12% Critique — 4 croisements (confiance high : client officiel + DPLN) :

- Ébène et Ivoire × Turquoise et Pourpre
- Indigo et Ivoire × Turquoise et Orchidée
- Orchidée et Ivoire × Turquoise et Indigo
- Pourpre et Ivoire × Turquoise et Ébène

**Muldo Émeraude** (id 100, objet 33087) — niv. 200 : 1 PM, 40 Dommages Critiques — 8 croisements (confiance high : client officiel + DPLN) :

- Turquoise et Ivoire × Turquoise et Doré
- Turquoise et Ivoire × Turquoise et Roux
- Turquoise et Ivoire × Amande et Ivoire
- Turquoise et Ivoire × Doré et Ivoire
- Turquoise et Ivoire × Turquoise et Amande
- Turquoise et Amande × Roux et Ivoire
- Turquoise et Amande × Doré et Ivoire
- Doré et Ivoire × Turquoise et Roux


### Génération 8 (19 Muldos)

| Muldo | id monture | id objet | Croisement | Stats niv. 100 | Stats niv. 200 |
|---|---|---|---|---|---|
| Muldo Prune et Pourpre | 146 | 33113 | Prune × Pourpre | 1 PM, 6% Critique, 8% Résistance Terre | 1 PM, 8% Critique, 10% Résistance Terre |
| Muldo Prune et Orchidée | 147 | 33112 | Prune × Orchidée | 1 PM, 6% Critique, 8% Résistance Feu | 1 PM, 8% Critique, 10% Résistance Feu |
| Muldo Prune et Indigo | 148 | 33110 | Prune × Indigo | 1 PM, 6% Critique, 8% Résistance Eau | 1 PM, 8% Critique, 10% Résistance Eau |
| Muldo Prune et Ébène | 149 | 33108 | Prune × Ébène | 1 PM, 6% Critique, 8% Résistance Air | 1 PM, 8% Critique, 10% Résistance Air |
| Muldo Prune et Doré | 150 | 33107 | Prune × Doré | 1 PM, 6% Critique, 40 Puissance | 1 PM, 8% Critique, 60 Puissance |
| Muldo Prune et Roux | 151 | 33114 | Prune × Roux | 1 PM, 6% Critique, 30 Tacle | 1 PM, 8% Critique, 40 Tacle |
| Muldo Prune et Amande | 152 | 33106 | Prune × Amande | 1 PM, 6% Critique, 30 Fuite | 1 PM, 8% Critique, 40 Fuite |
| Muldo Prune et Ivoire | 153 | 33111 | Prune × Ivoire | 1 PM, 6% Critique, 30 Esquive PA | 1 PM, 8% Critique, 40 Esquive PA |
| Muldo Prune et Turquoise | 154 | 33115 | Prune × Turquoise | 1 PM, 6% Critique, 30 Esquive PM | 1 PM, 8% Critique, 40 Esquive PM |
| Muldo Prune et Émeraude | 155 | 33109 | Prune × Émeraude | 1 PM, 6% Critique, 20 Dommages Critiques | 1 PM, 8% Critique, 30 Dommages Critiques |
| Muldo Pourpre et Émeraude | 156 | 33103 | Pourpre × Émeraude | 1 PM, 8% Résistance Terre, 20 Dommages Critiques | 1 PM, 10% Résistance Terre, 30 Dommages Critiques |
| Muldo Orchidée et Émeraude | 157 | 33098 | Orchidée × Émeraude | 1 PM, 8% Résistance Feu, 20 Dommages Critiques | 1 PM, 10% Résistance Feu, 30 Dommages Critiques |
| Muldo Indigo et Émeraude | 158 | 33090 | Indigo × Émeraude | 1 PM, 8% Résistance Eau, 20 Dommages Critiques | 1 PM, 10% Résistance Eau, 30 Dommages Critiques |
| Muldo Ébène et Émeraude | 159 | 33082 | Ébène × Émeraude | 1 PM, 8% Résistance Air, 20 Dommages Critiques | 1 PM, 10% Résistance Air, 30 Dommages Critiques |
| Muldo Doré et Émeraude | 160 | 33075 | Doré × Émeraude | 1 PM, 40 Puissance, 20 Dommages Critiques | 1 PM, 60 Puissance, 30 Dommages Critiques |
| Muldo Roux et Émeraude | 161 | 33120 | Roux × Émeraude | 1 PM, 30 Tacle, 20 Dommages Critiques | 1 PM, 40 Tacle, 30 Dommages Critiques |
| Muldo Amande et Émeraude | 162 | 33070 | Amande × Émeraude | 1 PM, 30 Fuite, 20 Dommages Critiques | 1 PM, 40 Fuite, 30 Dommages Critiques |
| Muldo Ivoire et Émeraude | 163 | 33095 | Ivoire × Émeraude | 1 PM, 30 Esquive PA, 20 Dommages Critiques | 1 PM, 40 Esquive PA, 30 Dommages Critiques |
| Muldo Turquoise et Émeraude | 164 | 33129 | Turquoise × Émeraude | 1 PM, 30 Esquive PM, 20 Dommages Critiques | 1 PM, 40 Esquive PM, 30 Dommages Critiques |

### Génération 9 (4 Muldos)

**Muldo Ambre** (id 297, objet 33255) — niv. 200 : 1 PM, 40 Dommages Terre — 5 croisements (confiance high : client officiel + DPLN) :

- Pourpre et Émeraude × Roux et Émeraude
- Orchidée et Émeraude × Amande et Émeraude
- Indigo et Émeraude × Ivoire et Émeraude
- Ébène et Émeraude × Turquoise et Émeraude
- Doré et Émeraude × Prune et Émeraude

**Muldo Corail** (id 298, objet 33256) — niv. 200 : 1 PM, 40 Dommages Feu — 5 croisements (confiance high : client officiel + DPLN) :

- Prune et Pourpre × Prune et Roux
- Prune et Orchidée × Prune et Amande
- Prune et Indigo × Prune et Ivoire
- Prune et Ébène × Prune et Turquoise
- Prune et Doré × Prune et Émeraude

**Muldo Azur** (id 299, objet 33257) — niv. 200 : 1 PM, 40 Dommages Eau — 5 croisements (confiance high : client officiel + DPLN) :

- Pourpre et Émeraude × Prune et Roux
- Orchidée et Émeraude × Prune et Amande
- Indigo et Émeraude × Prune et Ivoire
- Ébène et Émeraude × Prune et Turquoise
- Doré et Émeraude × Prune et Ivoire — *atypique mais présent dans le client officiel (confiance high)*

**Muldo Aigue-marine** (id 300, objet 33258) — niv. 200 : 1 PM, 40 Dommages Air — 5 croisements (confiance high : client officiel + DPLN) :

- Prune et Pourpre × Roux et Émeraude
- Prune et Orchidée × Amande et Émeraude
- Prune et Indigo × Ivoire et Émeraude
- Prune et Ébène × Turquoise et Émeraude
- Prune et Doré × Turquoise et Émeraude — *atypique mais présent dans le client officiel (confiance high)*


### Génération 10 (50 Muldos)

| Muldo | id monture | id objet | Croisement | Stats niv. 100 | Stats niv. 200 |
|---|---|---|---|---|---|
| Muldo Ambre et Doré | 301 | 33259 | Ambre × Doré | 1 PM, 20 Dommages Terre, 40 Puissance *(client)* | 1 PM, 30 Dommages Terre, 60 Puissance |
| Muldo Ambre et Ébène | 302 | 33260 | Ambre × Ébène | 1 PM, 20 Dommages Terre, 8% Résistance Air *(client)* | 1 PM, 30 Dommages Terre, 10% Résistance Air |
| Muldo Ambre et Indigo | 303 | 33261 | Ambre × Indigo | 1 PM, 20 Dommages Terre, 8% Résistance Eau *(client)* | 1 PM, 30 Dommages Terre, 10% Résistance Eau |
| Muldo Ambre et Pourpre | 304 | 33262 | Ambre × Pourpre | 1 PM, 20 Dommages Terre, 8% Résistance Terre *(client)* | 1 PM, 30 Dommages Terre, 10% Résistance Terre |
| Muldo Ambre et Orchidée | 305 | 33263 | Ambre × Orchidée | 1 PM, 20 Dommages Terre, 8% Résistance Feu *(client)* | 1 PM, 30 Dommages Terre, 10% Résistance Feu |
| Muldo Ambre et Amande | 306 | 33264 | Ambre × Amande | 1 PM, 20 Dommages Terre, 30 Fuite *(client)* | 1 PM, 30 Dommages Terre, 40 Fuite |
| Muldo Ambre et Roux | 307 | 33265 | Ambre × Roux | 1 PM, 20 Dommages Terre, 30 Tacle *(client)* | 1 PM, 30 Dommages Terre, 40 Tacle |
| Muldo Ambre et Ivoire | 308 | 33266 | Ambre × Ivoire | 1 PM, 20 Dommages Terre, 30 Esquive PA *(client)* | 1 PM, 30 Dommages Terre, 40 Esquive PA |
| Muldo Ambre et Turquoise | 309 | 33267 | Ambre × Turquoise | 1 PM, 20 Dommages Terre, 30 Esquive PM *(client)* | 1 PM, 30 Dommages Terre, 40 Esquive PM |
| Muldo Ambre et Émeraude | 310 | 33268 | Ambre × Émeraude | 1 PM, 20 Dommages Terre, 20 Dommages Critiques *(client)* | 1 PM, 30 Dommages Terre, 30 Dommages Critiques |
| Muldo Ambre et Prune | 311 | 33269 | Ambre × Prune | 1 PM, 20 Dommages Terre, 6% Critique *(client)* | 1 PM, 30 Dommages Terre, 8% Critique |
| Muldo Ambre et Corail | 312 | 33270 | Ambre × Corail | 1 PM, 20 Dommages Terre, 20 Dommages Feu *(client)* | 1 PM, 30 Dommages Terre, 30 Dommages Feu |
| Muldo Ambre et Azur | 313 | 33271 | Ambre × Azur | 1 PM, 20 Dommages Terre, 20 Dommages Eau *(client)* | 1 PM, 30 Dommages Terre, 30 Dommages Eau |
| Muldo Ambre et Aigue-marine | 314 | 33272 | Ambre × Aigue-marine | 1 PM, 20 Dommages Terre, 20 Dommages Air *(client)* | 1 PM, 30 Dommages Terre, 30 Dommages Air |
| Muldo Corail et Doré | 315 | 33273 | Corail × Doré | 1 PM, 20 Dommages Feu, 40 Puissance *(client)* | 1 PM, 30 Dommages Feu, 60 Puissance |
| Muldo Corail et Ébène | 316 | 33274 | Corail × Ébène | 1 PM, 20 Dommages Feu, 8% Résistance Air *(client)* | 1 PM, 30 Dommages Feu, 10% Résistance Air |
| Muldo Corail et Indigo | 317 | 33275 | Corail × Indigo | 1 PM, 20 Dommages Feu, 8% Résistance Eau *(client)* | 1 PM, 30 Dommages Feu, 10% Résistance Eau |
| Muldo Corail et Pourpre | 318 | 33276 | Corail × Pourpre | 1 PM, 20 Dommages Feu, 8% Résistance Terre *(client)* | 1 PM, 30 Dommages Feu, 10% Résistance Terre |
| Muldo Corail et Orchidée | 319 | 33277 | Corail × Orchidée | 1 PM, 20 Dommages Feu, 8% Résistance Feu *(client)* | 1 PM, 30 Dommages Feu, 10% Résistance Feu |
| Muldo Corail et Amande | 320 | 33278 | Corail × Amande | 1 PM, 20 Dommages Feu, 30 Fuite *(client)* | 1 PM, 30 Dommages Feu, 40 Fuite |
| Muldo Corail et Roux | 321 | 33279 | Corail × Roux | 1 PM, 20 Dommages Feu, 30 Tacle *(client)* | 1 PM, 30 Dommages Feu, 40 Tacle |
| Muldo Corail et Ivoire | 322 | 33280 | Corail × Ivoire | 1 PM, 20 Dommages Feu, 30 Esquive PA *(client)* | 1 PM, 30 Dommages Feu, 40 Esquive PA |
| Muldo Corail et Turquoise | 323 | 33281 | Corail × Turquoise | 1 PM, 20 Dommages Feu, 30 Esquive PM *(client)* | 1 PM, 30 Dommages Feu, 40 Esquive PM |
| Muldo Corail et Émeraude | 324 | 33282 | Corail × Émeraude | 1 PM, 20 Dommages Feu, 20 Dommages Critiques *(client)* | 1 PM, 30 Dommages Feu, 30 Dommages Critiques |
| Muldo Corail et Prune | 325 | 33283 | Corail × Prune | 1 PM, 20 Dommages Feu, 6% Critique *(client)* | 1 PM, 30 Dommages Feu, 8% Critique |
| Muldo Corail et Azur | 326 | 33284 | Corail × Azur | 1 PM, 20 Dommages Feu, 20 Dommages Eau *(client)* | 1 PM, 30 Dommages Feu, 30 Dommages Eau |
| Muldo Corail et Aigue-marine | 327 | 33285 | Corail × Aigue-marine | 1 PM, 20 Dommages Feu, 20 Dommages Air *(client)* | 1 PM, 30 Dommages Feu, 30 Dommages Air |
| Muldo Azur et Doré | 328 | 33286 | Azur × Doré | 1 PM, 20 Dommages Eau, 40 Puissance *(client)* | 1 PM, 30 Dommages Eau, 60 Puissance |
| Muldo Azur et Ébène | 329 | 33287 | Azur × Ébène | 1 PM, 20 Dommages Eau, 8% Résistance Air *(client)* | 1 PM, 30 Dommages Eau, 10% Résistance Air |
| Muldo Azur et Indigo | 330 | 33288 | Azur × Indigo | 1 PM, 20 Dommages Eau, 8% Résistance Eau *(client)* | 1 PM, 30 Dommages Eau, 10% Résistance Eau |
| Muldo Azur et Pourpre | 331 | 33289 | Azur × Pourpre | 1 PM, 20 Dommages Eau, 8% Résistance Terre *(client)* | 1 PM, 30 Dommages Eau, 10% Résistance Terre |
| Muldo Azur et Orchidée | 332 | 33290 | Azur × Orchidée | 1 PM, 20 Dommages Eau, 8% Résistance Feu *(client)* | 1 PM, 30 Dommages Eau, 10% Résistance Feu |
| Muldo Azur et Amande | 333 | 33291 | Azur × Amande | 1 PM, 20 Dommages Eau, 30 Fuite *(client)* | 1 PM, 30 Dommages Eau, 40 Fuite |
| Muldo Azur et Roux | 334 | 33292 | Azur × Roux | 1 PM, 20 Dommages Eau, 30 Tacle *(client)* | 1 PM, 30 Dommages Eau, 40 Tacle |
| Muldo Azur et Ivoire | 335 | 33293 | Azur × Ivoire | 1 PM, 20 Dommages Eau, 30 Esquive PA *(client)* | 1 PM, 30 Dommages Eau, 40 Esquive PA |
| Muldo Azur et Turquoise | 336 | 33294 | Azur × Turquoise | 1 PM, 20 Dommages Eau, 30 Esquive PM *(client)* | 1 PM, 30 Dommages Eau, 40 Esquive PM |
| Muldo Azur et Émeraude | 337 | 33295 | Azur × Émeraude | 1 PM, 20 Dommages Eau, 20 Dommages Critiques *(client)* | 1 PM, 30 Dommages Eau, 30 Dommages Critiques |
| Muldo Azur et Prune | 338 | 33296 | Azur × Prune | 1 PM, 20 Dommages Eau, 6% Critique *(client)* | 1 PM, 30 Dommages Eau, 8% Critique |
| Muldo Azur et Aigue-marine | 339 | 33297 | Azur × Aigue-marine | 1 PM, 20 Dommages Eau, 20 Dommages Air *(client)* | 1 PM, 30 Dommages Eau, 30 Dommages Air |
| Muldo Aigue-marine et Doré | 340 | 33298 | Aigue-marine × Doré | 1 PM, 20 Dommages Air, 40 Puissance *(client)* | 1 PM, 30 Dommages Air, 60 Puissance |
| Muldo Aigue-marine et Ébène | 341 | 33299 | Aigue-marine × Ébène | 1 PM, 20 Dommages Air, 8% Résistance Air *(client)* | 1 PM, 30 Dommages Air, 10% Résistance Air |
| Muldo Aigue-marine et Indigo | 342 | 33300 | Aigue-marine × Indigo | 1 PM, 20 Dommages Air, 8% Résistance Eau *(client)* | 1 PM, 30 Dommages Air, 10% Résistance Eau |
| Muldo Aigue-marine et Pourpre | 343 | 33301 | Aigue-marine × Pourpre | 1 PM, 20 Dommages Air, 8% Résistance Terre *(client)* | 1 PM, 30 Dommages Air, 10% Résistance Terre |
| Muldo Aigue-marine et Orchidée | 344 | 33302 | Aigue-marine × Orchidée | 1 PM, 20 Dommages Air, 8% Résistance Feu *(client)* | 1 PM, 30 Dommages Air, 10% Résistance Feu |
| Muldo Aigue-marine et Amande | 345 | 33303 | Aigue-marine × Amande | 1 PM, 20 Dommages Air, 30 Fuite *(client)* | 1 PM, 30 Dommages Air, 40 Fuite |
| Muldo Aigue-marine et Roux | 346 | 33304 | Aigue-marine × Roux | 1 PM, 20 Dommages Air, 30 Tacle *(client)* | 1 PM, 30 Dommages Air, 40 Tacle |
| Muldo Aigue-marine et Ivoire | 347 | 33305 | Aigue-marine × Ivoire | 1 PM, 20 Dommages Air, 30 Esquive PA *(client)* | 1 PM, 30 Dommages Air, 40 Esquive PA |
| Muldo Aigue-marine et Turquoise | 348 | 33306 | Aigue-marine × Turquoise | 1 PM, 20 Dommages Air, 30 Esquive PM *(client)* | 1 PM, 30 Dommages Air, 40 Esquive PM |
| Muldo Aigue-marine et Émeraude | 349 | 33307 | Aigue-marine × Émeraude | 1 PM, 20 Dommages Air, 20 Dommages Critiques *(client)* | 1 PM, 30 Dommages Air, 30 Dommages Critiques |
| Muldo Aigue-marine et Prune | 350 | 33308 | Aigue-marine × Prune | 1 PM, 20 Dommages Air, 6% Critique *(client)* | 1 PM, 30 Dommages Air, 8% Critique |

## 5. Statistiques et règle d'évolution avec le niveau

### 5.1 Caractéristique apportée par chaque couleur

Tous les Muldos donnent **1 PM** (effet 128). Chaque couleur ajoute une caractéristique ; un bicolore cumule les deux, avec des valeurs plus faibles qu'un monocolore.

| Couleur | Effet DofusDB | Caractéristique | Mono niv. 100 | Mono niv. 200 | Bi niv. 100 | Bi niv. 200 |
|---|---|---|---|---|---|---|
| Doré | 138 | Puissance | 50 | 70 | 40 | 60 |
| Pourpre | 210 | % Résistance Terre | 16 | 18 | 8 | 10 |
| Indigo | 211 | % Résistance Eau | 16 | 18 | 8 | 10 |
| Ébène | 212 | % Résistance Air | 16 | 18 | 8 | 10 |
| Orchidée | 213 | % Résistance Feu | 16 | 18 | 8 | 10 |
| Roux | 753 | Tacle | 40 | 50 | 30 | 40 |
| Amande | 752 | Fuite | 40 | 50 | 30 | 40 |
| Ivoire | 160 | Esquive PA | 40 | 50 | 30 | 40 |
| Turquoise | 161 | Esquive PM | 40 | 50 | 30 | 40 |
| Prune | 115 | % Critique | 10 | 12 | 6 | 8 |
| Émeraude | 418 | Dommages Critiques | 30 | 40 | 20 | 30 |
| Ambre | 422 | Dommages Terre | 30 *(client)* | 40 | 20 *(client)* | 30 |
| Corail | 424 | Dommages Feu | 30 *(client)* | 40 | 20 *(client)* | 30 |
| Azur | 426 | Dommages Eau | 30 *(client)* | 40 | 20 *(client)* | 30 |
| Aigue-marine | 428 | Dommages Air | 30 *(client)* | 40 | 20 *(client)* | 30 |
| (toutes) | 128 | PM | 1 | 1 | 1 | 1 |

### 5.2 Preuves

- **Niveau 100 = valeurs `diceSide` de DofusDB `/mounts`** (MountData, 66 Muldos). Ces valeurs sont celles de l'ancien niveau max (100). Le guide indique que « les statistiques de niveau 100 des montures ne changent pas » en 3.5 et donne l'exemple « Muldo Doré de niveau 100 : 1PM et 50 de puissance » = `diceSide` 50 de l'effet 138. Confiance high.
- **Niveau 200 = valeurs `diceNum` des objets monture 3.5** (DofusDB `items`, `typeId 332` « Muldo », 120 objets). L'exemple du guide « Muldo Doré niveau 200 : 1PM et 70 de puissance » correspond. Les 120 valeurs sont **identiques** aux stats affichées sur la page Muldos de DPLN (comparaison automatique, 0 écart). Confiance high.
- **Écart 100 → 200 identique pour monocolores et bicolores**, caractéristique par caractéristique (vérifié sur les 66 Muldos qui ont les deux sources) : Puissance +20, % Résistance +2, Tacle/Fuite/Esquive +10, % Critique +2, Dommages Critiques +10, PM +0.
- **Nouveaux Muldos G9/G10** : DofusDB `/mounts` ne les contient pas (ids 297-350 absents, re-vérifié le 2026-10-01), donc pas de valeur niveau 100 chez DofusDB. Les Dommages élémentaires niveau 100 avaient été **déduits** (30 mono / 20 bi) par analogie avec les Dommages Critiques ; **le client officiel le confirme** (`EvolutiveEffects` : 0,3/niveau mono, 0,2/niveau bi jusqu'au niveau 100, puis 0,1/niveau). Toutes les composantes des G9/G10 (Puissance 40, Tacle 30, etc.) sont confirmées de la même façon. Confiance **high** (relevée de low/medium).
- **Entre les paliers** (règle retenue pour `statsByLevel["1"]` et pour le calcul applicatif). Le client stocke pour chaque stat une progression par niveau `[[100, p1], [200, p2]]` (`EvolutiveEffects`, champ `progressionPerLevel` de chaque `statsRaw` du JSON) : `v(L) = floor(p1 × min(L,100) + p2 × max(0, L−100))`, ce qui équivaut à :
  - niveaux 1 à 100 : `v(L) = floor(v100 × L / 100)` ;
  - niveaux 100 à 200 : `v(L) = v100 + floor((v200 − v100) × (L − 100) / 100)`.

  La forme linéaire par morceaux est celle du client (high). L'arrondi à l'inférieur est cohérent avec la règle « Muldo : 1PM (à partir du niveau 100) » du guide (PM = 0,01/niveau) : avec un arrondi au plus proche, le PM apparaîtrait dès le niveau 50. Aucune mesure en jeu à un niveau intermédiaire n'a été trouvée : confiance **medium** pour l'arrondi (relevée de low). En code, utiliser `floor(x + 1e-6)` (0,01 en float32 × 100 donne 0,99999998). Le site dafous.app fait la même hypothèse linéaire, mais avec un arrondi au plus proche.
- Conséquence pratique : un Muldo ne donne son PM qu'à partir du niveau 100 (high, guide). Pour l'équiper, viser au moins le niveau 100.

## 6. Coût théorique minimal en captures (indicatif)

Calcul fait sur l'arbre : nombre minimal de Muldos G1 capturés pour obtenir **un** exemplaire de la couleur, et nombre d'accouplements. On suppose que chaque accouplement donne le bébé visé, sans clonage et sans tenir compte des sexes. C'est une borne basse : en pratique la génération cible sort avec une probabilité de 30 % à 100 % (§3), et le clonage permet de récupérer un parent fertile.

| Couleur | Gén. | Captures G1 min. | Accouplements min. | Recette la moins chère |
|---|---|---|---|---|
| Roux | 3 | 4 | 3 | Doré et Pourpre × Doré et Indigo (toute paire Doré-X/Doré-Y) |
| Amande | 3 | 4 | 3 | Indigo et Pourpre × Ébène et Orchidée (ou les 2 autres partitions) |
| Ivoire | 5 | 10 | 9 | Roux et Doré × Ébène et Amande |
| Turquoise | 5 | 10 | 9 | Doré et Amande × Roux et Ébène |
| Prune | 7 | 22 | 21 | Ébène et Ivoire × Turquoise et Pourpre |
| Émeraude | 7 | 25 | 24 | Turquoise et Amande × Doré et Ivoire |
| Corail | 9 | 49 | 48 | Prune et Pourpre × Prune et Roux |
| Azur | 9 | 52 | 51 | Pourpre et Émeraude × Prune et Roux |
| Aigue-marine | 9 | 52 | 51 | Prune et Pourpre × Roux et Émeraude |
| Ambre | 9 | 55 | 54 | Pourpre et Émeraude × Roux et Émeraude |
| G10 la moins chère | 10 | 50 | — | Corail et Doré (Corail × Doré) |
| G10 la plus chère | 10 | 107 | — | Ambre et Azur (Ambre × Azur) |

Aux générations 5 et 7 (Ivoire, Turquoise, Émeraude), les recettes à base de Doré (« Roux et Doré », « Doré et Amande », « Doré et Ivoire ») sont parmi les moins coûteuses. Ce n'est **pas** vrai en génération 9 : la recette avec Doré y est la plus chère (Corail : Prune et Doré × Prune et Émeraude = 70 captures contre 49 ; elle demande Prune **et** Émeraude). Les ex aequo existent (Ivoire et Turquoise : 4 recettes à 10 captures ; Émeraude : 2 à 25 ; Corail, Azur, Aigue-marine, Ambre : 2 chacune, la variante Pourpre/Roux ou Orchidée/Amande). Ce minimum suppose 1 bébé par accouplement : un parent Reproducteur (2 bébés) peut le réduire. L'optimiseur de l'application devra pondérer ce coût par les probabilités réelles (génération cible, niveau des parents, Optimakina) et par le prix HDV de chaque bicolore intermédiaire.

## 7. Variantes héritées (hors arbre)

- DofusDB `/mounts` contient 5 entrées « Sauvage » : Muldo Doré Sauvage (167), Pourpre Sauvage (168), Indigo Sauvage (169), Ébène Sauvage (170), Orchidée Sauvage (171). Ce sont des variantes de l'ancien système : avant la 3.5, une monture capturée était « sauvage ». Depuis la 3.5, « Quand vous capturez une monture, elle n'est plus sauvage mais directement de génération 1 » (guide). Elles sont listées dans `excludedLegacyVariants` et ne figurent pas dans `mounts`. Petite anomalie de données : la variante Pourpre Sauvage porte l'effet 213 (% Résistance Feu).
- Les objets `typeId 196` « Certificat de Muldo » (17874-17960) sont les anciens certificats, supprimés en 3.5. L'objet monture 3.5 est le `typeId 332` (`itemId` dans le JSON). C'est lui qui s'échange et se vend en HDV.
- Les montures possédées avant la 3.5 sont **séniles** : elles ne peuvent être ni accouplées ni clonées, et l'extraction ne donne qu'une ressource (guide).
- Monstres à capturer : Muldo doré / ébène / indigo / orchidée / pourpre sauvage (DofusDB monsters 4434-4438), niveau 62 à 70, Bassin des Muldos (Sufokia). Accès par [19,23] (scaphandre de l'atelier), [15,19] (barque) ou [22,19] (échelle) (DPLN).

## 8. Champs du JSON

Champs demandés : `family`, `familyId`, `maxGeneration`, `sources`, `notes`, `mounts[]` avec `name`, `dofusdbId`, `generation`, `capturable`, `colors`, `crossings`, `crossingsConfidence`, `statsRaw[]` (`effectId`, `characteristic`, `valueDofusDB`), `statsByLevel` (`"1"`, `"100"`, `"200"` ; **`"50"` et `"150"` ajoutés par la critique de complétude du 2026-10-02** avec la même règle `floor`, pour aligner les 3 arbres ; voir aussi les champs communs listés dans `harmonizedSchema` du JSON).

Précisions et champs ajoutés (sans modifier les champs demandés) :

- `dofusdbId` est l'id de monture du jeu (MountData). Pour les 54 nouveaux Muldos (297-350), l'endpoint DofusDB `/mounts` ne les expose pas encore : l'id vient des critères de succès DofusDB `EB>id`. Le champ `inDofusdbMountsEndpoint` (booléen) l'indique.
- `itemId` est l'objet monture 3.5 (`typeId 332`), à utiliser pour les prix HDV.
- `statsRaw[].valueDofusDB` est la valeur **niveau 200** (objet DofusDB). `valueDofusDBLevel`, `valueDofusDBSource`, `valueLevel100` et `valueLevel100Source` précisent l'origine de chaque valeur.
- `crossingsDetail[]` donne, pour chaque recette, `parents`, `confidence`, `note` et `sources`. `crossingsNotes[]` et `statsConfidence` (par niveau) complètent ces informations.
- Ajoutés à la vérification (mêmes noms que `tree-volkorne.json`, source client `RidesData` / `EvolutiveEffects`) : `statsRaw[].progressionPerLevel` (`[[100,p1],[200,p2]]`), `geneticWeight` (90 pour les monocolores G1/G3/G5/G7, 20 pour les bicolores et les monocolores G9), `extractionAmbresDeMuldo` (= génération, G1 = 0), `breederXpWhenParent` (30 × génération), `genetonsWhenParent` (`3.6.12.16` : 1/2/4/8/15/30/60/120/250/0 ; `3.7.3.3-beta` : 2/4/8/15/30/60/120/250/500/0), `clientDataSource` ; au niveau racine : `clientSpeciesId` (2), `statScaling.rule`, `statScaling.perLevelProgressionClient`, `statScaling.confidence`.
- Au niveau racine : `generatedAt`, `countsByGeneration`, `totalMounts`, `statScaling` (règle et écarts) et `excludedLegacyVariants`.

## 9. Sources

Système 3.5+ (utilisées pour l'arbre) :

0. **Client officiel Dofus 3** (ajouté à la vérification, source primaire) : version live 3.6.12.16 (`https://cytrus.cdn.ankama.com/dofus/releases/dofus3/linux/6.0_3.6.12.16.manifest`) et bêta 3.7.3.3. Tables `RidesData` (speciesId 2 = Muldo : génération, `parents` = tous les croisements, objet-monture lié, `geneticWeight`, extraction, génétons, XP) et `EvolutiveEffects` (progression des stats par niveau). Copies locales : `research/raw/dofus-client/rides-*.json`, `evolutive-effects-*.json` (extraction décrite dans `research/raw/dofus-client/README.md`).
1. Guide de l'éleveur DPLN, édition 2026 (MAJ 02/03/2026) — https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html — règles, exemples de stats, Émeraude = 8 croisements, 2 nouvelles générations Muldo.
2. DPLN « Les Muldos » (MAJ 06/03/2026) — https://www.dofuspourlesnoobs.com/les-muldos.html — liste des 120 Muldos, croisements et stats niveau 200 ; re-téléchargée le 2026-10-01 : identique au client.
3. DofusDB API (données de jeu, MAJ 2026-06-23) :
   - `achievements` 1490-1496, 9013, 9014 et `achievement-objectives` : générations et ids de monture ;
   - `items?typeId=332` : 120 objets Muldo, noms, stats niveau 200 ;
   - `mounts?familyId=5` : 71 MountData, stats niveau 100 ;
   - `effects`, `item-types` (332 = Muldo, 196 = Certificat de Muldo) ;
   - `recipes` (makinas Muldo G2-G10) ;
   - `monsters` 4434-4438.
4. guidactik.com — https://guidactik.com/dofus/guide-elevage-sur-dofus-extraction-et-genealogie-des-muldos/ — répartition par génération (identique aux succès), sans croisements.
5. dofuselevage.fr — https://dofuselevage.fr/tools/reproduction/muldo/genealogie — 120 recettes ; identique à DPLN sauf **Roux/Amande inversés** en G3 (relu le 2026-10-01 : « Amande — 6 recettes », « Roux — 3 recettes ») : erreur du site, le client donne Roux = 6.
6. dafous.app — https://dafous.app/elevage — croisements identiques à DPLN ; interpolation linéaire arrondie des stats.
7. dragodinde.fr — https://dragodinde.fr/guides/muldos — croisements identiques à DPLN (un seul croisement listé pour l'Aigue-marine).
8. GitHub tt405907/muldo-calculator et Bastien-Blando/elevage-tracker — mêmes données (un croisement par couleur, ou copie de DPLN).
9. DPLN « Mise à jour 3.6 » (20/06/2026) — https://www.dofuspourlesnoobs.com/mise-a-jour-306.html — rien sur l'arbre Muldo.
10. Devblog 3.7 (16/09/2026) — https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1771790-maj-3-7-confort-jeu-lisibilite-ajustements — pas de changement de croisement ; Optimakina +20 %, Animakina = choix du sexe, génétons augmentés.

Ancien système (pré-3.5, contexte uniquement, **non utilisé** pour l'arbre 3.5) :

- JOL « Les Muldos » — https://dofus.jeuxonline.info/article/13338/muldos — 8 générations, stats niveau 100 (50 Puissance, 16 % rés.), anciennes recettes (Roux = 2 bicolores Doré-X, Amande = bicolores sans Doré ; Ivoire = Roux/Amande + Amande/X ; Émeraude = Turquoise/Ivoire + Ivoire/X ; Prune = Turquoise/Ivoire + Turquoise/X), collisions génétiques, gestation 72 h.
- Outil DofusDB « Croisement Muldo » — https://dofusdb.fr/fr/tools/breeding/crossing/muldo — encore basé sur 66 Muldos / 8 générations / gestation 72 h.

Non consultable : encyclopédie dofus.com (protection Cloudflare, redirections en boucle).

## 10. Doutes et points à vérifier en jeu

1. ~~**Indépendance des sources de croisements.**~~ **Résolu à la vérification** : les données du client officiel (`RidesData.parents`) listent exactement les 57 croisements impairs et les 105 bicolores. Les recettes impaires passent en confiance **high**. L'Émeraude (8 recettes) est aussi corroborée par le texte du guide.
2. **Roux / Amande (G3).** dofuselevage.fr inverse les deux listes. DPLN, dafous.app, dragodinde.fr, muldo-calculator et l'ancien système placent les 6 recettes « Doré et X × Doré et Y » sur le **Roux**. **Le client officiel le confirme** (Roux, id 95 : 6 paires Doré-X ; Amande, id 96 : 3 paires disjointes) : point clos.
3. **Azur et Aigue-marine, 5e recette** (Doré et Émeraude × Prune et Ivoire ; Prune et Doré × Turquoise et Émeraude) : atypiques au regard du motif des autres recettes G9, **mais présentes dans le client officiel** : confiance **high**, point clos.
4. **Stats niveau 100 des G9/G10** (Dommages élémentaires) : non publiées par DofusDB `/mounts`, mais **confirmées par le client** (`EvolutiveEffects`) : point clos.
5. **Formule entre les niveaux** : pentes linéaires confirmées par le client ; seul l'**arrondi** (inférieur) reste non mesuré. Le confirmer en relevant en jeu un Muldo Doré aux niveaux 50 et 150 (valeurs attendues : 25 et 60 Puissance), et un Muldo Doré et Pourpre au niveau 1 à 2 (0,4 Puissance/niveau : attendu 0 au niveau 2, 1 au niveau 3 avec floor).
6. **Après la 3.5** : aucun changement de l'arbre (3.6 : rien ; **3.7** : devblog du 16/09/2026 sans changement de croisement, et client bêta 3.7.3.3 identique au live 3.6.12.16). La 3.7 change en revanche l'Optimakina (+20 %), l'Animakina (choix du sexe) et les génétons (≈ ×2) : à intégrer au simulateur quand la 3.7 sera live. Les données DofusDB objets/succès du 2026-06-23 sont cohérentes avec la 3.5.

## Vérification

Vérification adversariale faite le 2026-10-01 par un second agent. Elle confronte l'arbre à une source **indépendante de DPLN** : les tables du client officiel Dofus 3 (`research/raw/dofus-client/`, extraites du CDN Ankama, versions 3.6.12.16 live et 3.7.3.3 bêta). Elle re-télécharge aussi DofusDB, DPLN et dofuselevage.fr. Scripts de contrôle exécutés en Python, résultats ci-dessous.

### Ce qui a été vérifié (22 points)

| # | Point vérifié | Méthode / source | Résultat |
|---|---|---|---|
| 1 | JSON valide et forme demandée (`family`, `familyId`, `maxGeneration`, `sources`, `notes`, `mounts[]` avec `name`, `dofusdbId`, `generation`, `capturable`, `colors`, `crossings`, `crossingsConfidence`, `statsRaw[]` {`effectId`, `characteristic`, `valueDofusDB`}, `statsByLevel` {1, 100, 200}) | `json.load` + assertions | OK |
| 2 | 120 Muldos, ids = ids `RidesData` speciesId 2 du client | client 3.6.12.16 et 3.7.3.3-bêta | 120/120 identiques |
| 3 | Génération de chaque Muldo | client `RidesData.generation` | 120/120 identiques ; répartition 5/10/2/11/2/15/2/19/4/50 confirmée |
| 4 | `itemId` = objet-monture 3.5 | client `linkedItemGid` | 120/120 identiques |
| 5 | **Tous les croisements** (105 bicolores + 57 impairs = 162 paires) | client `RidesData.parents` (les deux versions) | **162/162 identiques**, y compris les 2 recettes « atypiques » de l'Azur et de l'Aigue-marine ; Roux 6 / Amande 3 / Ivoire 8 / Turquoise 8 / Prune 4 / Émeraude 8 / G9 5 chacun |
| 6 | Le champ `parents` du client = liste complète des croisements | cohérence `parents`/`children` (0 écart) ; Dragodindes : 1 croisement à toutes les générations, Volkornes : plusieurs aux générations impaires (conforme au guide) | interprétation confirmée |
| 7 | Page DPLN « Les Muldos » | re-téléchargée et re-parsée | « Dernière mise à jour le 06/03/2026 », « un total de 120 muldos » ; 120 générations et 162 croisements identiques à l'arbre |
| 8 | Inversion Roux/Amande de dofuselevage.fr | page re-téléchargée | confirmée (« Amande — 6 recettes », « Roux — 3 recettes ») ; contredite par le client : erreur du site |
| 9 | Succès de génération | DofusDB `achievements` 1490-1496, 9013, 9014 + `achievement-objectives` (critères `EB>id`), re-téléchargés | 10/2/11/2/15/2/19/4/50 montures ; chaque id présent dans l'arbre avec la bonne génération |
| 10 | DofusDB `/mounts` familyId 5 | dump `raw/mounts.json` + requête live | 71 entrées (66 + 5 « Sauvage ») ; 66 noms identiques ; aucun id ≥ 297 (DofusDB `/version` = 3.6.12.16) |
| 11 | Stats niveau 100 des 66 historiques | `effects.diceSide` | 66/66 identiques |
| 12 | Objets `typeId 332` | DofusDB `items` re-téléchargé | 120 objets ; 120 noms identiques ; niveau 200 = `diceNum` pour toutes les stats (les effets 3829-3835 sont des états de monture, pas des stats) |
| 13 | Stats niveau 100 et 200 des **120** Muldos | client `EvolutiveEffects` : p1 × 100 et (p1 + p2) × 100 | 0 écart ; les valeurs « déduites » des 54 nouveaux Muldos (Dommages élémentaires 30/20 au niveau 100) sont **exactes** |
| 14 | `statsByLevel["1"]` | floor(p1 × 1) | 0 partout, cohérent |
| 15 | Exemples du guide | guide DPLN | Doré 50 → 70 Puissance ; « 1PM à partir du niveau 100 » (client : 0,01/niveau) ; « 8 croisements » Émeraude ; Corail = G9 ; makina de génération ≥ génération cible |
| 16 | Structure | script | bicolore « X et Y » = X × Y, génération = max + 1 ; monocolore impair = 2 bicolores de n−1 ; aucune paire ne mène à deux enfants ; les C(15,2) = 105 bicolores existent ; `capturable` ⇔ G1 |
| 17 | Monstres à capturer | DofusDB `monsters` 4434-4438, `subareas/1119` | noms OK, niveaux 62-70, sous-zone « Bassin des Muldos » (zone « Baie de Sufokia ») |
| 18 | Variantes « Sauvage » et certificats | DofusDB `items` 17956-17960, `typeId 196` | correspondances OK ; `typeId 196` = 71 objets 17874-17960 ; anomalie effet 213 sur Pourpre Sauvage confirmée |
| 19 | Makinas Muldo G2 à G10 | `raw/items-eleveur.json` | Animakina, Kromakina et Optimakina de Génération 2 à 10 présentes |
| 20 | Tableau §6 (captures minimales) | recalcul récursif sur l'arbre | 12 lignes identiques (4/4/10/10/22/25/49/52/52/55 ; G10 50 et 107) |
| 21 | Changements après 3.5 | devblog 3.7 (16/09/2026) ; client bêta 3.7.3.3 | aucun changement de croisement ni de stat ; 3.7 change Optimakina (+20 %), Animakina, génétons |
| 22 | Valeurs client par génération | `RidesData` | `geneticWeight` 90 (mono G1/3/5/7) / 20 (bicolores, mono G9) ; extraction = génération (G1 = 0) ; XP = 30 × génération ; génétons 3.6 1/2/4/8/15/30/60/120/250/0 |

### Corrections apportées

**JSON (`research/data/tree-muldo.json`) :**

- **Croisements impairs : confiance `medium` → `high`** pour les 10 monocolores et leurs 57 `crossingsDetail`, dont les 2 croisements `low` de l'Azur et de l'Aigue-marine (`low` → `high`). Le client officiel les contient tous.
- Source client ajoutée en tête des `sources` des 162 `crossingsDetail`. Les notes ont été réécrites, y compris le désaccord Roux/Amande, désormais tranché.
- **Erreur corrigée** : pour les 54 nouveaux Muldos, chaque `valueLevel100Source` disait « valeur niveau 200 − 10 (même écart que Dommages Critiques) ». C'était faux pour la Puissance (écart 20), les % Résistance et le % Critique (écart 2). Les valeurs étaient justes. La source est maintenant le client `EvolutiveEffects` (p1 × 100).
- `statsConfidence` : `"100"` passe de `low` à `high` pour les 54 nouveaux ; `"1"` passe de `low` à `medium` pour les 120. La forme linéaire vient du client ; seul l'arrondi reste déduit.
- `statScaling` :
  - ajout de `rule`, `perLevelProgressionClient` et `confidence` ;
  - `deltaLevel100To200["Dommages Terre/Feu/Eau/Air"]` vaut maintenant 10 (avant : « déduit, non vérifié ») ;
  - textes des niveaux intermédiaires mis à jour.
- Ajouts par monture (mêmes noms que `tree-volkorne.json`) : `statsRaw[].progressionPerLevel`, `geneticWeight`, `extractionAmbresDeMuldo`, `breederXpWhenParent`, `genetonsWhenParent` (3.6.12.16 et 3.7.3.3-bêta), `clientDataSource`. À la racine : `clientSpeciesId`.
- `sources` : ajout du client 3.6.12.16 (source primaire), du client bêta 3.7.3.3 et du devblog 3.7. Descriptions DPLN, dofuselevage.fr et DofusDB `/mounts` mises à jour.
- `notes` :
  - **Erreur corrigée** : « aucune note 3.7 trouvée au 2026-10-01 ». Le devblog 3.7 du 16/09/2026 existe : il ne change pas l'arbre, mais modifie Optimakina, Animakina et génétons.
  - La note « croisements publiés uniquement par DPLN » est remplacée.
  - La note sur les G9/G10 niveau 100 est mise à jour.
  - Ajout de deux notes : champs client, et naissance hors croisement listé (couleur d'un parent ou grand-parent, génération cible via les grands-parents, exemple du guide).
- `crossingsNotes` des 5 G1 : « uniquement par capture » est nuancé. Une G1 peut aussi naître comme bébé hors génération cible d'un accouplement dont l'arbre contient sa couleur (guide DPLN).

**Markdown (ce fichier) :**

- §1 : confiance des générations impaires, des stats niveau 100 et de l'interpolation mise à jour.
- §3 : ajout du changement Optimakina +20 % de la 3.7 (bêta, confiance medium). La note sur les 5es recettes Azur/Aigue-marine passe de low à high.
- §4 : mentions « confiance medium » → « high » ; « atypique, à vérifier » → « atypique mais présent dans le client » ; *(déduit)* → *(client)*.
- §5 : stats G9/G10 confirmées ; règle `floor(p1 × min(L,100) + p2 × max(0, L−100))` ; conseil epsilon.
- §6 : **erreur corrigée**. La phrase « les recettes à base de Doré sont généralement les moins coûteuses » est fausse en génération 9 : la recette avec Doré y est la plus chère, par exemple 70 captures contre 49 pour le Corail. Les ex aequo et l'effet Reproducteur sont maintenant mentionnés.
- §8, §9, §10 : nouveaux champs, sources client et devblog 3.7. Doutes 1 à 4 clos ; doutes 5 et 6 mis à jour.

### Doutes restants

- **Arrondi entre les paliers** : l'arrondi inférieur n'a pas été mesuré en jeu. Il est déduit de « 1 PM à partir du niveau 100 ». Test proposé : Muldo Doré et Pourpre au niveau 2 (floor → 0 Puissance, arrondi au plus proche → 1).
- **Données client** : extraites par un autre agent (`research/raw/dofus-client/README.md`), pas re-téléchargées ici. Elles concordent toutefois point par point avec DofusDB (succès, objets, `/mounts`, stats) et avec DPLN, ce qui écarte une erreur d'extraction.
- **3.7** : les changements sont annoncés et présents en bêta, mais ne sont pas live au 2026-10-01. Valeurs à reconfirmer à la sortie.
- guidactik.com, dafous.app et dragodinde.fr n'ont pas été re-téléchargés : seuls DPLN et dofuselevage.fr l'ont été. Sans impact, le client faisant foi.

## Critique de complétude (2026-10-02)

Champs ajoutés au JSON pour aligner les trois arbres (aucune valeur existante modifiée ; tout est recalculé depuis `raw/dofus-client/rides-*.json` et `evolutive-effects-3.6.12.16.json`, puis revérifié contre le client : 0 écart) : `breedable` (false pour les spéciales G0), `extractionQty`, `captureMonsterId` (G1 capturables, DofusDB `monsters`), `statsRaw[].valueLevel100` / `valueLevel200` / `valueLevelsSource`, `harmonizedSchema` à la racine. Dragodindes en plus : `itemId` (68/68 vérifiés contre les noms DofusDB `items` typeId 331), `geneticWeight`, `extractionNeuronesDeDragodinde`, `breederXpWhenParent`, `genetonsWhenParent`, `equipMinLevel`, `statsConfidence`, `clientDataSource`, et à la racine `clientSpeciesId`, `countsByGeneration`, `totalMounts`, `totalBreedable`, `statScaling`, `excludedLegacyVariants`. Muldos en plus : `statsByLevel` aux niveaux 50 et 150, `equipMinLevel` (60, DofusDB items typeId 332). Index général et spécification consolidée : [`README.md`](README.md).
