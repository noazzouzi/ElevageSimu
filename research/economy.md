# Économie de l'élevage (système 3.5+) : prix, rentabilité et valeurs par défaut

> ElevageSimu, recherche. Rédigé le 2026-10-01.
> Données lisibles par machine : `research/data/prices-default.json` (valeurs par défaut du calculateur, toutes modifiables).
> Versions : live **3.6.12.16** au 2026-10-01 ; **3.7** en bêta (client 3.7.3.3, devblog du 16/09/2026). Voir `research/raw/dofus-client/README.md`.

**Unités.** `k` = millier de kamas, `M` = million de kamas ; « kamas/pt » = kamas par point de jauge. Les petits montants sont écrits en toutes lettres (« 27 kamas »).

**Conventions.** Chaque fait porte une source (code `[Sx]` renvoyant au tableau du §1) et une confiance : **haute**, **moyenne** ou **basse**. Un prix tiré d'une vidéo est un relevé ponctuel sur **un** serveur, à **une** date : il vaut comme ordre de grandeur, pas comme cours. Tout ce qui est marqué **ESTIMATION** est un calcul ou un raisonnement de notre part, sans relevé direct. L'application doit laisser l'utilisateur modifier chaque prix.

L'ancien système (avant le 3 mars 2026 : certificats, gestation, échange de dragodindes contre parchemins) n'apparaît ici que dans des encadrés **[Héritage pré-3.5]**. Ses chiffres ne servent jamais de valeurs par défaut.

---

## À retenir (pour le calculateur)

1. **Les vraies sources de kamas, d'après les sources, sont au nombre de quatre :**
   - vendre des ressources (ingrédients de carburants, ressources de capture, ressources d'extraction) ;
   - extraire les montures stériles : Neurone, Ambre ou Corne, une ressource par génération ;
   - **briser** les montures (runes Ga PM et Ga PA), toujours possible au 2026-10-01 ;
   - vendre des montures de haute génération et/ou de haut niveau.

   Les génétons (parchemins) rapportent peu en volume. Ankama annonçait trois sources (revente, ressources exclusives, génétons) et disait que le brisage serait impossible. En pratique, les joueurs brisent les montures depuis la 3.5 ([S1], [S9], [S12], [S20] ; confiance haute que c'est possible en 3.5 et 3.6, moyenne que ça le reste après la 3.7).
2. **Une monture stérile a une valeur plancher.** Ce plancher est `max(G × prix de la ressource d'extraction × 0,98 ; valeur de brisage au niveau atteint ; prix HDV de revente)`. Avec les relevés : Ambre ≈ 14 à 25 k, Neurone ≈ 7 k (un seul relevé), brisage d'un Muldo ou d'un Volkorne niveau ≈ 53 ≈ 12 k de runes (≈ 10 k après capture et XP). Une génération 2 extraite rapporte donc ≈ 30 à 50 k pour un Muldo. C'est plus qu'une revente de génération 1-2 niveau 100 (≈ 50 k pour un Muldo doré, marché saturé) ([S13], [S9], [S12]).
3. **XP de monture avec un T1 bon marché : peu de kamas, beaucoup de temps.** Avec l'**Extrait de Mangeoire** (3 000 points, ≈ 1 000 kamas ; [S9], [S10]) et 10 montures par enclos, le coût est de ≈ 1,3 k par monture jusqu'au niveau 53, ≈ 5,8 k jusqu'au niveau 100 et ≈ 29 k jusqu'au niveau 200. Il faut compter 11 h, 48 h et 241 h d'enclos (calcul, voir §6.3).
4. **Les tiers hauts coûtent très cher au point.** Philtre T2 gigantesque ≈ 3,2 kamas/pt [S16] (un seul relevé, contredit par un commentaire qui donne ≈ 3× le T1, soit ≈ 1 kamas/pt [S11] : confiance basse). Grande Potion de Mangeoire ≈ 6× le coût par point de l'Extrait [S9], soit ≈ 2 à 2,5 kamas/pt. Chaque Gigantesque Élixir T4 demande 4 ressources de monstres de niveau 200 à 2 % de drop plus 1 ressource de niveau 180 (DofusDB [S21] ; « 2 % de chance de base » [S9]) ; l'une d'elles (Huile de Pikoleur ou Broderie d'Eskoglyphe) vaut à elle seule 40 à 50 k [S7]. **Par défaut, l'optimiseur doit préférer T1/T2 et réserver T3/T4 aux cas où le temps compte.**
5. **Les génétons valent ≈ 375 kamas/généton** au prix stabilisé des Puissants Parchemins (≈ 60 k, de mai à septembre 2026, Salar ; [S10], [S20]). Un Puissant Parchemin coûte 160 génétons chez Eugène Éton [S2], [S9]. Fourchette historique : de 125 kamas/généton avant la 3.5 (Puissant < 20 k) à 725 kamas/généton au pic du 12/04/2026 (116 k). **La 3.7 bêta double les génétons par parent** [S3], [S4], ce qui pourrait faire baisser le prix des parchemins (**ESTIMATION**).
6. **Le brisage est très rentable en ROI mais le volume est limité.** Valeur des runes ≈ ×4,3 le coût sur 1 020 Muldos (ROI affiché 332 %, soit bénéfice/coût) et ≈ ×6,8 sur 10 000 Volkornes au niveau ≈ 53 ([S9], [S20] ; confiance moyenne). Le niveau optimal est ≈ 40 à 55. Le marché absorbe ≈ 2 000 Ga PA par jour et ≈ 21 500 Ga PM par semaine sur Salar [S9]. Ankama a écrit que le brisage ne serait pas possible [S5] : **c'est un risque de correctif**.
7. **Frais d'HDV : taxe de 2 %** à la mise en vente, et 1 % de plus quand on modifie un prix déjà affiché ([S17] ; confiance moyenne). L'exemple de [S15] tombe aussi sur 2 %.
8. **Peu de prix de montures publiés.** Relevés disponibles : Dragodinde gén. 1 capturée 10 à 15 k (mars), gén. 1 féconde 500 à 800 k (mars, marché naissant), Muldo doré niv. 100 ≈ 50 k (septembre), Muldo Aigue-marine niv. 200 ≈ 15 M (avril). **Le reste du tableau des montures dans le JSON est un plancher estimé**, à confirmer en jeu.

---

## 1. Sources

| Code | Source | Date | Serveur | Nature |
|---|---|---|---|---|
| S1 | Guide DPLN « Guide de l'éleveur (édition 2026) », https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html (texte : `research/raw/guide-eleveur-dpln.txt`) | 27/02/2026, maj 02/03/2026 | — | référence mécanique 3.5 |
| S2 | Capture de la boutique d'Eugène Éton publiée par DPLN (`research/raw/mechanics-evidence/screenshots/eugene-eton-genetons.jpg`) | 02/2026 (bêta 3.5) | — | liste de la boutique de génétons |
| S3 | Devblog Ankama 3.7, https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1771790-maj-3-7-confort-jeu-lisibilite-ajustements (`research/raw/mechanics-evidence/texts/devblog-3.7-elevage-2026-09-16.txt`) | 16/09/2026 | — | officiel, changements annoncés |
| S4 | Client Dofus 3, `RidesDataRoot` (`research/raw/mechanics-evidence/client-data/breeding-constants-by-client-version.json`) | 3.5.3.1 → 3.7.3.3 bêta | — | données du jeu (haute) |
| S5 | Devblog Ankama « Refonte de l'élevage, partie II » (`research/raw/mechanics-evidence/texts/devblog-elevage-partie-II-2025-04-28.txt`) | 28/04/2025 | — | officiel, intentions d'avant la sortie |
| S6 | DPLN « Mise à jour 3.5 », https://www.dofuspourlesnoobs.com/mise-a-jour-305.html, et « Mise à jour 3.6 », https://www.dofuspourlesnoobs.com/mise-a-jour-306.html | 03/2026 et 20/06/2026 | — | notes de mise à jour |
| S7 | Melcgame, « Astuces Kamas DOFUS liées aux Dragodindes ! », https://www.youtube.com/watch?v=IlEEr8Nxv_Q | 13/03/2026 | non précisé | transcription TubeLab |
| S8 | Maxma, « Comment faire des Kamas avec l'élevage (ou presque) sur DOFUS en 2026 », https://www.youtube.com/watch?v=be6wubCnC24 | tournée le 10/03, publiée le 11/03/2026 | non précisé | transcription TubeLab (données HDV « cours du marché ») |
| S9 | Solomonk-e (éleveur, Salar), série post-3.5 : https://www.youtube.com/watch?v=er35rckGDFM (≈ 10/03), https://www.youtube.com/watch?v=MSFc68m3JYg (≈ mi-mars, ajouté par la vérification), https://www.youtube.com/watch?v=41ka94FXdM0 (24/03), https://www.youtube.com/watch?v=z8TYzeV8g-o (avril), https://www.youtube.com/watch?v=ueP_g9naNQ4 (avril), https://www.youtube.com/watch?v=-eOWUAir9j8 (≈ mai), https://www.youtube.com/watch?v=KFzrg1-MRGQ (≈ mai), https://www.youtube.com/watch?v=9OxHDXq-4WI (10/05), https://www.youtube.com/watch?v=VvxzyS3H_oE (25/05), https://www.youtube.com/watch?v=fGqEPyQoBgk (≈ septembre) ; vidéo d'avant la 3.5 https://www.youtube.com/watch?v=a_Meh5-rqWk (février 2026, prix des serveurs pionniers) | 02 → 09/2026 | **Salar** (pionnier), où il élève. Il cite aussi Orukam (historique) | transcriptions TubeLab. Source la plus riche, confiance moyenne : relevés d'un seul joueur |
| S10 | Solomonk-e, « Comment se faire des millions… (sans faire d'élevage) », https://www.youtube.com/watch?v=r0c4r9Ndz8M | ≈ début mai 2026 (ventes du 12 au 19/04) | Salar (et Orukam) | prix des parchemins, boutique d'avitons |
| S11 | Commentaires YouTube sous [S9] (41ka94FXdM0) : @remirousselet6867, @jackwarq3909, @Michel1478, @EneVyctisGames, @MorganDaniel-g6t4n, @siyoo2 | 04 → 07/2026 | Tal Kasha (Michel1478), autres non précisés | témoignages (basse à moyenne) |
| S12 | Qays Gaming TV, « Brisage 200 MULDO VS Extraction 200 MULDO », https://www.youtube.com/watch?v=hLrYDDDRe8s | 08/09/2026 | « serveur peu peuplé » non nommé | transcription TubeLab |
| S13 | Qays [S12], ventes d'Ambre de muldo | 08/09/2026 | idem | — |
| S14 | HUZ, « Le TUTORIEL de L'ÉLEVAGE sur DOFUS 3.5 », https://www.youtube.com/watch?v=vffTmcHk1lY ; Laniyelle, https://www.youtube.com/watch?v=9DOVGqb_rXg ; Timtoobias, https://www.youtube.com/watch?v=dQjMQMnfeqE | 17/02 → 04/03/2026 | — | tutoriels, pas de prix |
| S15 | Dofus Astuces Kamas, https://dofus-astuces-kamas.com/blog/astuces-kamas-eleveur | 14/09/2026 | — | **les montants y sont déclarés fictifs**. Seul le taux de taxe d'HDV implicite est repris |
| S16 | HumaGo, « Up des premiers niveaux de mon métier éleveur (+15m kamas) », https://www.youtube.com/watch?v=hhAN0h_68X8 ; « Farm 3000 muldos : 3m6/h », https://www.youtube.com/watch?v=FCVngzbCB3k | 01/05/2026 ; ≈ début mai 2026 | serveur non précisé (persos sur Orukam, Hell Mina, Tal Kasha, Tylezia, Imagiro, Draconiros) | transcriptions TubeLab |
| S17 | Tenmalexis, « LES ITEMS les + VENDUS en JUIN… », https://www.youtube.com/watch?v=ry1jsE9fvRU ; « Le PACK pour MONTER ÉLEVEUR 200… », https://www.youtube.com/watch?v=DPBN9vN5AFE | 08/07/2026 ; 01/03/2026 | — | taxe d'HDV, pack de métier |
| S18 | Scripts05, « AVENTURE ÉLEVAGE EP.1 — Les Fondations (Gen 1 → Gen 10) », https://www.youtube.com/watch?v=e99jkyONuR0 | 06/03/2026 | non précisé | **projection**, pas un bilan |
| S19 | Dafous, https://dafous.app/en/guides/guide-eleveur.html (« retour d'expérience » du 17 au 23/03/2026) | maj 14/03/2026 | non précisé | marge hebdomadaire |
| S20 | Solomonk-e, « Je brise 10 000 Volkornes… », https://www.youtube.com/watch?v=fGqEPyQoBgk (traduction automatique EN de TubeLab) | ≈ septembre 2026 | Salar (probable) | bilan chiffré |
| S21 | DofusDB API (`/items`, `/recipes`, `/npcs`) : identifiants, `recyclingNuggets`, recettes qui utilisent Neurone, Ambre et Corne (`research/data/crafts.json` et requêtes du 2026-10-01) | 2026-10-01 | — | données (haute) |
| S22 | Wallaka/dofus-efficiency (GitHub), PR #63 « Éleveur : rentabilité du brisage des muldos » et `src/lib/mounts.ts` | 15/09/2026 | — | outil communautaire (hypothèses de rendement de brisage) |

Sources non exploitables : le forum officiel dofus.com bloque les requêtes automatiques (HTTP 202 vide). Reddit renvoie un HTTP 403. dofhub.com/guide-elevage renvoie un HTTP 403. ibendouma.com (site de vente de kamas) mélange l'ancien et le nouveau système et ne donne aucun prix : il est écarté. Aucun résumé Discord public n'a été trouvé.

---

## 2. Contexte économique depuis la 3.5 (03/03/2026)

- **Choc de demande sur les ressources de carburant.** Le 10/03/2026, Maxma relève : Patte d'Arakne Magique ≈ 2 400 kamas le 04/03, pic à 4 400 kamas, puis ≈ 3 000 kamas ; Pierre de Granit 2 000 kamas, puis 3 000 kamas, puis 1 600 à 2 000 kamas ; Scalp de Bwork Archer ≈ 4 400 kamas, avec **4 317 ventes le 09/03, soit environ 19 M de volume**. Avant la mise à jour, ces ressources valaient « quelques centaines de kamas » [S8] (moyenne).
- **Hausse de ×10.** Solomonk compare ses achats de février et les prix de mars : Souris verte de 155 à 1 300 kamas, larve champêtre de 590 à 4 400-6 000 kamas. Il relève aussi le Crâne de Wabbit Squelette à 5 400 kamas et la Coquille de Fantimonier à 6 500 kamas [S9] (moyenne). Un message de forum lu dans [S9] (avril) parle de ressources basses passées « de 400 à 7 000 ou 8 000 kamas ».
- **Les élixirs de haut niveau se vendent mal tout faits.** Le Gigantesque Élixir de Dragofesse ou de Baffeur est affiché à 1 M sans trouver preneur. Leurs ingrédients rares (Huile de Pikoleur, Broderie d'Eskoglyphe) se vendent 40 à 50 k pièce [S7] (basse à moyenne). L'Huile de Pikoleur valait ≈ 23 k avant la 3.5 sur les serveurs pionniers [S9].
- **Parchemins de caractéristiques.** Avant la 3.5, les éleveurs en produisaient l'essentiel (voir l'encadré Héritage). Après, le Puissant Parchemin passe de **< 20 k** (février) à **32-39 k** (09/04), puis **116 k** (12/04). Il redescend vers ≈ **60 k**, stable « depuis plusieurs mois » en septembre ([S10], [S20] ; Salar ; moyenne). Le Grand Parchemin vaut ≈ 30 k en mai [S10] (basse à moyenne).
- **Brisage des montures.** Depuis la 3.5, une monture est un objet équipable de niveau 60 (DofusDB : `level` = 60, typeId 332 Muldo [S21]). On peut la briser avec un coefficient de 50 %, sans « focus », puisqu'elle n'a pas de recette ([S9], [S20] ; haute que c'est possible). Le devblog de 2025 disait le contraire : « le brisage des montures pour obtenir des runes de forgemagie ne sera pas possible » [S5]. Le devblog 3.7 [S3] n'en parle pas.
- **3.6 (juin 2026).** Aucun changement économique de l'élevage relevé par DPLN [S6]. Le client passe l'XP de métier par accouplement de 10 à **30 × génération par parent** (3.6.2.1) [S4] (haute).
- **3.7 (bêta, devblog du 16/09/2026)** [S3], [S4] :
  - carburants **×2** en efficacité, jauges ×2 ;
  - Optimakina à **+20 %** ;
  - génétons par parent ≈ ×2 : 2/4/8/15/30/60/120/250/500 pour les générations 1 à 9 ;
  - ressources vendues par le PNJ de guilde **à 30 au lieu de 15** guildatons ;
  - recettes des makinas revues, certaines ressources de boss coûteuses remplacées ;
  - ressources d'élevage retirées des cadeaux de Nowel ;
  - cosmétiques colorisables chez Eugène Éton.

> **[Héritage pré-3.5]** Les éleveurs faisaient tourner des centaines de couples de dragodindes et les échangeaient contre des parchemins à un PNJ. Exemple : « en une semaine, 300 bébés… 300 puissants parchemins » ; une dernière mise bas avant la 3.5 a rapporté ≈ 50 M ([S9], vidéo kvSwZl4pLJk du 02/03/2026). **Ce système n'existe plus** : les dragodindes d'avant la 3.5 sont séniles et ne s'échangent plus contre des parchemins ([S1], [S6]).

---

## 3. Montures : prix, demande, valorisation

### 3.1 Relevés de prix (après la 3.5)

| Monture | Gén. | Niveau | État | Prix | Date | Source | Confiance |
|---|---:|---:|---|---:|---|---|---|
| Dragodinde (capture) | 1 | 1 | fertile, fraîchement capturée | 10 000 à 15 000 | 13/03/2026 | [S7] | moyenne (marché de lancement) |
| Dragodinde | 1 | ? (bas) | **féconde** | 500 000 à 800 000 « voire plus » | 13/03/2026 | [S7] | basse (début de marché, sans doute retombé) |
| Muldo Doré | 1 ou 2 | 100 | ? | ≈ 50 000 | 08/09/2026 | [S12] | moyenne (« énormément de gén. 1 et 2 en vente ») |
| Muldo Aigue-marine (1 PM, 40 Dommages Air) | 9 | 200 | ? | 15 000 000 | ≈ avril 2026 | [S9] (z8TYzeV8g-o), Salar | basse à moyenne (prix affiché, vente non constatée) |
| Muldo gén. 10 stérile | 10 | ? | stérile | mis en vente sur **Rafal**, prix non donné | avril 2026 | commentaire sous https://www.youtube.com/watch?v=OTsDMWTKt40 | — |

**Lecture.** Les générations 1 et 2 sont saturées. Les montures « méta » de haute génération et de haut niveau se vendent en millions, mais il n'y a qu'**un** relevé. Aucun prix n'a été trouvé pour les capacités Reproducteur ou Sage, ni pour les Volkornes et les Dragodindes de haute génération.

### 3.2 Montures recherchées pour leurs statistiques (méta)

Valeurs au niveau 200 tirées des fichiers d'arbres (`research/data/tree-*.json`, eux-mêmes issus de DofusDB et du client [S21]) ; confiance haute pour les stats.

- **Volkornes** : **1 PA** dès le niveau 100, pour toutes les couleurs. Dès la génération 1, un Volkorne Pourpre, Orchidée, Indigo ou Ébène donne **1 PA + 90 Force, Intelligence, Chance ou Agilité au niveau 200**. Les générations 10 donnent 1 PA + 70 caractéristique + 8 % de résistance, ou 1 PA + 7 % de critique, ou 1 PA + 200 Vitalité, etc. Un PA sur l'emplacement du familier explique que les Volkornes de haut niveau soient recherchées. **ESTIMATION** : demande forte pour les Volkornes niv. 100 et 200, quelle que soit la génération.
- **Muldos** : **1 PM** dès le niveau 100. Les gén. 9 monocolores (Ambre, Corail, Azur, Aigue-marine, ajoutés en 3.5) donnent **1 PM + 40 Dommages élémentaires** au niveau 200. Les gén. 10 bicolores donnent 1 PM + 30 dommages + un bonus (8 % critique, 30 dommages critiques, 60 Puissance, etc.). C'est l'Aigue-marine niv. 200 qui a été relevée à 15 M [S9].
- **Dragodindes** : 400 Vitalité au niveau 200. Les plus fortes sont la gén. 9 **Prune (+2 PO)** et **Émeraude (14 % critique)**, puis les gén. 10 « Prune et X » (+1 PO + caractéristique) et « Émeraude et X » (+10 % critique + caractéristique). Solomonk : « Dragodinde Émeraude niveau 200… 400 vita, 14 % crit… plus compétitif par rapport aux familiers » [S9].
- Avis de Tenmalexis : les montures « seront meilleures qu'un familier selon la situation, mais un familier légendaire restera quand même meilleur » [S17] (basse, opinion d'avant la sortie).

### 3.3 Modèle de valorisation d'une monture (pour le calculateur)

```
valeur_plancher(m) = max(
   extraction  = (G ≥ 2 ? G × prix(ressource_famille) × (1 − taxe_HDV) : 0),
   brisage     = E[runes | famille, niveau] × prix_runes × (1 − taxe_HDV) − (0 si déjà au niveau),
   revente     = prix_HDV(famille, G, niveau, couleur, capacité) × (1 − taxe_HDV)
)
```
Ressources d'extraction : Dragodinde → Neurone de dragodinde (33515), Muldo → Ambre de muldo (17864), Volkorne → Corne de volkorne (19975). Quantité = génération ; gén. 1 = 0 ; monture sénile = 1 ([S1], [S5], client [S4] ; haute).

- **Capacités : aucun relevé de prix.** **ESTIMATION** de leur valeur d'usage :
  - *Reproducteur* : environ un bébé de plus de la génération visée, une seule fois (les parents deviennent stériles et le clonage efface la capacité [S1]) ;
  - *Sage* : divise par deux le temps et le carburant d'XP, soit ≈ 14,5 k par monture menée au niveau 200 en T1 (§6.3) ;
  - *Amoureuse, Endurante, Précoce* : divisent par deux une des trois jauges de fécondité.

  En 3.7, l'Animakina sert à choisir le sexe et les capacités apparaissent sans makina : 3 % Reproductrice, 6 % Sage, 8 % pour chacune des trois autres [S3].

---

## 4. Ressources de monture

### 4.1 Ressources d'extraction (Neurone, Ambre, Corne)

| Ressource (id) | Relevés | Valeur par défaut retenue | Confiance |
|---|---|---:|---|
| Ambre de muldo (17864) | ≈ 14 000 kamas (avril, « sur mon serveur ») [S11] ; ≈ 16 000 kamas (avril, « 60 ambres ≈ 1 M ») [S11] ; ≈ 22 600 kamas en valeur estimée et ≈ 24 700 kamas au prix HDV unitaire (08/09, serveur peu peuplé) [S12] | **18 000** | moyenne (3 relevés, la tendance monte) |
| Neurone de dragodinde (33515) | ≈ 7 000 kamas (≈ avril 2026, Salar) [S9] | **8 000** | basse à moyenne (un relevé) |
| Corne de volkorne (19975) | aucun relevé | **15 000** (**ESTIMATION** : même nombre de recettes que l'Ambre, mais beaucoup de Volkornes partent au brisage plutôt qu'à l'extraction) | basse |

- **Demande** (DofusDB [S21] ; haute) : chaque ressource sert dans ≈ 111 à 112 recettes, toutes hors Éleveur (Tailleur, Cordonnier, Forgeron, Bijoutier, Sculpteur, Façonneur).
  - Neurone : niveaux 100 à 200 (50 recettes entre 100 et 149, 31 entre 150 et 199, 30 au niveau 200), 2 à 20 unités par craft.
  - Ambre : 81 recettes de niveau 200 sur 111, 10 unités le plus souvent.
  - Corne : 73 recettes de niveau 200 sur 112.
  - Objets connus : Amulette et Bottes du Cycloïde, Amulette du Strigide, Amulette et Épée du Granduk, Coiffe et Anneau du Comte Harebourg, Bottes du Nocturlabe, Amulette et Coiffe Séculaires, Amulette et Dagues d'Ilyzaelle, Dofusteuse (Ambre ×10 et Corne ×10), Dorabysses…
  - D'après DPLN [S6], le Neurone a remplacé dans de nombreuses recettes des trames dimensionnelles, fragments d'anomalie, étoffes mystérieuses et pépites.
- **Volume** : ≈ 1 805 Ambres au « cours du marché » sur un serveur peu peuplé, période non précisée (08/09) [S12]. Il vaut mieux vendre « par 10, car les recettes en demandent 10 » [S12].
- **Offre hors élevage** : l'Amateur de Guildaton vend des Neurones à **15 guildatons** pièce, limité à 3 par semaine, ou 6 si la guilde est niveau 13 ([S6] ; haute). Le prix passe à **30** en 3.7 [S3].
- **Recyclage** : Neurone et Ambre = **16 pépites** de base, Corne = 0 ([S21] ; haute). Sans relevé du prix de la Pépite, ce plancher n'est pas chiffré.

### 4.2 Ressources de capture (droppées par les montures sauvages)

- **Moustache de muldo doré (33524)** : ≈ **5 000 à 5 200 kamas**. Relevé : 462 moustaches dorées ≈ 2,4 M, et « 3 dorés… 15 000 kamas par perso » ([S16], début mai 2026 ; moyenne). C'est la moustache la plus chère, parce que **toutes les Optimakinas Muldo** en utilisent : 1 à 10 selon la génération ([S21], `crafts.json` ; haute).
- **Autres moustaches** (pourpre, ébène, orchidée, indigo) : pas de prix unitaire. Valeurs totales pour 1 h de farm : 200 k, 150 k, 211 k et 574 k [S16]. **ESTIMATION ≈ 1 000 kamas pièce** (basse).
- **Ailes de volkorne** : « ailes pourpres sans valeur, orchidées un peu plus, indigo un peu plus encore », et les ventes quotidiennes sont presque nulles ([S20], septembre ; basse à moyenne). L'**Aile de volkorne ébène** entre dans **toutes les Optimakinas Volkorne** [S21] : c'est probablement la plus chère (**ESTIMATION**).
- **Viandes de niveau 60** : 25 462 viandes droppées en capturant 10 000 Volkornes, revendues pour 687 000 kamas au total, soit ≈ 27 kamas pièce [S20] (moyenne).
- **Une heure de farm** au Bassin des Muldos, équipe de 5 niveau 195-200 : **≈ 3,6 à 3,7 M** de ressources (estimation HDV) [S16] (moyenne).
- Une remarque du forum relayée par [S9] : les Optimakinas Muldo ne demandent que des moustaches dorées, ce qui fausse le marché. La 3.7 répartit les ressources de monture sur toutes les couleurs dans les recettes de makinas [S3], `crafts.md` §7 ; haute pour la bêta.

---

## 5. Brisage des montures

### 5.1 Mécanique (communautaire et client)

- **Coefficient de 50 %, sans focus** (pas de recette) ([S9], [S20] ; moyenne à haute).
- **Statistique fractionnaire.** Le client fait progresser PM (effet 128) et PA (effet 111) de **0,01 par niveau jusqu'au niveau 100**, puis de 0 (`evolutive-effects-3.6.12.16.json` ; haute). Un Muldo de niveau 53 « porte » donc 0,53 PM pour le brisage, même si l'infobulle affiche 0 PM. Les joueurs le confirment : des runes PM tombent dès le niveau 35 environ [S11].
- **Formule communautaire** (Solomonk [S9], reprise d'un Discord et d'un Reddit ; moyenne) : `E[runes Ga] ≈ 3 × (0,01 × niveau × poids × 60/200 + 1) / 101`, avec poids 90 pour le PM, 100 pour le PA et 60 le niveau de l'objet-monture. Elle donne ≈ 0,82 Ga PM au niveau 100 (observé : 32 sur 40, soit 0,80) et ≈ 0,46 au niveau 53 (observé : 491 sur 1 020 Muldos de niveau 42 à 116, soit 0,48). Elle surestime le PA : 0,50 prédit contre 0,38 observé sur 3 832 Ga PA pour ≈ 10 000 Volkornes [S20]. Elle sous-estime le niveau 200 : 50 Muldos dorés niv. 200 ont donné 76 Ga PM, soit 1,52 chacun [S9].
  - **Attention (vérification)** : le JSON écrit cette formule avec `min(niveau, 100)`, ce qui donne 0,83 au niveau 200, loin du 1,52 observé ; sans plafond elle donne 1,63. Or le client fixe le PM à 1 de 100 à 200. Le niveau de la monture pèse donc ailleurs que dans la stat (hypothèse : niveau de l'objet = niveau de la monture ; la formule classique `0,5 × (3 × stat × poids × niveau/200 + 1) / poids_rune` donne 0,76 au niveau 100 et 1,51 au niveau 200, mais seulement 0,22 au niveau 53, contre 0,38 à 0,48 observé). Aucune formule ne colle à tous les relevés. **L'application doit utiliser la table des rendements observés (`valuation.brisage.observedYields`), pas la formule** (confiance basse pour la formule).
  - Recoupement indépendant au niveau ≥ 100 : Qays obtient 161 Ga PM pour 200 Muldos gén. 1-2 (0,805 par monture ; la traduction automatique dit « AP runes », mais un Muldo donne du PM) [S12]. C'est cohérent avec le 0,80 de [S9].
- **Runes secondaires.**
  - Muldos : Pui et Ré Per élémentaires. Pour 1 020 Muldos : 4 566 Pui, 905 Ré Per Air, 998 Ré Per Feu, 1 084 Ré Per Eau et 832 Ré Per Terre [S9].
  - Volkornes : runes de caractéristique Fo, Ine, Cha, Age, ≈ 14 à 15 par Volkorne **au total des quatre types**, soit ≈ 36 000 de chaque type et ≈ 145 000 en tout pour 10 000 Volkornes [S20].
- **Niveau optimal** : ≈ 40 à 55. Solomonk calcule le meilleur ROI à ≈ 44-45 pour le Muldo (≈ 255 %) et à ≈ 346 % pour le Volkorne [S9]. Les commentaires sous [S12] disent « l'optimum est environ au niveau 53 » et « niveau 53 ≈ 50 % de chance » [S11]. Le meilleur rendement en kamas/heure s'obtient à niveau très bas, avec un bénéfice relatif faible [S9].

### 5.2 Relevés de prix des runes

| Rune (id) | Relevés | Défaut | Confiance |
|---|---|---:|---|
| Rune Ga Pme (1558) | 13 400 à 14 000 kamas (24/03) ; ≈ 20 000 kamas (≈ mai) ; ≈ 15 800 kamas déduit du bilan de 1 020 Muldos (mai) [S9] | **18 000** | moyenne |
| Rune Ga Pa (1557) | ≈ 22 800 kamas (≈ mai) [S9] ; ≈ 33 000 kamas (septembre) ; ≈ 30 200 kamas déduit du bilan de 10 000 Volkornes [S20] | **30 000** | moyenne |
| Runes Pui (7436) et Ré Per (7457, 7458, 7459, 7560) | pas de prix unitaire. Moyenne déduite ≈ 500 kamas par rune pour l'ensemble des runes secondaires du lot de 1 020 Muldos [S9] | **500** | basse |
| Runes Fo, Ine, Cha, Age (1519, 1522, 1525, 1524) | ≈ 6 M pour ≈ 143 000 runes, soit ≈ 42 kamas par rune [S20] | **40** | basse |

Volumes : 38 000 Ga PM vendues en 7 jours (24/03) [S9] ; 21 509 en 7 jours et ≈ 90 000 en 30 jours (≈ mai) [S9] ; ≈ 2 000 Ga PA par jour (septembre) [S20]. Tous ces relevés viennent de Salar.

### 5.3 Valeur de brisage par monture (relevés)

| Lot | Niveau | Valeur des runes par monture | Coût par monture (capture + XP) | Source |
|---|---:|---:|---:|---|
| 40 Muldos | 100 | ≈ 16 k (652 k / 40, valeur estimée) | ≈ 7,2 k (filet universel 2 k + carburant T1) | [S9] 24/03 |
| 1 020 Muldos | 42 à 116 (moitié au niv. 53) | ≈ 12,5 k (≈ 12,7 M ; « 12 M » annoncé à l'oral) | ≈ 2,9 k (2 949 036 = 2 364 036 d'XP + 585 000 de filets) : **ROI 332 % = valeur ≈ ×4,3** | [S9] ≈ mai |
| 200 Muldos gén. 1-2 | ≥ 100 | ≈ 30 à 32 k (6,0 à 6,5 M ; 161 Ga PM, soit 0,805 par monture) | non donné (carburant « exorbitant ») | [S12] 08/09 |
| 50 Volkornes | 72 / 85 / 105 | ≈ 18 k / 22 k / 30 k | — | [S11] Tal Kasha, avril |
| ≈ 10 000 Volkornes | ≈ 53 | ≈ 12,2 k (121,7 M) | ≈ 1,8 k (17,9 M) : **ROI ≈ x7** | [S20] septembre |

Pour le Muldo, l'**extraction** d'une génération 2 rapporte davantage que le brisage. Exemple : 200 Muldos gén. 2 donnent 400 Ambres, soit ≈ 8,7 M en valeur estimée et ≈ 9,9 M au prix unitaire de l'HDV, contre 6,0 à 6,5 M au brisage. L'extraction ne demande aucune XP et se fait jusqu'à deux fois par jour ([S12], [S11] ; moyenne). Le brisage reste la seule valorisation possible pour une génération 1.

---

## 6. Carburants d'enclos

### 6.1 Relevés

| Carburant (id) | Durabilité | Prix | Coût par point de jauge (kamas/pt) | Source |
|---|---:|---:|---:|---|
| Extrait de Mangeoire (33331), T1 | 3 000 | **≈ 900 à 1 000 kamas** (craft : Truite + Œil de Pikdoa) | **≈ 0,30 à 0,33** | [S9] 24/03, mai, septembre, Salar (moyenne à haute : prix stable sur 6 mois) |
| Grand Extrait (T1, générique) | 4 000 | ≈ 550 kamas (ingrédients à 250 + 300, avant la sortie) | ≈ 0,14 | [S17] 01/03/2026 (basse : prix d'avant la flambée) |
| Gigantesque Philtre de Mangeoire (33404), T2 | 5 000 | ≈ **16 000 kamas** | ≈ 3,2 (≈ 1 selon un commentaire de mai : « le tier philtre ≈ 3× le point d'XP du tier 1 ») | [S16] 01/05/2026, pendant un bonus de 50 % d'XP de métier (basse : un seul relevé, sources en désaccord) ; [S11] |
| Grande Potion de Mangeoire (33446), T3 | 4 000 | « 6 fois plus cher que l'Extrait de Mangeoire en kamas par point » | ≈ 2 | [S9] 24/03 (basse à moyenne) |
| Potion de Mangeoire, T3 (recoupement) | 3 000 | Morpion de Truchideur seul ≈ 6 800 kamas (cours à 7 jours) | ≥ 2,3 | [S9] MSFc68m3JYg, ≈ mi-mars (basse) |
| Gigantesque Élixir de Dragofesse ou de Baffeur (33500, 33498), T4 | 5 000 | affiché 1 000 000 kamas, **invendu** | — | [S7] 13/03 (basse) |
| Gigantesque Élixir (T4, coût d'un craft) | 5 000 | **ESTIMATION ≈ 150 000 à 250 000 kamas** : 4 ressources de monstres de niveau 200 à 2 % de drop + 1 ressource de niveau 180 (Viande Gâtée ou Bois d'Orme), dont une à 40-50 k (Huile de Pikoleur pour le Dragofesse, Broderie d'Eskoglyphe pour le Baffeur) | ≈ 30 à 50 | [S7], [S9], recettes et taux de drop DofusDB [S21] (basse) |

D'autres ingrédients ont été relevés (Patte d'Arakne Magique, Pierre de Granit, Scalp de Bwork Archer, Herbe Folle ≈ 13 k, Boomerang du Maître Koalak ≈ 30 k…). Ils figurent dans le JSON, section `items`.

**Règle pour le calculateur** : calculer le prix d'un carburant comme `min(prix HDV du carburant, Σ prix HDV des ingrédients)`, puis le coût par point comme `prix / durabilité`. Voir `crafts.md` §2.2 : la quantité d'ingrédients ne change pas avec la taille, d'où l'intérêt des Gigantesques si leurs ingrédients ne sont pas beaucoup plus chers.

### 6.2 Poussière d'élevage (héritage, non échangeable)

- La poussière vient uniquement de la conversion des anciens objets d'élevage (0,55 par point de durabilité restante) ([S1], [S6] ; haute). DofusDB indique `exchangeable: false` [S21]. **Aucune source de poussière après la 3.5 n'a été trouvée.**
- Boutique d'Adèle Vage : Gigantesque Extrait 50, Philtre 200, Potion 800, Élixir 3 200, pour chacune des 6 jauges ([S1] ; haute). Cela donne 100, 25, 6,25 et 1,56 points de jauge par poussière.
- **ESTIMATION de la valeur d'une poussière** (coût évité) : ≈ 80 kamas avec le Gigantesque Philtre de Mangeoire (16 000 / 200) ; ≈ 50 à 80 kamas avec un Élixir à 150-250 k. Elle n'a d'intérêt que pour qui possède un stock d'avant la 3.5. Solomonk disposait de ≈ 680 000 à 820 000 poussières, de quoi acheter ≈ 212 à 256 Gigantesques Élixirs [S9].

### 6.3 Coût de l'XP de monture (calcul, haute pour l'arithmétique)

Hypothèses : Extrait de Mangeoire à 1 000 kamas pour 3 000 points, soit 0,333 kamas/pt ; 10 montures dans l'enclos, la jauge se vidant au même rythme qu'il y ait 1 ou 10 montures [S1] ; table d'XP de monture DPLN (`dpln-xp-tables.json`). En T1, une monture gagne 10 XP par tick de 10 s.

| Niveau visé | XP cumulée | Coût par enclos de 10 (kamas) | Coût par monture | Durée en T1 |
|---:|---:|---:|---:|---:|
| 45 | 26 887 | 8 962 | ≈ 0,9 k | 7,5 h |
| 53 | 39 360 | 13 120 | ≈ 1,3 k | 10,9 h |
| 100 | 172 668 | 57 556 | ≈ 5,8 k | 48 h |
| 200 | 867 582 | 289 194 | ≈ 28,9 k | 241 h |

Solomonk arrive au même chiffre : 57 556 kamas pour un Muldo niveau 100 seul, 5 756 kamas par monture à 10 par enclos [S9]. Le guide DPLN donne 12 h (100) et 60 h 24 (200) **en T4 permanent** [S1]. Le T4 va 4 fois plus vite mais coûte ≈ 100 fois plus cher au point (voir §6.1).

**Rendre 10 montures fécondes** consomme ≈ 60 000 points de jauge : 20 000 d'endurance, 20 000 de maturité et 20 000 d'amour, plus l'ajustement de la sérénité. Le coût dépend du prix par point de chaque jauge. Exemples :
- à 0,33 kamas/pt, ≈ 20 k par lot, soit 2 k par monture ;
- à 3 kamas/pt, ≈ 180 k par lot.

**Attention (vérification)** : 0,33 kamas/pt est le prix de l'Extrait **de Mangeoire**, qui ne remplit que la jauge d'XP. Les jauges de fécondité ont leurs propres carburants, avec d'autres ingrédients (Extrait de Dragofesse = Viande Faisandée + Rondelles de Milirat Strubien ; Extrait de Foudroyeur = Cuivre + Scalp de Milimulou ; Extrait d'Abreuvoir = Sauge + Plume de Tofu Maléfique ; DofusDB [S21]). Aucun prix n'a été relevé pour eux. Le seul indice pointe plus haut : le Minuscule Extrait de Dragofesse demande une Herbe Folle à ≈ 13 k, soit ≈ 13 kamas/pt [S7]. L'exemple ci-dessus est donc une borne basse théorique.

Témoignage de forum lu dans [S9] (avril) : « 4 millions de consommables pour seulement 12 DD de génération 2 », soit ≈ 333 k par bébé, avec des carburants achetés au plus fort de la spéculation.

**3.7** : avec une durabilité doublée, le coût par point est **divisé par deux à prix constant** [S3], [S4]. Le client bêta double aussi les paliers de jauge (80 000 / 140 000 / 180 000 / 200 000) en gardant la même consommation (10 / 20 / 30 / 40 par tick). Le palier 1 dure donc ≈ 22 h 12 au lieu de 11 h 06, et la vitesse d'XP par palier ne change pas (`paddock-gauges-3.7.3.3-beta.json` ; haute pour la bêta).

---

## 7. Makinas et filets

- **Makinas : aucun relevé de prix HDV.** **ESTIMATION** : coût de craft = 1 ressource de boss + 10 Pépites + des ressources de monture (1 à 10 selon la génération) ([S21], `crafts.json`).
  - Optimakina Muldo gén. G : **G − 1** Moustaches de muldo doré de la gén. 2 à la gén. 9 (1 à 8), puis **10** pour la gén. 10, à ≈ 5 k pièce, plus 1 à 3 Baves de muldo (DofusDB [S21], corrigé par la vérification). L'Optimakina Volkorne suit le même barème avec l'Aile de volkorne ébène (1 à 8, puis 10) et 1 à 3 Griffes de volkorne. Les ressources de monture seules coûtent donc ≈ 5 k (gén. 2) à ≈ 50 k (gén. 10), à quoi s'ajoutent la ressource de boss et les pépites.
  - En 3.7, les recettes changent (74 makinas sur 81) et l'Optimakina passe à +20 % ([S3], `crafts.md` §7).
- **Valeur d'une Optimakina pour l'optimiseur** : `Δp × (valeur bébé cible − valeur bébé hors cible)`, avec Δp = +10 points en 3.5-3.6 et +20 en 3.7. Elle ne vaut le coup que si cet écart dépasse son coût. C'est le cas pour les générations élevées : génétons, plus valeur de revente d'une gén. 9-10.
- **Filets** :
  - Filet de capture universel (32521 ; 10 Bois de Frêne + 10 Fer) : ≈ 1 210 à 2 000 kamas ([S9] mars à mai ; moyenne). Le défaut retenu est 1 300.
  - Filet multiplicateur de Volkorne (32526) : ≈ 1 000 kamas si l'on droppe soi-même les ressources de Volkorne (on n'achète que la viande et le bois), ≈ 4 000 kamas au prix de l'HDV ([S9] 10/05, [S20]).
  - Filet à Volkorne renforcé (32523) : ≈ 2 100 kamas hors ressources droppées, ≈ 6 Volkornes par combat [S20].
  - Coût de capture par monture : ≈ 350 kamas (renforcé, ≈ 6 par combat) à ≈ 500 kamas (multiplicateur, 2 par lancer) [S20].

---

## 8. Génétons et boutique d'Eugène Éton

### 8.1 Barème (génétons par parent, additionnés pour les deux parents)

Le bébé doit être d'une génération strictement supérieure à **toutes** les montures de l'arbre des parents ([S1], [S5] ; haute).

| Génération du parent | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 3.5 → 3.6.12.16 (live) | 1 | 2 | 4 | 8 | 15 | 30 | 60 | 120 | 250 |
| 3.7.3.3 bêta | 2 | 4 | 8 | 15 | 30 | 60 | 120 | 250 | 500 |

Sources : client [S4] (haute), DPLN [S1] et devblog [S3] (haute).

### 8.2 Boutique (26 objets) et valeur en kamas

Liste et coûts relevés sur la capture DPLN de février 2026 [S2]. Le coût du Puissant Parchemin (160) est confirmé en jeu en avril [S9].

| Objet (ids DofusDB) | Coût (génétons) | Valeur par défaut | Kamas par généton | Confiance du prix |
|---|---:|---:|---:|---|
| Puissant Parchemin, ×6 caractéristiques : Agi 801, Force 797, Sagesse 805, Vitalité 810, Chance 814, Intel 817 | 160 | **60 000** | **375** | moyenne ([S10], [S20], Salar ; < 20 k avant la 3.5, 116 k au pic du 12/04) |
| Grand Parchemin ×6 (800, 796, 804, 808, 812, 816) | 100 | 30 000 | 300 | basse à moyenne ([S10], mai) |
| Parchemin ×6 (799, 795, 803, 807, 811, 815) | 50 | 8 000 (**ESTIMATION**) | 160 | basse |
| Petit Parchemin ×6 (798, 683, 802, 806, 809, 686) | 10 | 3 000 (**ESTIMATION**) | 300 | basse |
| Tourmaline (15271) | 130 | 40 000 (**ESTIMATION**, utilisée dans 127 recettes [S21]) | 308 | basse |
| Aliton (17019) | 10 | non échangeable (monnaie de milice) : 0 en kamas | — | haute (DofusDB `exchangeable: false`) |
| Cosmétiques colorisables Dragodinde, Muldo, Volkorne (3.7) | ? | ? | — | [S3] |

- **Défaut `kamasPerGeneton` = 375**, sur la base du Puissant Parchemin, qui est la meilleure conversion avec les prix retenus. Fourchette : **125** (20 k) à **725** (116 k). Les prix diffèrent selon la caractéristique. Force et Intelligence ont monté les premières, la Sagesse est d'abord restée stable [S9]. L'application devrait permettre un prix par caractéristique.
- **Pour l'usage du parchemin** : monter une caractéristique à 100 demande 25 Petits, 25 normaux, 30 Grands et 10 Puissants (article « Dofus 3.0 » d'un site marchand, https://www.lootbar.com/blog/fr/4-astuces-pour-se-parchoter.html ; basse).
- **Autres sources de parchemins (concurrence)** : avis de recherche avec avitons. Puissant 340 avitons, Grand 140, normal 60, Petit 20. Ces avis se font maintenant par chasse au trésor ([S10] ; moyenne). Il existe aussi les doplons, le Kolizéum et l'Almanax [S5].

### 8.3 Production réelle de génétons (relevés)

- ≈ **811 génétons en un mois** pour Solomonk, arrivé aux générations 6-7 de Muldo, soit ≈ 5 Puissants Parchemins et ≈ 300 k au prix de 60 k ([S9], z8TYzeV8g-o, avril ; moyenne). Ailleurs, il parle d'≈ 1 000 génétons par mois, soit 6 à 7 Puissants [S9].
- Projection de Scripts05 : ≈ **34 000 génétons en ≈ 23 jours** de la gén. 1 à la gén. 10 en Dragodinde avec 6 enclos, soit ≈ 212 Puissants [S18]. **C'est un plan, pas un bilan** (basse).
- Exemple de gain par accouplement (barème live) : Émeraude (gén. 9) × Pourpre (gén. 5) donne un bébé gén. 10, soit 250 + 15 = **265 génétons** ≈ 99 k. En 3.7 : 500 + 30 = 530 ≈ 199 k à prix constant.

---

## 9. Rentabilité : analyses communautaires et synthèse

### 9.1 Analyses relevées

| Méthode | Résultat | Coûts et limites | Source |
|---|---|---|---|
| Capturer des Dragodindes gén. 1 pour les revendre | 10 à 15 k pièce, « 1,5 à 2 M de bénéfice en 1 h » | marché de lancement (mars), saturé depuis (voir [S12]) | [S7] (basse) |
| Rendre féconde une gén. 1 et la vendre | 500 à 800 k pièce | 1 à 2 jours d'enclos, marché naissant | [S7] (basse) |
| Farmer les ingrédients de carburant | ≥ 1 M/h « peu importe la potion » ; Herbe Folle ≈ 40 k par donjon ; ressources ×10 | baisse attendue quand les éleveurs auront fini de monter le métier | [S7], [S8], [S9] (moyenne, mars) |
| Farmer les Muldos (moustaches) | ≈ 3,6 M/h, équipe de 5 niv. 195-200 | — | [S16] (moyenne, mai) |
| Brisage Muldo niv. 100 en T1 | ≈ +3,5 k par Muldo, ≈ 40-50 % de bénéfice ; ≈ 679 k tous les 2 jours avec 110 places | « 3,5 k par capture, c'est faible pour le temps passé » (critique) | [S9] 24/03 ; [S11] (moyenne) |
| Brisage Muldo niv. 42-116 (1 020 Muldos) | coût 2,95 M, valeur ≈ 12,7 M (« 12 M » à l'oral), **ROI ≈ 332 %** (bénéfice/coût ; Ga PM seules : 163 %) | runes secondaires = ≈ 35 à 39 % de la valeur | [S9] ≈ mai (moyenne) |
| Brisage Volkorne niv. 53 (≈ 10 000) | coût 17,9 M, valeur 121,7 M (x7) ; ≈ 27-28 h de capture ; ≈ 3 mois avec 4 personnages | il faut écouler ≈ 3 800 Ga PA (≈ 2 000 vendues par jour sur le serveur) | [S20] (moyenne) |
| Extraction gén. 2 (Muldo) | 2 Ambres, soit ≈ 28 k (avril) à ≈ 50 k (septembre) par monture ; pas d'XP à monter ; faisable 2 fois par jour | il faut faire des accouplements (des carburants pour les rendre fécondes) | [S11], [S12] (moyenne) |
| Élevage « complet » en semaine type (17-23/03) | marge de **520 k à 1,24 M** sur la semaine | dépend du taux de fertilité et du tri | [S19] (basse : sans détail) |
| Avancer dans les générations pour les génétons | ≈ 5 à 7 Puissants par mois ≈ 0,3 à 0,4 M par mois | « coûts qui explosent », « l'entretien d'un enclos coûte souvent plus cher que la valeur de la monture produite » (forum, avril) | [S9] (moyenne) |
| Vendre une monture méta niv. 200 | ≈ 15 M (Muldo Aigue-marine) | 241 h d'enclos en T1, demande restreinte | [S9] (basse) |

### 9.2 Synthèse pour l'optimiseur (ESTIMATION, raisonnée à partir de §3 à §9.1)

1. **Ne jamais laisser une monture stérile sans valorisation** : prendre le maximum entre extraction, brisage et revente (§3.3). Les générations 1 se brisent vers le niveau 45-55. Les générations ≥ 2 sans débouché de revente s'extraient.
2. **Remplir les enclos au maximum (10 montures)** : la consommation de la jauge ne dépend pas du nombre de montures ([S1] ; haute). Le coût par point et par monture est divisé par 10.
3. **Utiliser T1 et T2 par défaut.** Passer en T3 ou T4 seulement si la vitesse rapporte plus que le surcoût, ce qui suppose un prix de revente qui dépend du délai. Exemple : Gigantesque Philtre ≈ 3,2 kamas/pt contre Extrait de Mangeoire ≈ 0,33 kamas/pt.
4. **XP des parents** : chaque niveau ajoute 0,15 % de chance de génération cible par parent [S1]. Le niveau 100 (+30 points pour deux parents) coûte ≈ 5,8 k de carburant T1 par monture et 48 h d'enclos. Le niveau 200 coûte 241 h. L'Optimakina donne +10 points, +20 en 3.7. **Calcul pour l'outil** : coût marginal du point de probabilité `= coût(XP ou makina) / Δp`, à comparer à la valeur d'un bébé de la génération cible (génétons × kamasPerGeneton + valeur de revente ou d'extraction).
5. **Génétons** : traiter `kamasPerGeneton` comme un paramètre. 375 par défaut, fourchette 125 à 725. En 3.7, le barème double et l'offre de parchemins risque de faire baisser le prix (**ESTIMATION**).
6. **Saturation des marchés** : imposer des volumes maximaux de vente. Relevés : ≈ 2 000 Ga PA par jour, ≈ 3 000 Ga PM par jour (Salar) ; ≈ 1 800 Ambres sur la période affichée (serveur peu peuplé). Les montures gén. 1-2 se vendent mal [S12].

---

## 10. Métier Éleveur : coût de montée

- **Barème d'XP** : 398 000 XP pour le niveau 200, 15 600 pour le niveau 40, 63 200 pour le 80, 142 800 pour le 120 et 254 400 pour le 160 (DPLN `dpln-xp-tables.json` ; moyenne à haute). Les enclos s'ouvrent aux niveaux 1, 40, 80, 120, 160 et 200 [S1].
- **Coûts observés**, très variables selon la date (spéculation de mars) :
  - 1 → 195 : ≈ **30 M** (début mars 2026) [S18] (basse à moyenne) ;
  - « monté 200 pour 7 M en achetant les ressources pendant la bêta », contre « 70 M » pour un autre joueur après la sortie (message de forum lu dans [S9], avril ; basse) ;
  - « plus de 10 M de crafts pour passer du niveau 40 au niveau 80, contre 1 à 2 M pour la plupart des métiers » (forum, [S9] ; basse) ;
  - 14 → 125 avec des ressources droppées par son équipe, valeur HDV ≈ **13 M**. Les carburants produits valaient ≈ **15 à 16 M** (01/05/2026) [S16] (moyenne) ;
  - « pack » de 1 à 200 : plus de **23 000 ressources** (DofusDB bêta, outil d'XP de métier) [S17]. Le calcul de `crafts.md` §6 donne ≈ 21 500 ressources et ≈ 6 200 crafts du niveau 15 au niveau 200.
- **Autres sources d'XP** ([S1], [S4] ; haute) :
  - capture : 30 XP par monture ;
  - accouplement : 30 × génération par parent depuis la 3.6 (10 × génération dans le client 3.5.x). Le guide DPLN, rédigé sur la bêta et daté du 27/02/2026, donne déjà 30 × génération [S1]. Les sources se contredisent donc pour la période 3.5 ; c'est le client qui est retenu.
  - Un commentaire de [S11] signale aussi la quête quotidienne « Aller Hue » (alignement neutre), qui rapporterait 1 à 2 niveaux d'Éleveur par jour. Les « parchemins d'XP éleveur » « valent assez cher » (basse, non vérifié).
- **Jours à viser (Almanax)** ([S1], [S6] ; haute) :
  - **Loumi (10 mai)** : 15 % d'ingrédients en moins pour les crafts d'Éleveur. Solomonk en a profité pour crafter ≈ 13 946 Extraits de Mangeoire [S9].
  - **Rigamix (10 août)** : 25 % de chance d'obtenir un second objet par craft.
  - Un bonus de 50 % d'XP de métier était actif début mai 2026 [S16] (basse : date et portée non vérifiées).
- **Recettes recommandées pour l'XP** : voir `crafts.md` §6. En résumé : filets universels du niveau 1 au niveau 14, puis la taille de carburant qui vient de se débloquer (une nouvelle tous les 10 niveaux), dans la jauge dont les ingrédients sont les moins chers. Variante éco de Tenmalexis : crafter en masse un seul carburant, le moins cher (par exemple 768 Minuscules Extraits pour atteindre le niveau 15) [S17].

---

## 11. Frais et volumes d'HDV

- **Taxe de mise en vente : 2 %**, et **1 % de plus** à chaque modification de prix d'un objet déjà affiché ([S17], juillet 2026 ; moyenne). L'exemple de [S15] (280 kamas de frais pour 14 000 kamas de ventes) correspond aussi à 2 %.
- **« Cours du marché »** : l'interface de l'HDV affiche le volume vendu sur 7 et 30 jours ([S17], [S9] ; haute). L'application peut demander ces volumes à l'utilisateur pour plafonner les ventes.
- **Lots** : vendre l'Ambre par 10, puisque les recettes en demandent 10 [S12].

---

## 12. Questions ouvertes

1. **Prix des montures par génération, couleur et niveau** : il n'existe presque aucun relevé public (§3.1). Le tableau des montures du JSON est surtout un **plancher estimé**. Il faut des relevés en jeu (HDV des créatures).
2. **Corne de volkorne, makinas, Pépite, Tourmaline, Petits et Parchemins normaux, Gigantesques Extraits, Potions et Élixirs** : aucun prix fiable trouvé. Les valeurs sont des estimations de confiance basse.
3. **Capacités (Reproducteur, Sage…)** : aucun prix de prime relevé.
4. **Brisage des montures** : Ankama le jugeait impossible en 2025 [S5]. Rien n'indique s'il sera corrigé en 3.7 ou plus tard.
5. **Effet de la 3.7 sur les prix** (carburants ×2, génétons ×2, Optimakina +20 %) : uniquement des estimations tant que la 3.7 n'est pas sortie (bêta au 2026-10-01).
6. **Écarts entre serveurs** : la plupart des relevés viennent de Salar (pionnier, [S9]) ou de serveurs non nommés. Les serveurs historiques (Orukam, Hell Mina, Tal Kasha…) peuvent avoir des prix très différents.
7. **Forums dofus.com, JOL, Reddit, Discord** : contenu inaccessible ou introuvable automatiquement (§1). À compléter à la main si possible.
8. **Barème exact de la boutique d'Eugène Éton en 3.6 et 3.7** : la liste vient d'une capture de la bêta 3.5 (février 2026). Seul le coût du Puissant (160) est confirmé après la sortie [S9]. Les boutiques de PNJ ne sont pas dans les données client ni dans DofusDB : vérification en jeu nécessaire.

---

## Vérification

> Vérification adversariale du 2026-10-02. Elle porte sur `research/economy.md` et `research/data/prices-default.json`. La méthode : re-télécharger les sources (transcriptions TubeLab, commentaires YouTube, API DofusDB), les confronter à d'autres sources (données client, guide DPLN, autres guides communautaires) et refaire chaque calcul. Le JSON est valide après correction (`python3 -c "import json; json.load(open(...))"`, 94 montures, 59 objets, 27 entrées de boutique).

### Points vérifiés et confirmés (43)

| # | Affirmation | Vérification | Résultat |
|---|---|---|---|
| 1 | 83 identifiants d'objets du JSON (ressources, runes, carburants, filets, parchemins, Tourmaline, Aliton, Généton, Poussière) et leurs noms français | API DofusDB `/items`, requête du 2026-10-02 | tous corrects |
| 2 | Objet-monture de niveau 60, typeId 332 (Muldo Orchidée 33096) | DofusDB | confirmé |
| 3 | Recyclage : Neurone et Ambre 16 pépites, Corne 0 | DofusDB `recyclingNuggets` | confirmé |
| 4 | Poussière d'élevage et Aliton non échangeables | DofusDB `exchangeable: false` | confirmé |
| 5 | Neurone : 111 recettes (50 entre 100 et 149, 31 entre 150 et 199, 30 au niveau 200) ; Ambre : 111 recettes, dont 81 au niveau 200 et 69 à ×10 ; Corne : 112 recettes, dont 73 au niveau 200 ; Tourmaline : 127 recettes | DofusDB `/recipes?ingredientIds` | confirmé. Nuance : 2 à 3 recettes « Base » (jobId 1), pas seulement des métiers d'artisan |
| 6 | PM (effet 128) et PA (effet 111) : +0,01 par niveau jusqu'au niveau 100, puis 0 | `evolutive-effects-3.6.12.16.json`, 120 objets chacun | confirmé |
| 7 | Stats des montures « méta » au niveau 200 : Muldo Aigue-marine 1 PM + 40 Dommages Air ; Volkorne Pourpre 1 PA + 90 Force ; Dragodinde Prune 400 Vitalité + 2 PO ; Dragodinde Émeraude 400 Vitalité + 14 % de critique ; Muldo gén. 10 : 1 PM + 30 dommages + un bonus | client 3.6.12.16 (EvolutiveEffects) | confirmé. Aigue-marine = génération 9 (client, `tree-muldo.json`) |
| 8 | Génétons par parent 1/2/4/8/15/30/60/120/250 (live) et 2/4/8/15/30/60/120/250/500 (3.7.3.3 bêta) | `breeding-constants-by-client-version.json` et guide DPLN | confirmé |
| 9 | XP d'Éleveur par accouplement : 10 × génération en 3.5.x, 30 × génération depuis 3.6.2.1 | client | confirmé, mais **désaccord** avec le guide DPLN (30 dès la bêta) : ajouté en §10 |
| 10 | Extraction : une ressource par génération, aucune en gén. 1, une seule pour une monture sénile | client (`extractionRewardQuantity` = génération) et guide DPLN | confirmé |
| 11 | Jauges : paliers 40 000 / 70 000 / 90 000 / 100 000 avec une consommation de 10 / 20 / 30 / 40 toutes les 10 s ; même vitesse pour 1 ou 10 montures | client `paddock-gauges`, guide DPLN, devblog II | confirmé |
| 12 | XP de monture : 26 887 (niv. 45), 39 360 (53), 172 668 (100), 867 582 (200) | `dpln-xp-tables.json`, texte du guide | confirmé. Recoupé par Solomonk : « niveau 53 en 11 h » en T1 |
| 13 | Tableau du coût d'XP en T1 (§6.3) : coûts par enclos et durées | recalcul (XP ÷ 3, XP ÷ 3 600 s) | arithmétique exacte |
| 14 | XP de métier : 15 600 / 63 200 / 142 800 / 254 400 / 398 000 | `dpln-xp-tables.json` | confirmé |
| 15 | Durabilités : Minuscule 1 000, Petit 2 000, normal 3 000, Grand 4 000, Gigantesque 5 000 | guide DPLN | confirmé |
| 16 | Boutique d'Adèle Vage : 50 / 200 / 800 / 3 200 poussières | guide DPLN ; [S9] EfTZZYsSVeY | confirmé |
| 17 | Boutique d'Eugène Éton : 26 objets ; Petit 10, normal 50, Grand 100, Puissant 160, Tourmaline 130, Aliton 10 | capture `eugene-eton-genetons.jpg` relue | confirmé |
| 18 | Recettes : Extrait de Mangeoire = Truite + Œil de Pikdoa ; Filet universel = 10 Bois de Frêne + 10 Fer ; Gigantesque Extrait de Mangeoire = Poisson-Chaton + Scalp de Bwork Archer ; ingrédients des Gigantesques Élixirs de Dragofesse et de Baffeur | `recipes-eleveur.slim.json` (DofusDB) | confirmé |
| 19 | Huile de Pikoleur, Broderie d'Eskoglyphe et les autres ressources de boss des élixirs : 2 % de drop | DofusDB `/monsters` (drops) ; « 2 % de chance de base » dans [S9] a_Meh5-rqWk | confirmé, sans être tiré de [S7] (source corrigée) |
| 20 | Devblog II : « le brisage des montures pour obtenir des runes de forgemagie ne sera pas possible » | `devblog-elevage-partie-II-2025-04-28.txt`, ligne 324 | citation exacte |
| 21 | Devblog 3.7 : carburants ×2, jauges ×2, Optimakina à +20 %, ressources du PNJ de guilde de 15 à 30, capacités 3/6/8/8/8 %, cosmétiques chez Eugène Éton, ressources retirées des cadeaux de Nowel | texte du devblog | confirmé |
| 22 | Neurone chez l'Amateur de Guildaton : 15 guildatons, 3 par semaine (6 si la guilde est niveau 13) ; le Neurone remplace des trames, des fragments, des étoffes et des pépites | `dpln-maj35.txt`, lignes 276 et 613 | confirmé |
| 23 | Coefficient de 50 % au brisage, sans focus | [S9] 41ka94FXdM0 (transcription relue) | confirmé |
| 24 | 40 Muldos niv. 100 : 32 Ga PM (80 %) et 652 000 kamas ; Ga PM à 13 400-14 000 le 24/03 ; 38 000 Ga PM vendues en 7 jours | [S9] 41ka94FXdM0 | confirmé |
| 25 | Extrait de Mangeoire à ≈ 900-1 000 kamas | [S9] 41ka94FXdM0 et KFzrg1-MRGQ ; [S20] | confirmé |
| 26 | 1 020 Muldos : 491 Ga PM, 4 566 Pui, Ré Per 905 / 998 / 1 084 / 832 ; coût 2 949 036 | [S9] KFzrg1-MRGQ | confirmé. **Valeur corrigée** (voir plus bas) |
| 27 | 10 000 Volkornes : coût ≈ 17,87 M (1 787 par Volkorne) ; valeur 121 684 259 ; 3 832 Ga PA ; Ga PA ≈ 33 000 ; ≈ 2 000 vendues par jour ; 25 462 viandes pour 687 000 ; ≈ 6 M de runes de caractéristique ; « presque x7 » | [S20] fGqEPyQoBgk | confirmé (ratio exact 6,8) |
| 28 | Puissant Parchemin : 32-39 k le 09/04, 116 k le 12/04, ≈ 60 k ensuite ; moins de 20 k avant la mise à jour ; Grand ≈ 30 k ; avitons 340/140/60/20 | [S10] r0c4r9Ndz8M (transcription relue) | confirmé. [S20] donne un pic de « 80 000, 90 000 » de mémoire : désaccord noté dans le JSON |
| 29 | 811 génétons en un mois ; Puissant à 160 génétons ; génétons « liés au compte » | [S9] z8TYzeV8g-o | confirmé |
| 30 | Muldo Aigue-marine 1 PM + 40 dommages à 15 M | [S9] z8TYzeV8g-o | confirmé (prix affiché, vente non constatée) |
| 31 | Ambre : ≈ 22 600 (valeur estimée, 2,8 M pour 124 Ambres) et ≈ 24 700 (9 896 000 / 400 au prix HDV) ; 1 805 Ambres au cours du marché ; Muldo Doré niv. 100 à 50 000 ; 200 Muldos brisés pour 6,0 à 6,5 M | [S12] hLrYDDDRe8s (transcription relue) | confirmé ; ajout de 161 Ga PM et de 1 649 Ga PM au cours du marché |
| 32 | Ambre ≈ 14 000 (« sur mon serveur ») ; « 60 ambres ≈ 1 M » ; Volkornes niv. 72 / 85 / 105 à 900 k / 1,1 M / 1,5 M pour 50 (Tal Kasha) ; runes dès le niveau 35 ; niveau 53 ≈ 50 % ; quête « Aller Hue » | commentaires de 41ka94FXdM0 (TubeLab) | confirmé |
| 33 | Taxe d'HDV de 2 % à la mise en vente, +1 % à chaque remise en vente | [S17] ry1jsE9fvRU (transcription relue) | confirmé |
| 34 | Dragodinde capturée 10-15 k ; féconde 500-800 k « voire plus » ; Herbe Folle ≈ 40 k pour 3 par donjon ; Gigantesques Élixirs affichés à 1 M sans preneur ; Huile et Broderie à 40-50 k | [S7] IlEEr8Nxv_Q (transcription relue) | confirmé. Melcgame dit « fertile ou féconde » |
| 35 | Patte d'Arakne Magique 2 400 (04/03) → 4 400 → ≈ 3 000 ; Pierre de Granit 2 000 → 3 000 → 1 600-2 000 ; Scalp de Bwork Archer 4 400, 4 317 ventes le 09/03 (≈ 19 M) ; Œuf de Dragoeuf Charbon ≈ 3 200 en prix moyen | [S8] be6wubCnC24 | confirmé |
| 36 | Souris verte 155 → 1 300 ; larve champêtre 590 → 4 400-4 500 | [S9] er35rckGDFM | confirmé (l'objet « Peau de Larve Champêtre » est le seul de ce nom dans les recettes d'Éleveur) |
| 37 | Gigantesque Philtre de Mangeoire 16 000 ; ressources ≈ 13 M (niveaux 14 → 125) ; carburants produits ≈ 15-16 M ; bonus de 50 % d'XP de métier le 01/05 | [S16] hhAN0h_68X8 | confirmé |
| 38 | 462 moustaches dorées ≈ 2,4 M ; « 5 000 × 3 = 15 000 » ; ≈ 3,6 à 3,7 M en 1 h | [S16] FCVngzbCB3k | confirmé |
| 39 | Pack de métier de plus de 23 000 ressources ; 768 Minuscules pour atteindre le niveau 15 | [S17] DPBN9vN5AFE | confirmé |
| 40 | Marge de 520 k à 1,24 M (semaine du 17 au 23/03) | dafous (`dafous-guide-eleveur.txt`) | confirmé |
| 41 | Poussières de Solomonk : 680 000 à 820 000, soit 212 à 256 Élixirs | [S9] EfTZZYsSVeY | confirmé |
| 42 | Calculs dérivés : 375 kamas/généton ; plage 125-725 ; 265 génétons ≈ 99 k ; viande ≈ 27 kamas ; runes de caractéristique ≈ 42 kamas ; Ga PM ≈ 15 800 et Ga PA ≈ 30 200 déduits ; poussière 47-80 kamas | recalcul | exacts |
| 43 | Planchers d'extraction du JSON (G × prix × 0,98) | recalcul | exacts |

### Corrections apportées

1. **Composition des Gigantesques Élixirs** (À retenir n° 4, §6.1, JSON `items`) : le texte disait « 5 ressources de niveau 200 à ≈ 2 % ». Il y a en réalité 4 ressources de monstres de niveau 200 à 2 % de drop et 1 ressource de niveau 180 (Viande Gâtée ou Bois d'Orme) ; une seule ressource à 40-50 k par élixir, pas deux. Le taux de 2 % vient de DofusDB et de [S9], pas de [S7].
2. **Bilan des 1 020 Muldos** (§5.3, §9.1, À retenir n° 6, JSON `observedYields` et `profitabilityObservations`) : « 12 M » pour un coût de 2,95 M donne ×4,07, pas ×4,3. Le ROI de 332 % que Solomonk affiche est un rapport bénéfice/coût : il implique une valeur de ≈ 12,7 M, soit ≈ 12,5 k par monture et non 11,8 k. Le détail du coût a été ajouté (2 364 036 d'XP + 585 000 de filets), ainsi que le ROI des seules Ga PM (163 %). Le ratio Volkorne a été précisé : 6,8.
3. **Formule de brisage** (§5.1, JSON `valuation.brisage`) : la version du JSON, avec `min(niveau,100)`, contredit le relevé du niveau 200 (1,52 Ga PM). Ajout de `formulaNote`, confiance de la formule abaissée à basse, recommandation d'utiliser les rendements observés. Ajout du recoupement indépendant de Qays (161 Ga PM pour 200 Muldos, 0,805).
4. **Planchers des montures** (JSON `mounts`, 90 lignes) : la composante brisage valait 0 partout, alors que `defaultValuePerMountByLevel` donne 30 k au niveau 100 et 45 k au niveau 200 pour les Muldos et les Volkornes. La taxe de 2 % ne s'appliquait qu'à l'extraction, contrairement à la formule du §3.3. Toutes les composantes ont été recalculées nettes de taxe, ainsi que `price` et `floorDriver`. Le texte source dit désormais clairement que la revente de base au niveau 200 (150 000) est une estimation sans relevé, et que les bases des niveaux 1 et 100 viennent d'une seule famille. Effet : les planchers « revente » passent de 12 500 / 50 000 / 150 000 à 12 250 / 49 000 / 147 000.
5. **Unités** (JSON) : « k/point », « k/pt », « ≈ 350 k/monture » et « 687 000 k » étaient faux, puisque k vaut mille. Ils sont devenus kamas/point, ≈ 350 kamas par monture et 687 000 kamas. Dans la note des carburants, « Herbe Folle ≈ 13 k → ≈ 13 k/pt » est devenu ≈ 13 kamas/pt. La recette réelle a été ajoutée : Viande Intangible + Herbe Folle.
6. **Optimakinas** (§7) : la recette demande G − 1 moustaches dorées de la gén. 2 à la gén. 9, puis 10 en gén. 10, et non G (DofusDB). Les ailes ébène du Volkorne suivent le même barème.
7. **Coût de fécondité** (§6.3) : l'exemple à 0,33 kamas/pt utilisait le prix d'un carburant **de mangeoire**, qui ne remplit pas les jauges de fécondité. Ajout d'un avertissement, des recettes T1 de ces jauges et de l'indice ≈ 13 kamas/pt (Minuscule Extrait de Dragofesse).
8. **T2 / T3** (§6.1, JSON `fuelCostPerGaugePointDefaults`) : ajout d'une source en désaccord sur le T2 (un commentaire de mai donne ≈ 3× le T1, soit ≈ 1 kamas/pt) et d'une plage [1 ; 3,2]. Ajout d'un recoupement T3 : Morpion de Truchideur ≈ 6 800 pour une Potion de Mangeoire de 3 000 points, soit ≥ 2,3 kamas/pt ([S9] MSFc68m3JYg, nouvel objet dans `items`). Le relevé T2 de 16 000 date d'un bonus d'XP de métier : confiance abaissée à basse.
9. **3.7** (§6.3, JSON) : les paliers de jauge doublent (80 000 / 140 000 / 180 000 / 200 000) avec la même consommation par tick. La vitesse d'XP ne change pas ; seuls le coût par point et l'autonomie changent.
10. **Généton** (JSON `items`) : DofusDB indique `exchangeable: true` pour l'objet 33512, alors que DPLN et Solomonk le disent lié au compte. Le désaccord est consigné et la confiance passe de haute à moyenne. Non échangeable reste le choix par défaut.
11. **XP d'accouplement** (§10, JSON `accouplementNote`) : ajout du désaccord DPLN (30) / client 3.5.x (10).
12. **Boutique d'Adèle Vage** (JSON) : « Gigantesque … de Abreuvoir » est devenu « Gigantesque … d'Abreuvoir », le nom exact en jeu (DofusDB). Ajout des `itemId` des 24 carburants.
13. **Runes de caractéristique des Volkornes** (§5.1) : « 14 à 15 par Volkorne » s'entend pour les quatre types réunis (≈ 36 000 de chaque type).
14. **Ajouts de sources** : [S9] MSFc68m3JYg. Ajout aussi de Qays [S12] pour les volumes de Ga PM et les 161 Ga PM.

### Doutes restants et désaccords non tranchés

- **dragodinde.fr** (guide « Gagner des kamas avec l'élevage », `research/raw/strategy-evidence/dragodinde-fr/ElevageKamas-*.js`) annonce « ambres et parchemins puissants vendus autour d'1 M l'unité » et ≈ 3 M de récolte par cycle pour 250 Muldos. C'est incompatible avec tous les autres relevés (Ambre 14-25 k, Puissant ≈ 60 k) : probablement une erreur ou un montant par lot. Il n'est pas repris (confiance basse).
- Le relevé « 50 Muldos dorés niv. 200 → 76 Ga PM » n'a pas pu être retrouvé dans les transcriptions mises en cache (vidéo de [S9] non rechargée) : il reste à confiance moyenne.
- « Grand Extrait ≈ 550 (250 + 300) » [S17] ne figure pas dans l'extrait de transcription disponible : confiance basse, non vérifié.
- Le filet à 4 000 kamas au prix HDV, le Muldo gén. 10 sur Rafal et le pic de 50 % d'XP de métier n'ont pas été re-vérifiés.
- [S22] (Wallaka/dofus-efficiency) figure dans le tableau des sources mais n'est cité nulle part dans le texte. [S13] fait doublon avec [S12].
- Le tableau d'XP du client (`evolutive-item-types`, type 2) ne correspond pas à la table DPLN (164 403 contre 172 668 au niveau 100). Ce type ne semble pas être celui des montures, puisque sa valeur au niveau 200 serait de 776 M. La table DPLN reste la référence ; elle est confirmée par le texte du guide et par la durée observée (niveau 53 en 11 h).
- Il n'y a toujours **aucun prix de monture de haute génération** hors l'Aigue-marine. Les planchers du JSON ne sont pas des cours.
