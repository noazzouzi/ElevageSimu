# ElevageSimu — l'élevage Dofus optimisé et rentable

Simulateur, planificateur pas à pas et calculateur de rentabilité pour l'**élevage de montures de
Dofus** (Dragodindes, Muldos, Volkornes) dans le **nouveau système 3.5+**. L'application vous dit
**quoi faire, à quelle heure et pourquoi**, pour atteindre le plus vite possible un élevage optimisé et
rentable.

**Version 2** : plusieurs élevages sur plusieurs serveurs (profils), prix de l'HDV de chaque serveur importés
d'un export CSV, **modes de rentabilité** (Rush Corne / Ambre / Neurone, brisage, vente de montures) et
**estimateur d'investissement** (un budget → plan d'action daté, point mort, bénéfice par jour). Voir
[Nouveautés de la v2](#nouveautés-de-la-v2).

> Outil non officiel, sans lien avec Ankama. Règles du jeu **3.6 (version live)** par défaut, règles
> **3.7 bêta** en option.

## Ce que fait l'application

| Page | À quoi elle sert |
|---|---|
| **Que faire maintenant ?** | La liste ordonnée et minutée de vos prochaines actions : changements de jauges (« Enclos 1 à 07:08 : désactiver Abreuvoir, activer Foudroyeur »), recharges de carburant, couples à accoupler (avec ou sans Optimakina), stériles à cloner, montures à placer, captures à faire (couleur, zone, filet), sort des stériles en trop (vendre, extraire, briser), prochain palier du métier, jours d'Almanax à exploiter (Takeza !), prix à saisir. |
| **Plan d'élevage** | Votre objectif (une monture visée ou la rentabilité maximale), la phase où vous en êtes (P0 → P6, selon votre niveau d'Éleveur) avec objectifs et critères de passage, le chemin depuis les captures, l'effort et la durée estimés, la routine quotidienne et les erreurs à éviter. |
| **Enclos** | Les 6 enclos (débloqués aux niveaux 1/40/80/120/160/200), saisie des jauges, jauges actives, **plan de fécondité minuté** (heures exactes de changement et fenêtres de tolérance), alarmes et notifications, simulation tick par tick (10 s) de vos jauges actuelles, carburant à prévoir et son coût, **répartition automatique** des montures par zone de sérénité. |
| **Mes montures** | Inventaire (étable, enclos, inventaire) : captures par lot, éditeur complet (sérénité, endurance, maturité, amour, niveau, capacité, parents), filtres, clonage, extraction, vente, et **recommandation du sort de chaque monture** (garder, accoupler d'abord, cloner, monter en niveau, vendre, extraire, briser). |
| **Accouplement** | Simulateur fidèle au jeu : probabilités de chaque bébé, génération cible, détail du bonus (30 % + 0,15 %/niveau + Optimakina + Takeza), génétons, XP d'Éleveur, makina requise. **Meilleurs couples** de votre étable, plan d'accouplement, enregistrement des naissances, historique et calibration. |
| **Génétique** | Les arbres complets des trois familles (308 montures, 382 croisements), stats par niveau, ce que donne chaque monture, chemin le moins coûteux depuis les captures et effort attendu. |
| **Optimiseur** | Simulation Monte-Carlo de programmes d'élevage complets vers une monture visée : comparez les stratégies (niveau des parents, Optimakina, clonage, palier de jauge, nombre d'enclos) en captures, accouplements, carburant, jours et kamas. |
| **Rentabilité** | Coût des matières (carburants par jauge, makinas, filets), revenus attendus (bébés, stériles, génétons), **bénéfice, kamas/heure, ROI** d'un cycle de production ; classement des croisements ; valeur de votre inventaire ; hypothèses et sources. |
| **Métier Éleveur** | Plan de montée au moins cher (en kamas ou en ressources), liste de courses, jalons de déblocage, autres sources d'XP. |
| **Modes de rentabilité** | Rush Volkorne → Cornes, Rush Muldo → Ambres, Rush Dragodinde → Neurones, brisage (Ga Pa / Ga Pme), vente de montures, progression, ou mode automatique : chaque mode est optimisé et simulé session par session avec les prix et le volume de **votre serveur** ; tableau comparatif (bénéfice net par jour, montée en charge, capital, point mort, part du marché, risques), routine quotidienne précise et bouton « Activer ce mode » que suivent l'accueil, le Plan et Mes montures. |
| **Investissement** | Un budget (ex. 20 M) → le meilleur usage pour être rentable le plus vite : montée du métier, stock de départ, palier, mode ; **plan d'action daté**, feuille de route, liste de courses du jour 0, courbe de trésorerie, **point mort**, **bénéfice par jour**, comparaison d'allocations et sensibilité — sans jamais dépasser le budget. |
| **Prix** | Prix HDV de votre serveur (ressources, carburants, makinas, filets, ingrédients, montures, généton) : **import d'un export CSV de l'HDV** (≈ 1 000 objets utiles chiffrés d'un coup, avec le volume des ventes ; préréglage « Tylezia du 02/10/2026 » en un clic), prix saisis, prix par défaut datés et sourcés, coût de fabrication calculé, couverture, collage en masse, import/export. Chaque prix indique son origine (« votre prix », « marché (02/10) · 2 203 vendus/24 h », « défaut », « craft »). Un prix manquant n'est **jamais** compté comme 0 : le coût est affiché « incomplet ». |
| **Guide & règles** | Les mécaniques expliquées, l'Almanax, les zones de capture, les erreurs fréquentes, les nouveautés 3.7 et la fiabilité des données. |
| **Réglages** | **Profils et serveurs** (créer, dupliquer, renommer, supprimer, changer de serveur), réglages du profil (version des règles, niveau d'Éleveur, objectif, palier préféré, niveau visé des parents…), sauvegarde / restauration de tout ou d'un seul profil. |

## Nouveautés de la v2

### Profils et serveurs

Vous élevez sur plusieurs serveurs ? Chaque **profil** (un élevage : montures, enclos, plans, journal,
réglages, préférences des pages) est rattaché à un **serveur**, qui porte sa propre économie : prix saisis et
prix du marché importés, partagés par tous les profils de ce serveur. Le profil ouvert est affiché en haut de la
barre latérale (« Profil — Serveur », avec la date du dernier import des prix) ; on en change en un clic
(l'application se recharge). Chaque onglet garde son profil : deux onglets peuvent suivre deux comptes.

- **Réglages › Profils et serveurs** : créer (vierge ou copie d'un profil, sur un serveur existant ou nouveau),
  renommer, changer de serveur, sauvegarder, supprimer (avec confirmation) ; créer, renommer, régler un serveur
  (statistique de prix, part du volume vendable).
- **Reprise des données** : à la première ouverture de cette version, vos données existantes deviennent le profil
  « Principal » sur le serveur noté dans vos réglages (« Mon serveur » sinon). L'ancienne copie est gardée jusqu'à ce
  que vous la supprimiez (Réglages) ; si un onglet resté sur l'ancienne version la modifie, l'application le signale
  et propose de reprendre ou d'ignorer ces changements.
- **Sauvegarde** : tout (tous les profils et serveurs) ou un seul profil, restaurable dans un autre navigateur ;
  l'import est « tout ou rien » (rien n'est écrit si le stockage est plein) et une sauvegarde de profil demande quoi
  faire des prix de son serveur s'il existe déjà (garder, prendre ceux du fichier, fusionner).
- Une action qui recharge l'application (changer de profil ou de serveur) refuse de perdre des modifications non
  enregistrées sans vous proposer d'abord une sauvegarde.

### Importer les prix de l'HDV (CSV)

Page **Prix › Marché HDV (CSV)** : choisissez l'export CSV de l'HDV de votre serveur (colonnes
`gid;nom;…;vendus_24h;vendus_7j;vendus_30j;median_30j;moyen_30j;median_24h;kamas_par_jour`), vérifiez
l'aperçu (lignes lues, objets reconnus, couverture par catégorie, évolution des prix clés) puis remplacez
les prix du marché du serveur. Statistique de prix réglable par serveur (automatique : médiane 24 h s'il y a
eu au moins 5 ventes, sinon médiane 30 jours). Les prix d'objets-montures de l'HDV mélangent niveaux, états
et montures séniles : ils sont affichés « HDV mixte », à titre indicatif. Pour un serveur nommé Tylezia, le
bouton « Charger les prix de Tylezia du 02/10/2026 » charge l'export fourni. Pour en générer un autre :
`node scripts/import-hdv-csv.mjs <fichier.csv> <serveur> <AAAA-MM-JJ>`.

Les pages de coûts (Rentabilité, Enclos, Métier, Accouplement, Optimiseur, Modes, Investissement) utilisent ces
prix et rappellent leur source ; un export de plus de 14 jours, les prix d'un autre serveur ou un export sans
volumes sont signalés. Un import se compare au précédent (évolution des prix clés), peut **compléter** les prix
actuels au lieu de les remplacer, et s'annule tant que l'onglet reste ouvert.

### Modes de rentabilité

Page **Modes de rentabilité** : un mode fixe l'objectif économique du profil.

| Mode | Objectif |
|---|---|
| Rush Volkorne / Muldo / Dragodinde | Produire et extraire le plus possible pour vendre **Cornes de volkorne**, **Ambres de muldo** ou **Neurones de dragodinde** |
| Brisage Volkorne / Muldo | Monter les montures au niveau optimal puis les briser (runes **Ga Pa** / **Ga Pme**) — risque de correctif signalé |
| Vente de montures | Produire les montures que le marché de votre serveur paie le mieux, dans la limite de son volume |
| Progression | Objectif de génération ou de succès (comportement d'avant les modes) |
| Automatique | Le mode le plus rentable par jour de la dernière comparaison |

Chaque mode est **optimisé** (génération visée, niveau des parents, Optimakina, palier de jauge, accoupler avant
d'extraire ; brisage : niveau et palier) par une simulation de production en continu, session par session, de votre
élevage : enclos débloqués (et ceux que l'XP d'élevage débloque en route), temps de jeu, personnages, filets,
carburant au prix du serveur, ventes plafonnées par le volume du marché. Le classement se fait sur le **bénéfice net
par jour en régime permanent**, sur plusieurs tirages indépendants : deux modes dans le bruit des tirages sont « à
égalité » (le moins gourmand en capital passe devant), une montée en charge trop longue est réévaluée sur une durée
plus longue, et une vente de montures chiffrée au seul prix « HDV mixte » (niveaux, états et montures séniles
mélangés) est **spéculative** : affichée à part, jamais choisie par le mode automatique tant que vous n'avez pas saisi
le prix d'un bébé. Le détail d'un mode donne la stratégie retenue et pourquoi, la **routine quotidienne** (quoi
capturer, accoupler, cloner, extraire ou vendre, quels carburants et combien), la montée en charge datée, les revenus
et coûts par jour, la sensibilité au prix et la liquidité du marché. « Activer ce mode » oriente l'accueil (« Que
faire maintenant ? »), le Plan et le sort conseillé de chaque monture.

### Estimer un investissement

Page **Investissement** : indiquez un budget (ex. 20 000 000 K), un horizon (30, 60, 90 jours…), un mode (ou
automatique), une réserve de sécurité et les leviers autorisés (monter le métier en achetant les ingrédients, acheter
des montures G1, des carburants, des filets et makinas, revendre les objets fabriqués). L'estimateur compare les
allocations (« tout dans le métier », « équilibré », « stock de montures », « sans investissement ») et retient celle
qui rapporte le plus à l'horizon, sans jamais engager plus que le budget moins la réserve. Il affiche :

- le **plan d'action jour par jour** (« Jour 0 : acheter … ; fabriquer 2 450 objets ; niveaux 120 et 160 atteints →
  4e et 5e enclos ; Jour 1 : lancer l'élevage… ») et la **liste de courses** du jour 0, avec la part du volume de
  l'HDV qu'elle représente ;
- la **feuille de route** (métier, enclos, première vente, point mort, régime permanent), la **courbe de trésorerie**
  (bande des tirages et pire scénario), le **jour du point mort**, le **bénéfice net par jour** et le ROI à 30/60/90 jours ;
- la **sensibilité** (prix ±20 %, coûts +20 %, durées × 1,5, liquidité ÷ 2, sans génétons…) et les risques (prix
  datés, saturation du marché, brisage, temps de jeu supposé) ; « Suivre ce plan » l'applique à l'accueil et au Plan.

Les montants sont des **simulations** (joueur parfait : comptez × 1,5 sur les durées) qui dépendent de votre profil
et des prix importés ; un prix inconnu n'est jamais compté comme 0.

Toutes vos données restent **dans votre navigateur** (localStorage) ; exportez-les depuis Réglages (tout, ou
un seul profil).

## Fiabilité des règles et des données

La recherche complète est dans [`research/`](research/README.md) (index, spécification de référence,
lacunes connues) :

- **Arbres et croisements** extraits des tables du **client officiel** Dofus 3.6.12.16 (et 3.7.3.3 bêta),
  recoupés avec DofusDB et les guides communautaires.
- **Modèle de naissance** reconstitué : il reproduit à 0,01 % près les pourcentages affichés en jeu
  (tests automatiques sur 5 captures d'écran).
- **Enclos, jauges, sérénité, génétons, clonage, extraction, XP** : constantes du client et du guide
  [Dofus pour les Noobs](https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html).
- **Recettes du métier** (211) et provenance des 471 ingrédients : DofusDB, identiques au client.
- **Prix par défaut** : relevés communautaires datés (peu nombreux, surtout Salar) — à remplacer par les
  prix de votre serveur dans la page Prix (export CSV de l'HDV ou saisie). Les estimations sont signalées
  comme telles.

Points encore incertains (affichés dans l'application) : poids exact de certains croisements, tirage des
2 bébés d'un Reproducteur, sérénité initiale des captures, conservation du niveau au clonage, valeurs
finales de la 3.7.

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
```

Autres commandes :

```bash
npm test                      # tests unitaires (Vitest)
npm run build                 # vérification TypeScript + build de production (dist/)
npm run lint                  # oxlint
node scripts/build-data.mjs   # régénère src/data/*.json depuis research/
node scripts/import-hdv-csv.mjs research/raw/hdv/tylezia-2026-10-02.csv Tylezia 2026-10-02
                              # préréglage de prix HDV (src/data/market/tylezia-2026-10-02.json)
```

Le build est statique (chemins relatifs) : `dist/` peut être hébergé n'importe où. Un workflow
GitHub Actions publie l'application sur GitHub Pages à chaque push sur `main`
(activer *Settings → Pages → Source : GitHub Actions*).

## Architecture

React 19 + TypeScript strict + Vite + zustand, sans serveur. La logique du jeu est dans `src/domain`
(pure et testée), les données générées dans `src/data`, les pages dans `src/ui/pages`. Voir
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) et [`docs/api/`](docs/api/).

## Crédits

Données de jeu : © Ankama (Dofus). Guides et outils communautaires cités dans `research/`, en
particulier Dofus pour les Noobs, DofusDB et les créateurs de contenu sur l'élevage. Les textes et
captures de ces sites ne sont pas reproduits dans ce dépôt.
