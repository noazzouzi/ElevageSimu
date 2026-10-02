# ElevageSimu — l'élevage Dofus optimisé et rentable

Simulateur, planificateur pas à pas et calculateur de rentabilité pour l'**élevage de montures de
Dofus** (Dragodindes, Muldos, Volkornes) dans le **nouveau système 3.5+**. L'application vous dit
**quoi faire, à quelle heure et pourquoi**, pour atteindre le plus vite possible un élevage optimisé et
rentable.

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
| **Prix** | Prix HDV de votre serveur (ressources, carburants, makinas, filets, ingrédients, montures, généton), prix par défaut datés et sourcés, coût de fabrication calculé, couverture, collage en masse, import/export. Un prix manquant n'est **jamais** compté comme 0 : le coût est affiché « incomplet ». |
| **Guide & règles** | Les mécaniques expliquées, l'Almanax, les zones de capture, les erreurs fréquentes, les nouveautés 3.7 et la fiabilité des données. |
| **Réglages** | Profil (version des règles, niveau d'Éleveur, objectif, palier préféré, niveau visé des parents…), sauvegarde / restauration de toutes vos données. |

Toutes vos données restent **dans votre navigateur** (localStorage) ; exportez-les depuis Réglages.

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
  prix de votre serveur dans la page Prix. Les estimations sont signalées comme telles.

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
