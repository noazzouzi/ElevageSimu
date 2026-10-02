# Arbre d'élevage des Dragodindes (système 3.5+, vérifié sur le client 3.6.12.16)

> Fichier de données associé : `research/data/tree-dragodinde.json`. Données brutes extraites du client : `research/raw/dofus-client/`.
> Rédigé le 2026-10-01. Version live du jeu à cette date : **3.6.12.16** (cytrus `dofus3`), bêta : **3.7.3.3**.

## 1. En bref

- **66 Dragodindes élevables** (11 monocolores + 55 bicolores) réparties sur **10 générations**, plus **2 Dragodindes spéciales** non reproductibles (en armure, à Plumes). Confiance : haute.
- **3 couleurs capturables** (génération 1) : Amande, Dorée, Rousse. Confiance : haute.
- **Un seul croisement possible pour chaque Dragodinde** (contrairement aux Muldos/Volkornes). Confiance : haute (client + guide DPLN).
- **Stats** : la valeur évolue linéairement du niveau 1 au 100 (taux p1 = v100/100 par niveau), puis plus lentement du 101 au 200 (taux p2 = (v200−v100)/100). Les 66 Dragodindes élevables (et la Dragodinde à Plumes) donnent **300 Vitalité au niveau 100 et 400 au niveau 200** ; la **Dragodinde en armure ne donne pas de Vitalité** (Puissance + 5 résistances %). Confiance : haute sur les taux, moyenne sur l'arrondi (floor) aux niveaux intermédiaires.
- L'arbre de croisements est **identique à l'ancien système** (pré-3.5) et **inchangé en 3.6 et en bêta 3.7**.

## 2. Sources et méthode

| # | Source | Ce qu'elle apporte | Confiance |
|---|---|---|---|
| 1 | Client officiel Dofus 3.6.12.16, CDN Ankama (`cytrus.cdn.ankama.com`, manifeste `dofus/releases/dofus3/linux/6.0_3.6.12.16.manifest`), bundles `data_assets_ridesdataroot` et `data_assets_evolutiveeffectsdataroot`, lus avec UnityPy | Table `RidesData` : génération, **parents (= croisements)**, enfants, `geneticWeight`, objet-monture lié, extraction, génétons, XP métier. Table `EvolutiveEffects` : progression des stats par niveau | haute (donnée du jeu) |
| 2 | Client bêta 3.7.3.3 (même méthode) | Comparaison 3.6 → 3.7 | haute (bêta) |
| 3 | [DofusDB /mounts](https://api.dofusdb.fr/mounts?familyId=1) et [/items typeId 331](https://api.dofusdb.fr/items?typeId=331) | Noms FR exacts, ids ; valeurs niveau 100 (MountData) et niveau 200 (objet-monture 3.5) | haute |
| 4 | [DPLN – Les Dragodindes](https://www.dofuspourlesnoobs.com/les-dragodindes.html) (MAJ 23/02/2026) | Croisements et bonus niv. 200 de toutes les dragodindes 3.5 | haute pour les croisements (66/66) ; 2 coquilles relevées sur les bonus niv. 200 |
| 5 | [DPLN – Guide de l'éleveur 2026](https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html) (MAJ 02/03/2026) + captures d'écran in-game | Règles 3.5 ; capture de l'interface génétique et de l'accouplement Ivoire et Turquoise × Ivoire et Pourpre → Émeraude GEN.9 ; Ébène et Rousse niv.200 ; monture niv.1 | haute |
| 6 | [Guidactik – généalogie des dragodindes](https://guidactik.com/dofus/guide-elevage-sur-dofus-extraction-et-genealogie-de-dragodindes/) (22/02/2026) | Liste par génération 2–10 (« Prune et Pourpre » listée deux fois en G10 : 20 lignes, 19 montures distinctes) | moyenne-haute |
| 7 | [DofusDB succès](https://api.dofusdb.fr/achievements?slug.fr[$search]=dragodinde) 96–101, 130–132 | Nombre de dragodindes par génération (3/2/7/2/11/2/15/2/19) | haute |
| 8 | [JOL – Dragodindes](https://dofus.jeuxonline.info/article/13334/dragodindes) | **Ancien système (pré-3.5)**, contexte : mêmes croisements | contexte |
| 9 | [API dofusdude](https://api.dofusdu.de/dofus3/v1/fr/mounts/all) | Recoupement des valeurs niveau 200 | haute |
| 10 | [Code client Dofus 2 `EvolutiveEffect.as`](https://raw.githubusercontent.com/scalexm/DofusInvoker/ddff8fe00a97983dcf5db588bf96f0193f332720/com/ankamagames/dofus/datacenter/effects/EvolutiveEffect.as) | **Ancien client**, structure des progressions + `Math.floor` (attention : compte à partir de `firstLevel = 1`, voir §6) | contexte |
| 11 | [Devblog officiel MAJ 3.7](https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1771790-maj-3-7-confort-jeu-lisibilite-ajustements) (16/09/2026 ; copie `research/raw/mechanics-evidence/texts/devblog-3.7-elevage-2026-09-16.txt`) | Changements 3.7 annoncés : génétons, jauges ×2, carburants ×2, Optimakina +20 % | haute (officiel, pas encore live) |
| 12 | [cytrus.json](https://cytrus.cdn.ankama.com/cytrus.json) + [DofusDB /version](https://api.dofusdb.fr/version) | Version live 3.6.12.16, bêta 3.7.3.3 (canal « experimental » 3.6.12.20) | haute |
| 13 | [DofusDB achievement-objectives](https://api.dofusdb.fr/achievement-objectives?achievementId=132) | Critère `EB>idMonture` : appartenance exacte de chaque monture G2–G10 à son succès de génération | haute |
| 14 | [DofusElevage](https://dofuselevage.fr) (planificateur génération en génération) et [Dafous – Dragodindes](https://dafous.app/en/guides/dragodindes.html) (14/03/2026) | Effectifs par génération, 66 + 2 spéciales, G1 capturables, niveaux 62-70 | moyenne-haute (concordent) |

Recoupement : les 66 croisements du client sont **identiques** à ceux de DPLN (3.5) ; les générations sont identiques à Guidactik et aux succès ; les valeurs niveau 100/200 calculées depuis les taux du client sont **identiques** à DofusDB (MountData / objets typeId 331), à dofusdude et à DPLN (hors 2 coquilles).

## 3. Règle de croisement

- **Bicolore « X et Y »** = accouplement d'une monocolore X avec une monocolore Y. Génération = max(gén. X, gén. Y) + 1. Exemple : Pourpre (G5) × Émeraude (G9) → Émeraude et Pourpre (G10).
- **Monocolore des générations impaires 3, 5, 7, 9** = accouplement de **deux bicolores précises**, dont **au moins une de la génération précédente** (une seule paire possible par couleur) : G3 = G2 × G2, **G5 = G2 × G4** (ex. Pourpre = Amande et Rousse [G2] × Ébène et Indigo [G4]), G7 = G6 × G6, G9 = G8 × G8.
- Le nom d'une bicolore n'indique pas toujours les couleurs dans l'ordre alphabétique (ex. « Prune et Amande », « Turquoise et Orchidée ») : utiliser les noms exacts du fichier JSON.
- Rappel 3.5 (guide DPLN) : l'accouplement donne 1 bébé (2 avec la capacité Reproducteur), les parents deviennent stériles ; le bébé a 30 % + 0,15 %/niveau de chaque parent + 10 % (Optimakina) de chance d'être de la **génération cible** ; le reste se répartit sur les couleurs des parents et grands-parents. (3.7 annoncée, pas encore live : Optimakina +20 % — devblog officiel du 16/09/2026.)

### Chaîne des monocolores (le « squelette » de l'élevage)

| Gén. | Monocolore | Croisement unique | Captures G1 minimales* | Accouplements minimaux* |
|---|---|---|---|---|
| 1 | Amande | capture (sauvage) | 1 | 0 |
| 1 | Dorée | capture (sauvage) | 1 | 0 |
| 1 | Rousse | capture (sauvage) | 1 | 0 |
| 3 | Indigo | Amande et Dorée × Amande et Rousse | 4 | 3 |
| 3 | Ébène | Amande et Dorée × Dorée et Rousse | 4 | 3 |
| 5 | Orchidée | Dorée et Rousse × Ébène et Indigo | 10 | 9 |
| 5 | Pourpre | Amande et Rousse × Ébène et Indigo | 10 | 9 |
| 7 | Ivoire | Indigo et Pourpre × Orchidée et Pourpre | 34 | 33 |
| 7 | Turquoise | Ébène et Orchidée × Orchidée et Pourpre | 34 | 33 |
| 9 | Prune | Ivoire et Turquoise × Turquoise et Orchidée | 112 | 111 |
| 9 | Émeraude | Ivoire et Turquoise × Ivoire et Pourpre | 112 | 111 |

\* Borne théorique : chaque accouplement réussit du premier coup (génération cible obtenue) avec des sexes favorables (il faut toujours un mâle et une femelle), sans clonage ni Reproducteur. En pratique il en faut beaucoup plus (30 % de base pour la génération cible) ; le clonage de deux parents stériles de même génération rend une monture fertile et réduit le besoin de captures.

Générations 10 les moins coûteuses : une couleur de G1 (Amande, Dorée ou Rousse) croisée avec Émeraude ou Prune, soit Amande et Émeraude, Dorée et Émeraude, Émeraude et Rousse, Prune et Amande, Prune et Dorée, Prune et Rousse (113 captures minimales chacune). La plus coûteuse est **Prune et Émeraude** (224).

## 4. Tableau des générations

| Gén. | Nb | Montures |
|---|---|---|
| 1 | 3 | Amande, Dorée, Rousse |
| 2 | 3 | Amande et Dorée, Amande et Rousse, Dorée et Rousse |
| 3 | 2 | Indigo, Ébène |
| 4 | 7 | Amande et Indigo, Amande et Ébène, Dorée et Indigo, Dorée et Ébène, Indigo et Rousse, Ébène et Indigo, Ébène et Rousse |
| 5 | 2 | Orchidée, Pourpre |
| 6 | 11 | Amande et Orchidée, Amande et Pourpre, Dorée et Orchidée, Dorée et Pourpre, Indigo et Orchidée, Indigo et Pourpre, Orchidée et Pourpre, Orchidée et Rousse, Pourpre et Rousse, Ébène et Orchidée, Ébène et Pourpre |
| 7 | 2 | Ivoire, Turquoise |
| 8 | 15 | Amande et Ivoire, Amande et Turquoise, Dorée et Ivoire, Dorée et Turquoise, Indigo et Ivoire, Indigo et Turquoise, Ivoire et Orchidée, Ivoire et Pourpre, Ivoire et Rousse, Ivoire et Turquoise, Turquoise et Orchidée, Turquoise et Pourpre, Turquoise et Rousse, Ébène et Ivoire, Ébène et Turquoise |
| 9 | 2 | Prune, Émeraude |
| 10 | 19 | Amande et Émeraude, Dorée et Émeraude, Prune et Amande, Prune et Dorée, Prune et Indigo, Prune et Ivoire, Prune et Orchidée, Prune et Pourpre, Prune et Rousse, Prune et Turquoise, Prune et Ébène, Prune et Émeraude, Ébène et Émeraude, Émeraude et Indigo, Émeraude et Ivoire, Émeraude et Orchidée, Émeraude et Pourpre, Émeraude et Rousse, Émeraude et Turquoise |
| spéciale (0) | 2 | en armure, à Plumes (non reproductibles, 50 Gladiatons chez Gladiagob [-11,-37] selon DPLN — source unique, confiance moyenne ; PNJ DofusDB 7501 et objet Gladiaton 30442 existent) |

## 5. Liste complète (croisement, stats niveau 100 et 200)

| Gén. | Monture | id DofusDB | Objet 3.5 (HDV) | Croisement | Stats niv. 100 | Stats niv. 200 | geneticWeight |
|---|---|---|---|---|---|---|---|
| 1 | Dragodinde Amande | 20 | 33001 | capture | 300 Vitalité, 1500 Initiative | 400 Vitalité, 1700 Initiative | 90 |
| 1 | Dragodinde Dorée | 18 | 33011 | capture | 300 Vitalité, 2 Invocations | 400 Vitalité, 2 Invocations | 20 |
| 1 | Dragodinde Rousse | 10 | 33063 | capture | 300 Vitalité, 50 Soins | 400 Vitalité, 60 Soins | 90 |
| 2 | Dragodinde Amande et Dorée | 33 | 33002 | Amande × Dorée | 300 Vitalité, 1 Invocation, 1000 Initiative | 400 Vitalité, 1 Invocation, 1200 Initiative | 20 |
| 2 | Dragodinde Amande et Rousse | 38 | 33009 | Amande × Rousse | 300 Vitalité, 35 Soins, 1000 Initiative | 400 Vitalité, 45 Soins, 1200 Initiative | 20 |
| 2 | Dragodinde Dorée et Rousse | 46 | 33018 | Dorée × Rousse | 300 Vitalité, 1 Invocation, 35 Soins | 400 Vitalité, 1 Invocation, 45 Soins | 20 |
| 3 | Dragodinde Indigo | 17 | 33036 | Amande et Dorée × Amande et Rousse | 300 Vitalité, 100 Chance | 400 Vitalité, 120 Chance | 90 |
| 3 | Dragodinde Ébène | 3 | 33020 | Amande et Dorée × Dorée et Rousse | 300 Vitalité, 100 Agilité | 400 Vitalité, 120 Agilité | 90 |
| 4 | Dragodinde Amande et Indigo | 36 | 33005 | Amande × Indigo | 300 Vitalité, 70 Chance, 1000 Initiative | 400 Vitalité, 90 Chance, 1200 Initiative | 20 |
| 4 | Dragodinde Amande et Ébène | 34 | 33003 | Amande × Ébène | 300 Vitalité, 70 Agilité, 1000 Initiative | 400 Vitalité, 90 Agilité, 1200 Initiative | 20 |
| 4 | Dragodinde Dorée et Indigo | 44 | 33014 | Dorée × Indigo | 300 Vitalité, 70 Chance, 1 Invocation | 400 Vitalité, 90 Chance, 1 Invocation | 20 |
| 4 | Dragodinde Dorée et Ébène | 42 | 33012 | Dorée × Ébène | 300 Vitalité, 70 Agilité, 1 Invocation | 400 Vitalité, 90 Agilité, 1 Invocation | 20 |
| 4 | Dragodinde Indigo et Rousse | 62 | 33040 | Indigo × Rousse | 300 Vitalité, 70 Chance, 35 Soins | 400 Vitalité, 90 Chance, 45 Soins | 20 |
| 4 | Dragodinde Ébène et Indigo | 51 | 33022 | Ébène × Indigo | 300 Vitalité, 70 Chance, 70 Agilité | 400 Vitalité, 90 Chance, 90 Agilité | 20 |
| 4 | Dragodinde Ébène et Rousse | 12 | 33026 | Ébène × Rousse | 300 Vitalité, 70 Agilité, 35 Soins | 400 Vitalité, 90 Agilité, 45 Soins | 20 |
| 5 | Dragodinde Orchidée | 22 | 33047 | Dorée et Rousse × Ébène et Indigo | 300 Vitalité, 100 Intelligence | 400 Vitalité, 120 Intelligence | 90 |
| 5 | Dragodinde Pourpre | 19 | 33050 | Amande et Rousse × Ébène et Indigo | 300 Vitalité, 100 Force | 400 Vitalité, 120 Force | 90 |
| 6 | Dragodinde Amande et Orchidée | 40 | 33007 | Amande × Orchidée | 300 Vitalité, 70 Intelligence, 1000 Initiative | 400 Vitalité, 90 Intelligence, 1200 Initiative | 20 |
| 6 | Dragodinde Amande et Pourpre | 41 | 33008 | Amande × Pourpre | 300 Vitalité, 70 Force, 1000 Initiative | 400 Vitalité, 90 Force, 1200 Initiative | 20 |
| 6 | Dragodinde Dorée et Orchidée | 48 | 33016 | Dorée × Orchidée | 300 Vitalité, 70 Intelligence, 1 Invocation | 400 Vitalité, 90 Intelligence, 1 Invocation | 20 |
| 6 | Dragodinde Dorée et Pourpre | 49 | 33017 | Dorée × Pourpre | 300 Vitalité, 70 Force, 1 Invocation | 400 Vitalité, 90 Force, 1 Invocation | 20 |
| 6 | Dragodinde Indigo et Orchidée | 64 | 33038 | Indigo × Orchidée | 300 Vitalité, 70 Intelligence, 70 Chance | 400 Vitalité, 90 Intelligence, 90 Chance | 20 |
| 6 | Dragodinde Indigo et Pourpre | 65 | 33039 | Indigo × Pourpre | 300 Vitalité, 70 Force, 70 Chance | 400 Vitalité, 90 Force, 90 Chance | 20 |
| 6 | Dragodinde Orchidée et Pourpre | 76 | 33048 | Orchidée × Pourpre | 300 Vitalité, 70 Force, 70 Intelligence | 400 Vitalité, 90 Force, 90 Intelligence | 20 |
| 6 | Dragodinde Orchidée et Rousse | 70 | 33049 | Orchidée × Rousse | 300 Vitalité, 70 Intelligence, 35 Soins | 400 Vitalité, 90 Intelligence, 45 Soins | 20 |
| 6 | Dragodinde Pourpre et Rousse | 71 | 33051 | Pourpre × Rousse | 300 Vitalité, 70 Force, 35 Soins | 400 Vitalité, 90 Force, 45 Soins | 20 |
| 6 | Dragodinde Ébène et Orchidée | 53 | 33024 | Ébène × Orchidée | 300 Vitalité, 70 Intelligence, 70 Agilité | 400 Vitalité, 90 Intelligence, 90 Agilité | 20 |
| 6 | Dragodinde Ébène et Pourpre | 54 | 33025 | Ébène × Pourpre | 300 Vitalité, 70 Force, 70 Agilité | 400 Vitalité, 90 Force, 90 Agilité | 20 |
| 7 | Dragodinde Ivoire | 16 | 33042 | Indigo et Pourpre × Orchidée et Pourpre | 300 Vitalité, 70 Puissance | 400 Vitalité, 90 Puissance | 90 |
| 7 | Dragodinde Turquoise | 15 | 33065 | Ébène et Orchidée × Orchidée et Pourpre | 300 Vitalité, 80 Prospection | 400 Vitalité, 90 Prospection | 90 |
| 8 | Dragodinde Amande et Ivoire | 37 | 33006 | Amande × Ivoire | 300 Vitalité, 50 Puissance, 1000 Initiative | 400 Vitalité, 70 Puissance, 1200 Initiative | 20 |
| 8 | Dragodinde Amande et Turquoise | 39 | 33010 | Amande × Turquoise | 300 Vitalité, 60 Prospection, 1000 Initiative | 400 Vitalité, 70 Prospection, 1200 Initiative | 20 |
| 8 | Dragodinde Dorée et Ivoire | 45 | 33015 | Dorée × Ivoire | 300 Vitalité, 50 Puissance, 1 Invocation | 400 Vitalité, 70 Puissance, 1 Invocation | 20 |
| 8 | Dragodinde Dorée et Turquoise | 47 | 33019 | Dorée × Turquoise | 300 Vitalité, 1 Invocation, 60 Prospection | 400 Vitalité, 1 Invocation, 70 Prospection | 20 |
| 8 | Dragodinde Indigo et Ivoire | 61 | 33037 | Indigo × Ivoire | 300 Vitalité, 70 Chance, 50 Puissance | 400 Vitalité, 90 Chance, 70 Puissance | 20 |
| 8 | Dragodinde Indigo et Turquoise | 63 | 33041 | Indigo × Turquoise | 300 Vitalité, 70 Chance, 60 Prospection | 400 Vitalité, 90 Chance, 70 Prospection | 20 |
| 8 | Dragodinde Ivoire et Orchidée | 67 | 33043 | Ivoire × Orchidée | 300 Vitalité, 70 Intelligence, 50 Puissance | 400 Vitalité, 90 Intelligence, 70 Puissance | 20 |
| 8 | Dragodinde Ivoire et Pourpre | 68 | 33044 | Ivoire × Pourpre | 300 Vitalité, 70 Force, 50 Puissance | 400 Vitalité, 90 Force, 70 Puissance | 20 |
| 8 | Dragodinde Ivoire et Rousse | 11 | 33045 | Ivoire × Rousse | 300 Vitalité, 50 Puissance, 35 Soins | 400 Vitalité, 70 Puissance, 45 Soins | 20 |
| 8 | Dragodinde Ivoire et Turquoise | 66 | 33046 | Ivoire × Turquoise | 300 Vitalité, 50 Puissance, 60 Prospection | 400 Vitalité, 70 Puissance, 70 Prospection | 20 |
| 8 | Dragodinde Turquoise et Orchidée | 72 | 33066 | Turquoise × Orchidée | 300 Vitalité, 70 Intelligence, 60 Prospection | 400 Vitalité, 90 Intelligence, 70 Prospection | 20 |
| 8 | Dragodinde Turquoise et Pourpre | 73 | 33067 | Turquoise × Pourpre | 300 Vitalité, 70 Force, 60 Prospection | 400 Vitalité, 90 Force, 70 Prospection | 20 |
| 8 | Dragodinde Turquoise et Rousse | 69 | 33068 | Turquoise × Rousse | 300 Vitalité, 35 Soins, 60 Prospection | 400 Vitalité, 45 Soins, 70 Prospection | 20 |
| 8 | Dragodinde Ébène et Ivoire | 9 | 33023 | Ébène × Ivoire | 300 Vitalité, 70 Agilité, 50 Puissance | 400 Vitalité, 90 Agilité, 70 Puissance | 20 |
| 8 | Dragodinde Ébène et Turquoise | 52 | 33027 | Ébène × Turquoise | 300 Vitalité, 70 Agilité, 60 Prospection | 400 Vitalité, 90 Agilité, 70 Prospection | 20 |
| 9 | Dragodinde Prune | 23 | 33052 | Ivoire et Turquoise × Turquoise et Orchidée | 300 Vitalité, 2 Portée | 400 Vitalité, 2 Portée | 90 |
| 9 | Dragodinde Émeraude | 21 | 33028 | Ivoire et Turquoise × Ivoire et Pourpre | 300 Vitalité, 12 % Critique | 400 Vitalité, 14 % Critique | 90 |
| 10 | Dragodinde Amande et Émeraude | 35 | 33004 | Amande × Émeraude | 300 Vitalité, 8 % Critique, 1000 Initiative | 400 Vitalité, 10 % Critique, 1200 Initiative | 20 |
| 10 | Dragodinde Dorée et Émeraude | 43 | 33013 | Dorée × Émeraude | 300 Vitalité, 8 % Critique, 1 Invocation | 400 Vitalité, 10 % Critique, 1 Invocation | 20 |
| 10 | Dragodinde Prune et Amande | 77 | 33053 | Prune × Amande | 300 Vitalité, 1 Portée, 1000 Initiative | 400 Vitalité, 1 Portée, 1200 Initiative | 20 |
| 10 | Dragodinde Prune et Dorée | 78 | 33054 | Prune × Dorée | 300 Vitalité, 1 Portée, 1 Invocation | 400 Vitalité, 1 Portée, 1 Invocation | 20 |
| 10 | Dragodinde Prune et Indigo | 82 | 33057 | Prune × Indigo | 300 Vitalité, 70 Chance, 1 Portée | 400 Vitalité, 90 Chance, 1 Portée | 20 |
| 10 | Dragodinde Prune et Ivoire | 83 | 33058 | Prune × Ivoire | 300 Vitalité, 50 Puissance, 1 Portée | 400 Vitalité, 70 Puissance, 1 Portée | 20 |
| 10 | Dragodinde Prune et Orchidée | 86 | 33059 | Prune × Orchidée | 300 Vitalité, 70 Intelligence, 1 Portée | 400 Vitalité, 90 Intelligence, 1 Portée | 20 |
| 10 | Dragodinde Prune et Pourpre | 87 | 33060 | Prune × Pourpre | 300 Vitalité, 70 Force, 1 Portée | 400 Vitalité, 90 Force, 1 Portée | 20 |
| 10 | Dragodinde Prune et Rousse | 84 | 33061 | Prune × Rousse | 300 Vitalité, 1 Portée, 35 Soins | 400 Vitalité, 1 Portée, 45 Soins | 20 |
| 10 | Dragodinde Prune et Turquoise | 85 | 33062 | Prune × Turquoise | 300 Vitalité, 1 Portée, 60 Prospection | 400 Vitalité, 1 Portée, 70 Prospection | 20 |
| 10 | Dragodinde Prune et Ébène | 79 | 33055 | Prune × Ébène | 300 Vitalité, 70 Agilité, 1 Portée | 400 Vitalité, 90 Agilité, 1 Portée | 20 |
| 10 | Dragodinde Prune et Émeraude | 80 | 33056 | Prune × Émeraude | 300 Vitalité, 8 % Critique, 1 Portée | 400 Vitalité, 10 % Critique, 1 Portée | 20 |
| 10 | Dragodinde Ébène et Émeraude | 50 | 33021 | Ébène × Émeraude | 300 Vitalité, 70 Agilité, 8 % Critique | 400 Vitalité, 90 Agilité, 10 % Critique | 20 |
| 10 | Dragodinde Émeraude et Indigo | 55 | 33029 | Émeraude × Indigo | 300 Vitalité, 70 Chance, 8 % Critique | 400 Vitalité, 90 Chance, 10 % Critique | 20 |
| 10 | Dragodinde Émeraude et Ivoire | 56 | 33030 | Émeraude × Ivoire | 300 Vitalité, 50 Puissance, 8 % Critique | 400 Vitalité, 70 Puissance, 10 % Critique | 20 |
| 10 | Dragodinde Émeraude et Orchidée | 59 | 33031 | Émeraude × Orchidée | 300 Vitalité, 70 Intelligence, 8 % Critique | 400 Vitalité, 90 Intelligence, 10 % Critique | 20 |
| 10 | Dragodinde Émeraude et Pourpre | 60 | 33032 | Émeraude × Pourpre | 300 Vitalité, 70 Force, 8 % Critique | 400 Vitalité, 90 Force, 10 % Critique | 20 |
| 10 | Dragodinde Émeraude et Rousse | 57 | 33033 | Émeraude × Rousse | 300 Vitalité, 8 % Critique, 35 Soins | 400 Vitalité, 10 % Critique, 45 Soins | 20 |
| 10 | Dragodinde Émeraude et Turquoise | 58 | 33034 | Émeraude × Turquoise | 300 Vitalité, 8 % Critique, 60 Prospection | 400 Vitalité, 10 % Critique, 70 Prospection | 20 |
| 0 | Dragodinde en armure | 88 | 33035 | — | 50 Puissance, 5 % Résistance Neutre, 5 % Résistance Terre, 5 % Résistance Feu, 5 % Résistance Eau, 5 % Résistance Air | 70 Puissance, 7 % Résistance Neutre, 7 % Résistance Terre, 7 % Résistance Feu, 7 % Résistance Eau, 7 % Résistance Air | 20 |
| 0 | Dragodinde à Plumes | 89 | 33000 | — | 300 Vitalité, 30 Dommages Renvoyés | 400 Vitalité, 40 Dommages Renvoyés | 20 |

## 6. Règle d'évolution des statistiques

**Donnée du jeu** : chaque objet-monture 3.5 (DofusDB items typeId 331) porte des `evolutiveEffectIds`. La table client `EvolutiveEffects` donne pour chaque stat `progressionPerLevelRange = [[100, p1], [200, p2]]` : `p1` par niveau jusqu'au niveau 100, `p2` par niveau du 101 au 200. Exemple Dragodinde Pourpre (objet 33050) : Vitalité [[100, 3], [200, 1]], Force [[100, 1], [200, 0,2]].

**Formule utilisée** : `valeur(L) = floor(p1 × min(L,100) + p2 × max(L−100, 0))`, avec `p1 = v100/100` et `p2 = (v200 − v100)/100` (vérifié pour les 67 montures hors Plumes).

| Caractéristique | Monocolore p1 → v100 | Monocolore p2 → v200 | Bicolore p1 → v100 | Bicolore p2 → v200 |
|---|---|---|---|---|
| Vitalité (toutes sauf « en armure ») | 3 → 300 | 1 → 400 | 3 → 300 | 1 → 400 |
| Force / Agilité / Chance / Intelligence | 1 → 100 | 0,2 → 120 | 0,7 → 70 | 0,2 → 90 |
| Puissance (Ivoire) | 0,7 → 70 | 0,2 → 90 | 0,5 → 50 | 0,2 → 70 |
| Initiative (Amande) | 15 → 1500 | 2 → 1700 | 10 → 1000 | 2 → 1200 |
| Soins (Rousse) | 0,5 → 50 | 0,1 → 60 | 0,35 → 35 | 0,1 → 45 |
| Prospection (Turquoise) | 0,8 → 80 | 0,1 → 90 | 0,6 → 60 | 0,1 → 70 |
| % Critique (Émeraude) | 0,12 → 12 | 0,02 → 14 | 0,08 → 8 | 0,02 → 10 |
| Portée (Prune) | 0,02 → 2 | 0 → 2 | 0,01 → 1 | 0 → 1 |
| Invocations (Dorée) | 0,02 → 2 | 0 → 2 | 0,01 → 1 | 0 → 1 |
| Armure : Puissance / 5 résistances % | 0,5 → 50 / 0,05 → 5 | 0,2 → 70 / 0,02 → 7 | | |
| Plumes : Vitalité / Dommages renvoyés | 3 → 300 / 0,3 → 30 | 1 → 400 / 0,1 → 40 | | |

**Preuves** : niveau 100 = DofusDB MountData (et guide DPLN : « Les statistiques de niveau 100 des montures ne changent pas ») ; niveau 200 = objets typeId 331, DPLN (Pourpre niv.200 = 120 Force + 400 Vitalité ; capture Ébène et Rousse niv.200 = 400 Vit / 90 Agi / 45 Soins) ; niveau 1 = capture DPLN d'un Volkorne Doré et Prune (GEN. 8) dont le panneau Statut indique « Niveau de la monture : Niveau 1 » (l'en-tête « Niveau 60 » est le niveau requis de l'objet) et affichant 1 Vitalité, 0 PA, 0 Rés. critiques (taux client 1 / 0,01 / 0,35) → le niveau 1 compte bien pour 1 niveau (pas de décalage L−1). Réserve : cette capture affiche une XP incohérente (« 79 860 / 19 XP (420300 %) »). Le niveau 200 (400 Vit, et non 397) exclut lui aussi le décalage L−1 de l'ancien code Dofus 2.

**Doutes** :
- L'arrondi aux niveaux intermédiaires (floor vs arrondi au plus proche) n'est vérifié qu'aux niveaux 1, 100 et 200, qui ne départagent pas les deux ; floor est retenu (ancien client Dofus 2 et émulateurs). Confiance moyenne. Impact faible (±1 point). Note : l'ancien `EvolutiveEffect.as` commence à `firstLevel = 1`, soit p1 × (L−1) dans la première tranche (297 Vit au niv. 100, 397 au niv. 200) : c'est contredit par les captures 3.5, donc seul son `Math.floor` est retenu comme indice.
- Les taux sont stockés en float32 dans le client (0,01 → 0,0099999998) : en double, 0,0099999998 × 100 = 0,99999998 → floor 0 ; en float32 le produit vaut exactement 1,0. Calculer avec des décimales exactes, sinon 1 Invocation/1 PO au niveau 100 deviendrait 0.
- **Dragodinde à Plumes** : DofusDB MountData indique 100 Vitalité / 10 renvoi (valeur héritée) alors que le client 3.5+ et l'objet 33000 donnent 300/30 au niv.100 et 400/40 au niv.200. Le JSON suit le client.
- Coquilles DPLN (2) : « Amande et Ebène 120 Agilité » au niveau 200 → en réalité 90 ; « Amande et Rousse 60 Soins » au niveau 200 → en réalité 45 (client, DofusDB objet 33009, dofusdude).
- Dragodinde à Plumes, trois valeurs selon la source : JOL (ancien système) 300 Vit + 10 renvoi ; DofusDB MountData 100 Vit + 10 renvoi ; client 3.5+ 300 / 30 au niv. 100 et 400 / 40 au niv. 200 (le niv. 200 est confirmé par DofusDB objet 33000, dofusdude et DPLN ; le niv. 100 = 30 renvoi repose sur le taux client seul).

## 7. Récompenses par génération (par parent accouplé)

| Gén. | Génétons (live 3.6) | Génétons (bêta 3.7) | XP métier Éleveur | Neurones de dragodinde à l'extraction |
|---|---|---|---|---|
| spéciale | 0 | 0 | 0 | 0 |
| 1 | 1 | 2 | 30 | 0 |
| 2 | 2 | 4 | 60 | 2 |
| 3 | 4 | 8 | 90 | 3 |
| 4 | 8 | 15 | 120 | 4 |
| 5 | 15 | 30 | 150 | 5 |
| 6 | 30 | 60 | 180 | 6 |
| 7 | 60 | 120 | 210 | 7 |
| 8 | 120 | 250 | 240 | 8 |
| 9 | 250 | 500 | 270 | 9 |
| 10 | 0 | 0 | 300 | 10 |

Génétons : on additionne la valeur des deux parents, uniquement si le bébé est d'une génération supérieure à toutes les montures des deux arbres (guide DPLN). Corroboré in-game : la capture DPLN de l'accouplement Ivoire et Turquoise (G8) × Ivoire et Pourpre (G8) affiche **240** à côté de la génération cible (= 2 × 120). Monture sénile (pré-3.5) : 1 neurone quelle que soit la génération (client `senileExtractionRewardQuantity` = 1 et DPLN ; **désaccord** : Guidactik affirme que les montures d'avant la 3.5 ne peuvent pas être extraites). Source : client RidesData ; concordant avec le guide DPLN.

## 8. Capture (génération 1)

- Monstres : Dragodinde amande sauvage (DofusDB monstre 171), Dragodinde rousse sauvage (200), Dragodinde dorée sauvage (666), niveaux 62 à 70, sous-zone « Territoire des dragodindes sauvages » (DofusDB sous-zone 235, aire 28 Montagne des Koalaks ; zaap Village des Éleveurs [-16,1]). DofusDB rattache aussi Amande et Rousse à la sous-zone 170 « Plaine des Scarafeuilles », probablement un reste. Sources : DofusDB, DPLN, Dafous. Confiance haute.
- Les entrées DofusDB MountData « Dragodinde Amande/Rousse/Dorée Sauvage » (ids 1, 6, 74) sont des restes de l'ancien système (sans effets, sans objet 3.5) : en 3.5 la capture donne directement la monture de génération 1. Elles ne figurent donc pas dans `mounts`.

## 9. Changements après la 3.5

- **3.6 (live, 3.6.12.16)** : arbre et stats identiques aux guides écrits pour la 3.5 (février-mars 2026).
- **Bêta 3.7.3.3** : arbre et stats inchangés ; **génétons doublés** (G1..G9 = 2/4/8/15/30/60/120/250/500) et **capacité des jauges d'enclos doublée** (paliers 80 000 / 140 000 / 180 000 / 200 000 au lieu de 40 000 / 70 000 / 90 000 / 100 000, même consommation 10/20/30/40 par tick). Bundles bêta re-extraits par le vérificateur : seul `breedingTokenRewardQuantity` change dans RidesData. À surveiller lors de la sortie de la 3.7.
- **Devblog officiel MAJ 3.7 (16/09/2026)** : confirme « de 2 génétons pour la génération 2 jusqu'à 500 génétons pour la génération 10 » (formulation indexée sur la génération visée, alors que le client indexe sur la génération du parent : mêmes nombres) et « de 100 000 à 200 000 points, avec des jauges de 80 000, 60 000, 40 000 et 20 000 » (tailles des 4 paliers). Il annonce aussi : efficacité des carburants ×2, Optimakina +10 % → +20 %, étable 250 → 500 places, Animakina = choix du sexe, capacités aléatoires naturelles (Reproductrice 3 %, Sage 6 %, Précoce/Amoureuse/Endurante 8 %). Non live au 2026-10-02 (cytrus `dofus3` = 3.6.12.16).

## 10. Questions ouvertes

- Rôle exact de `geneticWeight` (90 pour les monocolores sauf **Dorée = 20**, 20 pour les bicolores) dans les probabilités « Autres » d'un accouplement : non documenté, à confirmer par l'agent « probabilités ». **[Critique de complétude 2026-10-02 : rôle établi dans `mechanics.md` §1.2 — w(m) = poids de position (10 soi-même / 6 parent) × geneticWeight, normalisé par arbre ; reproduit les 24 pourcentages des captures in-game DPLN (high pour la structure). Le seul point non testé est le facteur κ des croisements dont l'enfant est monocolore.]**
- Arrondi des stats aux niveaux intermédiaires (voir §6).

## Vérification

Vérification adversariale faite le 2026-10-02 par un agent distinct. J'ai re-dérivé l'arbre de façon indépendante, à partir d'autres sources quand c'était possible. **Verdict : arbre solide.** Aucune erreur sur les croisements, les générations, les ids ni les stats. J'ai corrigé 4 erreurs de rédaction ou de règle et précisé des sources.

### Contrôles effectués (31 affirmations)

| # | Affirmation contrôlée | Méthode / source indépendante | Résultat |
|---|---|---|---|
| 1 | 68 Dragodindes famille 1 (hors 3 « Sauvage »), présentes une seule fois, noms FR exacts | `research/raw/mounts.json` (DofusDB /mounts, 71 entrées famille 1) | OK 68/68 |
| 2 | Ids 1, 6, 74 = « Sauvage » sans effets | DofusDB /mounts | OK |
| 3 | 66 élevables = 11 monocolores + 55 bicolores ; les 55 paires de monocolores existent toutes | script sur le JSON | OK |
| 4 | Effectifs G1..G10 = 3/3/2/7/2/11/2/15/2/19 | DofusDB succès 96-101 et 130-132 (nombre d'objectifs) ; DofusElevage ; Guidactik | OK |
| 5 | Génération de chaque monture G2–G10 | DofusDB `/achievement-objectives` : critère `EB>idMonture` rattaché au succès de la bonne génération | OK 63/63 |
| 6 | Génération des parents < génération de l'enfant, pour les 63 croisements | script | OK |
| 7 | Bicolore « X et Y » = X × Y, génération = max + 1 ; ordre des couleurs du nom = `colors` | script | OK 55/55 |
| 8 | Les 66 croisements | DPLN les-dragodindes.html **re-téléchargé** (MAJ 23/02/2026), parsé automatiquement | OK 66/66 |
| 9 | Croisements des 8 monocolores G3–G9 | JOL (ancien système, contexte) | OK 8/8 |
| 10 | Données client RidesData / EvolutiveEffects | **Ré-extraction indépendante** depuis le CDN Ankama (manifeste 3.6.12.16, SHA-1 vérifiés, UnityPy) | 0 différence (308 montures, 885 effets) |
| 11 | Version live 3.6.12.16, bêta 3.7.3.3 | cytrus.json + DofusDB /version | OK (il existe aussi un canal « experimental » 3.6.12.20) |
| 12 | Valeurs niveau 100 | DofusDB MountData `diceSide` | OK 67/68 (Plumes : valeur héritée, déjà documentée) |
| 13 | Valeurs niveau 200 | DofusDB /items typeId 331 (`diceNum`) | OK 68/68 |
| 14 | Valeurs niveau 200 | API dofusdude /mounts/all | OK 68/68 |
| 15 | Valeurs niveau 200 | DPLN | 66/68 : **2 coquilles DPLN**, et non 1 (voir corrections) |
| 16 | Ids d'objets 3.5 pour l'HDV | DofusDB typeId 331, recherche par nom | OK 68/68 (plage 33000–33068, 33064 absent) |
| 17 | statsByLevel aux niveaux 1/50/100/150/200 | recalcul à partir des taux client re-extraits (décimales exactes) | OK, 0 écart |
| 18 | Exemple Pourpre : Vit [[100,3],[200,1]], Force [[100,1],[200,0,2]] | ma propre extraction | OK |
| 19 | Stockage des taux en float32 (0,0099999998) | ma propre extraction | OK (précisé : en double floor = 0, en float32 = 1,0) |
| 20 | Niveau 200 : Ébène et Rousse = 400 Vit / 90 Agi / 45 Soins | capture DPLN `tuto3i10statsdragos`, vue | OK |
| 21 | Niveau 1 : 1 Vit / 0 PA / 0 Rés. crit. | captures DPLN `tuto3i44/45/46`, vues | OK, avec réserve : en-tête « Niveau 60 » = niveau de l'objet ; Statut « Niveau 1 » ; XP affichée incohérente |
| 22 | Ivoire et Turquoise × Ivoire et Pourpre → Émeraude G9 | capture DPLN `tuto3i57accouplement`, vue | OK, et 240 génétons affichés = 2 × 120 (G8) |
| 23 | Génétons live G1..G9 = 1/2/4/8/15/30/60/120/250 | guide DPLN §VIII + capture n° 22 | OK |
| 24 | Génétons bêta G1..G9 = 2/4/8/15/30/60/120/250/500 | **ré-extraction du bundle bêta** + devblog 3.7 du 16/09/2026 | OK ; seul champ RidesData qui change en bêta |
| 25 | Jauges bêta 80k/140k/180k/200k, consommation 10/20/30/40 inchangée | ré-extraction du bundle bêta PaddockGauges + devblog (« 80 000, 60 000, 40 000 et 20 000 ») | OK |
| 26 | XP métier = 30 × génération par parent | guide DPLN §II | OK |
| 27 | Extraction = génération, G1 = 0, sénile = 1 | guide DPLN §VIII, DPLN Dragodindes, Dafous | OK ; **désaccord** Guidactik pour les séniles (ajouté) |
| 28 | Monstres 171/200/666, niveaux 62–70, sous-zone 235 | DofusDB /monsters, /subareas, /areas | OK (235 = aire 28 Montagne des Koalaks ; 170 = Plaine des Scarafeuilles) |
| 29 | Un seul croisement par Dragodinde | guide DPLN §V + client (1 paire chacune) | OK |
| 30 | Captures G1 minimales (4/10/34/112 ; 113 et 224 en G10) | recalcul (arbre binaire, accouplements = captures − 1) | OK |
| 31 | Spéciales : 50 Gladiatons chez Gladiagob [-11,-37] | DPLN seul ; DofusDB confirme l'existence du PNJ 7501 et de l'objet 30442 | prix non recoupé → confiance moyenne |

### Corrections apportées

1. **Règle des monocolores impaires (§3 + note JSON)**. L'ancien texte disait « deux bicolores de la génération précédente ». C'est faux pour la G5 : Pourpre = Amande et Rousse (**G2**) × Ébène et Indigo (G4), et Orchidée = Dorée et Rousse (**G2**) × Ébène et Indigo (G4). Corrigé en « dont au moins une de la génération précédente ». Sources : client, DPLN, JOL.
2. **Vitalité (§1, §6 + note JSON)**. L'ancien texte disait « toutes les Dragodindes donnent 300/400 Vitalité ». C'est faux pour la Dragodinde en armure, qui ne donne aucune Vitalité (DofusDB /mounts 88, objet 33035, DPLN, JOL).
3. **Coquilles DPLN (§2, §6, sources et notes JSON)**. Il y en a 2, et non 1 : il faut ajouter « Amande et Rousse 60 Soins » au niveau 200. La vraie valeur est 45 (client, DofusDB 33009, dofusdude).
4. **Preuves de la formule (§6 + note JSON)** :
   - La capture « niveau 1 » est en réalité un en-tête « Niveau 60 » (niveau de l'objet). Le niveau 1 se lit dans le panneau Statut, et l'XP affichée est incohérente : preuve à prendre avec prudence.
   - L'ancien `EvolutiveEffect.as` compte à partir de `firstLevel = 1`. Il donnerait 397 Vitalité au niveau 200, ce que contredisent les captures 3.5. Je l'ai signalé.
   - Nuance float32 / double ajoutée.
5. **Ajouts sans changement de forme du JSON** :
   - Chaque entrée de `statsRaw` reçoit `valueDofusDBLevel` (= 100), `valueDofusDBSource`, `progressionPerLevel` (taux client [[100, p1], [200, p2]]) et `progressionSource`.
   - Raison : dans `tree-muldo.json` et `tree-volkorne.json`, `valueDofusDB` est la valeur **niveau 200**. Dans ce fichier, c'est la valeur **niveau 100**. Le pipeline de données doit en tenir compte.
6. **Sources ajoutées** : devblog officiel 3.7, cytrus.json, DofusDB achievement-objectives, DofusElevage, Dafous, captures in-game DPLN. Ajouté aussi : le doublon « Prune et Pourpre » dans Guidactik, le désaccord Guidactik sur l'extraction des séniles, la sous-zone 170 et le canal « experimental » 3.6.12.20.

### Doutes restants

- Arrondi aux niveaux intermédiaires (floor ou arrondi au plus proche) : toujours non tranché. Aucune capture in-game à un niveau intermédiaire n'a été trouvée.
- Rôle de `geneticWeight` dans les probabilités « Autres » (Dorée = 20 alors que les autres monocolores sont à 90 ; valeur confirmée par ma ré-extraction) : non documenté. **[Critique de complétude 2026-10-02 : rôle établi dans `mechanics.md` §1.2 — w(m) = poids de position (10 soi-même / 6 parent) × geneticWeight, normalisé par arbre ; reproduit les 24 pourcentages des captures in-game DPLN (high pour la structure). Le seul point non testé est le facteur κ des croisements dont l'enfant est monocolore.]**
- Dragodinde à Plumes au niveau 100 (300 Vit / 30 renvoi) : repose sur le seul taux client. JOL (ancien système) indiquait 300 Vit / 10 renvoi, DofusDB MountData 100 / 10.
- Le prix des spéciales (50 Gladiatons) ne vient que de DPLN.
- La page du devblog 3.7 renvoie 403 aux requêtes automatisées. Son contenu a été lu dans la copie locale, et ses chiffres (génétons, jauges) sont confirmés par ma ré-extraction du client bêta.

## Critique de complétude (2026-10-02)

Champs ajoutés au JSON pour aligner les trois arbres (aucune valeur existante modifiée ; tout est recalculé depuis `raw/dofus-client/rides-*.json` et `evolutive-effects-3.6.12.16.json`, puis revérifié contre le client : 0 écart) : `breedable` (false pour les spéciales G0), `extractionQty`, `captureMonsterId` (G1 capturables, DofusDB `monsters`), `statsRaw[].valueLevel100` / `valueLevel200` / `valueLevelsSource`, `harmonizedSchema` à la racine. Dragodindes en plus : `itemId` (68/68 vérifiés contre les noms DofusDB `items` typeId 331), `geneticWeight`, `extractionNeuronesDeDragodinde`, `breederXpWhenParent`, `genetonsWhenParent`, `equipMinLevel`, `statsConfidence`, `clientDataSource`, et à la racine `clientSpeciesId`, `countsByGeneration`, `totalMounts`, `totalBreedable`, `statScaling`, `excludedLegacyVariants`. Muldos en plus : `statsByLevel` aux niveaux 50 et 150, `equipMinLevel` (60, DofusDB items typeId 332). Index général et spécification consolidée : [`README.md`](README.md).
