# Arbre d'élevage des Volkornes (système 3.5+)

_Généré le 2026-10-01. Données machine : `research/data/tree-volkorne.json`. Toutes les affirmations ci-dessous portent une source et un niveau de confiance._

## 1. Résumé

| Élément | Valeur | Source | Confiance |
|---|---|---|---|
| Volkornes élevables (3.5+) | **120** (15 monocolores + 105 bicolores) | client Ankama 3.6.12.16 `RidesDataRoot` (speciesId 3), DofusDB items typeId 333 (120 objets), DPLN | high |
| Génération max | **10** | client ; succès DofusDB « Volkorne : Dixième génération » ; makinas Volkorne « de Génération 2 » à « 10 » (recettes Éleveur) | high |
| Capturables (G1) | Pourpre, Orchidée, Indigo, Ébène (4) | DofusDB monstres 5308/5309/5311/5313 (Haras de Brâkmar, sous-zone 886, niv. 62-70) ; succès 9015 « Prélèvement cornu » ; guide DPLN | high |
| Croisements | 157 au total : 105 bicolores (1 chacun) + 52 pour les 11 monocolores G3-G9 | client 3.6.12.16 = client 3.7.3.3-beta = DPLN = dafous.app | high |
| Stat commune | 1 PA à partir du niveau 100 | client (effet 111 : 0,01/niveau jusqu'à 100) ; guide DPLN | high |
| Niveau requis pour équiper | 60 | DofusDB items typeId 333 (level 60) ; DPLN | high |

### Pourquoi DofusDB liste 124 Volkornes

`/mounts?familyId=6` renvoie 124 entrées = **120 Volkornes élevables + 4 « Volkorne X Sauvage »** (ids 172-175 : Pourpre, Orchidée, Indigo, Ébène). Les 4 Sauvages n'ont aucun effet, n'existent ni dans la table `RidesDataRoot` du client 3.6/3.7 ni parmi les objets monture 3.5 (typeId 333) : ce sont des reliquats de l'ancien système où la capture donnait un « Sauvage » (certificats typeId 207 « Certificat de Volkorne », ids 19780 Pourpre, 19781 Indigo, 19783 Ébène, 19784 Orchidée ; 19782 est un autre objet). Depuis la 3.5, « Quand vous capturez une monture, elle n'est plus sauvage mais directement de génération 1 » (guide DPLN) et le succès de capture 9015 exige les objets G1 (33166, 33176, 33202, 33199). Les 120 = 15 couleurs + C(15,2) = 105 bicolores (toutes les paires de couleurs existent). Le chiffre « 124 races » figurait déjà dans l'annonce 2.47 de 2018 (JOL). Confiance : high.

## 2. Générations

| Gén. | Nb | Monocolores | Bicolores | Croisements par monture |
|---|---|---|---|---|
| 1 | 4 | Pourpre, Orchidée, Indigo, Ébène | — | capture uniquement |
| 2 | 6 | — | 6 bicolores | 1 (les deux monocolores du nom) |
| 3 | 4 | Roux, Amande, Ivoire, Turquoise | — | Roux : 3, Amande : 3, Ivoire : 3, Turquoise : 3 |
| 4 | 22 | — | 22 bicolores | 1 (les deux monocolores du nom) |
| 5 | 2 | Prune, Émeraude | — | Prune : 12, Émeraude : 12 |
| 6 | 17 | — | 17 bicolores | 1 (les deux monocolores du nom) |
| 7 | 1 | Doré | — | Doré : 8 |
| 8 | 10 | — | 10 bicolores | 1 (les deux monocolores du nom) |
| 9 | 4 | Jade, Rubis, Saphir, Améthyste | — | Jade : 2, Rubis : 2, Saphir : 2, Améthyste : 2 |
| 10 | 50 | — | 50 bicolores | 1 (les deux monocolores du nom) |

Sources : client 3.6.12.16 (`generation`), succès DofusDB 1684-1692 (objectifs `EB>idMonture`, 116/116 concordants), DPLN les-volkornes.html (120/120 concordants). Confiance : high.

**Règle des bicolores** : « Volkorne X et Y » s'obtient uniquement en croisant « Volkorne X » et « Volkorne Y » ; sa génération = max(gén. X, gén. Y) + 1 (vérifié sur les 105). Ex. Amande et Roux = G4 (3+1), Prune et Émeraude = G6, Jade et Rubis = G10.

## 3. Générations impaires : TOUS les croisements possibles

Le guide DPLN indique que pour Muldos et Volkornes les générations impaires peuvent avoir plusieurs croisements (l'interface « Génétique » n'en montre qu'un par défaut). La liste ci-dessous est la liste complète du client (`parents[]`), identique à DPLN et à dafous.app.

### Volkorne Roux (G3) — 3 croisement(s), minimum théorique 4 captures

| # | Parent A | Parent B | Gén. parents | Captures min. |
|---|---|---|---|---|
| 1 | Pourpre et Orchidée | Pourpre et Indigo | G2 + G2 | 4 |
| 2 | Pourpre et Orchidée | Pourpre et Ébène | G2 + G2 | 4 |
| 3 | Pourpre et Indigo | Pourpre et Ébène | G2 + G2 | 4 |

### Volkorne Amande (G3) — 3 croisement(s), minimum théorique 4 captures

| # | Parent A | Parent B | Gén. parents | Captures min. |
|---|---|---|---|---|
| 1 | Pourpre et Ébène | Orchidée et Ébène | G2 + G2 | 4 |
| 2 | Pourpre et Ébène | Indigo et Ébène | G2 + G2 | 4 |
| 3 | Orchidée et Ébène | Indigo et Ébène | G2 + G2 | 4 |

### Volkorne Ivoire (G3) — 3 croisement(s), minimum théorique 4 captures

| # | Parent A | Parent B | Gén. parents | Captures min. |
|---|---|---|---|---|
| 1 | Pourpre et Indigo | Indigo et Ébène | G2 + G2 | 4 |
| 2 | Pourpre et Indigo | Orchidée et Indigo | G2 + G2 | 4 |
| 3 | Orchidée et Indigo | Indigo et Ébène | G2 + G2 | 4 |

### Volkorne Turquoise (G3) — 3 croisement(s), minimum théorique 4 captures

| # | Parent A | Parent B | Gén. parents | Captures min. |
|---|---|---|---|---|
| 1 | Pourpre et Orchidée | Orchidée et Ébène | G2 + G2 | 4 |
| 2 | Orchidée et Indigo | Orchidée et Ébène | G2 + G2 | 4 |
| 3 | Pourpre et Orchidée | Orchidée et Indigo | G2 + G2 | 4 |

### Volkorne Prune (G5) — 12 croisement(s), minimum théorique 13 captures

| # | Parent A | Parent B | Gén. parents | Captures min. |
|---|---|---|---|---|
| 1 | Amande et Pourpre | Amande et Roux | G4 + G4 | 13 |
| 2 | Amande et Orchidée | Amande et Roux | G4 + G4 | 13 |
| 3 | Amande et Indigo | Amande et Roux | G4 + G4 | 13 |
| 4 | Amande et Ébène | Amande et Roux | G4 + G4 | 13 |
| 5 | Amande et Roux | Amande et Turquoise | G4 + G4 | 16 |
| 6 | Amande et Roux | Amande et Ivoire | G4 + G4 | 16 |
| 7 | Amande et Roux | Roux et Pourpre | G4 + G4 | 13 |
| 8 | Amande et Roux | Roux et Orchidée | G4 + G4 | 13 |
| 9 | Amande et Roux | Roux et Indigo | G4 + G4 | 13 |
| 10 | Amande et Roux | Roux et Ébène | G4 + G4 | 13 |
| 11 | Amande et Roux | Roux et Ivoire | G4 + G4 | 16 |
| 12 | Amande et Roux | Roux et Turquoise | G4 + G4 | 16 |

### Volkorne Émeraude (G5) — 12 croisement(s), minimum théorique 13 captures

| # | Parent A | Parent B | Gén. parents | Captures min. |
|---|---|---|---|---|
| 1 | Ivoire et Orchidée | Ivoire et Turquoise | G4 + G4 | 13 |
| 2 | Ivoire et Indigo | Ivoire et Turquoise | G4 + G4 | 13 |
| 3 | Ivoire et Ébène | Ivoire et Turquoise | G4 + G4 | 13 |
| 4 | Ivoire et Turquoise | Turquoise et Orchidée | G4 + G4 | 13 |
| 5 | Ivoire et Pourpre | Ivoire et Turquoise | G4 + G4 | 13 |
| 6 | Roux et Ivoire | Ivoire et Turquoise | G4 + G4 | 16 |
| 7 | Roux et Turquoise | Ivoire et Turquoise | G4 + G4 | 16 |
| 8 | Amande et Turquoise | Ivoire et Turquoise | G4 + G4 | 16 |
| 9 | Amande et Ivoire | Ivoire et Turquoise | G4 + G4 | 16 |
| 10 | Ivoire et Turquoise | Turquoise et Pourpre | G4 + G4 | 13 |
| 11 | Ivoire et Turquoise | Turquoise et Indigo | G4 + G4 | 13 |
| 12 | Ivoire et Turquoise | Turquoise et Ébène | G4 + G4 | 13 |

### Volkorne Doré (G7) — 8 croisement(s), minimum théorique 31 captures

| # | Parent A | Parent B | Gén. parents | Captures min. |
|---|---|---|---|---|
| 1 | Prune et Pourpre | Émeraude et Roux | G6 + G6 | 31 |
| 2 | Prune et Orchidée | Émeraude et Turquoise | G6 + G6 | 31 |
| 3 | Prune et Indigo | Émeraude et Ivoire | G6 + G6 | 31 |
| 4 | Prune et Ébène | Émeraude et Amande | G6 + G6 | 31 |
| 5 | Prune et Amande | Émeraude et Ébène | G6 + G6 | 31 |
| 6 | Prune et Turquoise | Émeraude et Orchidée | G6 + G6 | 31 |
| 7 | Émeraude et Pourpre | Prune et Roux | G6 + G6 | 31 |
| 8 | Émeraude et Indigo | Prune et Ivoire | G6 + G6 | 31 |

### Volkorne Jade (G9) — 2 croisement(s), minimum théorique 58 captures

| # | Parent A | Parent B | Gén. parents | Captures min. |
|---|---|---|---|---|
| 1 | Prune et Émeraude | Doré et Pourpre | G6 + G8 | 58 |
| 2 | Doré et Roux | Doré et Prune | G8 + G8 | 79 |

### Volkorne Rubis (G9) — 2 croisement(s), minimum théorique 58 captures

| # | Parent A | Parent B | Gén. parents | Captures min. |
|---|---|---|---|---|
| 1 | Prune et Émeraude | Doré et Orchidée | G6 + G8 | 58 |
| 2 | Doré et Amande | Doré et Prune | G8 + G8 | 79 |

### Volkorne Saphir (G9) — 2 croisement(s), minimum théorique 58 captures

| # | Parent A | Parent B | Gén. parents | Captures min. |
|---|---|---|---|---|
| 1 | Prune et Émeraude | Doré et Indigo | G6 + G8 | 58 |
| 2 | Doré et Turquoise | Doré et Émeraude | G8 + G8 | 79 |

### Volkorne Améthyste (G9) — 2 croisement(s), minimum théorique 58 captures

| # | Parent A | Parent B | Gén. parents | Captures min. |
|---|---|---|---|---|
| 1 | Prune et Émeraude | Doré et Ébène | G6 + G8 | 58 |
| 2 | Doré et Ivoire | Doré et Émeraude | G8 + G8 | 79 |

**Lecture des motifs** (déduits des données, utiles pour l'optimiseur) :

- G3 : chaque couleur est associée à une couleur G1 — Roux↔Pourpre, Amande↔Ébène, Ivoire↔Indigo, Turquoise↔Orchidée ; on croise deux bicolores G2 *différents* contenant cette couleur G1 (3 paires possibles).
- G5 : Prune = « Amande et Roux » + tout autre bicolore G4 contenant Amande ou Roux ; Émeraude = « Ivoire et Turquoise » + tout autre bicolore G4 contenant Ivoire ou Turquoise. Ces deux bicolores sont des **pivots** indispensables.
- G7 : Doré = « Prune et X » + « Émeraude et Y » où (X, Y) est un couple G1/G3 associé (Pourpre/Roux, Orchidée/Turquoise, Indigo/Ivoire, Ébène/Amande, dans les deux sens).
- G9 : chaque gemme a 2 recettes : « Prune et Émeraude » + « Doré et (Pourpre|Orchidée|Indigo|Ébène) », ou deux bicolores Doré G8. La première est la moins chère (58 captures contre 79).
- Une même paire de couleurs parents (A, B) n'apparaît que dans un seul croisement (vérifié sur les 157). **Correction du vérificateur** : cela ne veut pas dire qu'un accouplement réel n'a qu'une seule issue de génération cible. La couleur du bébé dépend aussi des grands-parents, donc un accouplement peut avoir plusieurs possibilités de génération cible, et les 30 % (+ bonus) se répartissent alors entre elles (guide DPLN, exemple Muldo : 30,3 % / 2 = 15,15 % ; « les 3 types de montures s'élèvent exactement de la même façon »). Confiance : high.

`minCapturesIdeal` = nombre minimal de Volkornes **G1** (et non de captures : un Filet multiplicateur en donne 2 par capture) pour obtenir 1 exemplaire, en supposant que chaque accouplement donne la génération cible. C'est un calcul de ce fichier, pas une donnée du jeu, et il ignore le sexe (chaque accouplement exige un mâle et une femelle). **Ce n'est une borne basse que sans clonage et sans capacité Reproducteur.** Le clonage (2 stériles de même génération -> 1 fertile, guide DPLN) peut faire descendre le besoin réel en dessous : par exemple, Roux peut s'obtenir avec 3 G1 au lieu de 4 si le clone rendu est le bon parent. En jeu, la génération cible n'a que 30 % de base, + 0,15 % par niveau cumulé des parents, + 10 % avec Optimakina, + 20 % le jour Almanax Takeza (guide DPLN). Le besoin moyen réel est donc bien supérieur.

## 4. Bicolores (105) — croisement unique

| Gén. | Bicolore | Parents | Stats niv. 100 | Stats niv. 200 |
|---|---|---|---|---|
| 2 | Pourpre et Orchidée | Pourpre + Orchidée | 1 PA, 50 Force, 50 Intelligence | 1 PA, 70 Force, 70 Intelligence |
| 2 | Pourpre et Indigo | Indigo + Pourpre | 1 PA, 50 Force, 50 Chance | 1 PA, 70 Force, 70 Chance |
| 2 | Pourpre et Ébène | Ébène + Pourpre | 1 PA, 50 Force, 50 Agilité | 1 PA, 70 Force, 70 Agilité |
| 2 | Orchidée et Indigo | Indigo + Orchidée | 1 PA, 50 Intelligence, 50 Chance | 1 PA, 70 Intelligence, 70 Chance |
| 2 | Orchidée et Ébène | Ébène + Orchidée | 1 PA, 50 Intelligence, 50 Agilité | 1 PA, 70 Intelligence, 70 Agilité |
| 2 | Indigo et Ébène | Indigo + Ébène | 1 PA, 50 Chance, 50 Agilité | 1 PA, 70 Chance, 70 Agilité |
| 4 | Roux et Pourpre | Pourpre + Roux | 1 PA, 50 Force, 40 Dommages Poussée | 1 PA, 70 Force, 50 Dommages Poussée |
| 4 | Roux et Orchidée | Orchidée + Roux | 1 PA, 50 Intelligence, 40 Dommages Poussée | 1 PA, 70 Intelligence, 50 Dommages Poussée |
| 4 | Roux et Indigo | Indigo + Roux | 1 PA, 50 Chance, 40 Dommages Poussée | 1 PA, 70 Chance, 50 Dommages Poussée |
| 4 | Roux et Ébène | Ébène + Roux | 1 PA, 50 Agilité, 40 Dommages Poussée | 1 PA, 70 Agilité, 50 Dommages Poussée |
| 4 | Roux et Ivoire | Roux + Ivoire | 1 PA, 20 Retrait PA, 40 Dommages Poussée | 1 PA, 30 Retrait PA, 50 Dommages Poussée |
| 4 | Roux et Turquoise | Roux + Turquoise | 1 PA, 20 Retrait PM, 40 Dommages Poussée | 1 PA, 30 Retrait PM, 50 Dommages Poussée |
| 4 | Amande et Pourpre | Pourpre + Amande | 1 PA, 50 Force, 60 Résistances Poussée | 1 PA, 70 Force, 70 Résistances Poussée |
| 4 | Amande et Orchidée | Orchidée + Amande | 1 PA, 50 Intelligence, 60 Résistances Poussée | 1 PA, 70 Intelligence, 70 Résistances Poussée |
| 4 | Amande et Indigo | Indigo + Amande | 1 PA, 50 Chance, 60 Résistances Poussée | 1 PA, 70 Chance, 70 Résistances Poussée |
| 4 | Amande et Ébène | Ébène + Amande | 1 PA, 50 Agilité, 60 Résistances Poussée | 1 PA, 70 Agilité, 70 Résistances Poussée |
| 4 | Amande et Roux | Roux + Amande | 1 PA, 40 Dommages Poussée, 60 Résistances Poussée | 1 PA, 50 Dommages Poussée, 70 Résistances Poussée |
| 4 | Amande et Ivoire | Amande + Ivoire | 1 PA, 20 Retrait PA, 60 Résistances Poussée | 1 PA, 30 Retrait PA, 70 Résistances Poussée |
| 4 | Amande et Turquoise | Amande + Turquoise | 1 PA, 20 Retrait PM, 60 Résistances Poussée | 1 PA, 30 Retrait PM, 70 Résistances Poussée |
| 4 | Ivoire et Pourpre | Pourpre + Ivoire | 1 PA, 50 Force, 20 Retrait PA | 1 PA, 70 Force, 30 Retrait PA |
| 4 | Ivoire et Orchidée | Orchidée + Ivoire | 1 PA, 50 Intelligence, 20 Retrait PA | 1 PA, 70 Intelligence, 30 Retrait PA |
| 4 | Ivoire et Indigo | Indigo + Ivoire | 1 PA, 50 Chance, 20 Retrait PA | 1 PA, 70 Chance, 30 Retrait PA |
| 4 | Ivoire et Ébène | Ébène + Ivoire | 1 PA, 50 Agilité, 20 Retrait PA | 1 PA, 70 Agilité, 30 Retrait PA |
| 4 | Ivoire et Turquoise | Ivoire + Turquoise | 1 PA, 20 Retrait PA, 20 Retrait PM | 1 PA, 30 Retrait PA, 30 Retrait PM |
| 4 | Turquoise et Pourpre | Pourpre + Turquoise | 1 PA, 50 Force, 20 Retrait PM | 1 PA, 70 Force, 30 Retrait PM |
| 4 | Turquoise et Orchidée | Orchidée + Turquoise | 1 PA, 50 Intelligence, 20 Retrait PM | 1 PA, 70 Intelligence, 30 Retrait PM |
| 4 | Turquoise et Indigo | Indigo + Turquoise | 1 PA, 50 Chance, 20 Retrait PM | 1 PA, 70 Chance, 30 Retrait PM |
| 4 | Turquoise et Ébène | Ébène + Turquoise | 1 PA, 50 Agilité, 20 Retrait PM | 1 PA, 70 Agilité, 30 Retrait PM |
| 6 | Prune et Pourpre | Pourpre + Prune | 1 PA, 50 Force, 35 Résistances Critiques | 1 PA, 70 Force, 45 Résistances Critiques |
| 6 | Prune et Orchidée | Orchidée + Prune | 1 PA, 50 Intelligence, 35 Résistances Critiques | 1 PA, 70 Intelligence, 45 Résistances Critiques |
| 6 | Prune et Indigo | Indigo + Prune | 1 PA, 50 Chance, 35 Résistances Critiques | 1 PA, 70 Chance, 45 Résistances Critiques |
| 6 | Prune et Ébène | Ébène + Prune | 1 PA, 50 Agilité, 35 Résistances Critiques | 1 PA, 70 Agilité, 45 Résistances Critiques |
| 6 | Prune et Roux | Roux + Prune | 1 PA, 35 Résistances Critiques, 40 Dommages Poussée | 1 PA, 45 Résistances Critiques, 50 Dommages Poussée |
| 6 | Prune et Amande | Amande + Prune | 1 PA, 35 Résistances Critiques, 60 Résistances Poussée | 1 PA, 45 Résistances Critiques, 70 Résistances Poussée |
| 6 | Prune et Ivoire | Ivoire + Prune | 1 PA, 20 Retrait PA, 35 Résistances Critiques | 1 PA, 30 Retrait PA, 45 Résistances Critiques |
| 6 | Prune et Turquoise | Turquoise + Prune | 1 PA, 20 Retrait PM, 35 Résistances Critiques | 1 PA, 30 Retrait PM, 45 Résistances Critiques |
| 6 | Prune et Émeraude | Prune + Émeraude | 1 PA, 5 % Critique, 35 Résistances Critiques | 1 PA, 7 % Critique, 45 Résistances Critiques |
| 6 | Émeraude et Pourpre | Pourpre + Émeraude | 1 PA, 50 Force, 5 % Critique | 1 PA, 70 Force, 7 % Critique |
| 6 | Émeraude et Orchidée | Orchidée + Émeraude | 1 PA, 50 Intelligence, 5 % Critique | 1 PA, 70 Intelligence, 7 % Critique |
| 6 | Émeraude et Indigo | Indigo + Émeraude | 1 PA, 50 Chance, 5 % Critique | 1 PA, 70 Chance, 7 % Critique |
| 6 | Émeraude et Ébène | Ébène + Émeraude | 1 PA, 50 Agilité, 5 % Critique | 1 PA, 70 Agilité, 7 % Critique |
| 6 | Émeraude et Roux | Roux + Émeraude | 1 PA, 5 % Critique, 40 Dommages Poussée | 1 PA, 7 % Critique, 50 Dommages Poussée |
| 6 | Émeraude et Amande | Amande + Émeraude | 1 PA, 5 % Critique, 60 Résistances Poussée | 1 PA, 7 % Critique, 70 Résistances Poussée |
| 6 | Émeraude et Ivoire | Ivoire + Émeraude | 1 PA, 5 % Critique, 20 Retrait PA | 1 PA, 7 % Critique, 30 Retrait PA |
| 6 | Émeraude et Turquoise | Turquoise + Émeraude | 1 PA, 5 % Critique, 20 Retrait PM | 1 PA, 7 % Critique, 30 Retrait PM |
| 8 | Doré et Pourpre | Pourpre + Doré | 1 PA, 100 Vitalité, 50 Force | 1 PA, 200 Vitalité, 70 Force |
| 8 | Doré et Orchidée | Orchidée + Doré | 1 PA, 100 Vitalité, 50 Intelligence | 1 PA, 200 Vitalité, 70 Intelligence |
| 8 | Doré et Indigo | Indigo + Doré | 1 PA, 100 Vitalité, 50 Chance | 1 PA, 200 Vitalité, 70 Chance |
| 8 | Doré et Ébène | Ébène + Doré | 1 PA, 100 Vitalité, 50 Agilité | 1 PA, 200 Vitalité, 70 Agilité |
| 8 | Doré et Roux | Roux + Doré | 1 PA, 100 Vitalité, 40 Dommages Poussée | 1 PA, 200 Vitalité, 50 Dommages Poussée |
| 8 | Doré et Amande | Amande + Doré | 1 PA, 100 Vitalité, 60 Résistances Poussée | 1 PA, 200 Vitalité, 70 Résistances Poussée |
| 8 | Doré et Ivoire | Ivoire + Doré | 1 PA, 100 Vitalité, 20 Retrait PA | 1 PA, 200 Vitalité, 30 Retrait PA |
| 8 | Doré et Turquoise | Turquoise + Doré | 1 PA, 100 Vitalité, 20 Retrait PM | 1 PA, 200 Vitalité, 30 Retrait PM |
| 8 | Doré et Prune | Prune + Doré | 1 PA, 100 Vitalité, 35 Résistances Critiques | 1 PA, 200 Vitalité, 45 Résistances Critiques |
| 8 | Doré et Émeraude | Émeraude + Doré | 1 PA, 100 Vitalité, 5 % Critique | 1 PA, 200 Vitalité, 7 % Critique |
| 10 | Jade et Pourpre | Pourpre + Jade | 1 PA, 50 Force, 6 % Résistance Terre | 1 PA, 70 Force, 8 % Résistance Terre |
| 10 | Jade et Orchidée | Orchidée + Jade | 1 PA, 50 Intelligence, 6 % Résistance Terre | 1 PA, 70 Intelligence, 8 % Résistance Terre |
| 10 | Jade et Indigo | Indigo + Jade | 1 PA, 50 Chance, 6 % Résistance Terre | 1 PA, 70 Chance, 8 % Résistance Terre |
| 10 | Jade et Ébène | Ébène + Jade | 1 PA, 50 Agilité, 6 % Résistance Terre | 1 PA, 70 Agilité, 8 % Résistance Terre |
| 10 | Jade et Roux | Roux + Jade | 1 PA, 6 % Résistance Terre, 40 Dommages Poussée | 1 PA, 8 % Résistance Terre, 50 Dommages Poussée |
| 10 | Jade et Amande | Amande + Jade | 1 PA, 6 % Résistance Terre, 60 Résistances Poussée | 1 PA, 8 % Résistance Terre, 70 Résistances Poussée |
| 10 | Jade et Ivoire | Ivoire + Jade | 1 PA, 6 % Résistance Terre, 20 Retrait PA | 1 PA, 8 % Résistance Terre, 30 Retrait PA |
| 10 | Jade et Turquoise | Turquoise + Jade | 1 PA, 6 % Résistance Terre, 20 Retrait PM | 1 PA, 8 % Résistance Terre, 30 Retrait PM |
| 10 | Jade et Prune | Prune + Jade | 1 PA, 6 % Résistance Terre, 35 Résistances Critiques | 1 PA, 8 % Résistance Terre, 45 Résistances Critiques |
| 10 | Jade et Émeraude | Émeraude + Jade | 1 PA, 5 % Critique, 6 % Résistance Terre | 1 PA, 7 % Critique, 8 % Résistance Terre |
| 10 | Jade et Doré | Doré + Jade | 1 PA, 100 Vitalité, 6 % Résistance Terre | 1 PA, 200 Vitalité, 8 % Résistance Terre |
| 10 | Jade et Rubis | Jade + Rubis | 1 PA, 6 % Résistance Terre, 6 % Résistance Feu | 1 PA, 8 % Résistance Terre, 8 % Résistance Feu |
| 10 | Jade et Saphir | Jade + Saphir | 1 PA, 6 % Résistance Terre, 6 % Résistance Eau | 1 PA, 8 % Résistance Terre, 8 % Résistance Eau |
| 10 | Jade et Améthyste | Jade + Améthyste | 1 PA, 6 % Résistance Terre, 6 % Résistance Air | 1 PA, 8 % Résistance Terre, 8 % Résistance Air |
| 10 | Rubis et Pourpre | Pourpre + Rubis | 1 PA, 50 Force, 6 % Résistance Feu | 1 PA, 70 Force, 8 % Résistance Feu |
| 10 | Rubis et Orchidée | Orchidée + Rubis | 1 PA, 50 Intelligence, 6 % Résistance Feu | 1 PA, 70 Intelligence, 8 % Résistance Feu |
| 10 | Rubis et Indigo | Indigo + Rubis | 1 PA, 50 Chance, 6 % Résistance Feu | 1 PA, 70 Chance, 8 % Résistance Feu |
| 10 | Rubis et Ébène | Ébène + Rubis | 1 PA, 50 Agilité, 6 % Résistance Feu | 1 PA, 70 Agilité, 8 % Résistance Feu |
| 10 | Rubis et Roux | Roux + Rubis | 1 PA, 6 % Résistance Feu, 40 Dommages Poussée | 1 PA, 8 % Résistance Feu, 50 Dommages Poussée |
| 10 | Rubis et Amande | Amande + Rubis | 1 PA, 6 % Résistance Feu, 60 Résistances Poussée | 1 PA, 8 % Résistance Feu, 70 Résistances Poussée |
| 10 | Rubis et Ivoire | Ivoire + Rubis | 1 PA, 6 % Résistance Feu, 20 Retrait PA | 1 PA, 8 % Résistance Feu, 30 Retrait PA |
| 10 | Rubis et Turquoise | Turquoise + Rubis | 1 PA, 6 % Résistance Feu, 20 Retrait PM | 1 PA, 8 % Résistance Feu, 30 Retrait PM |
| 10 | Rubis et Prune | Prune + Rubis | 1 PA, 6 % Résistance Feu, 35 Résistances Critiques | 1 PA, 8 % Résistance Feu, 45 Résistances Critiques |
| 10 | Rubis et Émeraude | Émeraude + Rubis | 1 PA, 5 % Critique, 6 % Résistance Feu | 1 PA, 7 % Critique, 8 % Résistance Feu |
| 10 | Rubis et Doré | Doré + Rubis | 1 PA, 100 Vitalité, 6 % Résistance Feu | 1 PA, 200 Vitalité, 8 % Résistance Feu |
| 10 | Rubis et Saphir | Rubis + Saphir | 1 PA, 6 % Résistance Feu, 6 % Résistance Eau | 1 PA, 8 % Résistance Feu, 8 % Résistance Eau |
| 10 | Rubis et Améthyste | Rubis + Améthyste | 1 PA, 6 % Résistance Feu, 6 % Résistance Air | 1 PA, 8 % Résistance Feu, 8 % Résistance Air |
| 10 | Saphir et Pourpre | Pourpre + Saphir | 1 PA, 50 Force, 6 % Résistance Eau | 1 PA, 70 Force, 8 % Résistance Eau |
| 10 | Saphir et Orchidée | Orchidée + Saphir | 1 PA, 50 Intelligence, 6 % Résistance Eau | 1 PA, 70 Intelligence, 8 % Résistance Eau |
| 10 | Saphir et Indigo | Indigo + Saphir | 1 PA, 50 Chance, 6 % Résistance Eau | 1 PA, 70 Chance, 8 % Résistance Eau |
| 10 | Saphir et Ébène | Ébène + Saphir | 1 PA, 50 Agilité, 6 % Résistance Eau | 1 PA, 70 Agilité, 8 % Résistance Eau |
| 10 | Saphir et Roux | Roux + Saphir | 1 PA, 6 % Résistance Eau, 40 Dommages Poussée | 1 PA, 8 % Résistance Eau, 50 Dommages Poussée |
| 10 | Saphir et Amande | Amande + Saphir | 1 PA, 6 % Résistance Eau, 60 Résistances Poussée | 1 PA, 8 % Résistance Eau, 70 Résistances Poussée |
| 10 | Saphir et Ivoire | Ivoire + Saphir | 1 PA, 6 % Résistance Eau, 20 Retrait PA | 1 PA, 8 % Résistance Eau, 30 Retrait PA |
| 10 | Saphir et Turquoise | Turquoise + Saphir | 1 PA, 6 % Résistance Eau, 20 Retrait PM | 1 PA, 8 % Résistance Eau, 30 Retrait PM |
| 10 | Saphir et Prune | Prune + Saphir | 1 PA, 6 % Résistance Eau, 35 Résistances Critiques | 1 PA, 8 % Résistance Eau, 45 Résistances Critiques |
| 10 | Saphir et Émeraude | Émeraude + Saphir | 1 PA, 5 % Critique, 6 % Résistance Eau | 1 PA, 7 % Critique, 8 % Résistance Eau |
| 10 | Saphir et Doré | Doré + Saphir | 1 PA, 100 Vitalité, 6 % Résistance Eau | 1 PA, 200 Vitalité, 8 % Résistance Eau |
| 10 | Saphir et Améthyste | Saphir + Améthyste | 1 PA, 6 % Résistance Eau, 6 % Résistance Air | 1 PA, 8 % Résistance Eau, 8 % Résistance Air |
| 10 | Améthyste et Pourpre | Pourpre + Améthyste | 1 PA, 50 Force, 6 % Résistance Air | 1 PA, 70 Force, 8 % Résistance Air |
| 10 | Améthyste et Orchidée | Orchidée + Améthyste | 1 PA, 50 Intelligence, 6 % Résistance Air | 1 PA, 70 Intelligence, 8 % Résistance Air |
| 10 | Améthyste et Indigo | Indigo + Améthyste | 1 PA, 50 Chance, 6 % Résistance Air | 1 PA, 70 Chance, 8 % Résistance Air |
| 10 | Améthyste et Ébène | Ébène + Améthyste | 1 PA, 50 Agilité, 6 % Résistance Air | 1 PA, 70 Agilité, 8 % Résistance Air |
| 10 | Améthyste et Roux | Roux + Améthyste | 1 PA, 6 % Résistance Air, 40 Dommages Poussée | 1 PA, 8 % Résistance Air, 50 Dommages Poussée |
| 10 | Améthyste et Amande | Amande + Améthyste | 1 PA, 6 % Résistance Air, 60 Résistances Poussée | 1 PA, 8 % Résistance Air, 70 Résistances Poussée |
| 10 | Améthyste et Ivoire | Ivoire + Améthyste | 1 PA, 6 % Résistance Air, 20 Retrait PA | 1 PA, 8 % Résistance Air, 30 Retrait PA |
| 10 | Améthyste et Turquoise | Turquoise + Améthyste | 1 PA, 6 % Résistance Air, 20 Retrait PM | 1 PA, 8 % Résistance Air, 30 Retrait PM |
| 10 | Améthyste et Prune | Prune + Améthyste | 1 PA, 6 % Résistance Air, 35 Résistances Critiques | 1 PA, 8 % Résistance Air, 45 Résistances Critiques |
| 10 | Améthyste et Émeraude | Émeraude + Améthyste | 1 PA, 5 % Critique, 6 % Résistance Air | 1 PA, 7 % Critique, 8 % Résistance Air |
| 10 | Améthyste et Doré | Doré + Améthyste | 1 PA, 100 Vitalité, 6 % Résistance Air | 1 PA, 200 Vitalité, 8 % Résistance Air |

## 5. Statistiques et règle de progression par niveau

**Règle (client Ankama, `EvolutiveEffectsDataRoot`, identique en 3.6.12.16 et 3.7.3.3-beta)** : chaque effet d'un objet monture a `progressionPerLevelRange = [[100, p1], [200, p2]]` = gain par niveau jusqu'au niveau 100 puis du 101 au 200 :

```
valeur(L) = floor( p1 × min(L, 100) + p2 × max(0, L − 100) )
```

Preuves (confiance high pour les niveaux 100 et 200) :

- 120/120 Volkornes : valeur(100) = DofusDB `/mounts` `effects.diceSide` (ancienne valeur max, inchangée en 3.5 selon le guide) et valeur(200) = DofusDB `/items` (typeId 333) `possibleEffects.diceNum` ; DPLN affiche les mêmes valeurs niveau 200 pour les 120.
- Exemples du guide DPLN reproduits par la même table client : Muldo Doré 50 -> 70 Puissance (0,5 / 0,2), Dragodinde Pourpre niv. 200 = 120 Force + 400 Vitalité (1,0/0,2 et 3/1), PA/PM « à partir du niveau 100 » (0,01 / 0).
- Arrondi : `floor` déduit du PA (0,01 × 99 = 0,99 -> 0 PA avant le niveau 100). Aucune mesure en jeu trouvée aux niveaux intermédiaires -> niveaux 1, 50, 150 en confiance **medium**.
- **Piège d'implémentation (ajout du vérificateur)** : en double précision (JS/Python), `floor(0.7 × 90)` donne 62 au lieu de 63 (0,7 × 90 = 62,999…) pour Pourpre, Orchidée, Indigo et Ébène au niveau 90. Avec les constantes float32 brutes du client, on obtient même 0 PA au niveau 100 (0,99999998). Il faut implémenter `floor(x + 1e-6)`. Un calcul entièrement en float32 (comme le client C#) suivi de `floor` redonne exactement les valeurs attendues pour les niveaux 1 à 200 des 345 effets (vérifié).

| Stat (couleur) | Monocolore p1 / p2 -> niv.100 / niv.200 | Bicolore p1 / p2 -> niv.100 / niv.200 |
|---|---|---|
| PA (toutes) | 0,01 / 0 -> 1 / 1 | 0,01 / 0 -> 1 / 1 |
| Force (Pourpre), Intelligence (Orchidée), Chance (Indigo), Agilité (Ébène) | 0,7 / 0,2 -> 70 / 90 | 0,5 / 0,2 -> 50 / 70 |
| Dommages Poussée (Roux) | 0,6 / 0,1 -> 60 / 70 | 0,4 / 0,1 -> 40 / 50 |
| Résistances Poussée (Amande) | 0,8 / 0,1 -> 80 / 90 | 0,6 / 0,1 -> 60 / 70 |
| Retrait PA (Ivoire), Retrait PM (Turquoise) | 0,3 / 0,1 -> 30 / 40 | 0,2 / 0,1 -> 20 / 30 |
| Résistances Critiques (Prune) | 0,5 / 0,1 -> 50 / 60 | 0,35 / 0,1 -> 35 / 45 |
| % Critique (Émeraude) | 0,07 / 0,02 -> 7 / 9 | 0,05 / 0,02 -> 5 / 7 |
| Vitalité (Doré) | 1,5 / 1,0 -> 150 / 250 | 1,0 / 1,0 -> 100 / 200 |
| % Résistance Terre (Jade), Feu (Rubis), Eau (Saphir), Air (Améthyste) | 0,12 / 0,02 -> 12 / 14 | 0,06 / 0,02 -> 6 / 8 |

Ids d'effets (DofusDB `/effects`) : 111 PA, 115 % Critique, 118 Force, 119 Agilité, 123 Chance, 125 Vitalité, 126 Intelligence, 210 % Résistance Terre, 211 Eau, 212 Air, 213 Feu, 410 Retrait PA, 412 Retrait PM, 414 Dommages Poussée, 416 Résistances Poussée, 420 Résistances Critiques.

## 6. Monocolores — stats

| Gén. | Monocolore | Capturable | Stats niv. 100 | Stats niv. 200 |
|---|---|---|---|---|
| 1 | Pourpre | oui | 1 PA, 70 Force | 1 PA, 90 Force |
| 1 | Orchidée | oui | 1 PA, 70 Intelligence | 1 PA, 90 Intelligence |
| 1 | Indigo | oui | 1 PA, 70 Chance | 1 PA, 90 Chance |
| 1 | Ébène | oui | 1 PA, 70 Agilité | 1 PA, 90 Agilité |
| 3 | Roux | non | 1 PA, 60 Dommages Poussée | 1 PA, 70 Dommages Poussée |
| 3 | Amande | non | 1 PA, 80 Résistances Poussée | 1 PA, 90 Résistances Poussée |
| 3 | Ivoire | non | 1 PA, 30 Retrait PA | 1 PA, 40 Retrait PA |
| 3 | Turquoise | non | 1 PA, 30 Retrait PM | 1 PA, 40 Retrait PM |
| 5 | Prune | non | 1 PA, 50 Résistances Critiques | 1 PA, 60 Résistances Critiques |
| 5 | Émeraude | non | 1 PA, 7 % Critique | 1 PA, 9 % Critique |
| 7 | Doré | non | 1 PA, 150 Vitalité | 1 PA, 250 Vitalité |
| 9 | Jade | non | 1 PA, 12 % Résistance Terre | 1 PA, 14 % Résistance Terre |
| 9 | Rubis | non | 1 PA, 12 % Résistance Feu | 1 PA, 14 % Résistance Feu |
| 9 | Saphir | non | 1 PA, 12 % Résistance Eau | 1 PA, 14 % Résistance Eau |
| 9 | Améthyste | non | 1 PA, 12 % Résistance Air | 1 PA, 14 % Résistance Air |

## 7. Données d'élevage par génération (client 3.6.12.16)

| Gén. | Cornes de volkorne à l'extraction | XP éleveur par parent | Génétons par parent (3.6) | Génétons (bêta 3.7.3.3) |
|---|---|---|---|---|
| 1 | 0 | 30 | 1 | 2 |
| 2 | 2 | 60 | 2 | 4 |
| 3 | 3 | 90 | 4 | 8 |
| 4 | 4 | 120 | 8 | 15 |
| 5 | 5 | 150 | 15 | 30 |
| 6 | 6 | 180 | 0/30 | 0/60 |
| 7 | 7 | 210 | 60 | 120 |
| 8 | 8 | 240 | 120 | 250 |
| 9 | 9 | 270 | 250 | 500 |
| 10 | 10 | 300 | 0 | 0 |

Concorde avec le guide DPLN (1 ressource par génération, G1 non extractible ; 30 XP par génération par monture ; génétons 1/2/4/8/15/30/60/120/250). Les génétons ne sont gagnés que si le bébé dépasse toute la généalogie (guide). Anomalie : Prune et Roux / Prune et Ivoire (G6) ont 0 généton dans le client (30 attendu) — à vérifier en jeu. La bêta 3.7 double environ les génétons. Elle n'est pas en production : au 2026-10-02, cytrus.json indique live 3.6.12.16 et bêta 3.7.3.3 (high). Les valeurs finales de la 3.7 restent incertaines (medium).

## 8. Divergences entre sources

- **dafous.app** et **dofuselevage.fr** : croisements identiques (dafous.app 120/120 ; dofuselevage.fr mêmes nombres de recettes), mais générations erronées pour Ivoire/Turquoise (affichées G5 au lieu de G3) et Prune/Émeraude (G7 au lieu de G5). Contredit par le client, les succès DofusDB (« Troisième génération » = Roux, Amande, Ivoire, Turquoise ; « Cinquième » = Prune, Émeraude), l'extraction (3 Cornes pour Ivoire) et DPLN. Il s'agit probablement d'un copier-coller de la structure Muldo. **On retient le client.**
- DPLN écrit « Ebène »/« Emeraude » sans accent : les noms en jeu (DofusDB name.fr) sont « Ébène »/« Émeraude ».
- `geneticWeight` vaut 1 pour tous les Volkornes. Côté Dragodindes et Muldos, il vaut 90 pour 10 monocolores Dragodinde et 11 monocolores Muldo, et 20 pour tous les bicolores ainsi que quelques monocolores (ex. Dragodinde Dorée, en armure, à Plumes). Son impact exact sur les probabilités hors génération cible est inconnu (confidence low). **[Critique de complétude 2026-10-02 : rôle établi dans `mechanics.md` §1.2 — w(m) = poids de position (10 soi-même / 6 parent) × geneticWeight, normalisé par arbre ; reproduit les 24 pourcentages des captures in-game DPLN (high pour la structure). Le seul point non testé est le facteur κ des croisements dont l'enfant est monocolore.]**
- Niveau des Volkornes sauvages : le guide de l'éleveur DPLN écrit « monstres de niveau 60 », alors que les grades DofusDB (monstres 5308/5309/5311/5313) sont 62/64/66/68/70 et que la page DPLN Volkornes indique « niveau 62 à 70 ». Le « 60 » correspond au niveau de la sous-zone 886. On retient 62-70 (high).
- Encyclopédie dofus.com non consultée (protection Cloudflare signalée par l'agent Muldo) ; le client de jeu la remplace avantageusement.

## 9. Historique pré-3.5 (contexte uniquement, ne pas utiliser pour le calcul)

- 2.47 (article JOL du 06/06/2018, annonçant la bêta du même jour) : arrivée des Volkornes, 10 générations, « 124 races », nouvelles couleurs Rubis/Saphir/Améthyste/Jade ; Volkornes sauvages solitaires dans 4 zones (Frigost, Pandala, Otomaï, Dimensions divines) ; max 2 reproductions, une seule en cas de collision génétique.
- 3.5 (03/03/2026 selon guidactik.com/gamewave.fr ; règles : guide DPLN) : capture au Haras de Brâkmar, 1 bébé par accouplement (2 avec Reproducteur), plus de collision génétique, plus de gestation, montures 3.4 séniles, niveau max 200.
- 3.6 (20/06/2026, DPLN) : seul ajout = succès monstres « Volkornes sauvages ». Aucun changement d'arbre.

## 10. Sources

- research/raw/dofus-client/rides-3.6.12.16.json (client Ankama Dofus 3.6.12.16, RidesDataRoot, cytrus.cdn.ankama.com) — SOURCE PRIMAIRE (données du jeu en production) : pour chaque Volkorne (speciesId 3) génération, liste COMPLÈTE des couples de parents (parents[]), index inverse children[], objet monture lié (linkedItemGid), Cornes à l'extraction, génétons et XP éleveur. Confidence high.
- research/raw/dofus-client/rides-3.7.3.3-beta.json (client Ankama 3.7.3.3-beta) — Même table en bêta 3.7 : croisements et générations des Volkornes IDENTIQUES à la 3.6 ; seuls les génétons (breedingTokenRewardQuantity) sont environ doublés.
- research/raw/dofus-client/evolutive-effects-3.6.12.16.json (+ 3.7.3.3-beta, identiques) — Règle de progression des stats par niveau (progressionPerLevelRange [[100,p1],[200,p2]] par effet et par objet monture). Reproduit exactement les valeurs DofusDB niveau 100 et niveau 200 des 120 Volkornes et les exemples du guide DPLN.
- research/raw/dofus-client/ride-species-3.6.12.16.json — speciesId 3 -> extractionRewardGid 19975 = "Corne de volkorne" (DofusDB items) : prouve que speciesId 3 = Volkorne.
- https://api.dofusdb.fr/items?typeId=333 — Objets monture 3.5 de type "Volkorne" (typeId 333, exactement 120 objets, niveau 60) : noms FR exacts, valeurs niveau 200 (possibleEffects.diceNum), evolutiveEffectIds.
- https://api.dofusdb.fr/mounts?familyId=6 — MountData (124 = 120 Volkornes + 4 "Sauvage" hérités) : ids monture (= ids client), valeurs niveau 100 (effects.diceSide), certificats hérités (typeId 207).
- https://api.dofusdb.fr/effects — Libellés des effets : 111 PA, 115 % Critique, 118 Force, 119 Agilité, 123 Chance, 125 Vitalité, 126 Intelligence, 210/211/212/213 % Résistance Terre/Eau/Air/Feu, 410 Retrait PA, 412 Retrait PM, 414 Dommages Poussée, 416 Résistances Poussée, 420 Résistances Critiques.
- https://api.dofusdb.fr/achievements?name.fr[$regex]=olkorne — Succès "Volkorne : Deuxième ... Dixième génération" (ids 1692..1684) ; objectifs (EB>idMonture) => génération de chaque Volkorne, identique au client pour les 116 Volkornes G2-G10.
- https://api.dofusdb.fr/achievement-objectives?achievementId=9015 — Succès "Prélèvement cornu" (Capturer les Volkornes) : 4 objectifs = objets G1 Ébène 33166, Indigo 33176, Pourpre 33202, Orchidée 33199 => 4 couleurs capturables, la capture donne la G1.
- https://api.dofusdb.fr/monsters?name.fr[$regex]=Volkorne — Monstres capturables : Volkorne orchidée/indigo/ébène/pourpre sauvage (ids 5308, 5309, 5311, 5313), niveaux 62-70, sous-zone 886 "Haras de Brâkmar".
- https://api.dofusdb.fr/recipes?jobId=79 — Recettes Éleveur : Kromakina/Animakina/Optimakina Volkorne de Génération 2 à 10 => génération max 10.
- https://www.dofuspourlesnoobs.com/les-volkornes.html — Page Volkornes DPLN (MAJ 23/02/2026, système 3.5) : 120 Volkornes, générations, stats niveau 200 et tous les croisements. Comparaison automatique : 120/120 croisements, générations et stats identiques au client/DofusDB.
- https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html — Règles 3.5 (paires = 1 croisement, impaires = plusieurs pour Muldos/Volkornes, 4 Volkornes capturables, PA à partir du niveau 100, exemples de stats niveau 100/200, génétons, extraction).
- https://dafous.app/elevage — Outil élevage (données dans assets/ElevagePage-*.js : parents + altParents) : croisements identiques au client pour 120/120 ; MAIS génération erronée pour Ivoire/Turquoise (5 au lieu de 3) et Prune/Émeraude (7 au lieu de 5).
- https://dofuselevage.fr/tools/reproduction/volkorne/genealogie — Outil généalogie : mêmes nombres de recettes (3/3/3/3/12/12/8/2) mais même erreur de génération qu'avec dafous.app (Ivoire/Turquoise G5, Prune/Émeraude G7).
- https://www.dofuspourlesnoobs.com/mise-a-jour-306.html — Notes 3.6 (20/06/2026) : seul ajout lié = succès monstres "Volkornes sauvages" (DofusDB 9049). Aucun changement de l'arbre.
- https://dofus.jeuxonline.info/actualite/54628/247-refonte-elevage-nouvelles-montures — HISTORIQUE pré-3.5 (2.47, 06/06/2018) : 10 générations, "124 races" de Volkornes (= 120 + 4 sauvages), nouvelles couleurs Rubis/Saphir/Améthyste/Jade, max 2 reproductions, collision génétique. Contexte uniquement.

## Vérification

_Vérification adversariale du 2026-10-02 (agent vérificateur). J'ai cherché à réfuter le contenu en re-téléchargeant les sources et en recalculant tout de façon indépendante. **Verdict : données solides.** Aucune erreur factuelle trouvée sur les croisements, générations, stats, ids et compteurs. Les corrections ne portent que sur la formulation et les précisions._

### Ce qui a été vérifié (15 contrôles principaux)

| # | Affirmation contrôlée | Méthode / source indépendante | Résultat |
|---|---|---|---|
| 1 | 124 entrées DofusDB = 120 + 4 Sauvages (172-175, sans effet) | `research/raw/mounts.json` (familyId 6), comparaison id par id avec le JSON | OK : chacune présente une seule fois, noms identiques, aucun doublon |
| 2 | Croisements, générations, itemId, Cornes, XP, génétons (client) | **Ré-extraction indépendante** du bundle `data_assets_ridesdataroot` depuis cytrus.cdn.ankama.com (manifeste dofus3 linux 6.0_3.6.12.16, SHA-1 OK) | OK : identique à `rides-3.6.12.16.json` (308/308 entrées). Arbre = client 3.6 et 3.7-bêta sur 120/120 |
| 3 | Cohérence structurelle | Script : chaque parent existe, gén. parent < gén. enfant, bicolore « X et Y » = croisement X+Y unique, gén. = max + 1, pas de monocolore pair, capturable <=> G1 | OK, 0 erreur sur 157 croisements |
| 4 | 120 = 15 + C(15,2) ; toutes les paires de couleurs existent | Script | OK |
| 5 | Comptes par génération 4/6/4/22/2/17/1/10/4/50 | Recomptage + nombre d'objectifs des succès DofusDB 1684-1692 (50/4/10/1/17/2/22/4/6), re-téléchargés | OK. Générations : 116/116 identiques via les critères `EB>id` |
| 6 | DPLN les-volkornes.html : 120/120 concordants | Page re-téléchargée et parsée (MAJ 23/02/2026) | OK : 120/120 générations, croisements et stats niveau 200 |
| 7 | dafous.app : croisements identiques, générations Ivoire/Turquoise G5 et Prune/Émeraude G7 erronées | `ElevagePage-B4ceU1sM.js` re-téléchargé | OK : 116/116 croisements (+ 4 G1 `parents:null`) ; erreurs de génération confirmées |
| 8 | dofuselevage.fr : même erreur de génération | Page re-téléchargée (liste déroulante) | OK : Ivoire/Turquoise G5, Prune/Émeraude G7 |
| 9 | Stats niveau 200 (120 objets typeId 333, niveau 60) | `api.dofusdb.fr/items?typeId=333` re-téléchargé (120 objets) | OK : tous les effets identiques |
| 10 | Stats niveau 100 et progression par niveau | `mounts.json` diceSide + **ré-extraction** de `EvolutiveEffectsDataRoot` | OK : 345/345 progressions identiques ; règle(100) et règle(200) exactes ; statsByLevel 1/50/100/150/200 recalculés = OK |
| 11 | Exemples du guide (Muldo Doré 50 -> 70 ; Dragodinde Pourpre 120 Force + 400 Vitalité) | Client ré-extrait (objets 33072, 33050) | OK |
| 12 | Capturables G1 et zone | DofusDB monsters 5308/5309/5311/5313 (grades 62-70, sous-zone 886 « Haras de Brâkmar », zone Brâkmar) ; succès 9015 = objets 33166/33176/33202/33199 | OK |
| 13 | Génération max 10 (makinas) | `items-eleveur.json` : 27 makinas Volkorne (Animakina, Kromakina, Optimakina) de Génération 2 à 10 | OK |
| 14 | `minCapturesIdeal` (4 / 13 / 31 / 58 / 79 / max 116) | Recalcul indépendant (montures + `crossingsDetail`) ; `producesWhenCrossedWith` contrôlé dans les deux sens | OK : valeurs identiques, mais la portée de la notion est précisée (voir corrections) |
| 15 | Ids d'effets et libellés | `api.dofusdb.fr/effects/<id>` pour les 16 ids | OK |
| 16 | Historique 2.47 (124 races, 10 générations, 4 zones, 2 reproductions) | Article JOL re-téléchargé | OK. Date 06/06/2018 = article + début de bêta |
| 17 | 3.6 (succès « Volkornes sauvages ») ; 3.7 non live | DPLN mise-a-jour-306 (mise en ligne 20/06/2026) ; DofusDB succès 9049 ; cytrus.json (live 3.6.12.16, bêta 3.7.3.3, experimental 3.6.12.20) | OK |
| 18 | Anomalie génétons 0 pour Prune et Roux (287) / Prune et Ivoire (288) | Ré-extraction client | Confirmée dans les données. Reste à vérifier en jeu (medium) |
| 19 | Certificats hérités | DofusDB items 19780/19781/19783/19784 (typeId 207 « Certificat de Volkorne ») ; 19782 = « Destination Maelström » | Plage « 19780-19784 » corrigée |

### Corrections appliquées

1. **Fausse inférence retirée** (JSON `notes` + §3) : « un couple a au plus une génération cible ». Seule l'unicité de la paire de couleurs parents est vraie. Via les grands-parents, un accouplement peut avoir plusieurs issues de génération cible qui se partagent les 30 % (guide DPLN).
2. **`minCapturesIdeal` précisé** (JSON `notes` + §3) :
   - il compte des Volkornes G1, pas des captures ;
   - il ignore le sexe des montures ;
   - ce n'est une borne basse que sans clonage ni capacité Reproducteur (exemple : Roux possible avec 3 G1) ;
   - ajout du bonus Almanax Takeza (+20 %).
3. **Piège d'arrondi pour l'application** (JSON `statScaling.implementationNote` + note + §5) : il faut utiliser `floor(x + 1e-6)`. Sans epsilon, on obtient 62 au lieu de 63 au niveau 90 pour les 4 G1.
4. **Niveau des monstres** (JSON note + §8) : divergence consignée entre le guide (« niveau 60 ») et DofusDB/DPLN Volkornes (62-70).
5. **`geneticWeight`** (JSON note + §8) : description exacte des valeurs 90/20 chez les Dragodindes et Muldos.
6. **Certificats** (§1) : ids exacts au lieu de la plage 19780-19784.
7. **3.7** (§7) : statut « pas en production » confirmé par cytrus.json au 2026-10-02 (high).
8. **JSON** :
   - nouvelles sources (cytrus.json, re-vérification de dofuselevage.fr) ;
   - note d'anomalie génétons sur les montures 287 et 288 ;
   - nouveau bloc `verification` (contrôles + corrections).

   Les autres clés et la forme du fichier ne changent pas. JSON validé avec `python -m json.tool`.

### Doutes restants

- L'arrondi aux niveaux intermédiaires (`floor`) est déduit, pas mesuré en jeu (medium). L'arithmétique float32 du client est cohérente avec `floor` à tous les niveaux.
- Génétons 0 pour Prune et Roux / Prune et Ivoire : c'est bien dans les données du client, mais l'effet en jeu n'est pas confirmé.
- `geneticWeight` = 1 pour les Volkornes : effet sur les probabilités non documenté (low). **[Critique de complétude 2026-10-02 : rôle établi dans `mechanics.md` §1.2 — w(m) = poids de position (10 soi-même / 6 parent) × geneticWeight, normalisé par arbre ; reproduit les 24 pourcentages des captures in-game DPLN (high pour la structure). Le seul point non testé est le facteur κ des croisements dont l'enfant est monocolore.]**
- `minCapturesIdeal` est une métrique de planification et non une donnée du jeu. L'optimiseur doit modéliser les probabilités (30 % + bonus, répartition par la généalogie), le sexe et le clonage.

## Critique de complétude (2026-10-02)

Champs ajoutés au JSON pour aligner les trois arbres (aucune valeur existante modifiée ; tout est recalculé depuis `raw/dofus-client/rides-*.json` et `evolutive-effects-3.6.12.16.json`, puis revérifié contre le client : 0 écart) : `breedable` (false pour les spéciales G0), `extractionQty`, `captureMonsterId` (G1 capturables, DofusDB `monsters`), `statsRaw[].valueLevel100` / `valueLevel200` / `valueLevelsSource`, `harmonizedSchema` à la racine. Dragodindes en plus : `itemId` (68/68 vérifiés contre les noms DofusDB `items` typeId 331), `geneticWeight`, `extractionNeuronesDeDragodinde`, `breederXpWhenParent`, `genetonsWhenParent`, `equipMinLevel`, `statsConfidence`, `clientDataSource`, et à la racine `clientSpeciesId`, `countsByGeneration`, `totalMounts`, `totalBreedable`, `statScaling`, `excludedLegacyVariants`. Muldos en plus : `statsByLevel` aux niveaux 50 et 150, `equipMinLevel` (60, DofusDB items typeId 332). Index général et spécification consolidée : [`README.md`](README.md).
