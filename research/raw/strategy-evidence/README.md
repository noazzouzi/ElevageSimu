# Preuves de la recherche « stratégie » (ElevageSimu, 2026-10-01)

Fichiers produits pour `research/strategy.md` et `research/data/strategy.json`.

| Fichier | Contenu |
|---|---|
| `gestion-enclos.html`, `enclos-calculator.js`, `enclos-calculator.deobf.js` | Outil « Gestion d'enclos » de DPLN (page + JS obfusqué + version désobfusquée : chaînes et constantes en clair). |
| `pages/*.html|txt` | Pages communautaires téléchargées (guides dafous, dofuselevage, guidactik, next-stage, astuces-kamas, dofus-portals, DPLN Dragodindes/Muldos/Volkornes/MAJ 3.5/3.6, dragodinde.fr…), texte extrait. |
| `dragodinde-fr/*.js` | Composants JS des guides de dragodinde.fr (le texte des guides est dans le JS). |
| `tools/muldo-calculator`, `tools/fabenclos`, `tools/registre-abysses` | Bundles JS des outils communautaires (pour l'inventaire des fonctionnalités). |
| `youtube/*.txt` | Transcriptions YouTube (TubeLab) : Solomonk-e (11 vidéos), Tenmalexis, Laniyelle, Chikkin Sama. |
| `wild-mount-monsters.json`, `wild-mount-subareas.json`, `wild-mount-subarea-maps.json` | DofusDB : monstres sauvages, sous-zones de capture, coordonnées des cartes. |
| `sim/pyramid_sim.py` | Simulateur Monte-Carlo « pyramide » (politique d'élevage pilotée par la demande, modèle de probabilités de `research/raw/mechanics-evidence/breeding_model_reference.py`). |
| `sim/run_grid.py`, `sim/pyramid-results.json`, `sim/grid.log` | Grille 1 : 15 cibles × 10 scénarios (niveau, Optimakina, clonage, nombre de places). |
| `sim/run_grid2.py`, `sim/pyramid-results-v2.json`, `sim/grid2.log` | Grille 2 : 9 cibles × 6 politiques, avec consommation de carburant. |
| `sim/carrier-examples.txt` | Distributions calculées : « porteurs », dilution de la génération cible, G10×G10. |
| `sim/deterministic-tables.json` | Tables déterministes : durée d'un lot par palier, points délivrés en 8 h/12 h, coût/bénéfice du niveau. |
| `build_strategy_json.py` | Génère `research/data/strategy.json` (règles écrites à la main + résumés de simulation) ; vérifie que chaque source citée existe. |

Inaccessibles : Reddit (bloqué par politique réseau de Reddit), forum officiel dofus.com (défi anti-bot AWS WAF, réponse 202 vide), X/Twitter.
