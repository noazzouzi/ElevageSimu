# Crafts du métier Éleveur : base de données et provenance des ingrédients

> ElevageSimu, recherche. Généré le 2026-10-01.
> Données lisibles par machine : `research/data/crafts.json` (211 recettes, 471 ingrédients).
> Version du jeu en ligne : **3.6.12.16**. DofusDB `/version` et le client Ankama donnent les mêmes recettes.
> Version bêta analysée : **3.7.3.3**, d'après le client bêta sur le CDN Ankama (voir §7).

Chaque fait porte une source et un niveau de confiance (haute / moyenne / basse).
Abréviations : **DofusDB** = api.dofusdb.fr ; **client** = données du client Dofus 3 (Unity) extraites du CDN Ankama ;
**guide DPLN** = https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html (édition 2026, système 3.5).
Le système d'élevage d'avant la 3.5 n'est **pas** utilisé ici : objets d'élevage, filets et potions de l'époque ont été supprimés en 3.5 (guide DPLN).

---

## À retenir (pour l'optimiseur)

1. **211 recettes en 3 familles : 120 carburants, 81 makinas, 10 filets.** Chaque recette a été classée, aucune n'est restée de côté (DofusDB et client ; confiance haute).
2. **Taille d'un carburant : la quantité d'ingrédients ne change pas, seule la durabilité augmente.** Chaque ingrédient d'un carburant est demandé ×1. Un Minuscule et un Gigantesque du même tier demandent donc autant d'objets (2 à 5), mais le Gigantesque donne 5× plus de durabilité. Les ingrédients ne sont pas les mêmes : la ressource de monstre monte en niveau avec la taille. Sur le prix en kamas, rien n'est garanti : il dépend de l'HDV (DofusDB ; confiance haute).
3. **Une jauge vide remplie jusqu'à 100 000 demande au minimum 20 carburants Gigantesques** (8 Extraits, 6 Philtres, 4 Potions, 2 Élixirs), soit 60 ressources. En Minuscules, il faut 100 carburants et 300 ressources (calcul ; confiance haute).
4. **Un point de durabilité vaut autant quel que soit le tier.** Le tier fixe seulement la vitesse : 10, 20, 30 ou 40 points par tranche de 10 s. Ce point est crédité à **chaque** monture éligible de l'enclos, 10 au maximum. Le coût d'un point de monture vaut donc `coût du carburant / durabilité / nb de montures éligibles` (guide DPLN et client ; confiance haute).
5. **Chaque makina = 1 ressource de boss + 10 Pépites + des ressources de montures sauvages.** Ces dernières passent de 1 à 10 **par couleur** entre les générations 2 et 10 (la Kromakina Muldo demande 3 couleurs, la Kromakina Volkorne 2 : jusqu'à 30 et 20 unités en G10). Toute la série des générations 2 à 10 coûte 810 Pépites (DofusDB ; confiance haute).
6. **Les ressources de monture se droppent, elles ne s'extraient pas.** Moustaches, Bave, Ailes, Griffe, Pic, Queue et Sueur tombent des montures sauvages pendant les combats de capture, où la prospection compte. L'extraction donne seulement Neurone, Ambre ou Corne. **Aucune recette Éleveur ne les utilise** : elles servent aux équipements des autres métiers (DofusDB et client ; confiance haute).
7. **XP du métier : les crafts rapportent peu.** Une recette de niveau L faite au même niveau rapporte L XP (ratio de type 5 %). Il faut environ 6 200 crafts de carburant, soit environ 21 500 ressources, pour aller du niv. 15 au niv. 200. Les niveaux 1 à 15 se font mieux par la capture (30 XP par monture) (formule du client Dofus et table XP DPLN ; confiance moyenne).
8. **La bêta 3.7.3.3 change beaucoup de choses** (confiance haute que ce soit dans la bêta, moyenne que ça sorte tel quel) :
   - carburants à **durabilité ×2**, avec des paliers de jauge eux aussi doublés (80 000 / 140 000 / 180 000 / 200 000) et **renommés** (« Extrait de perte de Sérénité », « Élixir d'Expérience de monture »…) ;
   - **Optimakina passe de +10 % à +20 %** ;
   - l'**Animakina permet de choisir le sexe du bébé** et ne donne plus de capacité aléatoire. D'après le devblog officiel 3.7 du 16/09/2026, les capacités apparaîtront alors **sans makina** : Reproductrice 3 %, Sage 6 %, Précoce 8 %, Amoureuse 8 %, Endurante 8 %. Les Animakinas déjà possédées seront converties (devblog ; haute pour l'annonce) ;
   - 74 recettes de makinas sur 81 sont modifiées : les ressources de monture se répartissent sur toutes les couleurs, et 6 ressources de boss sont remplacées.

---

## 0. Sources, méthode, confiance

| Donnée | Source | Confiance |
|---|---|---|
| Recettes (ingrédients, quantités, niveaux) | DofusDB `recipes?jobId=79` (fichier `research/raw/recipes-eleveur.json`) **comparé à** `RecipesDataRoot` du client 3.6.12.16 : 0 différence sur les 211 recettes | haute |
| Effets des objets (durabilité, plafond, bonus des makinas) | DofusDB `possibleEffects` et descriptions en jeu (« … de 5000 sans dépasser 40 000 ») | haute |
| Types d'objet et `craftXpRatio` | DofusDB `item-types` (326 Carburant d'enclos = 5, 323 Makina = 5, 99 Filet de capture = 5) ; objet 32521 Filet universel = 50 ; identique dans le client bêta | haute |
| Sources des ingrédients | DofusDB `items` (dropMonsterIds, resourcesBySubarea), `monsters` (drops, taux par grade, sous-zones), `skills` (gatheredRessourceItem → métier et niveau), `subareas`, `areas`, `recipes?resultId[$in]` (aucun ingrédient n'est craftable) | haute (taux de drop = taux de base, hors prospection) |
| Formule d'XP de craft | client Dofus 2 (AS3) `Item.getCraftXpByJobLevel` : https://github.com/scalexm/DofusInvoker (com/ankamagames/dofus/datacenter/items/Item.as), reprise telle quelle par d'autres outils (ex. github.com/Neriere/dbhdv `jobLevelingService.ts`) | moyenne (non revérifiée en jeu sur Dofus 3) |
| Table d'XP du métier (niv. 200 = 398 000) | https://www.dofuspourlesnoobs.com/tableaux-dexpeacuterience.html (données `xpData.metier`) | moyenne-haute |
| Bêta 3.7.3.3 | Client bêta, `https://cytrus.cdn.ankama.com/dofus/releases/beta/linux/6.0_3.7.3.3.manifest` : `RecipesDataRoot`, `ItemsDataRoot`, `ItemTypesDataRoot`, `EffectsDataRoot`, `I18n/fr.bin` (noms et descriptions), avec les outils de `research/raw/dofus-client/tools` | haute (contenu de la bêta), moyenne (version finale) |
| Jauges et paliers | `research/raw/dofus-client/paddock-gauges-*.json` (client) et guide DPLN | haute |
| Annonces 3.7 (officiel) | Devblog Ankama du 16/09/2026, https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1771790-maj-3-7-confort-jeu-lisibilite-ajustements (copie : `research/raw/mechanics-evidence/texts/devblog-3.7-elevage-2026-09-16.txt`). Confirme Animakina → choix du sexe, Optimakina +20 %, carburants ×2, jauges ×2, recettes de makinas revues, renommage des carburants | haute (annonce), moyenne (version finale) |
| Neurones chez l'Amateur de Guildaton | DPLN « Mise à jour 3.5 », https://www.dofuspourlesnoobs.com/mise-a-jour-305.html | haute |

Remarques :
- Deux recettes ont un `updatedAt` DofusDB au 2026-06-23 (mise à jour 3.6) : **Petit Extrait de Caresseur** et **Grand Extrait de Caresseur**. Le contenu antérieur n'est pas connu. Les 209 autres n'ont pas bougé depuis l'import 3.5 du 2026-03-03 (DofusDB ; confiance moyenne).
- La page 3.6 de DPLN (https://www.dofuspourlesnoobs.com/mise-a-jour-306.html) ne mentionne aucun changement sur les crafts Éleveur. Elle ajoute seulement les succès de monstres « Muldos sauvages » et « Volkornes sauvages » (confiance moyenne).

---

## 1. Inventaire et vérification des comptes

| Famille (`resultTypeId`) | Attendu | Trouvé | Explication |
|---|---:|---:|---|
| Carburants d'enclos (326) | 6 jauges × 4 tiers × 5 tailles = 120 | **120** | Conforme. Extraits niv. 5→45, Philtres 55→95, Potions 105→145, Élixirs 155→195, avec une taille de plus tous les 10 niveaux (guide DPLN et DofusDB). |
| Makinas (323) | 3 types × 3 familles × N générations | **81** | N = **9** (générations 2 à 10). Il n'existe pas de makina de génération 1 : la génération cible d'un accouplement vaut au moins 2. Une makina de génération G sert pour toute génération cible ≤ G (guide DPLN et descriptions en jeu : « … de génération G ou inférieure »), donc une makina G2 couvre aussi un accouplement dont la cible serait la génération 1 (deux parents de même couleur). Niveaux : de 17 (Kromakina Dragodinde G2) à 189 (Optimakina Muldo G10), par pas de 2 **à l'intérieur d'une génération**, avec un saut de 4 entre G2→G3, G3→G4, …, G7→G8 (aucune makina aux niveaux 35, 55, 75, 95, 115, 135). Premier niveau de chaque génération : 17, 37, 57, 77, 97, 117, 137, 155, 173. |
| Filets de capture (99) | 1 universel + 3 types × 3 familles = 10 | **10** | Conforme (guide DPLN). |
| **Total** | 211 | **211** | `unmapped` est vide. |

Tous les crafts utilisent le skill 422 (atelier des éleveurs, [-20,1] d'après le guide DPLN).
**Aucun ingrédient n'est lui-même craftable** : `recipes?resultId[$in]` renvoie 0 résultat pour les 471 ingrédients (DofusDB ; haute).

---

## 2. Carburants d'enclos

### 2.1 Structure (DofusDB et guide DPLN ; haute)

| Jauge (`gauge`) | Clé client | Effet sur les montures de l'enclos | Ressource de base des recettes |
|---|---|---|---|
| mangeoire | FEEDER | Expérience de la monture | Poisson (Pêcheur) |
| abreuvoir | DRINKING_TROUGH | Maturité (si −2 000 ≤ sérénité ≤ 2 000) | Plante (Alchimiste) |
| foudroyeur | BLASTER | Endurance (si sérénité < 0) | Minerai (Mineur) |
| dragofesse | DRAGO_BUTT | Amour (si sérénité ≥ 0) | Viande (drop réservé aux Chasseurs) |
| caresseur | PATTER | Sérénité + | Céréale (Paysan) |
| baffeur | SLAPPER | Sérénité − | Bois (Bûcheron) |

| Tier | Nom | Débloqué au niv. | Plafond : le carburant ne remplit pas au-delà | Ingrédients par craft |
|---:|---|---:|---:|---|
| 1 | Extrait | 5 | 40 000 | 1 ressource de base + 1 ressource de monstre |
| 2 | Philtre | 55 | 70 000 | 1 ressource de base + 2 ressources de monstres |
| 3 | Potion | 105 | 90 000 | 1 ressource de base + 3 ressources de monstres |
| 4 | Élixir | 155 | 100 000 (pas de plafond) | 1 ressource de base + 4 ressources de monstres |

Tailles et durabilité, vérifiées sur l'effet de l'objet (`value`) : Minuscule 1 000, Petit(e) 2 000, Normal (pas de préfixe) 3 000, Grand(e) 4 000, Gigantesque 5 000.
Niveau de recette = 5 + 10 × (5 × (tier − 1) + index de taille), où l'index de taille va de 0 (Minuscule) à 4 (Gigantesque).
Nommage exact en jeu : « Petit / Grand » pour Extrait, Philtre et Élixir, mais « Petite / Grande Potion ».

- **Effets :** les effectId 3810 (Baffeur), 3812 (Caresseur), 3814 (Foudroyeur), 3816 (Abreuvoir), 3818 (Dragofesse) et 3820 (Mangeoire) se lisent « Jauge de X +#3 (Max #2) ». Le plafond est codé `diceNum×diceSide` = 100×400, 100×700 ou 100×900. Les Élixirs n'ont pas de plafond, codé (1, 0).
- **Quantités :** **tous les ingrédients de carburant sont ×1.**
- **Partage des ressources de base :** chaque ressource de base sert à deux recettes consécutives. Exemple : Goujon pour Minuscule (5) et Petit (15) Extrait de Mangeoire.
- **Ressources de monstres :** elles sont propres à chaque recette. Les carburants en utilisent **300**, soit 30 Extraits × 1 + 30 Philtres × 2 + 30 Potions × 3 + 30 Élixirs × 4. **Chacune ne sert qu'à une seule recette Éleveur.**

Ressource de base par jauge, avec le métier et le niveau de récolte requis (DofusDB `skills` et `items`) :

| Jauge | Ressource de base (1 par craft) — par tier/taille |
|---|---|
| Mangeoire | Goujon (Pêcheur 1) [niv. recette 5, 15] → Truite (Pêcheur 20) [niv. recette 25, 35] → Poisson-Chaton (Pêcheur 40) [niv. recette 45, 55] → Carpe d'Iem (Pêcheur 60) [niv. recette 65, 75] → Brochet (Pêcheur 80) [niv. recette 85, 95] → Anguille (Pêcheur 100) [niv. recette 105, 115] → Perche (Pêcheur 120) [niv. recette 125, 135] → Lotte (Pêcheur 140) [niv. recette 145, 155] → Bar Rikain (Pêcheur 160) [niv. recette 165, 175] → Tanche (Pêcheur 180) [niv. recette 185, 195] |
| Abreuvoir | Ortie (Alchimiste 1) [niv. recette 5, 15] → Sauge (Alchimiste 20) [niv. recette 25, 35] → Trèfle à 5 feuilles (Alchimiste 40) [niv. recette 45, 55] → Menthe Sauvage (Alchimiste 60) [niv. recette 65, 75] → Orchidée Freyesque (Alchimiste 80) [niv. recette 85, 95] → Edelweiss (Alchimiste 100) [niv. recette 105, 115] → Graine de Pandouille (Alchimiste 120) [niv. recette 125, 135] → Ginseng (Alchimiste 140) [niv. recette 145, 155] → Belladone (Alchimiste 160) [niv. recette 165, 175] → Mandragore (Alchimiste 180) [niv. recette 185, 195] |
| Foudroyeur | Fer (Mineur 1) [niv. recette 5, 15] → Cuivre (Mineur 20) [niv. recette 25, 35] → Bronze (Mineur 40) [niv. recette 45, 55] → Kobalte (Mineur 60) [niv. recette 65, 75] → Manganèse (Mineur 80) [niv. recette 85, 95] → Étain (Mineur 100) [niv. recette 105, 115] → Argent (Mineur 120) [niv. recette 125, 135] → Bauxite (Mineur 140) [niv. recette 145, 155] → Or (Mineur 160) [niv. recette 165, 175] → Cendrepierre (Mineur 180) [niv. recette 185, 195] |
| Dragofesse | Viande Intangible (Chasseur ≥1) [niv. recette 5, 15] → Viande Faisandée (Chasseur ≥20) [niv. recette 25, 35] → Viande Minérale (Chasseur ≥40) [niv. recette 45, 55] → Viande Ladre (Chasseur ≥60) [niv. recette 65, 75] → Viande Sanguinolente (Chasseur ≥80) [niv. recette 85, 95] → Viande Exsudative (Chasseur ≥100) [niv. recette 105, 115] → Viande Saignante (Chasseur ≥120) [niv. recette 125, 135] → Viande Macérée (Chasseur ≥140) [niv. recette 145, 155] → Viande Fraîche (Chasseur ≥160) [niv. recette 165, 175] → Viande Gâtée (Chasseur ≥180) [niv. recette 185, 195] |
| Caresseur | Blé (Paysan 1) [niv. recette 5, 15] → Orge (Paysan 20) [niv. recette 25, 35] → Avoine (Paysan 40) [niv. recette 45, 55] → Houblon (Paysan 60) [niv. recette 65, 75] → Lin (Paysan 80) [niv. recette 85, 95] → Seigle (Paysan 100) [niv. recette 105, 115] → Malt (Paysan 120) [niv. recette 125, 135] → Chanvre (Paysan 140) [niv. recette 145, 155] → Maïs (Paysan 160) [niv. recette 165, 175] → Millet (Paysan 180) [niv. recette 185, 195] |
| Baffeur | Bois de Frêne (Bûcheron 1) [niv. recette 5, 15] → Bois de Châtaignier (Bûcheron 20) [niv. recette 25, 35] → Bois de Noyer (Bûcheron 40) [niv. recette 45, 55] → Bois de Chêne (Bûcheron 60) [niv. recette 65, 75] → Bois d'Érable (Bûcheron 80) [niv. recette 85, 95] → Bois de Pin (Bûcheron 90) [niv. recette 105, 115] → Bois de Merisier (Bûcheron 120) [niv. recette 125, 135] → Bois d'Ébène (Bûcheron 140) [niv. recette 145, 155] → Bois de Charme (Bûcheron 160) [niv. recette 165, 175] → Bois d'Orme (Bûcheron 180) [niv. recette 185, 195] |

**Viandes** (Dragofesse) : elles ne se récoltent pas. Elles tombent de dizaines de monstres, mais seulement si le personnage a le **métier Chasseur** au niveau indiqué (critère de drop DofusDB `Pj>41,N&CU>0`, 41 étant le jobId Chasseur ; confiance haute sur le critère, moyenne sur l'interprétation de `CU>0`).

### 2.2 Efficacité par taille : ingrédients pour 1 000 de durabilité (calcul ; haute)

| Tier \ Taille | Minuscule (1000) | Petit (2000) | Normal (3000) | Grand (4000) | Gigantesque (5000) |
|---|---:|---:|---:|---:|---:|
| Extrait (2 ingr./craft) | 2 | 1 | 0.667 | 0.5 | 0.4 |
| Philtre (3 ingr./craft) | 3 | 1.5 | 1 | 0.75 | 0.6 |
| Potion (4 ingr./craft) | 4 | 2 | 1.333 | 1 | 0.8 |
| Élixir (5 ingr./craft) | 5 | 2.5 | 1.667 | 1.25 | 1 |

Ce que montre ce tableau :
- **Les grandes tailles sont plus efficaces en nombre d'objets** : 5× moins d'objets par point entre Minuscule et Gigantesque, et 5× moins de clics et de crafts.
- **Elles ne sont pas forcément moins chères en kamas.** La ressource de monstre d'un Gigantesque vient de monstres plus hauts, avec des taux de drop souvent plus bas. Par exemple, le Gigantesque Élixir de Mangeoire demande 4 ressources de monstres niv. 200 à 2 % de drop, alors que le Minuscule Élixir de Mangeoire utilise des ressources entre 2,7 % et 24 %.
- **Règle pour l'application :** pour chaque tier, prendre la taille qui minimise `Σ prix_HDV(ingrédients) / durabilité` (ou `prix_HDV(carburant) / durabilité` si on l'achète tout fait), parmi les tailles débloquées par le niveau d'Éleveur. Il faut des prix HDV pour trancher, DofusDB ne les donne pas.
- La progression d'un tier à l'autre tient au nombre d'ingrédients : 2→3→4→5 par craft, soit 0,4 → 0,6 → 0,8 → 1,0 objet pour 1 000 de durabilité en Gigantesque.

### 2.3 Remplir une jauge de 0 à 100 000

Paliers (client `PaddockGaugesData` 3.6.12.16 et guide DPLN ; haute) : le tier 1 va de 0 à 40 000, le tier 2 de 40 000 à 70 000, le tier 3 de 70 000 à 90 000 et le tier 4 de 90 000 à 100 000.
Un carburant ne peut pas monter la jauge au-dessus du plafond de son tier, mais un carburant de tier supérieur peut remplir les tiers du dessous (guide DPLN).
Le moins cher en ingrédients est donc de remplir chaque tier avec le carburant **minimal** qui le permet.

| Tier rempli | Points | Carburant minimal | Nb Minuscule | Nb Petit | Nb Normal | Nb Grand | Nb Gigantesque | Ingrédients (Gigantesque) | Ingrédients (Minuscule) |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Tier 1 | 40 000 | Extrait | 40 | 20 | 14 (dépasse de 2000) | 10 | 8 | 16 | 80 |
| Tier 2 | 30 000 | Philtre | 30 | 15 | 10 | 8 (dépasse de 2000) | 6 | 18 | 90 |
| Tier 3 | 20 000 | Potion | 20 | 10 | 7 (dépasse de 1000) | 5 | 4 | 16 | 80 |
| Tier 4 | 10 000 | Élixir | 10 | 5 | 4 (dépasse de 2000) | 3 (dépasse de 2000) | 2 | 10 | 50 |
| **Total 0→100 000** | 100 000 | — | 100 | 50 | 35 | 26 | **20** | **60** | 300 |

- **« Dépasse de »** : quand la taille ne divise pas la tranche, le dernier carburant déborderait du plafond. On ne sait pas si l'excédent est perdu ou si le jeu refuse le dépôt (**non vérifié en jeu**). Indice : le devblog 3.7 annonce « une fenêtre de confirmation indiquera la quantité ajoutée lors du remplissage des jauges afin de limiter le gaspillage de carburant ». En live, l'excédent est donc **probablement perdu** (confiance moyenne). L'optimiseur doit éviter les dépôts qui débordent. Le Minuscule, le Petit et le Gigantesque tombent juste sur tous les tiers.
- **Remplir 0→100 000 coûte au minimum 20 carburants Gigantesques et 60 ressources.** Il faut le niveau 195 d'Éleveur pour crafter le Gigantesque Élixir, ou bien acheter les carburants.
- En pratique, on **entretient** la jauge plutôt que de la remplir une fois : elle se vide en continu. Se reporter au §2.4.

Liste de courses pour remplir une jauge de 0 à 100 000 en Gigantesques uniquement (DofusDB ; haute) :

| Jauge | 8 × Gig. Extrait | 6 × Gig. Philtre | 4 × Gig. Potion | 2 × Gig. Élixir |
|---|---|---|---|---|
| Mangeoire | 8× Poisson-Chaton, 8× Scalp de Bwork Archer | 6× Brochet, 6× Peau de Cochon de Farle, 6× Échasse de Molette | 4× Lotte, 4× Défense de Gliglicérin, 4× Bracelet de Ino-Naru, 4× Étoffe de Vigie Pirate | 2× Tanche, 2× Pince de Krabouilleur, 2× Cervelle de Verglasseur, 2× Pédoncule de Mérulor, 2× Pic du Nocturlabe |
| Abreuvoir | 8× Trèfle à 5 feuilles, 8× Lait de Cochon de Lait | 6× Orchidée Freyesque, 6× Os de Mama Koalak, 6× Plume de Gobvious | 4× Ginseng, 4× Sabot de Gliglicérin, 4× Étoffe de Kurookin, 4× Écaille de Harpirate | 2× Mandragore, 2× Bec de Granduk, 2× Malleus de Karkanik, 2× Oreille de Mécanofoux, 2× Chaussette du Cyclophandre |
| Foudroyeur | 8× Bronze, 8× Corail Morito | 6× Manganèse, 6× Peau de Drakoalak, 6× Canine de Mergranlou | 4× Bauxite, 4× Étoffe de Gliglidoudur, 4× Tête de lance de Fangshu, 4× Mât de Fantômat | 2× Cendrepierre, 2× Dent de Cuirboule, 2× Ethmoïde de Stalak, 2× Sternum de Mansordide, 2× Sépale de Drosérâle |
| Dragofesse | 8× Viande Minérale, 8× Corail Passaoh | 6× Viande Sanguinolente, 6× Patte de Bouledogre, 6× Queue du Mulou | 4× Viande Macérée, 4× Cuir de Gliglibido, 4× Peau de Rouquette, 4× Coquille de Fantimonier | 2× Viande Gâtée, 2× Cœur d'Empaillé, 2× Huile de Pikoleur, 2× Griffe de Kanimate, 2× Bec de Dodox |
| Caresseur | 8× Avoine, 8× Corail Malibout | 6× Lin, 6× Oreille de Bouledogre, 6× Testicules de Cocholou | 4× Chanvre, 4× Estomac de Gliglidoudur, 4× Poils de Pétartifoux, 4× Queue de Fantomalamère | 2× Millet, 2× Étoffe de Grodruche, 2× Molaire de Ventrublion, 2× Queue de Sinistrofu, 2× Crinière de Krakal |
| Baffeur | 8× Bois de Noyer, 8× Corail Kouraçao | 6× Bois d'Érable, 6× Jus de Ouassingue, 6× Poils de Mulounoké | 4× Bois d'Ébène, 4× Poil de Gliglitch, 4× Poils de Boumbardier, 4× Pince du Fancrôme | 2× Bois d'Orme, 2× Culotte de Harrogant, 2× Plume de Cycloïde, 2× Broderie d'Eskoglyphe, 2× Molaire de Nessil |

Achat au PNJ (guide DPLN ; moyenne, données 3.5) : **Adèle Vage** en [-18,1] ne vend que des Gigantesques, contre de la **poussière d'élevage**.

| Carburant Gigantesque | Prix en poussière | Poussière pour 1 000 de durabilité |
|---|---:|---:|
| Extrait | 50 | 10 |
| Philtre | 200 | 40 |
| Potion | 800 | 160 |
| Élixir | 3 200 | 640 |

Remplir 0→100 000 au PNJ coûte donc 8×50 + 6×200 + 4×800 + 2×3 200 = **11 200 poussières**.
La poussière était une compensation de la 3.5 : 0,55 par point de durabilité des anciens objets d'élevage (guide DPLN). Une autre source de poussière n'a pas été identifiée ici.

### 2.4 Vitesse et coût par point : ce que l'optimiseur doit modéliser (client et guide DPLN ; haute)

| Tier actif | Consommation (live 3.6) | Durée pour vider le tier (live) | Taille du tier en bêta 3.7 | Durée en bêta 3.7 (consommation inchangée) |
|---|---:|---:|---:|---:|
| 1 (0–40 k) | 10 / 10 s | 40 000 s ≈ 11 h 07 | 80 000 | ≈ 22 h 13 |
| 2 (40–70 k) | 20 / 10 s | 15 000 s ≈ 4 h 10 | 60 000 | ≈ 8 h 20 |
| 3 (70–90 k) | 30 / 10 s | 6 667 s ≈ 1 h 51 | 40 000 | ≈ 3 h 42 |
| 4 (90–100 k) | 40 / 10 s | 2 500 s ≈ 42 min | 20 000 | ≈ 1 h 23 |
| **Total** | | **≈ 17 h 49** (le guide DPLN donne 17 h 48) | 200 000 | ≈ 35 h 39 |

- **Durabilité :** chaque point consommé donne +1 dans la jauge correspondante à **chaque** monture de l'enclos qui peut en profiter, jusqu'à 10 (guide DPLN).
- **Jauge active sans bénéficiaire :** elle ne se vide pas s'il n'y a aucune monture éligible (guide DPLN).
- **Coût par point de monture :** `prix(carburant) / durabilité / nb_montures_éligibles`. Ce coût **ne dépend pas du tier**. Les tiers hauts font seulement aller plus vite, et coûtent plus cher par durabilité puisque leurs ingrédients sont plus nombreux et de plus haut niveau.
- **Ordre de grandeur :** une monture devient féconde avec 20 000 d'Endurance, 20 000 de Maturité et 20 000 d'Amour (client `RideGauges` ; guide DPLN). Avec 10 montures éligibles, il faut donc **au moins 60 000 de durabilité** de carburants (Foudroyeur, Abreuvoir, Dragofesse), plus le Baffeur ou le Caresseur pour régler la sérénité. Cela fait au minimum 12 Gigantesques (ex. 12 Gigantesques Extraits si tout reste au tier 1), soit 6 000 par monture.
- **Bêta 3.7 :** chaque carburant donne 2× plus de durabilité pour la même recette, ce qui **divise par deux le coût en carburant d'une fécondation**, à recettes et jauges de monture (20 000) inchangées.
- **Bonus Almanax** (guide DPLN ; moyenne) : le 10 mai (Loumi), les Éleveurs économisent 15 % de leurs ingrédients. Le 10 août (Rigamix), chaque craft a 25 % de chances de donner un second objet. Les jours où l'effet d'une jauge est doublé (Trôma, Inndo, Nunu, Jibejan, Mau, Foya), chaque point de carburant vaut double.

### 2.5 Tables complètes des 120 carburants

Source des ingrédients : métier et niveau de récolte, ou le monstre « naturel » avec le meilleur taux de base, non archimonstre et proche du niveau de l'objet. Tous les monstres sont dans `crafts.json`.

#### Carburants de Mangeoire

| Niv. | Carburant | Durab. | Plafond | Ingrédients (×1 chacun) — source principale |
|---:|---|---:|---:|---|
| 5 | Minuscule Extrait de Mangeoire | 1000 | 40 000 | Goujon [Pêcheur 1]; Patte d'Arakne Magique [Arakne niv.16-20  10 %] |
| 15 | Petit Extrait de Mangeoire | 2000 | 40 000 | Goujon [Pêcheur 1]; Pierre de Granit [Martoa niv.22-30  8.84 %] |
| 25 | Extrait de Mangeoire | 3000 | 40 000 | Truite [Pêcheur 20]; Œil de Pikdoa [Pikdoa niv.22-30  53 %] |
| 35 | Grand Extrait de Mangeoire | 4000 | 40 000 | Truite [Pêcheur 20]; Dent de Kwoan [Kwoan niv.32-40  8.44 %] |
| 45 | Gigantesque Extrait de Mangeoire | 5000 | 40 000 | Poisson-Chaton [Pêcheur 40]; Scalp de Bwork Archer [Bwork Archer niv.37-48  8.12 %] |
| 55 | Minuscule Philtre de Mangeoire | 1000 | 70 000 | Poisson-Chaton [Pêcheur 40]; Minerai Étrange [Robionicle niv.55-63  7.52 %]; Poils de Wo Wabbit [Wo Wabbit niv.52-60  7.64 %] |
| 65 | Petit Philtre de Mangeoire | 2000 | 70 000 | Carpe d'Iem [Pêcheur 60]; Peau de Koalak Immature [Koalak Immature niv.60-68  43 %]; Étoffe de Foufayteur [Foufayteur niv.64-72  7.16 %] |
| 75 | Philtre de Mangeoire | 3000 | 70 000 | Carpe d'Iem [Pêcheur 60]; Œuf de Dragoeuf Calcaire [Dragoeuf Calcaire niv.62-70  7.24 %]; Œil de Kanigrou [Kanigrou niv.62-105  7.24 %] |
| 85 | Grand Philtre de Mangeoire | 4000 | 70 000 | Brochet [Pêcheur 80]; Peau de Piralak [Piralak niv.80-88  39 %]; Peau de Tivelo [Tivelo niv.82-90  6.44 %] |
| 95 | Gigantesque Philtre de Mangeoire | 5000 | 70 000 | Brochet [Pêcheur 80]; Peau de Cochon de Farle [Cochon de Farle niv.90-98  36 %]; Échasse de Molette [Molette niv.91-99  6.08 %] |
| 105 | Minuscule Potion de Mangeoire | 1000 | 90 000 | Anguille [Pêcheur 100]; Bourgeon de Fourbasse [Fourbasse niv.92-100  6 %]; Faux menton du Bourbassingue [Bourbassingue niv.95-107  5.76 %]; Bâton du Kilibriss [Kilibriss niv.98-110  5.64 %] |
| 115 | Petite Potion de Mangeoire | 2000 | 90 000 | Anguille [Pêcheur 100]; Corne de Boufmouth de guerre [Boufmouth de guerre niv.112-120  31 %]; Étoffe du Fauchalak [Fauchalak niv.108-120  5.24 %]; Slip de Troollaraj [Troollaraj niv.112-120  5.24 %] |
| 125 | Potion de Mangeoire | 3000 | 90 000 | Perche [Pêcheur 120]; Tibia du Guerrier Zoth [Guerrier Zoth niv.120-132  4.76 %]; Morpion de Truchideur [Truchideur niv.112-128  4.92 %]; Cawotte Transgénique [Wabbit Vampire niv.112-120  5.2 %] |
| 135 | Grande Potion de Mangeoire | 4000 | 90 000 | Perche [Pêcheur 120]; Duvet de Mamansot [Mamansot niv.132-140  28 %]; Amygdales du Bitouf Sombre [Bitouf Sombre niv.130-142  26 %]; Fleur de Cactiflore [Cactiflore niv.122-130  29 %] |
| 145 | Gigantesque Potion de Mangeoire | 5000 | 90 000 | Lotte [Pêcheur 140]; Défense de Gliglicérin [Gliglicérin niv.138-146  25 %]; Bracelet de Ino-Naru [Ino-Naru niv.132-140  27 %]; Étoffe de Vigie Pirate [Vigie pirate niv.142-150  21 %] |
| 155 | Minuscule Élixir de Mangeoire | 1000 | 100 000 | Lotte [Pêcheur 140]; Œuf de Crapeur [Crapeur niv.152-160  2.68 %]; Œil de Phozami [Phozami niv.142-150  24 %]; Bave du Kaskargo [Kaskargo niv.152-160  21 %]; Crinière d'Orfélin [Orfélin niv.151-159  22 %] |
| 165 | Petit Élixir de Mangeoire | 2000 | 100 000 | Bar Rikain [Pêcheur 160]; Oreille de Chargus [Chargus niv.152-160  22 %]; Queue de Yomi Givrefoux [Yomi Givrefoux niv.162-170  3.24 %]; Barbe de Seith [Seith niv.162-170  19 %]; Lanterne usée [Tsume-bozu niv.162-170  19 %] |
| 175 | Élixir de Mangeoire | 3000 | 100 000 | Bar Rikain [Pêcheur 160]; Volve de Fongeur [Fongeur niv.172-180  17 %]; Écorce de Champaknyde [Champaknyde niv.172-180  17 %]; Racine d'Abrazif [Abrazif niv.172-180  2.84 %]; Caleçon Blanc [Bwork Élémental d'Air niv.172-180  2.84 %] |
| 185 | Grand Élixir de Mangeoire | 4000 | 100 000 | Tanche [Pêcheur 180]; Oreille de Blérice [Blérice niv.182-190  2.44 %]; Vomer d'Apériglours [Apériglours niv.182-190  2.44 %]; Aile de Gloursaya [Gloursaya niv.182-190  2.44 %]; Molaire de Blérice [Blérice niv.182-190  15 %] |
| 195 | Gigantesque Élixir de Mangeoire | 5000 | 100 000 | Tanche [Pêcheur 180]; Pince de Krabouilleur [Krabouilleur niv.200-212  2 %]; Cervelle de Verglasseur [Verglasseur niv.200-212  2 %]; Pédoncule de Mérulor [Mérulor niv.200-212  2 %]; Pic du Nocturlabe [Nocturlabe niv.200-212  2 %] |

#### Carburants d'Abreuvoir

| Niv. | Carburant | Durab. | Plafond | Ingrédients (×1 chacun) — source principale |
|---:|---|---:|---:|---|
| 5 | Minuscule Extrait d'Abreuvoir | 1000 | 40 000 | Ortie [Alchimiste 1]; Bois Vermoulu [Campagnoll niv.16-20  9.2 %] |
| 15 | Petit Extrait d'Abreuvoir | 2000 | 40 000 | Ortie [Alchimiste 1]; Bougie du Mineur Sombre [Mineur Sombre niv.42-50  8.04 %] |
| 25 | Extrait d'Abreuvoir | 3000 | 40 000 | Sauge [Alchimiste 20]; Plume de Tofu Maléfique [Tofu Maléfique niv.32-200  8.44 %] |
| 35 | Grand Extrait d'Abreuvoir | 4000 | 40 000 | Sauge [Alchimiste 20]; Estomac de Tofu Ventripotent [Tofu Ventripotent niv.32-40  8.44 %] |
| 45 | Gigantesque Extrait d'Abreuvoir | 5000 | 40 000 | Trèfle à 5 feuilles [Alchimiste 40]; Lait de Cochon de Lait [Cochon de Lait niv.42-50  8.04 %] |
| 55 | Minuscule Philtre d'Abreuvoir | 1000 | 70 000 | Trèfle à 5 feuilles [Alchimiste 40]; Oreille du Grand Pa Wabbit [Grand Pa Wabbit niv.52-60  7.6 %]; Peau de Larve Champêtre [Larve Champêtre niv.56-64  7.48 %] |
| 65 | Petit Philtre d'Abreuvoir | 2000 | 70 000 | Menthe Sauvage [Alchimiste 60]; Baballe [Croc Gland niv.62-70  7.24 %]; Boîte de Vétauran [Vétauran niv.66-74  7.08 %] |
| 75 | Philtre d'Abreuvoir | 3000 | 70 000 | Menthe Sauvage [Alchimiste 60]; Œuf de Dragoeuf Charbon [Dragoeuf Charbon niv.62-70  7.24 %]; Boomerang du Dok Alako [Dok Alako niv.70-78  6.92 %] |
| 85 | Grand Philtre d'Abreuvoir | 4000 | 70 000 | Orchidée Freyesque [Alchimiste 80]; Os de Pékeualak [Pékeualak niv.80-88  39 %]; Œil de Saltik [Saltik niv.82-90  38 %] |
| 95 | Gigantesque Philtre d'Abreuvoir | 5000 | 70 000 | Orchidée Freyesque [Alchimiste 80]; Os de Mama Koalak [Mama Koalak niv.90-98  36 %]; Plume de Gobvious [Gobvious niv.90-98  37 %] |
| 105 | Minuscule Potion d'Abreuvoir | 1000 | 90 000 | Edelweiss [Alchimiste 100]; Glouto Rhum [Gloutovore niv.92-100  6 %]; Bec du Kido [Kido niv.95-107  5.76 %]; Peau de Mandrine [Mandrine niv.102-110  34 %] |
| 115 | Petite Potion d'Abreuvoir | 2000 | 90 000 | Edelweiss [Alchimiste 100]; Œil de Boufmouth de guerre [Boufmouth de guerre niv.112-120  5.16 %]; Boomerang du Maître Koalak [Maître Koalak niv.108-120  5.24 %]; Bracelet de Force de Trooll [Troollogram niv.112-120  5.24 %] |
| 125 | Potion d'Abreuvoir | 3000 | 90 000 | Graine de Pandouille [Alchimiste 120]; Peau de Dragnarok [Dragnarok niv.112-120  31 %]; Plume de Truchideur [Truchideur niv.112-128  30 %]; Œil de Wabbit Céphale [Wabbit Céphale niv.112-120  31 %] |
| 135 | Grande Potion d'Abreuvoir | 4000 | 90 000 | Graine de Pandouille [Alchimiste 120]; Huile de Mamansot [Mamansot niv.132-140  4.68 %]; Coco du Bitouf Sombre [Bitouf Sombre niv.130-142  4.36 %]; Parchemin de Cactana [Cactana niv.122-130  29 %] |
| 145 | Gigantesque Potion d'Abreuvoir | 5000 | 90 000 | Ginseng [Alchimiste 140]; Sabot de Gliglicérin [Gliglicérin niv.138-146  4.2 %]; Étoffe de Kurookin [Kurookin niv.132-140  27 %]; Écaille de Harpirate [Harpirate niv.142-150  24 %] |
| 155 | Minuscule Élixir d'Abreuvoir | 1000 | 100 000 | Ginseng [Alchimiste 140]; Cœur de Crapeur [Crapeur niv.152-160  16 %]; Corne de Père Phorreur [Père Phorreur niv.142-150  24 %]; Porte-bonheur de Malalfa [Malalfa niv.142-150  24 %]; Étoffe de Kaniblou [Kaniblou niv.151-159  3.68 %] |
| 165 | Petit Élixir d'Abreuvoir | 2000 | 100 000 | Belladone [Alchimiste 160]; Croissant de Tsukinochi [Tsukinochi niv.152-160  22 %]; Crâne de Yokaï Givrefoux [Yokaï Givrefoux niv.162-170  3.24 %]; Pagne de Trantroa [Trantroa niv.162-170  19 %]; Collier de Chakichan [Chakichan niv.152-160  22 %] |
| 175 | Élixir d'Abreuvoir | 3000 | 100 000 | Belladone [Alchimiste 160]; Pédoncule de Fongeur [Fongeur niv.172-180  2.84 %]; Carapace de Ver des Sables [Pikténia niv.162-170  3.24 %]; Écorce d'Abrazif [Abrazif niv.172-180  17 %]; Caleçon Bleu [Bwork Élémental d'Eau niv.172-180  2.84 %] |
| 185 | Grand Élixir d'Abreuvoir | 4000 | 100 000 | Mandragore [Alchimiste 180]; Étoffe de Croleur [Croleur niv.182-190  2.44 %]; Venin d'Éperfide [Éperfide niv.172-180  17 %]; Laine de Glouragan [Glouragan niv.182-190  2.44 %]; Oreille de Croleur [Croleur niv.182-190  15 %] |
| 195 | Gigantesque Élixir d'Abreuvoir | 5000 | 100 000 | Mandragore [Alchimiste 180]; Bec de Granduk [Granduk niv.200-212  2 %]; Malleus de Karkanik [Karkanik niv.200-212  2 %]; Oreille de Mécanofoux [Mécanofoux niv.200-212  2 %]; Chaussette du Cyclophandre [Cyclophandre niv.200-212  2 %] |

#### Carburants de Foudroyeur

| Niv. | Carburant | Durab. | Plafond | Ingrédients (×1 chacun) — source principale |
|---:|---|---:|---:|---|
| 5 | Minuscule Extrait de Foudroyeur | 1000 | 40 000 | Fer [Mineur 1]; Sporme du Champ Champ [Champ Champ niv.16-20  9.2 %] |
| 15 | Petit Extrait de Foudroyeur | 2000 | 40 000 | Fer [Mineur 1]; Étoffe du Sanglier [Sanglier niv.22-30  8.84 %] |
| 25 | Extrait de Foudroyeur | 3000 | 40 000 | Cuivre [Mineur 20]; Scalp de Milimulou [Milimulou niv.22-90  8.84 %] |
| 35 | Grand Extrait de Foudroyeur | 4000 | 40 000 | Cuivre [Mineur 20]; Crâne de Chafer [Chafer niv.32-40  8.44 %] |
| 45 | Gigantesque Extrait de Foudroyeur | 5000 | 40 000 | Bronze [Mineur 40]; Corail Morito [Crustorail Morito niv.36-48  48 %] |
| 55 | Minuscule Philtre de Foudroyeur | 1000 | 70 000 | Bronze [Mineur 40]; Estomac de Wo Wabbit [Wo Wabbit niv.52-60  45 %]; Bidule inutile [Malle Outillée niv.57-65  7.44 %] |
| 65 | Petit Philtre de Foudroyeur | 2000 | 70 000 | Kobalte [Mineur 60]; Humérus du Sparo [Sparo niv.57-69  7.28 %]; Langue de Craquelope [Craquelope niv.62-70  7.24 %] |
| 75 | Philtre de Foudroyeur | 3000 | 70 000 | Kobalte [Mineur 60]; Coquille de Dragoeuf Ardoise [Dragoeuf Ardoise niv.62-70  43 %]; Racine d'Abraknyde Sombre [Abraknyde Sombre niv.78-90  39 %] |
| 85 | Grand Philtre de Foudroyeur | 4000 | 70 000 | Manganèse [Mineur 80]; Poils de Koalak Indigo [Koalak Indigo niv.80-88  39 %]; Fil de Néfileuse [Néfileuse niv.82-90  38 %] |
| 95 | Gigantesque Philtre de Foudroyeur | 5000 | 70 000 | Manganèse [Mineur 80]; Peau de Drakoalak [Drakoalak niv.90-98  37 %]; Canine de Mergranlou [Mergranlou niv.92-100  36 %] |
| 105 | Minuscule Potion de Foudroyeur | 1000 | 90 000 | Étain [Mineur 100]; Trukikol Mort [Trukikol niv.92-100  36 %]; Corne de Berserkoffre [Berserkoffre niv.92-100  36 %]; Peau de Minoskito [Minoskito niv.102-110  34 %] |
| 115 | Petite Potion de Foudroyeur | 2000 | 90 000 | Étain [Mineur 100]; Cuir de Bouftonmouth [Bouftonmouth niv.112-120  5.96 %]; Peau de Maître Koalak [Maître Koalak niv.108-120  31 %]; Épaulière de Troolligark [Troolligark niv.112-120  5.24 %] |
| 125 | Potion de Foudroyeur | 3000 | 90 000 | Argent [Mineur 120]; Corne de Dragacé [Dragacé niv.112-120  31 %]; Écusson du Sergent Zoth [Sergent Zoth niv.123-135  4.64 %]; Dents de Wabbit Vampire [Wabbit Vampire niv.112-120  31 %] |
| 135 | Grande Potion de Foudroyeur | 4000 | 90 000 | Argent [Mineur 120]; Peau de Mansobèse [Mansobèse niv.132-140  30 %]; Écorce de Fécorce [Fécorce niv.128-140  4.44 %]; Moustaches de Cactoblongo [Cactoblongo niv.122-130  29 %] |
| 145 | Gigantesque Potion de Foudroyeur | 5000 | 90 000 | Bauxite [Mineur 140]; Étoffe de Gliglidoudur [Gliglidoudur niv.137-145  25 %]; Tête de lance de Fangshu [Fangshu niv.132-140  27 %]; Mât de Fantômat [Fantômat niv.142-150  24 %] |
| 155 | Minuscule Élixir de Foudroyeur | 1000 | 100 000 | Bauxite [Mineur 140]; Ulna de Solfataré [Solfataré niv.152-160  3.64 %]; Peau de Métaphorreur [Métaphorreur niv.142-150  24 %]; Pic de Malépik [Malépik niv.142-150  24 %]; Boule de Panthègros [Panthègros niv.150-158  3.72 %] |
| 165 | Petit Élixir de Foudroyeur | 2000 | 100 000 | Or [Mineur 160]; Plastron de Tambouraï [Tambouraï niv.152-160  22 %]; Laine de Maho Givrefoux [Maho Givrefoux niv.162-170  19 %]; Peau de Vindeux [Vindeux niv.162-170  19 %]; Kapokaza [Bakazako niv.162-170  19 %] |
| 175 | Élixir de Foudroyeur | 3000 | 100 000 | Or [Mineur 160]; Volve de Fistulor [Fistulor niv.172-180  17 %]; Peau de Trémorse [Trémorse niv.162-170  19 %]; Bave de Champ à Gnons [Champ à Gnons niv.172-180  17 %]; Caleçon Brun [Bwork Élémental de Terre niv.172-180  2.84 %] |
| 185 | Grand Élixir de Foudroyeur | 4000 | 100 000 | Cendrepierre [Mineur 180]; Poil de Blérauve [Blérauve niv.182-190  2.44 %]; Pince de Lucrane [Lucrane niv.172-180  17 %]; Iris de Boulglours [Boulglours niv.182-190  2.44 %]; Griffe de Blérauve [Blérauve niv.182-190  15 %] |
| 195 | Gigantesque Élixir de Foudroyeur | 5000 | 100 000 | Cendrepierre [Mineur 180]; Dent de Cuirboule [Cuirboule niv.200-212  2 %]; Ethmoïde de Stalak [Stalak niv.200-212  2 %]; Sternum de Mansordide [Mansordide niv.200-212  2 %]; Sépale de Drosérâle [Drosérâle niv.200-212  2 %] |

#### Carburants de Dragofesse

| Niv. | Carburant | Durab. | Plafond | Ingrédients (×1 chacun) — source principale |
|---:|---|---:|---:|---|
| 5 | Minuscule Extrait de Dragofesse | 1000 | 40 000 | Viande Intangible [Chasseur ≥1]; Herbe Folle [Gardienne Champêtre niv.16-20  9.24 %] |
| 15 | Petit Extrait de Dragofesse | 2000 | 40 000 | Viande Intangible [Chasseur ≥1]; Crinière de Scélérat Strubien [Scélérat Strubien niv.22-30  8.84 %] |
| 25 | Extrait de Dragofesse | 3000 | 40 000 | Viande Faisandée [Chasseur ≥20]; Rondelles de Milirat Strubien [Milirat Strubien niv.22-30  8.84 %] |
| 35 | Grand Extrait de Dragofesse | 4000 | 40 000 | Viande Faisandée [Chasseur ≥20]; Chauve-souris [Vampire niv.32-40  8.44 %] |
| 45 | Gigantesque Extrait de Dragofesse | 5000 | 40 000 | Viande Minérale [Chasseur ≥40]; Corail Passaoh [Crustorail Passaoh niv.36-48  48 %] |
| 55 | Minuscule Philtre de Dragofesse | 1000 | 70 000 | Viande Minérale [Chasseur ≥40]; Osselet de Black Wabbit Squelette [Black Wabbit Squelette niv.50-58  7.72 %]; Fléau de Robot Fléau [Robot Fléau niv.53-61  7.6 %] |
| 65 | Petit Philtre de Dragofesse | 2000 | 70 000 | Viande Ladre [Chasseur ≥60]; Pierre de Crystaloboule [Craqueboule niv.62-70  7.24 %]; Kolérat Mort [Kolérat de Laboratoire niv.58-70  7.24 %] |
| 75 | Philtre de Dragofesse | 3000 | 70 000 | Viande Ladre [Chasseur ≥60]; Coquille de Dragoeuf Charbon [Dragoeuf Charbon niv.62-70  43 %]; Boomerang du Warko Marron [Warko Marron niv.74-82  40 %] |
| 85 | Grand Philtre de Dragofesse | 4000 | 70 000 | Viande Sanguinolente [Chasseur ≥80]; Poils de Koalak Reinette [Koalak Reinette niv.80-88  39 %]; Dent de Gargantûl [Gargantûl niv.82-90  38 %] |
| 95 | Gigantesque Philtre de Dragofesse | 5000 | 70 000 | Viande Sanguinolente [Chasseur ≥80]; Patte de Bouledogre [Bouledogre niv.89-97  37 %]; Queue du Mulou [Mulou niv.92-100  36 %] |
| 105 | Minuscule Potion de Dragofesse | 1000 | 90 000 | Viande Exsudative [Chasseur ≥100]; Plume de Dostrogo [Dostrogo niv.92-100  36 %]; Antenne de Trésantène [Trésantène niv.92-100  36 %]; Coco du Bitouf des Plaines [Bitouf des Plaines niv.97-109  5.68 %] |
| 115 | Petite Potion de Dragofesse | 2000 | 90 000 | Viande Exsudative [Chasseur ≥100]; Oreille de Bouftonmouth [Bouftonmouth niv.112-120  36 %]; Couche usagée de Warko Violet [Warko Violet niv.106-118  32 %]; Laine du Trooll Furieux [Troolléolé niv.112-120  5.24 %] |
| 125 | Potion de Dragofesse | 3000 | 90 000 | Viande Saignante [Chasseur ≥120]; Peau de Draguaindrop [Draguaindrop niv.112-120  31 %]; Mouchoir de la Gamine Zoth [Gamine Zoth niv.117-129  4.88 %]; Oreilles de Wabbit Fluo [Wabbit Fluo niv.112-120  31 %] |
| 135 | Grande Potion de Dragofesse | 4000 | 90 000 | Viande Saignante [Chasseur ≥120]; Aile de Mansobèse [Mansobèse niv.132-140  4.92 %]; Écorce de Brouture [Brouture niv.127-139  4.48 %]; Os de Sramouraï [Sramouraï niv.122-130  29 %] |
| 145 | Gigantesque Potion de Dragofesse | 5000 | 90 000 | Viande Macérée [Chasseur ≥140]; Cuir de Gliglibido [Gliglibido niv.140-148  25 %]; Peau de Rouquette [Rouquette niv.132-140  27 %]; Coquille de Fantimonier [Fantimonier niv.142-150  24 %] |
| 155 | Minuscule Élixir de Dragofesse | 1000 | 100 000 | Viande Macérée [Chasseur ≥140]; Résidu de Solfataré [Solfataré niv.152-160  22 %]; Griffe de Phorrêveur [Phorrêveur niv.142-150  24 %]; Bolas de Maltrio [Maltrio niv.142-150  24 %]; Chaîne de Panthègros [Panthègros niv.150-158  22 %] |
| 165 | Petit Élixir de Dragofesse | 2000 | 100 000 | Viande Fraîche [Chasseur ≥160]; Os de Jiangshi-Nobi [Jiangshi-Nobi niv.152-160  22 %]; Cuir de Maho Givrefoux [Maho Givrefoux niv.162-170  3.24 %]; Dent de Trezz [Trezz niv.162-170  19 %]; Œil de Madura [Madura niv.162-170  19 %] |
| 175 | Élixir de Dragofesse | 3000 | 100 000 | Viande Fraîche [Chasseur ≥160]; Oreille de Fistulor [Fistulor niv.172-180  2.84 %]; Patte de Masticroc [Masticroc niv.162-170  19 %]; Lamelle de Champbis [Champbis niv.172-180  17 %]; Caleçon Rouge [Bwork Élémental de Feu niv.172-180  2.84 %] |
| 185 | Grand Élixir de Dragofesse | 4000 | 100 000 | Viande Gâtée [Chasseur ≥180]; Manubrium de Wolvero [Wolvero niv.182-190  2.44 %]; Aile de Puceronde [Puceronde niv.172-180  17 %]; Péroné du Marôdeur [Marôdeur niv.182-190  14 %]; Queue de Wolvero [Wolvero niv.182-190  15 %] |
| 195 | Gigantesque Élixir de Dragofesse | 5000 | 100 000 | Viande Gâtée [Chasseur ≥180]; Cœur d'Empaillé [Empaillé niv.200-212  2 %]; Huile de Pikoleur [Pikoleur niv.200-212  2 %]; Griffe de Kanimate [Kanimate niv.200-212  2 %]; Bec de Dodox [Dodox niv.200-212  2 %] |

#### Carburants de Caresseur

| Niv. | Carburant | Durab. | Plafond | Ingrédients (×1 chacun) — source principale |
|---:|---|---:|---:|---|
| 5 | Minuscule Extrait de Caresseur | 1000 | 40 000 | Blé [Paysan 1]; Engrais [Pissenlit Diabolique niv.16-20  9.24 %] |
| 15 | Petit Extrait de Caresseur | 2000 | 40 000 | Blé [Paysan 1]; Feuille de Rose Obscure [Rose Obscure niv.19-27  8.96 %] |
| 25 | Extrait de Caresseur | 3000 | 40 000 | Orge [Paysan 20]; Œil de Ramane Strubien [Ramane Strubien niv.22-30  8.84 %] |
| 35 | Grand Extrait de Caresseur | 4000 | 40 000 | Orge [Paysan 20]; Champignon Luidegît [Champa Vert niv.35-43  8.32 %] |
| 45 | Gigantesque Extrait de Caresseur | 5000 | 40 000 | Avoine [Paysan 40]; Corail Malibout [Crustorail Malibout niv.36-48  48 %] |
| 55 | Minuscule Philtre de Caresseur | 1000 | 70 000 | Avoine [Paysan 40]; Bandeau de Black Wabbit Squelette [Black Wabbit Squelette niv.50-58  46 %]; Souris verte [Souris Verte niv.54-62  45 %] |
| 65 | Petit Philtre de Caresseur | 2000 | 70 000 | Houblon [Paysan 60]; Cœur de Craqueleur [Craqueleur des Plaines niv.62-70  7.24 %]; Fragment d'Épée Reptilienne [Arakne Olithique niv.62-70  7.24 %] |
| 75 | Philtre de Caresseur | 3000 | 70 000 | Houblon [Paysan 60]; Coquille de Dragoeuf Argile [Dragoeuf Argile niv.62-70  43 %]; Écorce de Liroye Merline [Pirolienne niv.82-90  6.44 %] |
| 85 | Grand Philtre de Caresseur | 4000 | 70 000 | Lin [Paysan 80]; Poils de Koalak Coco [Koalak Coco niv.80-88  39 %]; Laine de Dardalaine [Dardalaine niv.82-90  38 %] |
| 95 | Gigantesque Philtre de Caresseur | 5000 | 70 000 | Lin [Paysan 80]; Oreille de Bouledogre [Bouledogre niv.89-97  6.16 %]; Testicules de Cocholou [Cocholou niv.92-100  6.04 %] |
| 105 | Minuscule Potion de Caresseur | 1000 | 90 000 | Seigle [Paysan 100]; Fleur de Gloutovore [Gloutovore niv.92-100  36 %]; Langue de Mimikado [Mimikado niv.92-100  36 %]; Fragment de cerveau poli [Craqueleur Poli niv.96-108  34 %] |
| 115 | Petite Potion de Caresseur | 2000 | 90 000 | Seigle [Paysan 100]; Clavicule de Boufmouth [Boufmouth dressé niv.94-114  5.48 %]; Poils de Barbe du Warko Violet [Warko Violet niv.106-118  5.32 %]; Enfumoir Zoth [Disciple Zoth niv.114-126  30 %] |
| 125 | Potion de Caresseur | 3000 | 90 000 | Malt [Paysan 120]; Aile de Draguaindrop [Draguaindrop niv.112-120  5.24 %]; Braguette du Maître Zoth [Maître Zoth niv.126-138  4.52 %]; Feuille de Cawotman [Cawotman niv.112-120  31 %] |
| 135 | Grande Potion de Caresseur | 4000 | 90 000 | Malt [Paysan 120]; Plume du Timansot [Timansot niv.132-140  32 %]; Écorce de Nerbe [Nerbe niv.126-138  4.52 %]; Sacoche de Kartouche [Kartouche niv.122-130  29 %] |
| 145 | Gigantesque Potion de Caresseur | 5000 | 90 000 | Chanvre [Paysan 140]; Estomac de Gliglidoudur [Gliglidoudur niv.137-145  4.24 %]; Poils de Pétartifoux [Pétartifoux niv.132-140  27 %]; Queue de Fantomalamère [Fantomalamère niv.142-150  24 %] |
| 155 | Minuscule Élixir de Caresseur | 1000 | 100 000 | Chanvre [Paysan 140]; Téphra d'Atomystique [Atomystique niv.152-160  2.96 %]; Cloaque du Poolay [Poolay niv.142-158  22 %]; Pousse de Malzerb [Malzerb niv.142-150  24 %]; Canine de Félygiène [Félygiène niv.150-158  3.72 %] |
| 165 | Petit Élixir de Caresseur | 2000 | 100 000 | Maïs [Paysan 160]; Étoffe de Samouraï fantôme [Tsukinochi niv.152-160  3.64 %]; Oreille de Soryo Givrefoux [Soryo Givrefoux niv.162-170  19 %]; Poil de Chacrebleu [Chacrebleu niv.152-160  22 %]; Yokayu [Madura niv.162-170  3.24 %] |
| 175 | Élixir de Caresseur | 3000 | 100 000 | Maïs [Paysan 160]; Œil de Dramanite [Dramanite niv.172-180  2.84 %]; Langue de Morsquale [Morsquale niv.162-170  19 %]; Œil de Champmane [Champmane niv.172-180  17 %]; String en Cuir de la Mama Bwork [Mama Bwork niv.172-180  2.84 %] |
| 185 | Grand Élixir de Caresseur | 4000 | 100 000 | Millet [Paysan 180]; Œil de Fleuro [Fleuro niv.182-190  2.36 %]; Patte de Scoliopode [Scoliopode niv.172-180  17 %]; Peau d'Ouilleur [Ouilleur niv.182-190  14 %]; Oreille de Fleuro [Fleuro niv.182-190  14 %] |
| 195 | Gigantesque Élixir de Caresseur | 5000 | 100 000 | Millet [Paysan 180]; Étoffe de Grodruche [Grodruche niv.200-212  2 %]; Molaire de Ventrublion [Ventrublion niv.200-212  2 %]; Queue de Sinistrofu [Sinistrofu niv.200-212  2 %]; Crinière de Krakal [Krakal niv.200-212  2 %] |

#### Carburants de Baffeur

| Niv. | Carburant | Durab. | Plafond | Ingrédients (×1 chacun) — source principale |
|---:|---|---:|---:|---|
| 5 | Minuscule Extrait de Baffeur | 1000 | 40 000 | Bois de Frêne [Bûcheron 1]; Feuille de Tournesol Sauvage [Tournesol Sauvage niv.16-20  9.24 %] |
| 15 | Petit Extrait de Baffeur | 2000 | 40 000 | Bois de Frêne [Bûcheron 1]; Os Invisible du Chafer Invisible [Chafer Invisible niv.25-37  51 %] |
| 25 | Extrait de Baffeur | 3000 | 40 000 | Bois de Châtaignier [Bûcheron 20]; Patte d'Arakne des Égouts [Arakne des Égouts niv.22-30  8.84 %] |
| 35 | Grand Extrait de Baffeur | 4000 | 40 000 | Bois de Châtaignier [Bûcheron 20]; Colonne Vertébrale [Chafer Invisible niv.25-37  8.56 %] |
| 45 | Gigantesque Extrait de Baffeur | 5000 | 40 000 | Bois de Noyer [Bûcheron 40]; Corail Kouraçao [Crustorail Kouraçao niv.36-48  48 %] |
| 55 | Minuscule Philtre de Baffeur | 1000 | 70 000 | Bois de Noyer [Bûcheron 40]; Crâne de Wabbit Squelette [Wabbit Squelette niv.48-56  7.8 %]; Duvet de Bourdard [Bourdard niv.51-59  7.68 %] |
| 65 | Petit Philtre de Baffeur | 2000 | 70 000 | Bois de Chêne [Bûcheron 60]; Dent en Or de Craqueleur [Craqueleur niv.62-70  7.24 %]; Œil de Crowneille [Crowneille niv.62-70  7.24 %] |
| 75 | Philtre de Baffeur | 3000 | 70 000 | Bois de Chêne [Bûcheron 60]; Coquille de Dragoeuf Calcaire [Dragoeuf Calcaire niv.62-70  43 %]; Ambre d'Abraknyde Sombre [Coffre Sombre niv.50  100 %] |
| 85 | Grand Philtre de Baffeur | 4000 | 70 000 | Bois d'Érable [Bûcheron 80]; Poils de Koalak Griotte [Koalak Griotte niv.80-88  39 %]; Chélicères d'Arapex [Arapex niv.82-90  38 %] |
| 95 | Gigantesque Philtre de Baffeur | 5000 | 70 000 | Bois d'Érable [Bûcheron 80]; Jus de Ouassingue [Le Ouassingue Entourbé niv.92-104  5.88 %]; Poils de Mulounoké [Mulounoké niv.92-100  36 %] |
| 105 | Minuscule Potion de Baffeur | 1000 | 90 000 | Bois de Pin [Bûcheron 90]; Feuille de Fourbasse [Fourbasse niv.92-100  36 %]; Corde de Boursoin [Boursoin niv.92-100  36 %]; Cœur de pierre poli [Craqueleur Poli niv.96-108  5.72 %] |
| 115 | Petite Potion de Baffeur | 2000 | 90 000 | Bois de Pin [Bûcheron 90]; Laine de Boufmouth [Boufmouth dressé niv.94-114  33 %]; Cubitus de Momie Koalak [Momie Koalak niv.106-118  32 %]; Peau de Kraméléhon [Kraméléhon niv.110-118  64 %] |
| 125 | Potion de Baffeur | 3000 | 90 000 | Bois de Merisier [Bûcheron 120]; Peau de Dragueuse [Dragueuse niv.112-120  31 %]; Rotule du Disciple Zoth [Disciple Zoth niv.114-126  5 %]; Sang de Wabbit Garou [Wabbit Garou niv.112-120  31 %] |
| 135 | Grande Potion de Baffeur | 4000 | 90 000 | Bois de Merisier [Bûcheron 120]; Bec du Timansot [Timansot niv.132-140  5.28 %]; Écorce de Chiendent [Chiendent niv.125-137  4.56 %]; Foulard de Milimaître [Milimaître niv.122-130  29 %] |
| 145 | Gigantesque Potion de Baffeur | 5000 | 90 000 | Bois d'Ébène [Bûcheron 140]; Poil de Gliglitch [Gliglitch niv.142-150  24 %]; Poils de Boumbardier [Boumbardier niv.132-140  27 %]; Pince du Fancrôme [Fancrôme niv.142-150  24 %] |
| 155 | Minuscule Élixir de Baffeur | 1000 | 100 000 | Bois d'Ébène [Bûcheron 140]; Pierre d'Atomystique [Atomystique niv.152-160  18 %]; Tresse du Poolay [Poolay niv.142-158  3.72 %]; Pétale de Malter [Malzerb niv.142-150  4.04 %]; Griffe de Félygiène [Félygiène niv.150-158  22 %] |
| 165 | Petit Élixir de Baffeur | 2000 | 100 000 | Bois de Charme [Bûcheron 160]; Fleur d'Onabu-Geisha [Onabu-Geisha niv.152-160  22 %]; Patte de Soryo Givrefoux [Soryo Givrefoux niv.162-170  3.24 %]; Queue de Chasquatch [Chasquatch niv.152-160  22 %]; Kaokurimono [Kaonashi niv.162-170  19 %] |
| 175 | Élixir de Baffeur | 3000 | 100 000 | Bois de Charme [Bûcheron 160]; Lamelle de Dramanite [Dramanite niv.172-180  17 %]; Dent de Cycloporth [Cycloporth niv.162-170  19 %]; Langue de Champodonte [Champodonte niv.172-180  17 %]; Furoncle de la Mama Bwork [Mama Bwork niv.172-180  17 %] |
| 185 | Grand Élixir de Baffeur | 4000 | 100 000 | Bois d'Orme [Bûcheron 180]; Oreille de Gobosteur [Gobosteur niv.182-190  15 %]; Oreille d'Apériglours [Apériglours niv.182-190  15 %]; Œil de Sapeur [Sapeur niv.182-190  14 %]; Calcanéus de Meliglours [Meliglours niv.182-190  2.44 %] |
| 195 | Gigantesque Élixir de Baffeur | 5000 | 100 000 | Bois d'Orme [Bûcheron 180]; Culotte de Harrogant [Harrogant niv.200-212  2 %]; Plume de Cycloïde [Cycloïde niv.200-212  2 %]; Broderie d'Eskoglyphe [Eskoglyphe niv.200-212  2 %]; Molaire de Nessil [Nessil niv.200-212  2 %] |

---

## 3. Makinas

### 3.1 Structure et effets (DofusDB, descriptions en jeu, guide DPLN ; haute sauf mention)

- **Composition fixe :** **1 ressource de boss** (une différente par makina, 81 au total) + **10 × Pépite** + des **ressources de monture sauvage**.
- **Quantité de ressources de monture selon la génération G :** G−1 pour G de 2 à 9, et **10 à la génération 10** (saut de 8 à 10). Les Optimakinas ajoutent de la Sueur, de la Bave ou une Griffe : ×1 de G2 à G8, ×2 en G9, ×3 en G10.
- **Effet 3837 :** `diceSide` = espèce (1 Dragodinde, 2 Muldo, 3 Volkorne = `RideSpecies` du client) et `value` = génération maximale. Les familyId DofusDB `/mounts` (1, 5, 6) sont **différents**.
- **Kromakina :** capacité **Caméléone** à 100 % (effet 3839). Les descriptions d'objets en jeu écrivent « capacité Caméléon », le guide DPLN « Caméléone » : c'est la même capacité (DofusDB descriptions ; haute).
- **Animakina (live 3.6) :** capacité aléatoire (effets 3840-3844).
  - Reproducteur 5 % et Sage 14 % : attribués aux effectId 3840 et 3841 par concordance avec le guide DPLN (confiance moyenne sur cette correspondance).
  - Amoureuse, Endurante et Précoce : 27 % chacune.
- **Optimakina (live 3.6) :** +10 % de chances d'obtenir la génération cible (effet 3838, valeur 10).
- **Une seule makina par accouplement** (guide DPLN). Une makina de génération G est utilisable si la génération cible est ≤ G.

### 3.2 Recettes (live 3.6.12.16)

#### Dragodinde

| Gén. | Kromakina (niv.) : ingrédients | Animakina (niv.) : ingrédients | Optimakina (niv.) : ingrédients |
|---:|---|---|---|
| 2 | (17) 1× Crâne de Kardorim, 1× Pic de dragodinde + 10 Pépite | (23) 1× Cuir de Bouftou Royal, 1× Queue de dragodinde sauvage + 10 Pépite | (29) 1× Fémur du Chafer Rōnin, 1× Sueur de dragodinde, 1× Pic de dragodinde dorée + 10 Pépite |
| 3 | (37) 1× Boostoplasme, 2× Pic de dragodinde + 10 Pépite | (43) 1× Sacrum magistral, 2× Queue de dragodinde sauvage + 10 Pépite | (49) 1× La cambriole pour les Nuls, 1× Sueur de dragodinde, 2× Pic de dragodinde dorée + 10 Pépite |
| 4 | (57) 1× Gelée Bleuet Royale, 3× Pic de dragodinde + 10 Pépite | (63) 1× Gelée Citron Royale, 3× Queue de dragodinde sauvage + 10 Pépite | (69) 1× Pierre du Craqueleur Légendaire, 1× Sueur de dragodinde, 3× Pic de dragodinde dorée + 10 Pépite |
| 5 | (77) 1× Barbe du Wa Wobot, 4× Pic de dragodinde + 10 Pépite | (83) 1× Soie Baveuse, 4× Queue de dragodinde sauvage + 10 Pépite | (89) 1× Groin de Dragon Cochon, 1× Sueur de dragodinde, 4× Pic de dragodinde dorée + 10 Pépite |
| 6 | (97) 1× Peau de Moon, 5× Pic de dragodinde + 10 Pépite | (103) 1× Plume du Rasboul Majeur, 5× Queue de dragodinde sauvage + 10 Pépite | (109) 1× Bourgeon explosif de Damadrya, 1× Sueur de dragodinde, 5× Pic de dragodinde dorée + 10 Pépite |
| 7 | (117) 1× Feuille de Blop Multicolore Royal, 6× Pic de dragodinde + 10 Pépite | (123) 1× Poil de Skeunk, 6× Queue de dragodinde sauvage + 10 Pépite | (129) 1× Laine du Royalmouth, 1× Sueur de dragodinde, 6× Pic de dragodinde dorée + 10 Pépite |
| 8 | (137) 1× Testicules du Tanukouï San, 7× Pic de dragodinde + 10 Pépite | (143) 1× Racine du Chêne Mou, 7× Queue de dragodinde sauvage + 10 Pépite | (149) 1× Pistil du Tynril, 1× Sueur de dragodinde, 7× Pic de dragodinde dorée + 10 Pépite |
| 9 | (155) 1× Défense du Phossile, 8× Pic de dragodinde + 10 Pépite | (161) 1× Poils de Kanigroula, 8× Queue de dragodinde sauvage + 10 Pépite | (167) 1× Braises bleutées, 2× Sueur de dragodinde, 8× Pic de dragodinde dorée + 10 Pépite |
| 10 | (173) 1× Corne de XLII, 10× Pic de dragodinde + 10 Pépite | (179) 1× Patte de Korriandre, 10× Queue de dragodinde sauvage + 10 Pépite | (185) 1× Queue de Glourséleste, 3× Sueur de dragodinde, 10× Pic de dragodinde dorée + 10 Pépite |

#### Muldo

| Gén. | Kromakina (niv.) : ingrédients | Animakina (niv.) : ingrédients | Optimakina (niv.) : ingrédients |
|---:|---|---|---|
| 2 | (21) 1× Peau de Mob l'Éponge, 1× Moustache de muldo ébène, 1× Moustache de muldo orchidée, 1× Moustache de muldo pourpre + 10 Pépite | (27) 1× Ailes du Scarabosse Doré, 1× Moustache de muldo indigo + 10 Pépite | (33) 1× Manuel du Directeur Grunob, 1× Bave de muldo, 1× Moustache de muldo doré + 10 Pépite |
| 3 | (41) 1× Serrure du Coffre des Forgerons, 2× Moustache de muldo ébène, 2× Moustache de muldo orchidée, 2× Moustache de muldo pourpre + 10 Pépite | (47) 1× Plume du Kwakwa, 2× Moustache de muldo indigo + 10 Pépite | (53) 1× Feuille de Blop Royal, 1× Bave de muldo, 2× Moustache de muldo doré + 10 Pépite |
| 4 | (61) 1× Gelée Fraise Royale, 3× Moustache de muldo ébène, 3× Moustache de muldo orchidée, 3× Moustache de muldo pourpre + 10 Pépite | (67) 1× Morceau de caleçon de Gourlo, 3× Moustache de muldo indigo + 10 Pépite | (73) 1× Étoffe de Draegnerys, 1× Bave de muldo, 3× Moustache de muldo doré + 10 Pépite |
| 5 | (81) 1× Barbe du Chouque, 4× Moustache de muldo ébène, 4× Moustache de muldo orchidée, 4× Moustache de muldo pourpre + 10 Pépite | (87) 1× Faux Visage de Choudini, 4× Moustache de muldo indigo + 10 Pépite | (93) 1× Tresse du Koulosse, 1× Bave de muldo, 4× Moustache de muldo doré + 10 Pépite |
| 6 | (101) 1× Chaussette trouée de Dramak, 5× Moustache de muldo ébène, 5× Moustache de muldo orchidée, 5× Moustache de muldo pourpre + 10 Pépite | (107) 1× Glande du Pounicheur, 5× Moustache de muldo indigo + 10 Pépite | (113) 1× Crinière de Rat Blanc, 1× Bave de muldo, 5× Moustache de muldo doré + 10 Pépite |
| 7 | (121) 1× Poils du Minotoror, 6× Moustache de muldo ébène, 6× Moustache de muldo orchidée, 6× Moustache de muldo pourpre + 10 Pépite | (127) 1× Plume de Tofu Royal, 6× Moustache de muldo indigo + 10 Pépite | (133) 1× Cœur du Capitaine Ekarlatte, 1× Bave de muldo, 6× Moustache de muldo doré + 10 Pépite |
| 8 | (141) 1× Koinkoin de bain de Nagate, 7× Moustache de muldo ébène, 7× Moustache de muldo orchidée, 7× Moustache de muldo pourpre + 10 Pépite | (147) 1× Queue Magique de Founoroshi, 7× Moustache de muldo indigo + 10 Pépite | (153) 1× Poil de Ben le Ripate, 1× Bave de muldo, 7× Moustache de muldo doré + 10 Pépite |
| 9 | (159) 1× Sphénoïde du Kimbo, 8× Moustache de muldo ébène, 8× Moustache de muldo orchidée, 8× Moustache de muldo pourpre + 10 Pépite | (165) 1× Moustache de Ush, 8× Moustache de muldo indigo + 10 Pépite | (171) 1× Œil du Père Ver, 2× Bave de muldo, 8× Moustache de muldo doré + 10 Pépite |
| 10 | (177) 1× Sang du Toxoliath, 10× Moustache de muldo ébène, 10× Moustache de muldo orchidée, 10× Moustache de muldo pourpre + 10 Pépite | (183) 1× Griffe de Kolosso, 10× Moustache de muldo indigo + 10 Pépite | (189) 1× Cloche de Barbéryl Clochecuivre, 3× Bave de muldo, 10× Moustache de muldo doré + 10 Pépite |

#### Volkorne

| Gén. | Kromakina (niv.) : ingrédients | Animakina (niv.) : ingrédients | Optimakina (niv.) : ingrédients |
|---:|---|---|---|
| 2 | (19) 1× Pétale Magique du Tournesol Affamé, 1× Aile de volkorne orchidée, 1× Aile de volkorne pourpre + 10 Pépite | (25) 1× Patte de Kankreblath, 1× Aile de volkorne indigo + 10 Pépite | (31) 1× Plume de Batofu, 1× Griffe de volkorne, 1× Aile de volkorne ébène + 10 Pépite |
| 3 | (39) 1× Peau de Bworkette, 2× Aile de volkorne orchidée, 2× Aile de volkorne pourpre + 10 Pépite | (45) 1× Peau de Shin Larve, 2× Aile de volkorne indigo + 10 Pépite | (51) 1× Poil du Wa Wabbit, 1× Griffe de volkorne, 2× Aile de volkorne ébène + 10 Pépite |
| 4 | (59) 1× Gelée Menthe Royale, 3× Aile de volkorne orchidée, 3× Aile de volkorne pourpre + 10 Pépite | (65) 1× Carniflore, 3× Aile de volkorne indigo + 10 Pépite | (71) 1× Duvet de Nelween, 1× Griffe de volkorne, 3× Aile de volkorne ébène + 10 Pépite |
| 5 | (79) 1× Carapace du Mantiscore, 4× Aile de volkorne orchidée, 4× Aile de volkorne pourpre + 10 Pépite | (85) 1× Racine d'Abraknyde Ancestral, 4× Aile de volkorne indigo + 10 Pépite | (91) 1× Scalp du Meulou, 1× Griffe de volkorne, 4× Aile de volkorne ébène + 10 Pépite |
| 6 | (99) 1× Broderie de Malléfisk, 5× Aile de volkorne orchidée, 5× Aile de volkorne pourpre + 10 Pépite | (105) 1× Dent du Kharnozor, 5× Aile de volkorne indigo + 10 Pépite | (111) 1× Crinière de Rat Noir, 1× Griffe de volkorne, 5× Aile de volkorne ébène + 10 Pépite |
| 7 | (119) 1× Pixel de Fraktale, 6× Aile de volkorne orchidée, 6× Aile de volkorne pourpre + 10 Pépite | (125) 1× Peau de Crocabulia, 6× Aile de volkorne indigo + 10 Pépite | (131) 1× Paire de boules de Haute Truche, 1× Griffe de volkorne, 6× Aile de volkorne ébène + 10 Pépite |
| 8 | (139) 1× Picot d'El Piko, 7× Aile de volkorne orchidée, 7× Aile de volkorne pourpre + 10 Pépite | (145) 1× Plume du Mansot Royal, 7× Aile de volkorne indigo + 10 Pépite | (151) 1× Fémur de Sphincter Cell, 1× Griffe de volkorne, 7× Aile de volkorne ébène + 10 Pépite |
| 9 | (157) 1× Scorie d'Obsidiantre, 8× Aile de volkorne orchidée, 8× Aile de volkorne pourpre + 10 Pépite | (163) 1× Ethmoïde du Minotot, 8× Aile de volkorne indigo + 10 Pépite | (169) 1× Laine de Tengu Givrefoux, 2× Griffe de volkorne, 8× Aile de volkorne ébène + 10 Pépite |
| 10 | (175) 1× Épine d'Ougah, 10× Aile de volkorne orchidée, 10× Aile de volkorne pourpre + 10 Pépite | (181) 1× Ongle du Bworker, 10× Aile de volkorne indigo + 10 Pépite | (187) 1× Corne d'Ombre, 3× Griffe de volkorne, 10× Aile de volkorne ébène + 10 Pépite |

### 3.3 Ressources de monture nécessaires pour toute la série G2→G10, live et bêta 3.7

| Famille / type | Ressources de monture, gén. 2→10 (live 3.6) | idem bêta 3.7 | Détail live | Détail bêta 3.7 |
|---|---:|---:|---|---|
| Dragodinde kromakina | 46 | 45 | 46 Pic de dragodinde | 18 Pic de dragodinde, 15 Pic de dragodinde dorée, 12 Queue de dragodinde sauvage |
| Dragodinde animakina | 46 | 45 | 46 Queue de dragodinde sauvage | 18 Queue de dragodinde sauvage, 15 Pic de dragodinde, 12 Pic de dragodinde dorée |
| Dragodinde optimakina | 58 | 57 | 46 Pic de dragodinde dorée, 12 Sueur de dragodinde | 18 Pic de dragodinde dorée, 15 Queue de dragodinde sauvage, 12 Sueur de dragodinde, 12 Pic de dragodinde |
| Muldo kromakina | 138 | 75 | 46 Moustache de muldo ébène, 46 Moustache de muldo orchidée, 46 Moustache de muldo pourpre | 18 Moustache de muldo orchidée, 18 Moustache de muldo pourpre, 15 Moustache de muldo indigo, 12 Moustache de muldo ébène, 12 Moustache de muldo doré |
| Muldo animakina | 46 | 74 | 46 Moustache de muldo indigo | 18 Moustache de muldo indigo, 18 Moustache de muldo ébène, 14 Moustache de muldo doré, 14 Moustache de muldo pourpre, 10 Moustache de muldo orchidée |
| Muldo optimakina | 58 | 84 | 46 Moustache de muldo doré, 12 Bave de muldo | 18 Moustache de muldo doré, 15 Moustache de muldo ébène, 15 Moustache de muldo orchidée, 12 Bave de muldo, 12 Moustache de muldo indigo, 12 Moustache de muldo pourpre |
| Volkorne kromakina | 92 | 63 | 46 Aile de volkorne orchidée, 46 Aile de volkorne pourpre | 18 Aile de volkorne orchidée, 18 Aile de volkorne pourpre, 15 Aile de volkorne indigo, 12 Aile de volkorne ébène |
| Volkorne animakina | 46 | 59 | 46 Aile de volkorne indigo | 18 Aile de volkorne indigo, 15 Aile de volkorne ébène, 15 Aile de volkorne orchidée, 11 Aile de volkorne pourpre |
| Volkorne optimakina | 58 | 69 | 46 Aile de volkorne ébène, 12 Griffe de volkorne | 18 Aile de volkorne ébène, 15 Aile de volkorne pourpre, 12 Griffe de volkorne, 12 Aile de volkorne indigo, 12 Aile de volkorne orchidée |

Pépites : 81 × 10 = **810 Pépites** pour toute la série. Le total par type et par famille est de 90.

### 3.4 Ressource de boss de chaque makina

Le boss est donné dans sa version la plus accessible : la version « Expédition » de niveau 200+ existe parfois aussi, avec un meilleur taux. Le taux de drop affiché est celui du boss listé.

| Makina | Ressource de boss | Boss (niv.) — donjon | Drop |
|---|---|---|---:|
| Kromakina Dragodinde de Génération 2 (niv. 17) | Crâne de Kardorim | Kardorim (10) — Crypte de Kardorim | 57 % |
| Kromakina Volkorne de Génération 2 (niv. 19) | Pétale Magique du Tournesol Affamé | Tournesol Affamé (20) — Grange du Tournesol Affamé | 55 % |
| Kromakina Muldo de Génération 2 (niv. 21) | Peau de Mob l'Éponge | Mob l'Éponge (20) — Château Ensablé | 55 % |
| Animakina Dragodinde de Génération 2 (niv. 23) | Cuir de Bouftou Royal | Bouftou Royal (30) — Cour du Bouftou Royal | 53 % |
| Animakina Volkorne de Génération 2 (niv. 25) | Patte de Kankreblath | Kankreblath (40) — Cache de Kankreblath | 51 % |
| Animakina Muldo de Génération 2 (niv. 27) | Ailes du Scarabosse Doré | Scarabosse Doré (40) — Donjon des Scarafeuilles | 51 % |
| Optimakina Dragodinde de Génération 2 (niv. 29) | Fémur du Chafer Rōnin | Chafer Rōnin (40) — Donjon des Squelettes | 51 % |
| Optimakina Volkorne de Génération 2 (niv. 31) | Plume de Batofu | Batofu (40) — Donjon des Tofus | 51 % |
| Optimakina Muldo de Génération 2 (niv. 33) | Manuel du Directeur Grunob | Directeur Grunob (50) — Akadémie des Gobs | 48 % |
| Kromakina Dragodinde de Génération 3 (niv. 37) | Boostoplasme | Boostache (40) — Maison Fantôme | 51 % |
| Kromakina Volkorne de Génération 3 (niv. 39) | Peau de Bworkette | Bworkette (50) — Donjon des Bworks | 48 % |
| Kromakina Muldo de Génération 3 (niv. 41) | Serrure du Coffre des Forgerons | Coffre des Forgerons (50) — Donjon des Forgerons | 48 % |
| Animakina Dragodinde de Génération 3 (niv. 43) | Sacrum magistral | Corailleur Magistral (50) — Grotte Hesque | 48 % |
| Animakina Volkorne de Génération 3 (niv. 45) | Peau de Shin Larve | Shin Larve (50) — Donjon des Larves | 48 % |
| Animakina Muldo de Génération 3 (niv. 47) | Plume du Kwakwa | Kwakwa (50) — Nid du Kwakwa | 48 % |
| Optimakina Dragodinde de Génération 3 (niv. 49) | La cambriole pour les Nuls | Rakoopeur (50) — Refuge sylvestre | 48 % |
| Optimakina Volkorne de Génération 3 (niv. 51) | Poil du Wa Wabbit | Wa Wabbit (60) — Château du Wa Wabbit | 46 % |
| Optimakina Muldo de Génération 3 (niv. 53) | Feuille de Blop Royal | Blop Coco Royal (60) — Clos des Blops | 45 % |
| Kromakina Dragodinde de Génération 4 (niv. 57) | Gelée Bleuet Royale | Gelée Royale Bleuet (60) — Gelaxième dimension | 46 % |
| Kromakina Volkorne de Génération 4 (niv. 59) | Gelée Menthe Royale | Gelée Royale Menthe (60) — Gelaxième dimension | 46 % |
| Kromakina Muldo de Génération 4 (niv. 61) | Gelée Fraise Royale | Gelée Royale Fraise (60) — Gelaxième dimension | 46 % |
| Animakina Dragodinde de Génération 4 (niv. 63) | Gelée Citron Royale | Gelée Royale Citron (60) — Gelaxième dimension | 46 % |
| Animakina Volkorne de Génération 4 (niv. 65) | Carniflore | Kanniboul Ebil (60) — Village Kanniboul | 46 % |
| Animakina Muldo de Génération 4 (niv. 67) | Morceau de caleçon de Gourlo | Gourlo le Terrible (70) — Cale de l'arche d'Otomaï | 43 % |
| Optimakina Dragodinde de Génération 4 (niv. 69) | Pierre du Craqueleur Légendaire | Craqueleur Légendaire (70) — Pitons Rocheux des Craqueleurs | 43 % |
| Optimakina Volkorne de Génération 4 (niv. 71) | Duvet de Nelween | Nelween (70) — Laboratoire de Brumen Tinctorias | 43 % |
| Optimakina Muldo de Génération 4 (niv. 73) | Étoffe de Draegnerys | Draegnerys (70) — Épreuve de Draegnerys | 43 % |
| Kromakina Dragodinde de Génération 5 (niv. 77) | Barbe du Wa Wobot | Wa Wobot (80) — Terrier du Wa Wabbit | 41 % |
| Kromakina Volkorne de Génération 5 (niv. 79) | Carapace du Mantiscore | Mantiscore (80) — Cimetière des Mastodontes | 41 % |
| Kromakina Muldo de Génération 5 (niv. 81) | Barbe du Chouque | Le Chouque (90) — Bateau du Chouque | 39 % |
| Animakina Dragodinde de Génération 5 (niv. 83) | Soie Baveuse | Reine Nyée (90) — Antre de la Reine Nyée | 39 % |
| Animakina Volkorne de Génération 5 (niv. 85) | Racine d'Abraknyde Ancestral | Abraknyde Ancestral (90) — Domaine Ancestral | 39 % |
| Animakina Muldo de Génération 5 (niv. 87) | Faux Visage de Choudini | Choudini (90) — Chapiteau des Magik Riktus | 39 % |
| Optimakina Dragodinde de Génération 5 (niv. 89) | Groin de Dragon Cochon | Dragon Cochon (100) — Antre du Dragon Cochon | 36 % |
| Optimakina Volkorne de Génération 5 (niv. 91) | Scalp du Meulou | Meulou (100) — Tanière du Meulou | 36 % |
| Optimakina Muldo de Génération 5 (niv. 93) | Tresse du Koulosse | Koulosse (100) — Caverne du Koulosse | 36 % |
| Kromakina Dragodinde de Génération 6 (niv. 97) | Peau de Moon | Moon (100) — Arbre de Moon | 36 % |
| Kromakina Volkorne de Génération 6 (niv. 99) | Broderie de Malléfisk | Malléfisk (100) — Fabrique de Malléfisk | 36 % |
| Kromakina Muldo de Génération 6 (niv. 101) | Chaussette trouée de Dramak | Maître des Pantins (400\*) — Théâtre de Dramak | 36 % |
| Animakina Dragodinde de Génération 6 (niv. 103) | Plume du Rasboul Majeur | Silf le Rasboul Majeur (110) — Goulet du Rasboul | 34 % |
| Animakina Volkorne de Génération 6 (niv. 105) | Dent du Kharnozor | Kharnozor (100) — Repaire du Kharnozor | 36 % |
| Animakina Muldo de Génération 6 (niv. 107) | Glande du Pounicheur | Pounicheur (110) — Miausolée du Pounicheur | 34 % |
| Optimakina Dragodinde de Génération 6 (niv. 109) | Bourgeon explosif de Damadrya | Damadrya (110) — Bambusaie de Damadrya | 34 % |
| Optimakina Volkorne de Génération 6 (niv. 111) | Crinière de Rat Noir | Rat Noir (110) — Repaire de Sphincter Cell | 34 % |
| Optimakina Muldo de Génération 6 (niv. 113) | Crinière de Rat Blanc | Rat Blanc (110) — Repaire de Sphincter Cell | 34 % |
| Kromakina Dragodinde de Génération 7 (niv. 117) | Feuille de Blop Multicolore Royal | Blop Multicolore Royal (120) — Antre du Blop Multicolore Royal | 31 % |
| Kromakina Volkorne de Génération 7 (niv. 119) | Pixel de Fraktale | Fraktale (120) — Mégalithe de Fraktale | 31 % |
| Kromakina Muldo de Génération 7 (niv. 121) | Poils du Minotoror | Minotoror (120) — Centre du labyrinthe du Minotoror | 31 % |
| Animakina Dragodinde de Génération 7 (niv. 123) | Poil de Skeunk | Skeunk (120) — Repaire de Skeunk | 31 % |
| Animakina Volkorne de Génération 7 (niv. 125) | Peau de Crocabulia | Crocabulia (120) — Antre de Crocabulia | 31 % |
| Animakina Muldo de Génération 7 (niv. 127) | Plume de Tofu Royal | Tofu Royal (120) — Tofulailler Royal | 31 % |
| Optimakina Dragodinde de Génération 7 (niv. 129) | Laine du Royalmouth | Royalmouth (120) — Serre du Royalmouth | 31 % |
| Optimakina Volkorne de Génération 7 (niv. 131) | Paire de boules de Haute Truche | Haute Truche (130) — Volière de la Haute Truche | 29 % |
| Optimakina Muldo de Génération 7 (niv. 133) | Cœur du Capitaine Ekarlatte | Capitaine Ekarlatte (130) — Ring du Capitaine Ekarlatte | 29 % |
| Kromakina Dragodinde de Génération 8 (niv. 137) | Testicules du Tanukouï San | Tanukouï San (130) — Atelier du Tanukouï San | 29 % |
| Kromakina Volkorne de Génération 8 (niv. 139) | Picot d'El Piko | El Piko (130) — Caverne d'El Piko | 29 % |
| Kromakina Muldo de Génération 8 (niv. 141) | Koinkoin de bain de Nagate | Nagate (130) — Vallée de la Dame des eaux | 29 % |
| Animakina Dragodinde de Génération 8 (niv. 143) | Racine du Chêne Mou | Chêne Mou (140) — Clairière du Chêne Mou | 27 % |
| Animakina Volkorne de Génération 8 (niv. 145) | Plume du Mansot Royal | Mansot Royal (140) — Excavation du Mansot Royal | 27 % |
| Animakina Muldo de Génération 8 (niv. 147) | Queue Magique de Founoroshi | Founoroshi (140) — Fabrique de foux d'artifice | 27 % |
| Optimakina Dragodinde de Génération 8 (niv. 149) | Pistil du Tynril | Tynril Perfide (140) — Laboratoire du Tynril | 27 % |
| Optimakina Volkorne de Génération 8 (niv. 151) | Fémur de Sphincter Cell | Sphincter Cell (150) — Repaire de Sphincter Cell | 24 % |
| Optimakina Muldo de Génération 8 (niv. 153) | Poil de Ben le Ripate | Ben le Ripate (150) — Épave du Grolandais violent | 24 % |
| Kromakina Dragodinde de Génération 9 (niv. 155) | Défense du Phossile | Phossile (150) — Galerie du Phossile | 24 % |
| Kromakina Volkorne de Génération 9 (niv. 157) | Scorie d'Obsidiantre | Obsidiantre (160) — Hypogée de l'Obsidiantre | 22 % |
| Kromakina Muldo de Génération 9 (niv. 159) | Sphénoïde du Kimbo | Kimbo (160) — Canopée du Kimbo | 22 % |
| Animakina Dragodinde de Génération 9 (niv. 161) | Poils de Kanigroula | Kanigroula (160) — Grotte de Kanigroula | 22 % |
| Animakina Volkorne de Génération 9 (niv. 163) | Ethmoïde du Minotot | Minotot (160) — Centre du labyrinthe du Minotoror | 22 % |
| Animakina Muldo de Génération 9 (niv. 165) | Moustache de Ush | Ush Galesh (160) — Plateau de Ush | 22 % |
| Optimakina Dragodinde de Génération 9 (niv. 167) | Braises bleutées | Koumiho (170) — Demeure des Esprits | 19 % |
| Optimakina Volkorne de Génération 9 (niv. 169) | Laine de Tengu Givrefoux | Tengu Givrefoux (170) — Tanière Givrefoux | 19 % |
| Optimakina Muldo de Génération 9 (niv. 171) | Œil du Père Ver | Père Ver (170) — Boyau du Père Ver | 19 % |
| Kromakina Dragodinde de Génération 10 (niv. 173) | Corne de XLII | XLII (170) — Horologium de XLII | 19 % |
| Kromakina Volkorne de Génération 10 (niv. 175) | Épine d'Ougah | Ougah (180) — Temple du Grand Ougah | 17 % |
| Kromakina Muldo de Génération 10 (niv. 177) | Sang du Toxoliath | Toxoliath (180) — Cave du Toxoliath | 17 % |
| Animakina Dragodinde de Génération 10 (niv. 179) | Patte de Korriandre | Korriandre (180) — Antre du Korriandre | 17 % |
| Animakina Volkorne de Génération 10 (niv. 181) | Ongle du Bworker | Bworker (180) — Grotte du Bworker | 17 % |
| Animakina Muldo de Génération 10 (niv. 183) | Griffe de Kolosso | Kolosso (190) — Cavernes du Kolosso | 15 % |
| Optimakina Dragodinde de Génération 10 (niv. 185) | Queue de Glourséleste | Glourséleste (190) — Antichambre des Gloursons | 15 % |
| Optimakina Volkorne de Génération 10 (niv. 187) | Corne d'Ombre | Ombre (190) — Pyramide d'Ombre | 15 % |
| Optimakina Muldo de Génération 10 (niv. 189) | Cloche de Barbéryl Clochecuivre | Barbéryl Clochecuivre (190) — Bastion des Marteaux-Aigris | 15 % |

\* DofusDB donne au Maître des Pantins des grades de niveau 400 à 800, une valeur atypique. La ressource est de niveau 100 et le donjon Théâtre de Dramak a `optimalPlayerLevel` = 100 (DofusDB `dungeons` id 72, sous-zone 800 de niveau 100). Il faut le lire comme un donjon de niveau 100 (confiance haute).

En bêta 3.7, 6 ressources de boss changent :
- Kromakina Volkorne G7 : Pixel de Fraktale → Duvet du Maître Corbac
- Animakina Muldo G9 : Moustache de Ush → Piques à cheveux de Shihan
- Optimakina Dragodinde G9 : Braises bleutées → Mèche Rebelle d'Hell Mina
- Optimakina Muldo G9 : Œil du Père Ver → Slip feuillu de Supervizœuf
- Optimakina Volkorne G10 : Corne d'Ombre → Cuir de Fuji Givrefoux
- Optimakina Muldo G10 : Cloche de Barbéryl Clochecuivre → Poudre glaciale

Toutes les recettes bêta figurent dans `crafts.json`, sous `makinas[].beta_3_7.ingredients`.

---

## 4. Filets de capture (DofusDB et guide DPLN ; haute)

| Niv. | Filet | Type | Ingrédients |
|---:|---|---|---|
| 1 | Filet de capture universel | universel | 10× Bois de Frêne, 10× Fer |
| 100 | Filet multiplicateur de Dragodinde | multiplicateur | 5× Bois d'If, 5× Seigle, 1× Aile de dragodinde rousse sauvage, 1× Pic de dragodinde, 1× Sueur de dragodinde, 1× Aile de dragodinde dorée |
| 100 | Filet multiplicateur de Volkorne | multiplicateur | 1× Griffe de volkorne, 1× Aile de volkorne indigo, 1× Aile de volkorne orchidée, 1× Aile de volkorne pourpre, 1× Aile de volkorne ébène, 5× Viande Exsudative, 5× Bois d'If |
| 100 | Filet multiplicateur de Muldo | multiplicateur | 1× Bave de muldo, 1× Moustache de muldo doré, 1× Moustache de muldo ébène, 1× Moustache de muldo pourpre, 1× Moustache de muldo indigo, 1× Moustache de muldo orchidée, 5× Anguille, 5× Bois d'If |
| 150 | Filet à Dragodinde renforcé | renforce | 5× Ginseng, 5× Aile de dragodinde dorée, 1× Sueur de dragodinde, 5× Bois de Kaliptus, 5× Pic de dragodinde, 5× Aile de dragodinde rousse sauvage |
| 150 | Filet à Volkorne renforcé | renforce | 5× Bois de Kaliptus, 5× Viande de Brousse, 5× Aile de volkorne ébène, 5× Aile de volkorne pourpre, 5× Aile de volkorne orchidée, 5× Aile de volkorne indigo, 2× Griffe de volkorne |
| 150 | Filet à Muldo renforcé | renforce | 5× Requin Marteau-Faucille, 5× Bois de Kaliptus, 5× Moustache de muldo orchidée, 5× Moustache de muldo indigo, 5× Moustache de muldo pourpre, 5× Moustache de muldo ébène, 5× Moustache de muldo doré, 2× Bave de muldo |
| 200 | Filet multiplicateur de Dragodinde renforcé | multiplicateur_renforce | 1× Bois de Tremble, 2× Quisnoa, 1× Frostiz, 3× Aile de dragodinde, 2× Sueur de dragodinde, 10× Aile de dragodinde dorée, 10× Aile de dragodinde rousse sauvage, 10× Pic de dragodinde |
| 200 | Filet multiplicateur de Volkorne renforcé | multiplicateur_renforce | 1× Bois de Tremble, 10× Viande Goûtue, 1× Pichon d'encre, 10× Aile de volkorne indigo, 10× Aile de volkorne orchidée, 10× Aile de volkorne pourpre, 3× Griffe de volkorne, 10× Aile de volkorne ébène |
| 200 | Filet multiplicateur de Muldo renforcé | multiplicateur_renforce | 2× Bois d'Aquajou, 2× Patelle, 10× Moustache de muldo doré, 10× Moustache de muldo ébène, 10× Moustache de muldo indigo, 10× Moustache de muldo orchidée, 10× Moustache de muldo pourpre, 3× Bave de muldo |

- **Effets** (guide DPLN) :
  - universel : capture la monture ciblée ;
  - multiplicateur : capture la monture et la duplique (couleur identique, genre non garanti) ;
  - renforcé : capture dans un cercle de rayon 3 ;
  - multiplicateur renforcé : capture dans un cercle de rayon 3 et duplique.
- **Sort accordé :** chaque filet équipé en consommable donne le sort temporaire « Apprivoisement de monture » (effet 722 « Ajouter un sort temporaire ») : 1 PA, portée jusqu'à 7 PO sans ligne de vue, une fois par combat.
- **Niveau requis :** pour équiper un filet, il faut un niveau d'Éleveur au moins égal au niveau du filet (« ou + », guide DPLN).
- **Bêta 3.7 :** aucune recette de filet ne change.

---

## 5. Provenance des ingrédients (DofusDB ; haute, taux de drop de base hors prospection)

### 5.1 Vue d'ensemble des 471 ingrédients distincts

| `source.kind` | Nb | Détail |
|---|---:|---|
| `harvest` | 59 | Bûcheron 14, Pêcheur 13, Paysan 12, Alchimiste 10, Mineur 10. Ce sont les ressources de base des carburants et les bois, céréales et poissons des filets. Quelques-unes tombent aussi de monstres, de façon marginale (critère `SC=5`). |
| `drop` | 411 | 12 **Viandes**, avec un drop réservé aux Chasseurs. **81 ressources de boss**, toutes dans les makinas. **18 ressources de montures sauvages**. Le reste est fait de ressources de monstres « normaux » pour les carburants, entre le niveau 10 et le niveau 200. |
| `other` | 1 | **Pépite** (14635) : aucun drop, aucune récolte, aucune recette dans DofusDB. |
| `mount-extraction` | 0 | Aucune ressource d'extraction n'entre dans une recette Éleveur (voir §5.3). |
| `craft` / `npc` | 0 | Aucun ingrédient n'est craftable. DofusDB n'expose pas les ventes des PNJ. Le champ `npcPrice` est le `price` interne de DofusDB, pas un prix d'achat. |

- **Pépite :** elle s'obtient par le **recyclage** des ressources dans les recycleurs des territoires d'alliance (AvA). Le rendement dépend du recycleur et des territoires (https://www.gamosaurus.com/?p=56387 ; confiance moyenne). **Attention, source héritée :** cet article date de 2022 (mis à jour en 2023) et décrit Dofus 2. Le mécanisme n'a pas été revérifié pour Dofus 3 / 3.6. Elle se trouve en pratique à l'HDV des ressources. Chaque objet porte une valeur `recyclingNuggets`, reprise dans `crafts.json`.
- **Monstres absents de DofusDB :** quelques identifiants de monstres (7999-8002) n'existent pas dans `/monsters`. Ils sont listés dans `source.monstersMissingInDofusDB`.

### 5.2 Ressources de montures sauvages (combats de capture)

Les montures sauvages sont des monstres de niveau 62 à 70 d'après les grades DofusDB (archimonstres : Draglida la Disparue 55-67, Dragnoute l'Irascible 60-72). Le guide DPLN parle de « monstres de niveau 60 » : les deux versions sont consignées ici (confiance haute sur les grades DofusDB). On les trouve dans trois zones :
- Territoire des dragodindes sauvages, dans la Montagne des Koalaks ;
- Bassin des Muldos, au nord de Sufokia ;
- Haras de Brâkmar.

Sources : DofusDB `monsters`, guide DPLN.

Elles laissent leurs ressources comme n'importe quel monstre, donc **la prospection compte**. Le guide DPLN conseille de l'optimiser et de jouer en multicompte pour capturer et dropper davantage.

| Ressource | Famille | Source (taux de base) | Qté Éleveur live (211 recettes) | Qté Éleveur bêta 3.7 | Autres métiers (nb recettes) |
|---|---|---|---:|---:|---|
| Pic de dragodinde | Dragodinde | Dragodinde amande sauvage 44 %; Draglida la Disparue (archi) 88 % | 62 | 61 | Forgeron 1, Sculpteur 1, Tailleur 1, Façonneur 1, Cordonnier 1 |
| Pic de dragodinde dorée | Dragodinde | Dragodinde dorée sauvage 41 % | 46 | 45 | Tailleur 2, Sculpteur 1, Bijoutier 1, Façonneur 1 |
| Aile de dragodinde | Dragodinde | Dragodinde amande sauvage 7.36 %; Draglida la Disparue (archi) 14 % | 3 | 3 | Cordonnier 3, Sculpteur 2, Base 2 |
| Aile de dragodinde rousse sauvage | Dragodinde | Dragodinde rousse sauvage 7.16 %; Dragnoute l'Irascible (archi) 14 % | 16 | 16 | Cordonnier 2, Tailleur 1, Bijoutier 1, Alchimiste 1 |
| Aile de dragodinde dorée | Dragodinde | Dragodinde dorée sauvage 6.7 % | 16 | 16 | Sculpteur 2, Tailleur 2, Façonneur 1 |
| Queue de dragodinde sauvage | Dragodinde | Dragodinde rousse sauvage 43 %; Dragnoute l'Irascible (archi) 86 % | 46 | 45 | Cordonnier 1, Forgeron 1, Sculpteur 1, Façonneur 1 |
| Sueur de dragodinde | Dragodinde | Dragodinde amande sauvage 2 %; Dragodinde rousse sauvage 2 %; Dragodinde dorée sauvage 2 %; Draglida la Disparue (archi) 4 %; Dragnoute l'Irascible (archi) 4 % | 16 | 16 | Tailleur 2, Cordonnier 1, Bijoutier 1, Alchimiste 1 |
| Moustache de muldo orchidée | Muldo | Muldo orchidée sauvage 42 % | 62 | 59 | Tailleur 1 |
| Moustache de muldo indigo | Muldo | Muldo indigo sauvage 42 % | 62 | 61 | Tailleur 1 |
| Moustache de muldo pourpre | Muldo | Muldo pourpre sauvage 42 % | 62 | 60 | Cordonnier 1 |
| Moustache de muldo ébène | Muldo | Muldo ébène sauvage 42 % | 62 | 61 | Tailleur 1 |
| Moustache de muldo doré | Muldo | Muldo doré sauvage 42 % | 62 | 60 | Cordonnier 1 |
| Bave de muldo | Muldo | Muldo indigo sauvage 7.1 %; Muldo ébène sauvage 7.1 %; Muldo orchidée sauvage 7.1 %; Muldo pourpre sauvage 7.1 %; Muldo doré sauvage 7.1 % | 18 | 18 | Tailleur 2, Cordonnier 1 |
| Aile de volkorne ébène | Volkorne | Volkorne ébène sauvage 42 % | 62 | 61 | Tailleur 1, Façonneur 1 |
| Aile de volkorne pourpre | Volkorne | Volkorne pourpre sauvage 42 % | 62 | 60 | Cordonnier 1, Façonneur 1 |
| Aile de volkorne orchidée | Volkorne | Volkorne orchidée sauvage 42 % | 62 | 61 | Cordonnier 1, Tailleur 1 |
| Aile de volkorne indigo | Volkorne | Volkorne indigo sauvage 42 % | 62 | 61 | Cordonnier 1 |
| Griffe de volkorne | Volkorne | Volkorne orchidée sauvage 7.1 %; Volkorne indigo sauvage 7.1 %; Volkorne ébène sauvage 7.1 %; Volkorne pourpre sauvage 7.1 % | 18 | 18 | Cordonnier 1, Tailleur 1, Façonneur 1 |
| Neurone de dragodinde | Dragodinde | extraction d'une monture (onglet Extraction) : quantité = génération (gén. ≥ 2 ; gén. 1 = 0 ; monture sénile = 1) | 0 | 0 | Tailleur 31, Forgeron 21, Cordonnier 19, Bijoutier 19, Sculpteur 17, Façonneur 4 |
| Ambre de muldo | Muldo | extraction d'une monture (onglet Extraction) : quantité = génération (gén. ≥ 2 ; gén. 1 = 0 ; monture sénile = 1) | 0 | 0 | Tailleur 35, Cordonnier 27, Bijoutier 15, Sculpteur 14, Forgeron 10, Façonneur 7, Base 3 |
| Corne de volkorne | Volkorne | extraction d'une monture (onglet Extraction) : quantité = génération (gén. ≥ 2 ; gén. 1 = 0 ; monture sénile = 1) | 0 | 0 | Forgeron 28, Tailleur 27, Cordonnier 19, Bijoutier 15, Façonneur 11, Sculpteur 10, Base 2 |

- **Archimonstres :** les Dragodindes amande et rousse sauvages ont chacune un archimonstre, respectivement Draglida la Disparue et Dragnoute l'Irascible, avec des taux doublés. La Dragodinde dorée sauvage, les Muldos et les Volkornes n'en ont pas parmi les droppeurs (DofusDB ; haute).
- **Génération :** une monture capturée est de génération 1 (guide DPLN).
- **Quantités Éleveur :** « Qté Éleveur live » est la somme des quantités sur les 211 recettes, soit une fois chaque makina et chaque filet.

### 5.3 Ressources d'extraction (Neurone, Ambre, Corne)

- **Ce que donne l'extraction :** Neurone de dragodinde (33515), Ambre de muldo (17864) ou Corne de volkorne (19975), selon l'espèce (client `RideSpecies.extractionRewardGid` ; haute).
- **Quantité :** égale à la génération de la monture. Une monture de génération 1 ne donne rien, une monture sénile (d'avant la 3.5) donne 1 (client `Rides.extractionRewardQuantity`, `senileExtractionRewardQuantity` ; guide DPLN ; haute).
- **Usage :** **0 recette Éleveur.** Neurone : 111 recettes (Tailleur 31, Forgeron 21, Cordonnier 19, Bijoutier 19, Sculpteur 17, Façonneur 4). Ambre : 111 recettes. Corne : 112 recettes (DofusDB `recipes?ingredientIds=…`, total relevé le 2026-10-02 ; haute).
- **Autre source de Neurones :** l'**Amateur de Guildaton** en vend depuis la 3.5, à 15 guildatons l'unité, 3 achats par semaine (6 si la guilde est niveau 13) (guide DPLN, https://www.dofuspourlesnoobs.com/mise-a-jour-305.html ; haute). En 3.7, le devblog annonce que « le prix des ressources achetables auprès du PNJ de guilde passera de 15 à 30 ». Il ne nomme pas les Neurones, mais le prix de 15 correspond (haute pour l'annonce, moyenne sur l'identification).
- **Conséquence pour la rentabilité :** une monture stérile de génération G se valorise au plus haut entre
  - sa revente,
  - G × le prix HDV de la ressource d'extraction,
  - un clonage (guide DPLN).

---

## 6. XP du métier Éleveur

**Formule par craft** (client Dofus, `Item.getCraftXpByJobLevel` ; confiance moyenne pour Dofus 3) :

```
si J − 100 > L : xp = 0
sinon          : xp = floor( 20·L / ((J − L)^1.1 / 10 + 1) × ratio / 100 )
L = niveau de la recette (= niveau de l'objet), J = niveau du métier (J ≥ L)
ratio = craftXpRatio de l'objet s'il est ≥ 0, sinon celui du type d'objet, sinon 100
```

**Ratios** (DofusDB `item-types` ; haute) :
- Carburant d'enclos (326) : **5**
- Makina (323) : **5**
- Filet de capture (99) : **5**
- exception : **Filet de capture universel (32521) : 50**, qui rapporte 10 XP au niveau 1

Ces ratios sont les mêmes dans le client bêta 3.7.

**Valeurs :** au même niveau (J = L), une recette rapporte **L XP** par objet : 195 XP pour un Gigantesque Élixir. Le gain baisse ensuite :

| Recette | J = L | J = L+5 | J = L+9 | J = L+20 |
|---|---:|---:|---:|---:|
| niv. 5 | 5 | 3 | 2 | 1 |
| niv. 45 | 45 | 28 | 21 | 12 |
| niv. 95 | 95 | 59 | 44 | 25 |
| niv. 145 | 145 | 91 | 68 | 39 |
| niv. 195 | 195 | 122 (J = 200) | — | — |

**Table d'XP du métier** (DPLN) : xp(n) = 10·n·(n−1) cumulé, sauf au niv. 3. Il faut 24 500 XP au niv. 50, 99 000 au niv. 100 et **398 000 au niv. 200**.

**Simulation** de la meilleure recette disponible à chaque niveau (formule ci-dessus, table DPLN ; confiance moyenne).

*Phase 1, niveaux 1→15.* Entre 1 et 14, le **Filet de capture universel** (ratio 50 %) rapporte plus que les Extraits : 10 XP au niv. 1, 6 au niv. 5, 3 au niv. 14, contre 5 → 2 pour les Extraits. Il faut toutefois environ **500 filets** (503 simulés) pour les 2 100 XP du niv. 15, soit 5 000 Bois de Frêne et 5 000 Fer. Les Extraits ne sont craftables qu'à partir du niv. 5 : il faut environ **765 Minuscules Extraits** pour aller du niv. 5 au niv. 15 (1 900 XP). Le Petit Extrait (niv. 15) n'est débloqué qu'à l'arrivée. Captures et accouplements vont plus vite (voir plus bas).

*Phase 2, du niv. 15 au niv. 200,* en craftant toujours le carburant qui vient d'être débloqué :

| Palier visé | Crafts de carburant cumulés depuis le niv. 15 | Ressources consommées (cumul) | Intérêt du palier |
|---|---:|---:|---|
| 40 | ≈ 950 | ≈ 1 900 | 2e enclos (novice) |
| 55 | ≈ 1 530 | ≈ 3 050 | Philtres |
| 80 | ≈ 2 330 | ≈ 5 470 | 3e enclos |
| 105 | ≈ 3 190 | ≈ 8 050 | Potions, Filet multiplicateur (100) |
| 120 | ≈ 3 640 | ≈ 9 860 | 4e enclos |
| 155 | ≈ 4 810 | ≈ 14 500 | Élixirs, Filet renforcé (150) |
| 160 | ≈ 4 930 | ≈ 15 130 | 5e enclos |
| 200 | ≈ 6 200 | ≈ 21 500 | 6e enclos, Filet multiplicateur renforcé |

Les niveaux d'accès aux enclos (1, 40, 80, 120, 160, 200) et de déblocage des filets viennent du guide DPLN.

- **Crafts à bas niveau :** ils rapportent très peu. La capture (30 XP par monture) et l'accouplement (30 XP × génération, pour chacun des deux parents, soit 30 × (G parent 1 + G parent 2)) font mieux au début (guide DPLN ; client `Rides.breedingExperienceRewardQuantity` = 30 × G ; haute). Environ 70 captures suffisent pour aller de 1 à 15.
- **Règle d'XP :** crafter **la taille qui vient d'être débloquée**, puisqu'il y en a une nouvelle tous les 10 niveaux. 9 niveaux au-dessus d'une recette, son XP tombe à environ 47 % (1 / (1 + 0,1 × 9^1,1) = 0,472 ; 44 % à 10 niveaux ; cohérent avec le tableau ci-dessus et `strategy.md` §3.1 — chiffre précisé par la critique de complétude du 2026-10-02).
- **Ce que la simulation ne compte pas :** les bonus d'XP de métier éventuels (événements, serveurs). La formule reste à vérifier en jeu : l'interface de craft affiche l'XP gagnée.

---

## 7. Bêta 3.7.3.3 : différences avec la version live 3.6.12.16

Source : client bêta et client live comparés objet par objet (`RecipesDataRoot`, `ItemsDataRoot` avec les effets, `I18n/fr.bin`, `PaddockGaugesData`). Confiance haute sur le contenu de la bêta du 2026-10-01, moyenne sur la version finale.

| Élément | Live 3.6 | Bêta 3.7.3.3 |
|---|---|---|
| Paliers des jauges d'enclos | 40 k / 70 k / 90 k / 100 k | **80 k / 140 k / 180 k / 200 k** (consommation inchangée : 10/20/30/40 par 10 s) |
| Durabilité des carburants | 1 000 → 5 000 | **2 000 → 10 000** (×2), plafonds 80 000 / 140 000 / 180 000 / aucun |
| Noms des carburants | « … de Baffeur / Caresseur / Foudroyeur / Abreuvoir / Dragofesse / Mangeoire » | « … de **perte de Sérénité** / **gain de Sérénité** / **d'Endurance** / **de Maturité** / **d'Amour** / **d'Expérience de monture** », ex. « Gigantesque Élixir d'Expérience de monture ». La description parle toujours de « la jauge de Mangeoire ». |
| Recettes des carburants | — | **inchangées** (0/120) |
| Recettes des filets | — | **inchangées** (0/10) |
| Optimakina | +10 % de génération cible | **+20 %** |
| Animakina | capacité aléatoire (27/27/27/14/5 %) | **« permet de choisir le sexe d'un bébé »** (nouvel effet 4069). Les capacités spéciales ne viennent donc plus de l'Animakina. D'après le devblog 3.7 (16/09/2026), elles apparaîtront **sans makina** avec ces chances : Reproductrice 3 %, Sage 6 %, Précoce 8 %, Amoureuse 8 %, Endurante 8 %. Les Animakinas déjà possédées seront converties automatiquement. |
| Kromakina | Caméléone 100 % | inchangée |
| Recettes des makinas | une seule couleur de ressource (×(G−1)) | **74/81 modifiées** : ressources réparties sur 4-5 couleurs (ex. Optimakina Muldo G10 = 3 Bave + 3 de chaque Moustache au lieu de 3 Bave + 10 Moustaches dorées), 6 ressources de boss remplacées (§3.4). Seules 7 makinas G2 restent identiques. |
| XP (craftXpRatio) | 5 % (types 99/323/326), 50 % Filet universel | inchangé |
| Génétons | — | ≈ ×2 (`breedingTokenRewardQuantity`, voir `research/raw/dofus-client/README.md`) |

L'application doit pouvoir **basculer entre les règles 3.6 et 3.7**. Toutes les valeurs de la bêta sont dans `crafts.json`, sous `beta_3_7` et `gaugeTiers.beta_3_7`.

---

## 8. Schéma de `research/data/crafts.json`

- **`meta`** : versions, sources, compteurs, formule d'XP, notes.
- **`gaugeTiers`** : `live_3_6` et `beta_3_7`, au format `{tier, from, to, consumptionPer10s}`.
- **`fuels[]`** : 120 entrées.
  - Identité : `id`, `name` (FR en jeu), `nameEn`, `level`, `typeId`, `effectId`.
  - Recette : `ingredients[{id, name, qty}]`, `ingredientCount`, `totalIngredientUnits`.
  - XP : `xp{craftXpRatioPct, xpPerCraftAtRecipeLevel, xpPerCraftJobPlus10, xpPerCraftJobPlus30, xpPerCraftAtJob200}`.
  - Jauge : `gauge` (`mangeoire|abreuvoir|foudroyeur|dragofesse|caresseur|baffeur`), `gaugeClientKey`, `mountStat`.
  - Carburant : `tier` (1-4), `tierName` (`extrait|philtre|potion|elixir`), `size` (`minuscule|petit|normal|grand|gigantesque`), `durability`, `fillCap`, `ingredientsPer1000Durability`, `unlockJobLevel`.
  - Bêta : `beta_3_7{name, durability, fillCap, recipeChanged, ingredients}`.
- **`makinas[]`** : 81 entrées.
  - Identité et recette : comme les carburants, plus `kind` (`kromakina|animakina|optimakina`), `family`, `speciesId`, `generation`, `usableForTargetGenerationUpTo`.
  - Effet : `effect` (`capacite_cameleone`, `capacite_aleatoire{chancesPct}` ou `bonus_generation_cible{bonusPct}`).
  - Ressources de monture : `mountResourceUnits`.
  - Bêta : `beta_3_7{name, recipeChanged, ingredients, effect, mountResourceUnits}`.
- **`nets[]`** : 10 entrées.
  - Identité et recette : comme les carburants, plus `kind` (`universel|multiplicateur|renforce|multiplicateur_renforce`) et `family` (null pour l'universel).
  - Usage : `requiredJobLevelToEquip`, `effect`, `grantsTemporarySpell`.
  - Bêta : `beta_3_7`.
- **`ingredients[]`** : 471 entrées.
  - Identité : `id`, `name`, `level`, `typeId`, `typeName`, `npcPrice`.
  - Usage : `usedInRecipes`, `totalQtyAllRecipes`, `usedIn[]`.
  - Monture : `isMountResource`, `mountFamily`.
  - Divers : `recyclingNuggets`.
  - Provenance : `source` (détail ci-dessous).
- **`source`** de chaque ingrédient :
  - `kind` (`harvest|drop|other`) et `details` (texte en français) ;
  - récolte : `job`, `jobId`, `jobLevel`, `skill`, `topSubareas[{id, name, area, spots}]` ;
  - drop : `monsters[{id, name, levelMin, levelMax, dropPctMin, dropPctMax, isBoss, isArchmonster, dropCriterion, subareas}]` (5 au maximum, sources « naturelles » d'abord ; boss : version la plus basse d'abord), `droppersCount`, `bossOnly`, `requiresHunterJobLevel`, `dropSubareas`, `monstersMissingInDofusDB`.
- **`mountResources[]`** : les 18 ressources de drop des montures sauvages et les 3 ressources d'extraction, avec `family`, `origin`, `droppedBy`, `eleveurQtyLive`, `eleveurQtyBeta37` et `recipesByJob` (usages dans les autres métiers).
- **`unmapped`** : `[]`.

Méthode de reconstruction :
- Les recettes, objets et types viennent de `research/raw/` et des appels DofusDB cités au §0.
- La bêta vient des outils `research/raw/dofus-client/tools` : `cytrus.py`, puis `fetchfile.py` sur les fichiers `data_assets_recipesdataroot`, `itemsdataroot`, `itemtypesdataroot` et `effectsdataroot.asset.bundle` et sur `I18n/fr.bin`, puis `dumpbundle.py`.
- Format de `fr.bin` : nom de langue, puis `int32 count`, puis `count × (int32 id, uint32 offset)`, puis les chaînes UTF-8 préfixées par une longueur 7-bit.

---

## 9. Questions ouvertes

1. **Débordement du plafond :** quand on dépose un carburant qui dépasserait le plafond de son tier (ex. un Normal Extrait à 39 000), l'excédent est-il perdu ou le dépôt refusé ? Non testé en jeu. Le devblog 3.7 parle de « limiter le gaspillage de carburant » avec une fenêtre de confirmation, ce qui laisse penser que l'excédent est perdu en live (confiance moyenne).
2. **Formule d'XP de craft en Dofus 3 :** la formule vient du client Dofus 2, avec le ratio de 5 %. Elle reste à confirmer en jeu, par exemple avec l'XP affichée pour un Minuscule Extrait au niveau 5, qui devrait être de 5.
3. **Correspondance exacte des effectId 3842-3844 de l'Animakina** (amoureuse, endurante, précoce) : sans conséquence, toutes valent 27 %.
4. **Contenu antérieur des deux recettes modifiées en 3.6** (Petit et Grand Extrait de Caresseur).
5. **Prix PNJ en poussière d'élevage en 3.7**, et existence d'une source de poussière après la compensation de la 3.5.
6. **Bêta 3.7 :** ~~on ne sait pas d'où viendraient les capacités spéciales~~ → **résolu par le devblog 3.7** : elles apparaîtront sans makina (3/6/8/8/8 %). Reste à savoir si ces chances se cumulent avec l'Optimakina ou la génération cible, et si elles figurent dans les données de la bêta. Elles sont absentes des tables déjà extraites (`RidesData`, `PaddockGauges`, `RideGauges`, effets d'objets), et le reste du client bêta n'a pas été fouillé. Toutes ces valeurs peuvent encore changer avant la sortie.
7. **Prix HDV :** aucun prix (ressources, carburants, Pépites, ressources de monture) n'est disponible dans DofusDB. L'application doit les faire saisir ou les importer.

---

## Vérification

Vérification adversariale du 2026-10-02 sur `research/data/crafts.json` et ce fichier. Les données ont été recalculées ou re-téléchargées depuis des sources indépendantes : API DofusDB interrogée à nouveau, client Ankama live **re-extrait** à part, extraction bêta d'un autre agent (`research/raw/mechanics-evidence/client-data/`), devblog officiel 3.7, pages DPLN 3.5 / 3.6 / tableaux d'XP, code source du client Dofus 2.

**Verdict : base solide.** Aucune erreur trouvée dans les recettes, les quantités, les durabilités, les plafonds ni l'XP. Les corrections portent sur des formulations, des sources héritées mal étiquetées et des questions ouvertes que le devblog 3.7 tranche.

### Ce qui a été vérifié (tout est conforme sauf mention contraire)

| # | Affirmation | Méthode / source indépendante | Résultat |
|---:|---|---|---|
| 1 | JSON valide ; 120 carburants, 81 makinas, 10 filets, 471 ingrédients, 21 `mountResources`, `unmapped` vide | `python3 json.load` + comptages | conforme |
| 2 | Les 211 recettes (ingrédients, quantités, niveau, nom, type) = DofusDB | comparaison avec `raw/recipes-eleveur.json` | 0 écart |
| 3 | « 0 différence avec le client live 3.6.12.16 » | **re-extraction indépendante** : manifeste cytrus `6.0_3.6.12.16` → `data_assets_recipesdataroot.asset.bundle` (SHA-1 OK) → UnityPy, 211 recettes jobId 79 | 0 écart, aucune recette en plus |
| 4 | Versions live et bêta | `cytrus.json` (dofus3 = 6.0_3.6.12.16, beta = 6.0_3.7.3.3) et DofusDB `/version` = 3.6.12.16, le 2026-10-02 | conforme |
| 5 | Durabilité 1 000 → 5 000 et plafonds 40 k / 70 k / 90 k / aucun | effet de chaque objet (`value`, `diceNum×diceSide`, Élixir = 1×0) et descriptions en jeu, pour les 120 carburants | conforme |
| 6 | Niveau = 5 + 10 × (5(tier−1) + taille) ; 2/3/4/5 ingrédients par tier ; tous ×1 ; préfixes Petit/Grand, mais Petite/Grande Potion | recalcul sur les 120 | conforme |
| 7 | 1 ressource de base par carburant, partagée par 2 tailles consécutives ; 300 ressources de monstres, chacune dans une seule recette Éleveur | recalcul | conforme (60 bases × 2 ; 300 × 1) |
| 8 | Métiers et niveaux de récolte des ressources de base (dont Bois de Pin = Bûcheron 90) | DofusDB `skills?gatheredRessourceItem[$in]` re-téléchargé | conforme |
| 9 | Viandes réservées aux Chasseurs | DofusDB `monsters` : `criterions` = `Pj>41,179&CU>0` (Viande Gâtée / Mama Bwork) ; `jobs` 41 = Chasseur | conforme |
| 10 | Taux de drop, niveaux et nombre de droppeurs des ressources de monstres | 12 ressources tirées au hasard (Patte d'Arakne Magique, Pince de Krabouilleur, Œuf de Crapeur, Peau de Kraméléhon…) re-téléchargées depuis DofusDB `monsters` | 12/12 identiques |
| 11 | Composition des makinas : 1 boss, 10 Pépites, G−1 ressources de monture par couleur (10 en G10), Sueur/Bave/Griffe ×1/×2/×3 ; 81 boss distincts ; effets 3837 (espèce, gén. max), 3838 = 10, 3839, 3840-3844 = 5/14/27/27/27 | recalcul sur les 81 + effets DofusDB | conforme ; **la formulation « par pas de 2 » des niveaux était inexacte** (voir corrections) |
| 12 | « Makina G = cible ≤ G » | descriptions en jeu (« de génération G ou inférieure ») | conforme |
| 13 | Pas besoin de makina au-delà de G10 | client `RidesData` : génération max = 10 pour les 3 espèces | conforme |
| 14 | Totaux du §3.3 (46 / 58 / 138 / 92… ; bêta 45 / 57 / 75…) | recalcul depuis l'extraction bêta indépendante | conforme |
| 15 | Bêta : 74/81 makinas modifiées, 0/120 carburants, 0/10 filets, 7 makinas G2 inchangées, 6 ressources de boss remplacées, exemple Optimakina Muldo G10 | `mechanics-evidence/client-data/eleveur-recipes-3.7.3.3-beta.json` (autre extraction) | conforme |
| 16 | Bêta : durabilité ×2 et plafonds 80 k / 140 k / 180 k / aucun ; paliers de jauge 80 k / 140 k / 180 k / 200 k | `breeding-item-effects-3.7.3.3-beta.json` et `paddock-gauges-3.7.3.3-beta.json` ; devblog 3.7 (« 3 000 → 6 000 », jauges 100 000 → 200 000) | conforme |
| 17 | Bêta : Optimakina +20 %, Animakina = choix du sexe (effet 4069), nouveaux noms des carburants | effets bêta + **devblog officiel du 16/09/2026** (« Élixir de dragofesse » → « Élixir d'amour ») | conforme |
| 18 | Consommation 10/20/30/40, durées 11 h 07 / 4 h 10 / 1 h 51 / 42 min = 17 h 49 (bêta 35 h 39) ; jauges de monture de 20 000 et intervalles de sérénité | `paddock-gauges` / `ride-gauges` 3.6.12.16 + recalcul ; guide DPLN (17 h 48) | conforme |
| 19 | Remplissage 0 → 100 000 : 20 Gigantesques / 60 ressources ; 100 Minuscules / 300 ; Normal 35, Grand 26 ; 11 200 poussières au PNJ | recalcul, prix PNJ du guide DPLN | conforme |
| 20 | Formule d'XP de craft | code `Item.as` de https://github.com/scalexm/DofusInvoker relu : `20*level/(pow(jobLevel-level,1.1)/10+1)`, ratio objet puis type, `MAX_JOB_LEVEL_GAP = 100` ; `item-types` 99/323/326 = 5 et objet 32521 = 50 (DofusDB) | identique ; **844 valeurs d'XP du JSON recalculées, 0 écart** |
| 21 | Table d'XP du métier (398 000 au niv. 200) et simulation 15 → 200 | `xpData.metier` re-téléchargé sur https://www.dofuspourlesnoobs.com/tableaux-dexpeacuterience.html : 10·n·(n−1) sauf niv. 3 (40) ; simulation refaite : 949 / 1 898 … 6 203 / 21 487 | conforme ; **phase 1 imprécise** (voir corrections) |
| 22 | Extraction : quantité = génération, gén. 1 = 0, sénile = 1 ; ressources 33515 / 17864 / 19975 | client `RidesData.extractionRewardQuantity` / `senileExtractionRewardQuantity`, `RideSpecies` | conforme |
| 23 | Drops des montures sauvages (42 % ; 7,1 % ; 2 % ; amande 44 / 7,36, rousse 43 / 7,16, dorée 41 / 6,7 ; archimonstres environ ×2) | DofusDB `items` → `dropMonsterIds` → `monsters` re-téléchargés | conforme ; **niveau : 62-70 pour DofusDB contre « niveau 60 » pour DPLN**, désormais consigné |
| 24 | Usages de Neurone / Ambre / Corne dans les autres métiers | DofusDB `recipes?ingredientIds=` (total et répartition par métier) | Ambre 111 et Corne 112 conformes ; **Neurone = 111, pas 112** |
| 25 | Aucun ingrédient craftable ; skill 422 partout | DofusDB `recipes?resultId[$in]` par lots (0 résultat) ; `skillId` des 211 recettes | conforme |
| 26 | 2 recettes modifiées le 2026-06-23 (Petit et Grand Extrait de Caresseur) | `updatedAt` du dump DofusDB | conforme |
| 27 | DPLN 3.6 sans changement des crafts Éleveur | page https://www.dofuspourlesnoobs.com/mise-a-jour-306.html re-téléchargée | conforme ; la page 3.5 révèle **une source de Neurones absente du document** (Amateur de Guildaton) |
| 28 | Table des ressources de boss | 6 lignes vérifiées dans DofusDB (Moon, Glourséleste, Toxoliath, Tynril Perfide, Chafer Rōnin, Gelée Royale Bleuet) | conforme ; **« Maître des Pantins (400) » trompeur** (voir corrections) |
| 29 | Pépite : ni drop ni recette qui la produit ; issue du recyclage | DofusDB `items/14635` ; date de l'article gamosaurus | conforme pour DofusDB ; **source datée de 2022 (Dofus 2)**, désormais étiquetée comme héritée |
| 30 | Cohérence entre les tableaux du .md et le JSON | analyse des 120 lignes de carburants, des 10 filets et des 81 makinas du .md | 0 écart |

### Corrections apportées

**Dans `crafts.md` :**
- §1 : « niveaux de makina par pas de 2 » remplacé par la règle exacte : pas de 2 dans une génération, saut de 4 entre G2→G3 … G7→G8, rien aux niveaux 35/55/75/95/115/135. Ajouté : une makina G2 couvre aussi une cible de génération 1.
- À retenir n° 5 : la quantité de ressources de monture (1 → 10) est **par couleur**. Une Kromakina Muldo G10 demande 30 Moustaches.
- À retenir n° 8, §7 et §9 (question 6) : le devblog 3.7 dit d'où viennent les capacités en 3.7. Elles apparaîtront sans makina (Reproductrice 3 %, Sage 6 %, Précoce 8 %, Amoureuse 8 %, Endurante 8 %) et les Animakinas existantes seront converties.
- §0 : sources ajoutées (devblog 3.7, DPLN « Mise à jour 3.5 »).
- §2.3 et §9 (question 1) : le devblog 3.7 (« limiter le gaspillage de carburant ») indique qu'en live l'excédent au-delà du plafond est probablement perdu. Confiance passée de basse à moyenne, toujours non testé en jeu.
- §3.1 : écart de nom signalé (« Caméléon » en jeu, « Caméléone » chez DPLN).
- §3.4 : « Maître des Pantins (400) » annoté. Les grades 400-800 sont atypiques dans DofusDB : c'est un donjon de niveau 100 (`dungeons` 72, `optimalPlayerLevel` = 100).
- §4 : niveau requis pour un filet = « au moins égal » au niveau du filet, et non « égal ».
- §5.1 : la source sur la Pépite (gamosaurus, 2022-2023) est étiquetée **Dofus 2 / héritage**, non revérifiée pour Dofus 3.
- §5.2 : niveaux des montures sauvages : DofusDB 62-70 (archimonstres 55-67 et 60-72) **et** DPLN « niveau 60 ».
- §5.3 : Neurone = **111** recettes (et non 112). Ajout de l'**Amateur de Guildaton** (15 guildatons, 3 par semaine, 6 si la guilde est niv. 13 ; DPLN 3.5). Passage à 30 en 3.7, avec une confiance moyenne qu'il s'agisse bien des Neurones.
- §6 : XP d'accouplement = 30 × (G parent 1 + G parent 2), et non « × génération × 2 », sauf si les deux parents ont la même génération. Phase 1 : 503 filets = 5 000 Bois de Frêne + 5 000 Fer. Les 765 Extraits sont des **Minuscules** et couvrent les niv. 5 → 15 (1 900 XP), pas 2 100 XP.

**Dans `crafts.json` (forme inchangée, seuls des textes ou des éléments de liste ont été ajoutés) :**
- `meta.sources` : + devblog 3.7, + DPLN « Mise à jour 3.5 ».
- `meta.notes` : + note de vérification, + capacités sans makina en 3.7, + débordement probablement perdu, + Caméléon / Caméléone.
- `mountResources[Neurone de dragodinde].origin` : + source Amateur de Guildaton.
- `mountResources[18 ressources de drop].origin` : + niveaux DofusDB et DPLN.
- `ingredients[Pépite].source.details` : + étiquette « source Dofus 2 ».
- `ingredients[Chaussette trouée de Dramak].source.details` : + note sur le niveau 400-800 et le donjon de niveau 100.

### Doutes restants
- La formule d'XP de craft est celle du client **Dofus 2**. Elle n'a pas été mesurée en jeu sur Dofus 3 (confiance moyenne maintenue).
- Le débordement au-delà du plafond n'a pas été testé en jeu.
- L'affectation Reproducteur = 3840 et Sage = 3841 repose sur la concordance des valeurs (5 % et 14 %) avec le guide.
- Les prix en poussière d'Adèle Vage datent du guide 3.5. Ils ne sont pas revérifiés en 3.6 et sont inconnus en 3.7.
- Toutes les valeurs bêta 3.7 peuvent changer avant la sortie.
- L'interprétation « chaque point vaut double » pour les Almanax qui doublent une jauge n'est pas vérifiée.
