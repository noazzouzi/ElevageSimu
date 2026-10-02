"""Builds research/data/strategy.json (ElevageSimu strategy research, 2026-10-01).
Hand-written rules + simulation summaries read from sim/pyramid-results*.json and sim/deterministic-tables.json.
Run: python3 research/raw/strategy-evidence/build_strategy_json.py
"""
import json, os, datetime

BASE = '/home/user/ElevageSimu/research'
EV = BASE + '/raw/strategy-evidence'
OUT = BASE + '/data/strategy.json'

# ----------------------------------------------------------------------------------------------
SOURCES = [
    {"id": "dpln_guide", "title": "Guide de l'éleveur (édition 2026), Dofus pour les Noobs", "url": "https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html", "date": "2026-03-02", "type": "guide", "local": "research/raw/guide-eleveur-dpln.txt"},
    {"id": "dpln_tool", "title": "Gestion d'enclos (outil DPLN)", "url": "https://www.dofuspourlesnoobs.com/gestion-d-enclos.html", "type": "tool", "local": "research/raw/strategy-evidence/enclos-calculator.deobf.js"},
    {"id": "dpln_species", "title": "DPLN : Les Dragodindes / Les Muldos / Les Volkornes", "url": "https://www.dofuspourlesnoobs.com/les-dragodindes.html", "type": "guide", "local": "research/raw/strategy-evidence/pages/dpln-*.txt"},
    {"id": "devblog2", "title": "Devblog élevage partie II (Ankama)", "url": "https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1762596-devblog-elevage-monture-partie-ii", "date": "2025-04-28", "type": "official", "local": "research/raw/mechanics-evidence/texts/devblog-elevage-partie-II-2025-04-28.txt"},
    {"id": "devblog37", "title": "Devblog 3.7 – confort, lisibilité, ajustements (Ankama)", "url": "https://www.dofus.com/fr/mmorpg/actualites/devblog/billets/1771790-maj-3-7-confort-jeu-lisibilite-ajustements", "date": "2026-09-16", "type": "official", "local": "research/raw/mechanics-evidence/texts/devblog-3.7-elevage-2026-09-16.txt"},
    {"id": "dofusdb", "title": "DofusDB API (monsters, subareas, map-positions, items, effects, almanax-calendars)", "url": "https://api.dofusdb.fr", "type": "game-data", "local": "research/raw/strategy-evidence/wild-mount-*.json"},
    {"id": "mechanics", "title": "Recherche interne : mécaniques + modèle de probabilités validé", "url": None, "type": "internal", "local": "research/mechanics.md ; research/raw/mechanics-evidence/breeding_model_reference.py"},
    {"id": "crafts", "title": "Recherche interne : recettes, XP de craft, ingrédients", "url": None, "type": "internal", "local": "research/crafts.md"},
    {"id": "trees", "title": "Recherche interne : arbres Dragodinde/Muldo/Volkorne", "url": None, "type": "internal", "local": "research/tree-*.md"},
    {"id": "dragodinde_fr", "title": "dragodinde.fr – planner et guides (kamas, succès, mode d'emploi)", "url": "https://dragodinde.fr/", "type": "tool", "local": "research/raw/strategy-evidence/dragodinde-fr/"},
    {"id": "dofuselevage", "title": "dofuselevage.fr – guide et outils", "url": "https://dofuselevage.fr/tools", "type": "tool", "local": "research/raw/strategy-evidence/pages/dofuselevage-*.txt"},
    {"id": "dafous", "title": "dafous.app – guide éleveur et outil élevage", "url": "https://dafous.app/en/guides/guide-eleveur.html", "type": "guide", "local": "research/raw/strategy-evidence/pages/dafous-*.txt"},
    {"id": "registre", "title": "Registre des Abysses", "url": "https://registre-des-abysses.pages.dev/", "type": "tool", "local": "research/raw/strategy-evidence/tools/registre-abysses/"},
    {"id": "fabenclos", "title": "FabEnclos", "url": "https://enclos.le-fab.fr/", "type": "tool", "local": "research/raw/strategy-evidence/tools/fabenclos/"},
    {"id": "muldo_calc", "title": "Muldo breeding calculator (Chikkin Sama)", "url": "https://tt405907.github.io/muldo-calculator/", "type": "tool", "local": "research/raw/strategy-evidence/tools/muldo-calculator/"},
    {"id": "dofus_portals", "title": "dofus-portals.fr – Comment monter Éleveur", "url": "https://dofus-portals.fr/comment-monter-eleveur/", "type": "guide"},
    {"id": "nextstage", "title": "Next Stage – Tuto élevage de dragodinde", "url": "https://www.next-stage.fr/2026/04/tuto-elevage-dragodinde-dofus-guide-complet-a-z.html", "date": "2026-04", "type": "guide"},
    {"id": "guidactik", "title": "Guidactik – Guide complet de l'élevage sur DOFUS 3 ; roadmap 2026", "url": "https://guidactik.com/dofus/guide-complet-de-lelevage-sur-dofus-3/", "type": "guide"},
    {"id": "astuces_kamas", "title": "Astuces Kamas – Éleveur : élevage rentable", "url": "https://dofus-astuces-kamas.com/blog/astuces-kamas-eleveur", "date": "2026-09-14", "type": "guide"},
    {"id": "yt_solomonk_calc", "title": "Solomonk-e – Le meilleur outil pour optimiser ton élevage (de Muldos)", "url": "https://www.youtube.com/watch?v=MSFc68m3JYg", "date": "2026-03-15", "type": "video", "local": "research/raw/strategy-evidence/youtube/MSFc68m3JYg-solomonke-muldo-calculator.txt"},
    {"id": "yt_solomonk_fullsucces", "title": "Solomonk-e – Si je voulais faire le full succès élevage", "url": "https://www.youtube.com/watch?v=Yoz63BNQZ0o", "date": "2026-03", "type": "video", "local": "research/raw/strategy-evidence/youtube/Yoz63BNQZ0o-solomonke-full-succes.txt"},
    {"id": "yt_solomonk_muldo_kamas", "title": "Solomonk-e – Des millions de kamas (presque) sans jouer avec les Muldos", "url": "https://www.youtube.com/watch?v=41ka94FXdM0", "date": "2026-04", "type": "video"},
    {"id": "yt_solomonk_secret", "title": "Solomonk-e – Ma technique (pas si) secrète pour faire des kamas", "url": "https://www.youtube.com/watch?v=er35rckGDFM", "date": "2026-03", "type": "video"},
    {"id": "yt_solomonk_volk10000", "title": "Solomonk-e – Je brise 10 000 Volkornes", "url": "https://www.youtube.com/watch?v=fGqEPyQoBgk", "date": "2026-09", "type": "video"},
    {"id": "yt_solomonk_muldo1000", "title": "Solomonk-e – Je brise 1 000 Muldos", "url": "https://www.youtube.com/watch?v=KFzrg1-MRGQ", "date": "2026-05", "type": "video"},
    {"id": "yt_solomonk_1mois", "title": "Solomonk-e – Mon avis honnête après un mois", "url": "https://www.youtube.com/watch?v=z8TYzeV8g-o", "date": "2026-04", "type": "video"},
    {"id": "yt_solomonk_parchemins", "title": "Solomonk-e – L'impact économique de la refonte (parchemins)", "url": "https://www.youtube.com/watch?v=a_Meh5-rqWk", "date": "2026-02", "type": "video"},
    {"id": "yt_solomonk_muldo_aventure", "title": "Solomonk-e – Aventure Muldo #1 et #2", "url": "https://www.youtube.com/watch?v=EfTZZYsSVeY", "date": "2026-03/04", "type": "video"},
    {"id": "yt_solomonk_ankama", "title": "Solomonk-e – Ankama répond à la communauté élevage", "url": "https://www.youtube.com/watch?v=9IkAMTg4lw8", "date": "2026-05", "type": "video"},
    {"id": "yt_tenmalexis_pack", "title": "Tenmalexis – Le PACK pour monter Éleveur 200", "url": "https://www.youtube.com/watch?v=DPBN9vN5AFE", "date": "2026-03-01", "type": "video"},
    {"id": "yt_laniyelle", "title": "Laniyelle – Guide ultime de l'élevage", "url": "https://www.youtube.com/watch?v=9DOVGqb_rXg", "date": "2026-03-04", "type": "video"},
    {"id": "yt_chikkin", "title": "Chikkin Sama – Élevage = contenu de bot ?", "url": "https://www.youtube.com/watch?v=dhQ0-67UYXs", "date": "2026-04", "type": "video"},
    {"id": "sim", "title": "Simulation Monte-Carlo de cette recherche (pyramide)", "url": None, "type": "internal", "local": "research/raw/strategy-evidence/sim/"},
]

# ----------------------------------------------------------------------------------------------
PHASES = [
    {"id": "P0", "title": "Préparation", "jobLevelRange": [0, 1], "paddocks": 1,
     "goals": ["Choisir l'espèce et l'objectif (succès, génétons, revente, brisage)", "Préparer filets universels et premiers carburants", "Saisir les prix HDV de base dans l'application"],
     "actions": [
         "Choisir une espèce : Muldo (1 PM) ou Volkorne (1 PA) pour la valeur de revente et le brisage ; Dragodinde si l'on vise d'abord ses succès (zone de capture collée aux enclos).",
         "Crafter ~20–30 Filets de capture universels (10 Bois de Frêne + 10 Fer ; 10 XP chacun au niveau 1).",
         "Réunir des carburants palier 1 (Extraits) pour au moins 2 lots : ~20 000 points de Foudroyeur, d'Abreuvoir, de Dragofesse et de Mangeoire + ~5 000 de Caresseur/Baffeur.",
         "Équiper un filet en consommable de combat (donne le sort Apprivoisement de monture).",
     ],
     "exitCriteria": ["≥ 20 G1 capturées (équilibre de sexes par couleur)", "carburants palier 1 pour 2 lots"],
     "sources": ["dpln_guide", "crafts", "dragodinde_fr"]},
    {"id": "P1", "title": "Démarrage (1 enclos)", "jobLevelRange": [1, 40], "paddocks": 1,
     "goals": ["Succès de capture de l'espèce", "Premières G2–G3", "Éleveur 40 (2e enclos)", "Montures au niveau ~40 « gratuitement »"],
     "actions": [
         "Capturer en équipe (chaque personnage lance son filet) ; challenges en mode drop.",
         "Lot de 10 groupé par sérénité ; phase double (2 statistiques) la nuit au palier 1 ; traversée de 0 + 3e statistique + Mangeoire le jour.",
         "Accoupler tous les couples G1 × G1 de recettes utiles (60 XP d'Éleveur chacun en 3.6).",
         "Cloner les stériles G1 de même couleur ; capturer pour remplir les places libres.",
         "Monter le métier : captures (30 XP) puis Minuscules/Petits/normal/Grands Extraits du niveau débloqué.",
     ],
     "exitCriteria": ["Éleveur ≥ 40", "au moins une couleur G3 obtenue"],
     "sources": ["dpln_guide", "yt_solomonk_muldo_aventure", "crafts"]},
    {"id": "P2", "title": "Montée en régime (2 enclos)", "jobLevelRange": [40, 80], "paddocks": 2,
     "goals": ["Atteindre G5", "Éleveur 80 (3e enclos)", "Clonage systématique"],
     "actions": [
         "Enclos 1 = groupe bleu (Foudroyeur + Abreuvoir), enclos 2 = groupe violet (Dragofesse + Abreuvoir).",
         "Crafter des Gigantesques Extraits (niv. 45) : palier 1 le moins cher par point, pour toutes les nuits.",
         "Philtres dès 55 : palier 2 en journée.",
         "Produire plus de bicolores « goulots » (ex. Dragodinde Amande et Dorée) ; « stacker » avant de tenter G5.",
         "Optimakina sur G4–G5 seulement si son prix < seuil (matingRules M-OPTI-01).",
     ],
     "exitCriteria": ["Éleveur ≥ 80", "première monocolore G5"],
     "sources": ["dpln_guide", "yt_solomonk_fullsucces", "sim"]},
    {"id": "P3", "title": "Production (3–4 enclos)", "jobLevelRange": [80, 120], "paddocks": 3,
     "goals": ["Filet multiplicateur (100)", "Éleveur 120 = 4 enclos (palier clé)", "Atteindre G7"],
     "actions": [
         "Passer au Filet multiplicateur de [type] dès le niveau 100 (2 montures par lancer).",
         "Potions dès 105 (palier 3) pour les sessions actives.",
         "Enclos 3 = station de sérénité (Caresseur ou Baffeur + Mangeoire).",
         "Optimakina systématique pour les cibles G ≥ 6 ; arbres propres (pas de génération ≥ cible dans les arbres).",
         "Préparer les couples de haute génération pour le jour Takeza.",
     ],
     "exitCriteria": ["Éleveur ≥ 120", "première monocolore G7"],
     "sources": ["dpln_guide", "sim", "dafous"]},
    {"id": "P4", "title": "Haute génération (4–5 enclos)", "jobLevelRange": [120, 160], "paddocks": 4,
     "goals": ["Filet renforcé (150)", "Élixirs (155)", "Éleveur 160 (5e enclos)", "Première G9"],
     "actions": [
         "Filet à [type] renforcé (cercle de rayon 3) : regrouper les montures avant de lancer.",
         "Monter au niveau 60–100 les parents chers (G8) si les places d'enclos ne sont pas limitantes.",
         "Garder les bébés ratés porteurs d'une G9 (G1 dont un parent est G9) pour les G10 (porteurs).",
     ],
     "exitCriteria": ["Éleveur ≥ 160", "première G9"],
     "sources": ["dpln_guide", "mechanics", "sim"]},
    {"id": "P5", "title": "Maîtrise (6 enclos)", "jobLevelRange": [160, 200], "paddocks": 5,
     "goals": ["Éleveur 200 : 6 enclos + filet multiplicateur renforcé", "G10 et succès G10", "Génétons (×2 en 3.7)"],
     "actions": [
         "Filet multiplicateur renforcé : jusqu'à 16 montures par combat.",
         "Croisements G9 × G1 (251 génétons) ou G9 × G9 (500) avec Optimakina ; porteurs pour les autres couleurs G10.",
         "Dernier accouplement G10 × G10 avant de sortir une G10.",
     ],
     "exitCriteria": ["Éleveur 200", "toutes les G10 visées"],
     "sources": ["dpln_guide", "dragodinde_fr", "mechanics"]},
    {"id": "P6", "title": "Croisière et rentabilité", "jobLevelRange": [200, 200], "paddocks": 6,
     "goals": ["Marge positive stable", "Boucle capture → génération → vente/extraction/brisage → recapture"],
     "actions": [
         "Mode génétons : maximiser les bébés qui dépassent leurs arbres (G8 × G8, G9 × G1, G9 × G9).",
         "Vendre G8–G10 (Muldo/Volkorne niveau 100–200), ressources d'extraction, runes de brisage.",
         "Recapturer chaque cycle les G1 consommées (proportions par couleur et sexe).",
     ],
     "exitCriteria": ["marge hebdomadaire ≥ objectif fixé par l'utilisateur"],
     "sources": ["dragodinde_fr", "yt_solomonk_volk10000", "dafous"]},
]

# ----------------------------------------------------------------------------------------------
# Condition DSL: {"all":[...]} / {"any":[...]} of predicates {"field":..., "op": "lt|le|gt|ge|eq|between|in", "value":...}
PADDOCK_RULES = [
    {"id": "E-FULL-01", "priority": 1, "title": "Enclos plein de montures éligibles",
     "when": {"field": "paddock.eligibleMountsForActiveGauge", "op": "lt", "value": 7},
     "then": "Compléter l'enclos avec des montures qui ont besoin de la même jauge ; sinon remplacer la jauge par la Mangeoire ou la désactiver.",
     "rationale": "La jauge consomme la même chose avec 1 ou 10 montures ; rendement = éligibles/10.",
     "params": {"efficiency": "eligible/10"}, "sources": ["dpln_guide", "devblog2"], "confidence": "high"},
    {"id": "E-GROUP-01", "priority": 1, "title": "Lots homogènes en sérénité",
     "when": {"field": "batch.serenitySpread", "op": "gt", "value": 2000},
     "then": "Scinder le lot : chaque lot doit tenir dans une fenêtre de 2 000 de sérénité.",
     "rationale": "Un lot ≤ 2 000 de large traverse 0 sans qu'aucune monture ne sorte de la zone utile.",
     "params": {"maxSpread": 2000}, "sources": ["dpln_guide", "mechanics"], "confidence": "high"},
    {"id": "E-GAUGE-BLUE", "priority": 2, "title": "Groupe bleu : endurance + maturité",
     "when": {"field": "batch.serenity", "op": "between", "value": [-2000, -1]},
     "then": "Activer Foudroyeur + Abreuvoir jusqu'à 20 000/20 000 ; puis Caresseur + Mangeoire jusqu'à sérénité ≥ 0 ; puis Dragofesse + Mangeoire.",
     "sources": ["dpln_guide", "mechanics"], "confidence": "high"},
    {"id": "E-GAUGE-PURPLE", "priority": 2, "title": "Groupe violet : maturité + amour",
     "when": {"field": "batch.serenity", "op": "between", "value": [0, 2000]},
     "then": "Activer Dragofesse + Abreuvoir ; puis Baffeur + Mangeoire jusqu'à sérénité ≤ −1 ; puis Foudroyeur + Mangeoire.",
     "sources": ["dpln_guide", "mechanics"], "confidence": "high"},
    {"id": "E-GAUGE-RED", "priority": 2, "title": "Groupe rouge : sérénité < −2 000",
     "when": {"field": "batch.serenity", "op": "between", "value": [-5000, -2001]},
     "then": "Foudroyeur + Caresseur (l'endurance monte pendant la remontée) ; dès [−2 000 ; −1] passer au groupe bleu.",
     "sources": ["dpln_guide", "dofuselevage", "mechanics"], "confidence": "high"},
    {"id": "E-GAUGE-GREEN", "priority": 2, "title": "Groupe vert : sérénité > 2 000",
     "when": {"field": "batch.serenity", "op": "between", "value": [2001, 5000]},
     "then": "Dragofesse + Baffeur ; dès [0 ; 2 000] passer au groupe violet.",
     "sources": ["dpln_guide", "mechanics"], "confidence": "high"},
    {"id": "E-XP-01", "priority": 2, "title": "Mangeoire en 2e jauge",
     "when": {"field": "paddock.activeGauges", "op": "eq", "value": 1},
     "then": "Activer la Mangeoire en 2e jauge (objectif niveau ~40 pour les parents ; plus pour les montures à vendre/briser).",
     "rationale": "+0,15 %/niveau/parent ; 20 437 XP (niveau 40) ≈ la durée d'une phase de 20 000 points.",
     "params": {"defaultTargetLevel": 40}, "sources": ["dpln_guide", "dragodinde_fr", "yt_solomonk_calc"], "confidence": "high"},
    {"id": "E-SER-ALARM", "priority": 1, "title": "Alarme obligatoire sur Baffeur/Caresseur",
     "when": {"field": "paddock.activeGauges", "op": "in", "value": ["baffeur", "caresseur"]},
     "then": "Calculer tick par tick l'heure où la monture la plus éloignée atteint la cible ; programmer une alarme ; couper la jauge à distance. Ne jamais laisser une jauge de sérénité active la nuit.",
     "params": {"formula": "ticks = points_à_parcourir / rythme_du_palier_courant (simulation tick par tick)", "pointsPer1000": {"T1": "17 min", "T2": "8 min", "T3": "6 min", "T4": "4 min"}},
     "sources": ["dpln_guide", "dpln_tool"], "confidence": "high"},
    {"id": "E-SER-EXACT", "priority": 3, "title": "Remplir la jauge de sérénité au plus juste",
     "when": {"field": "paddock.activeGauges", "op": "in", "value": ["baffeur", "caresseur"]},
     "then": "Ne mettre dans la jauge que |s_cible − s_max| + une petite marge, pour qu'elle s'arrête d'elle-même.",
     "sources": ["mechanics"], "confidence": "medium"},
    {"id": "E-TIER-NIGHT", "priority": 2, "title": "Nuit et absences : palier 1",
     "when": {"field": "player.absenceHours", "op": "ge", "value": 6},
     "then": "Mettre les lots en phase double et remplir les deux jauges de statistiques à 20 000–40 000 avec des Extraits (palier 1 : 5 h 33 par statistique ; 8 h délivrent 28 800 points depuis 40 000).",
     "sources": ["dpln_guide", "guidactik", "sim"], "confidence": "high"},
    {"id": "E-TIER-DAY", "priority": 3, "title": "Journée : palier 2 (3 en session active)",
     "when": {"field": "player.present", "op": "eq", "value": True},
     "then": "Palier 2 par défaut (Philtres) ; palier 3 (Potions) si l'on reste présent ; palier 4 (Élixirs, 42 min) seulement en rush et si le prix au point le justifie.",
     "sources": ["dpln_guide", "yt_solomonk_secret"], "confidence": "medium"},
    {"id": "E-FUEL-CHEAPEST", "priority": 2, "title": "Carburant le moins cher au point",
     "when": {"field": "action", "op": "eq", "value": "refuel"},
     "then": "Pour chaque tranche de jauge, choisir la taille débloquée qui minimise prix/durabilité ; remplir chaque palier avec la famille minimale qui le permet (Extraits ≤ 40 000, Philtres ≤ 70 000, Potions ≤ 90 000, Élixirs ≤ 100 000) ; préférer les tailles qui tombent juste.",
     "sources": ["crafts", "registre"], "confidence": "high"},
    {"id": "E-ALMANAX-GAUGE", "priority": 3, "title": "Jours d'effet doublé",
     "when": {"field": "calendar.dayMonth", "op": "in", "value": ["10/01", "10/03", "10/04", "10/06", "10/09", "10/12"]},
     "then": "Programmer la phase correspondante (Abreuvoir, Foudroyeur, Baffeur, Mangeoire, Caresseur, Dragofesse) dans tous les enclos ce jour-là.",
     "sources": ["dofusdb", "dpln_guide"], "confidence": "medium"},
    {"id": "E-ABILITY-01", "priority": 4, "title": "Capacités de gain",
     "when": {"field": "mount.ability", "op": "in", "value": ["Amoureuse", "Endurante", "Précoce", "Sage"]},
     "then": "Regrouper les montures de même capacité dans un même enclos pour profiter du ×2 sur tout le lot ; Sage → montures à monter (revente/brisage).",
     "sources": ["dpln_guide"], "confidence": "medium"},
    {"id": "E-FECUND-WAIT", "priority": 3, "title": "Lot fécond en attente",
     "when": {"field": "batch.allFecund", "op": "eq", "value": True},
     "then": "Sortir le lot vers l'étable (accouplement possible à distance) ou le laisser sous Mangeoire seule ; libérer les places pour un nouveau lot.",
     "sources": ["dpln_guide", "dragodinde_fr"], "confidence": "high"},
]

ALLOCATION_BY_PADDOCKS = {
    "1": "1 lot de 10 ; sérénité réglée lot par lot ; accoupler dès que 2 montures compatibles sont fécondes.",
    "2": "E1 groupe bleu (Foudroyeur + Abreuvoir), E2 groupe violet (Dragofesse + Abreuvoir) ; changement d'enclos à la traversée de 0.",
    "3": "E1 bleu, E2 violet, E3 station de sérénité (Caresseur/Baffeur + Mangeoire).",
    "4": "2 bleus, 1 violet, 1 station ; ou 3 de production + 1 Mangeoire (revente/brisage).",
    "5": "2 bleus, 2 violets, 1 station.",
    "6": "2 bleus, 2 violets, 1 station Caresseur, 1 station Baffeur ; lots de 60.",
}

MATING_RULES = [
    {"id": "M-CLEAN-01", "priority": 1, "title": "Arbres propres",
     "when": {"field": "pair.maxTreeGeneration", "op": "ge", "value": "pair.targetGeneration"},
     "then": "Éviter ce couple si une alternative existe : le bonus de cible est partagé avec les montures de l'arbre et le couple ne rapporte aucun généton.",
     "example": "Orchidée × Pourpre (parents G6) : Orchidée et Pourpre 36,7 %, 0 généton ; avec une Pourpre standard : 42 %, 30 génétons (niv. 40/40).",
     "sources": ["mechanics", "dpln_guide", "sim"], "confidence": "high"},
    {"id": "M-LEVEL-01", "priority": 2, "title": "Niveau des parents",
     "when": {"field": "pair.levelSum", "op": "lt", "value": 80},
     "then": "Amener chaque parent au niveau ~40 pendant la fécondation (Mangeoire en 2e jauge).",
     "decision": "monter de ΔL si coût_XP(ΔL) < C_eff × 0,003·ΔL / p ; niveau 100 seulement pour les parents chers (G8/G9) ou quand les places ne limitent pas ; pour G9 × G1, monter la G1 (bon marché).",
     "sources": ["dpln_guide", "dragodinde_fr", "sim"], "confidence": "medium"},
    {"id": "M-OPTI-01", "priority": 2, "title": "Optimakina",
     "when": {"field": "pair.targetGeneration", "op": "ge", "value": 2},
     "then": "Utiliser une Optimakina (génération ≥ génération cible) si prix_optimakina < C_eff × Δ / p (Δ = 0,10 ; 0,20 en 3.7). Systématique dès la cible G6 ; partout si les makinas basses générations sont bon marché.",
     "params": {"delta_3_6": 0.10, "delta_3_7": 0.20},
     "simulation": "Optimakina à chaque accouplement : −40 à −65 % de captures, accouplements, fécondations et carburant pour une G9/G10 (niv. 40, clonage) ; limitée aux cibles ≥ G6 : −20 à −48 % pour 38 à 77 makinas.",
     "sources": ["dpln_guide", "dafous", "sim"], "confidence": "medium"},
    {"id": "M-ANIMA-36", "priority": 4, "title": "Animakina (3.5/3.6)",
     "when": {"field": "ruleset", "op": "in", "value": ["3.5", "3.6"]},
     "then": "Ne pas l'utiliser sauf bébé destiné à rester longtemps (Sage pour revente) ; Reproducteur 5 % seulement ; capacités perdues au clonage. Garder les stocks : elles seront converties en « choix du sexe » en 3.7.",
     "sources": ["dpln_guide", "devblog37"], "confidence": "high"},
    {"id": "M-ANIMA-37", "priority": 2, "title": "Animakina (3.7) = choix du sexe",
     "when": {"field": "ruleset", "op": "eq", "value": "3.7"},
     "then": "L'utiliser quand la couleur du bébé visé a un déficit de sexe dans l'étable, ou pour garantir le sexe d'une G9/G10 nécessaire.",
     "sources": ["devblog37"], "confidence": "high"},
    {"id": "M-KROMA-01", "priority": 5, "title": "Kromakina",
     "when": {"field": "baby.purpose", "op": "eq", "value": "vitrine"},
     "then": "Caméléone 100 % : uniquement pour des montures destinées à la vente comme apparat.",
     "sources": ["dpln_guide", "dafous"], "confidence": "high"},
    {"id": "M-100PCT", "priority": 3, "title": "Seuils de 100 % de cible",
     "when": {"field": "pair.isCritical", "op": "eq", "value": True},
     "then": "100 % si niveaux cumulés ≥ 400 avec Optimakina (3.6) ; ≥ 333 avec Optimakina 20 % (3.7) ; ≥ 267 avec Optimakina + Takeza (3.6) ; ≥ 200 avec Optimakina 20 % + Takeza (3.7).",
     "sources": ["dpln_guide", "devblog37", "dofusdb"], "confidence": "high"},
    {"id": "M-CLONE-01", "priority": 1, "title": "Clonage systématique",
     "when": {"field": "stable.steriles.sameGenerationPairs", "op": "ge", "value": 1},
     "then": "Cloner juste après les accouplements : 1) deux stériles de même couleur ; 2) couleur utile + couleur inutile (50 %) ; jamais deux inutiles ; même sexe si l'on a besoin d'un sexe précis.",
     "rationale": "« 2 pour 2 » ; sans clonage une G7 demande ~15 000 captures (simulation).",
     "sources": ["dpln_guide", "registre", "sim"], "confidence": "high"},
    {"id": "M-FREEBABY-01", "priority": 1, "title": "Bébé gratuit avant extraction",
     "when": {"all": [{"field": "mount.fertility", "op": "eq", "value": "Féconde"}, {"field": "mount.fate", "op": "in", "value": ["extract", "sell", "break"]}]},
     "then": "Accoupler d'abord les fécondes condamnées entre elles (sexes opposés, même espèce), puis extraire/vendre les stériles.",
     "sources": ["dragodinde_fr", "dpln_guide"], "confidence": "high"},
    {"id": "M-G10OUT-01", "priority": 3, "title": "Sortie des G10",
     "when": {"all": [{"field": "mount.generation", "op": "eq", "value": 10}, {"field": "mount.successValidated", "op": "eq", "value": True}]},
     "then": "Dernier accouplement G10 × G10 si possible (~30–42 % de G10, peut-être une couleur manquante), puis vendre/extraire ; remplacer par des G1.",
     "sources": ["dragodinde_fr", "sim"], "confidence": "medium"},
    {"id": "M-CARRIER-01", "priority": 2, "title": "Porteurs (G10 à partir de G1)",
     "when": {"field": "mount.parentsMaxGeneration", "op": "eq", "value": 9},
     "then": "Garder ces montures (souvent des G1 nées d'un croisement G9 × G1 raté) et les croiser avec une monture d'une autre couleur : la cible devient la G10 « G9 et X » avec la même chance qu'un croisement standard ; les recycler par clonage.",
     "example": "Dragodinde Dorée (parents Dorée + Émeraude) × Rousse sauvage : Émeraude et Rousse 42 % (niv. 40/40), Émeraude 15 %, 2 génétons.",
     "sources": ["mechanics", "dpln_guide", "sim"], "confidence": "medium"},
    {"id": "M-STACK-01", "priority": 2, "title": "Accumuler avant de tenter",
     "when": {"field": "recipe.expectedAttemptsAvailable", "op": "lt", "value": 3},
     "then": "Ne pas tenter la génération suivante tout de suite : produire d'abord assez de parents pour ≥ 3 tentatives (à 42 %, 1 tentative échoue 58 % du temps).",
     "sources": ["yt_solomonk_fullsucces", "yt_chikkin"], "confidence": "medium"},
    {"id": "M-ORDER-01", "priority": 1, "title": "Ordre d'une session",
     "when": {"field": "session.phase", "op": "eq", "value": "breeding"},
     "then": "1) accouplements par génération (G2, G4, G6, G8, puis monocolores), 2) clonages, 3) captures, 4) extractions, 5) banque/havre-sac ; puis resynchroniser le plan sur les naissances réelles.",
     "sources": ["dragodinde_fr"], "confidence": "medium"},
    {"id": "M-STABLE-01", "priority": 1, "title": "Accoupler depuis l'étable",
     "when": {"field": "mount.location", "op": "in", "value": ["inventaire", "enclos"]},
     "then": "Déplacer les deux montures dans l'étable avant d'accoupler/cloner.",
     "sources": ["dpln_guide"], "confidence": "high"},
    {"id": "M-MAKGEN-01", "priority": 1, "title": "Génération de la makina",
     "when": {"field": "makina.generation", "op": "lt", "value": "pair.targetGeneration"},
     "then": "Makina inutilisable : prendre une makina de génération ≥ génération cible.",
     "sources": ["dpln_guide"], "confidence": "high"},
    {"id": "M-PAIRS-01", "priority": 2, "title": "Appariement maximal",
     "when": {"field": "session.phase", "op": "eq", "value": "breeding"},
     "then": "Choisir les couples qui maximisent le nombre de croisements utiles de la session (appariement ♂/♀), priorité à la génération la plus haute et aux goulots.",
     "sources": ["registre", "dragodinde_fr"], "confidence": "medium"},
    {"id": "M-GENETON-01", "priority": 3, "title": "Génétons",
     "when": {"field": "objective", "op": "eq", "value": "genetons"},
     "then": "Privilégier les réussites qui dépassent les arbres avec des parents hauts (G8+G8 = 240, G9+G1 = 251, G9+G9 = 500 ; ×2 en 3.7) ; en 3.6, si la 3.7 est imminente, reporter les gros accouplements G8/G9.",
     "sources": ["mechanics", "devblog37"], "confidence": "high"},
    {"id": "M-TAKEZA-01", "priority": 2, "title": "Jour Takeza",
     "when": {"field": "calendar.date", "op": "in", "value": ["2026-10-12", "2027-10-11", "2028-10-09"]},
     "then": "Faire ce jour-là les accouplements à fort enjeu (+20 % de cible) ; préparer les couples féconds la veille.",
     "sources": ["dofusdb", "dpln_guide"], "confidence": "high"},
    {"id": "M-BABYDAY-01", "priority": 4, "title": "Jours de capacité offerte",
     "when": {"field": "calendar.dayMonth", "op": "in", "value": ["10/02", "10/07", "10/10", "10/11"]},
     "then": "Faire les accouplements dont on garde/vend les bébés (10/10 Sage : XP ×2).",
     "sources": ["dofusdb"], "confidence": "high"},
    {"id": "M-BOTTLENECK-01", "priority": 2, "title": "Goulots de recettes",
     "when": {"field": "color.usedByRecipes", "op": "ge", "value": 2},
     "then": "Produire davantage de ces couleurs (ex. Dragodinde Amande et Dorée → Indigo et Ébène ; Ébène et Indigo → Orchidée et Pourpre ; Orchidée et Pourpre → Ivoire et Turquoise ; Ivoire et Turquoise → Prune et Émeraude).",
     "sources": ["yt_solomonk_fullsucces", "trees"], "confidence": "medium"},
]

CAPTURE_RULES = [
    {"id": "C-NET-01", "title": "Meilleur filet disponible",
     "then": "Utiliser le filet le plus haut que le niveau d'Éleveur permet d'équiper (100 multiplicateur, 150 renforcé, 200 multiplicateur renforcé) ; garder des universels pour les montures isolées.",
     "sources": ["dpln_guide", "yt_solomonk_volk10000"], "confidence": "high"},
    {"id": "C-TEAM-01", "title": "Un filet par personnage",
     "then": "En équipe, chaque personnage lance son filet sur des montures différentes (4 × multiplicateur = 8 par combat ; 1 renforcé + 3 multiplicateurs ≈ 11).",
     "sources": ["dpln_guide", "yt_solomonk_volk10000"], "confidence": "high"},
    {"id": "C-AOE-01", "title": "Regrouper avant un filet de zone",
     "then": "Regrouper les montures (glyphes, attirances ; les Volkornes attirent eux-mêmes) puis lancer au centre du groupe (cercle de rayon 3) ; marquer au 1er tour.",
     "sources": ["yt_solomonk_volk10000", "dpln_guide"], "confidence": "medium"},
    {"id": "C-DROP-01", "title": "Prospection",
     "then": "Challenges en mode drop et prospection élevée : les ressources de monture (42 % de base ; Bave/Griffe 7,1 % ; Sueur 2 %) alimentent filets et makinas.",
     "sources": ["dpln_guide", "crafts", "yt_solomonk_muldo_aventure"], "confidence": "high"},
    {"id": "C-MIX-01", "title": "Couleurs selon l'arbre visé",
     "then": "Capturer les G1 dans les proportions de l'arbre visé (multiplicité des G1 dans la recette) et non en parts égales.",
     "example": "Muldo Ambre et Azur : ~120 Pourpre, 120 Doré, 40 Ébène (Solomonk/muldo-calculator).",
     "sources": ["yt_solomonk_calc", "muldo_calc", "sim"], "confidence": "medium"},
    {"id": "C-SEX-01", "title": "Sexe en déficit d'abord",
     "then": "Pour chaque couleur, capturer en priorité le sexe en déficit dans l'étable.",
     "sources": ["dragodinde_fr"], "confidence": "medium"},
    {"id": "C-FILL-01", "title": "Remplir les places",
     "then": "À chaque cycle, capturer de quoi remplir les places d'enclos libres (pas plus : une monture non fécondée immobilise de l'étable).",
     "sources": ["yt_solomonk_fullsucces", "sim"], "confidence": "medium"},
    {"id": "C-LOG-01", "title": "Journal des captures",
     "then": "Enregistrer couleur et sexe de chaque capture pour estimer les fréquences réelles par serveur (inconnues publiquement).",
     "sources": ["dofusdb"], "confidence": "high"},
    {"id": "C-SUCCESS-01", "title": "Succès de capture",
     "then": "Faire d'abord les succès de capture (5 Muldos, 4 Volkornes, 3 Dragodindes) : ~10 minutes.",
     "sources": ["dpln_guide"], "confidence": "high"},
    {"id": "C-MULTI-01", "title": "Multi-compte",
     "then": "Chaque compte a ses 6 enclos (60 places) ; un autre personnage du même compte n'en ajoute pas. Un compte principal avance les générations, les autres capturent et produisent N−1/N−2.",
     "sources": ["dpln_guide", "devblog2", "yt_solomonk_fullsucces"], "confidence": "high"},
    {"id": "C-ALMANAX-01", "title": "Almanax de capture",
     "then": "11/09 : +75 % XP au Territoire des Dragodindes Sauvages ; 01/04 : +50 % XP/butin sur les créatures marines (Muldos probablement).",
     "sources": ["dofusdb"], "confidence": "medium"},
    {"id": "C-BREAK-01", "title": "Surplus de Muldos/Volkornes",
     "then": "Monter vers le niveau 40–60 avec des Extraits de Mangeoire (1 extrait de 3 000 points ≈ 1 000 k par lot de 10) puis briser : Ga PM (Muldo, ~48 % au niv. ~53) ou Ga PA (Volkorne, ~38 % au niv. ~53).",
     "sources": ["yt_solomonk_muldo1000", "yt_solomonk_volk10000", "yt_solomonk_muldo_kamas"], "confidence": "medium"},
]

CAPTURE_ZONES = [
    {"family": "Dragodinde", "subareaId": 235, "subarea": "Territoire des dragodindes sauvages", "area": "Montagne des Koalaks", "maps": 87, "xRange": [-23, -11], "yRange": [-2, 9], "nearestZaap": {"name": "Village des Éleveurs", "coords": [-16, 1]}, "monsters": [{"id": 171, "name": "Dragodinde amande sauvage"}, {"id": 200, "name": "Dragodinde rousse sauvage"}, {"id": 666, "name": "Dragodinde dorée sauvage", "note": "uniquement ici"}, {"id": 2379, "name": "Draglida la Disparue", "archimonster": True}, {"id": 2465, "name": "Dragnoute l'Irascible", "archimonster": True}], "levels": [62, 70], "hp": [740, 900], "sources": ["dofusdb", "dpln_species"], "confidence": "high"},
    {"family": "Dragodinde", "subareaId": 170, "subarea": "Plaine des Scarafeuilles", "area": "Amakna", "maps": 82, "xRange": [-6, 5], "yRange": [21, 32], "nearestZaap": {"name": "Plaine des Scarafeuilles", "coords": [-1, 24]}, "monsters": [{"id": 171, "name": "Dragodinde amande sauvage"}, {"id": 200, "name": "Dragodinde rousse sauvage"}], "levels": [62, 70], "note": "listée par DofusDB, probablement un reste d'avant la 3.5", "sources": ["dofusdb"], "confidence": "low"},
    {"family": "Muldo", "subareaId": 1119, "subarea": "Bassin des Muldos", "area": "Baie de Sufokia", "maps": 37, "xRange": [16, 22], "yRange": [18, 23], "nearestZaap": {"name": "Rivage sufokien", "coords": [10, 22]}, "access": ["barque du Territoire des Bandits [15,19] puis corde", "échelle face au sous-marin de Sufokia [22,19]", "scaphandre de l'atelier des éleveurs de Sufokia [19,23]"], "monsters": [{"id": 4438, "name": "Muldo doré sauvage"}, {"id": 4437, "name": "Muldo pourpre sauvage"}, {"id": 4434, "name": "Muldo indigo sauvage"}, {"id": 4435, "name": "Muldo ébène sauvage"}, {"id": 4436, "name": "Muldo orchidée sauvage"}], "levels": [62, 70], "hp": [820, 1000], "sources": ["dofusdb", "dpln_species"], "confidence": "high"},
    {"family": "Volkorne", "subareaId": 886, "subarea": "Haras de Brâkmar", "area": "Brâkmar", "maps": 45, "xRange": [-33, -23], "yRange": [39, 45], "nearestZaap": {"name": "La Cuirasse", "coords": [-26, 37]}, "access": ["sortie sud de Brâkmar [-25,40]"], "monsters": [{"id": 5308, "name": "Volkorne orchidée sauvage"}, {"id": 5309, "name": "Volkorne indigo sauvage"}, {"id": 5311, "name": "Volkorne ébène sauvage"}, {"id": 5313, "name": "Volkorne pourpre sauvage"}], "levels": [62, 70], "hp": [820, 1000], "sources": ["dofusdb", "dpln_species"], "confidence": "high"},
]

NETS = [
    {"name": "Filet de capture universel", "jobLevel": 1, "family": None, "effect": "1 cible", "mountsPerCast": [1, 1], "ingredients": "10 Bois de Frêne + 10 Fer", "craftXpRatioPct": 50, "indicativeCost": {"kamas": 2000, "date": "2026-04", "source": "yt_solomonk_muldo_kamas", "confidence": "low"}},
    {"name": "Filet multiplicateur de [type]", "jobLevel": 100, "effect": "1 cible ×2 (couleur identique, sexe non garanti)", "mountsPerCast": [2, 2], "ingredients": "1 de chaque ressource de couleur + Bave/Griffe/Sueur + 5 Bois d'If + 5 Seigle/Viande Exsudative/Anguille", "indicativeCost": {"kamas": 1000, "date": "2026-09", "note": "ressources de monture droppées", "source": "yt_solomonk_volk10000", "confidence": "low"}},
    {"name": "Filet à [type] renforcé", "jobLevel": 150, "effect": "toutes les montures dans un cercle de rayon 3", "mountsPerCast": [1, 8], "typicalMountsPerCast": 6, "indicativeCost": {"kamas": 2100, "date": "2026-09", "source": "yt_solomonk_volk10000", "confidence": "low"}},
    {"name": "Filet multiplicateur de [type] renforcé", "jobLevel": 200, "effect": "zone de rayon 3 et ×2", "mountsPerCast": [2, 16], "typicalMountsPerCast": 12},
]

MOUNT_FATE_GRID = [
    {"order": 1, "if": "Féconde et utile à un croisement du plan, ou partenaire rare", "do": "keep", "label": "Garder"},
    {"order": 2, "if": "Féconde condamnée et une féconde de sexe opposé de même espèce l'est aussi", "do": "mate_then_process", "label": "Accoupler entre elles puis traiter les stériles"},
    {"order": 3, "if": "Stérile avec une autre stérile de même génération", "do": "clone", "label": "Cloner (même couleur d'abord)"},
    {"order": 4, "if": "Stérile isolée sans usage, génération ≥ 2", "do": "max(sell, extract, break)", "label": "Vendre / extraire / briser selon les prix"},
    {"order": 5, "if": "G10 dont le succès est validé", "do": "last_g10_mating_then_sell_or_extract", "label": "Dernier G10×G10 puis sortir"},
    {"order": 6, "if": "Surplus sans partenaire (ratio ♂/♀ bloquant)", "do": "bank_or_sell", "label": "Banque si réutilisée plus tard, sinon vente/extraction"},
    {"order": 7, "if": "Sénile (avant 3.5)", "do": "equip_or_level_or_extract_1", "label": "Équiper, monter, ou extraire (1 ressource)"},
    {"order": 8, "if": "Muldo/Volkorne G1 en surplus", "do": "level_40_60_then_break", "label": "Monter niv. 40–60 puis briser"},
]

FORMULAS = {
    "mountPointCost": "prix_carburant / durabilité / montures_éligibles (≤ 10)",
    "fecundityCostPerMount": "(60000 + points_sérénité_du_lot) / taille_lot × prix_point_moyen",
    "xpCostToLevel": "max(0, XP(L) − XP_actuelle) / taille_lot × prix_point_mangeoire",
    "captureCostPerMount": "prix_filet / montures_par_lancer − valeur_des_drops",
    "targetChance": "min(1, 0.30 + 0.0015 × (niv_A + niv_B) + opti(0.10 | 0.20 en 3.7) + takeza(0.20)) ; 1 si aucune autre issue",
    "expectedCostPerTargetBaby": "(C_A + C_B + makina − R) / p ; R = (1 − p) × valeur_moyenne_bébé_raté + valeur des 2 stériles",
    "optimakinaWorthIt": "prix_optimakina < C_eff × Δ / p",
    "levelWorthIt": "coût_XP(ΔL pour les 2 parents) < C_eff × 0.003 × ΔL / p",
    "genetonValue": "max sur la boutique d'Eugène Éton (prix_HDV_objet / coût_en_génétons), objets échangeables seulement",
    "sterileValue": "max(prix_vente, génération × prix_ressource_extraction, valeur_clone − coût_refécondation, valeur_brisage)",
    "jobCraftXp": "floor(20·L / ((J−L)^1.1/10 + 1) × ratio/100) ; ratio 5 (carburants, makinas, filets spécifiques), 50 (filet universel) ; 0 si J − 100 > L",
    "jobMatingXp": "k × (gen_A + gen_B) × nb_bébés ; k = 30 (3.6+), 10 (3.5)",
    "jobCaptureXp": "30 par monture capturée",
    "serenityEta": "simulation tick par tick : chaque tick de 10 s déplace la sérénité de 10/20/30/40 selon le palier courant de la jauge",
}

GENETON_SHOP = [
    {"item": "Petits Parchemins de caractéristique (×6 types)", "cost": 10}, {"item": "Aliton", "cost": 10, "exchangeable": False},
    {"item": "Parchemins de caractéristique", "cost": 50}, {"item": "Grands Parchemins de caractéristique", "cost": 100},
    {"item": "Tourmaline", "cost": 130, "exchangeable": True}, {"item": "Puissants Parchemins de caractéristique", "cost": 160, "exchangeable": True,
     "observedPrice": [{"kamas": 20000, "date": "2026-03", "note": "lancement 3.5"}, {"kamas": 60000, "date": "2026-09", "note": "stable depuis plusieurs mois, pic 80–90 k", "source": "yt_solomonk_volk10000"}]},
]

COMMUNITY_PRICE_POINTS = [
    {"what": "Rune Ga PM", "kamas": 13400, "date": "2026-04", "source": "yt_solomonk_muldo_kamas", "confidence": "low"},
    {"what": "Rune Ga PA", "kamas": 33000, "date": "2026-09", "source": "yt_solomonk_volk10000", "confidence": "low"},
    {"what": "Extrait de Mangeoire (3 000 points)", "kamas": 900, "date": "2026-04", "source": "yt_solomonk_muldo_kamas", "confidence": "low"},
    {"what": "Extrait de Mangeoire (3 000 points)", "kamas": 1000, "date": "2026-05", "source": "yt_solomonk_muldo1000", "confidence": "low"},
    {"what": "Filet de capture universel", "kamas": 2000, "date": "2026-04", "source": "yt_solomonk_muldo_kamas", "confidence": "low"},
    {"what": "Filet multiplicateur (ressources de monture droppées)", "kamas": 1000, "date": "2026-09", "source": "yt_solomonk_volk10000", "confidence": "low"},
    {"what": "Filet renforcé", "kamas": 2100, "date": "2026-09", "source": "yt_solomonk_volk10000", "confidence": "low"},
    {"what": "Muldo G10 « Marine » 1 PM niveau 200", "kamas": 15000000, "date": "2026-04", "source": "yt_solomonk_1mois", "confidence": "low"},
    {"what": "Puissant Parchemin de caractéristique", "kamas": 60000, "date": "2026-09", "source": "yt_solomonk_volk10000", "confidence": "low"},
    {"what": "Morpion de Truchideur (ingrédient de potion de Mangeoire)", "kamas": 6800, "date": "2026-03", "source": "yt_solomonk_calc", "confidence": "low"},
    {"what": "Marge hebdomadaire d'un éleveur (17–23/03/2026)", "kamas": [520000, 1240000], "date": "2026-03", "source": "dafous", "confidence": "low"},
    {"what": "Récolte d'un cycle (étable de 250 Muldos)", "kamas": 3000000, "date": "2026", "source": "dragodinde_fr", "confidence": "low"},
]

COMMON_MISTAKES = [
    {"id": "X01", "mistake": "Laisser un Baffeur/Caresseur actif sans surveillance", "consequence": "montures à ±5 000, phases à refaire", "fix": "alarme + coupure à distance (E-SER-ALARM)", "sources": ["dpln_guide"]},
    {"id": "X02", "mistake": "Enclos à moitié vide avec une jauge active", "consequence": "rendement du carburant = éligibles/10", "fix": "E-FULL-01", "sources": ["dpln_guide", "dafous", "yt_solomonk_muldo_aventure"]},
    {"id": "X03", "mistake": "Jauge incompatible avec la sérénité du lot", "consequence": "rien n'avance", "fix": "tables de groupes", "sources": ["dafous"]},
    {"id": "X04", "mistake": "Lot hétérogène (> 2 000 d'écart de sérénité)", "consequence": "des montures sortent de la zone utile", "fix": "E-GROUP-01", "sources": ["mechanics"]},
    {"id": "X05", "mistake": "Palier 4 permanent et Élixirs pour tout", "consequence": "coût au point maximal, jauge vide en 42 min", "fix": "E-TIER-NIGHT / E-TIER-DAY", "sources": ["dpln_guide", "yt_solomonk_secret"]},
    {"id": "X06", "mistake": "Monter tous les parents au niveau 200", "consequence": "60–150 h d'XP par lot, places bloquées", "fix": "M-LEVEL-01", "sources": ["dpln_guide", "devblog2", "sim"]},
    {"id": "X07", "mistake": "Ne pas cloner, vendre toutes les stériles", "consequence": "×80 à ×100 de captures dès la G7", "fix": "M-CLONE-01", "sources": ["dpln_guide", "sim"]},
    {"id": "X08", "mistake": "Extraire/vendre une monture utile à une lignée", "consequence": "rupture de chaîne", "fix": "grille de décision", "sources": ["dafous", "dpln_guide"]},
    {"id": "X09", "mistake": "Extraire deux fécondes sans les accoupler d'abord", "consequence": "bébé et XP perdus", "fix": "M-FREEBABY-01", "sources": ["dragodinde_fr"]},
    {"id": "X10", "mistake": "Oublier l'Optimakina en haute génération", "consequence": "jusqu'à ~2× plus de tentatives", "fix": "M-OPTI-01", "sources": ["dafous", "sim"]},
    {"id": "X11", "mistake": "Makina de génération < génération cible", "consequence": "inutilisable", "fix": "M-MAKGEN-01", "sources": ["dpln_guide"]},
    {"id": "X12", "mistake": "Parents dont l'arbre contient une génération ≥ cible", "consequence": "bonus partagé, 0 généton", "fix": "M-CLEAN-01", "sources": ["dpln_guide", "mechanics"]},
    {"id": "X13", "mistake": "Tenter une génération avec un seul couple", "consequence": "~58 % d'échec à 42 %", "fix": "M-STACK-01", "sources": ["yt_chikkin", "yt_solomonk_fullsucces"]},
    {"id": "X14", "mistake": "Ignorer les sexes à la capture", "consequence": "couleurs bloquées (ex. 80 ♂ / 40 ♀)", "fix": "C-SEX-01", "sources": ["dragodinde_fr"]},
    {"id": "X15", "mistake": "Garder ses G10 après les succès", "consequence": "places bloquées, génétons en baisse", "fix": "M-G10OUT-01", "sources": ["dragodinde_fr"]},
    {"id": "X16", "mistake": "Accoupler depuis l'inventaire ou un enclos", "consequence": "impossible", "fix": "M-STABLE-01", "sources": ["dpln_guide"]},
    {"id": "X17", "mistake": "Acheter au prix fort ressources de filets/carburants", "consequence": "rentabilité détruite", "fix": "droppers soi-même, acheter hors pic", "sources": ["yt_solomonk_muldo_kamas", "yt_solomonk_secret"]},
    {"id": "X18", "mistake": "Suivre de vieux tutoriels (gestation, fatigue, énergie, « 2 reproductions », dorées plus lentes)", "consequence": "plans faux", "fix": "règles 3.5+ uniquement", "sources": ["dpln_guide", "nextstage", "dragodinde_fr"]},
    {"id": "X19", "mistake": "Compter sur les montures d'avant la 3.5", "consequence": "séniles : ni accouplement ni clonage", "fix": "les extraire ou les équiper", "sources": ["dpln_guide"]},
    {"id": "X20", "mistake": "Consommer ses Animakinas juste avant la 3.7", "consequence": "perte d'un futur outil de choix du sexe", "fix": "M-ANIMA-36", "sources": ["devblog37"]},
]

DAILY_ROUTINE = {
    "twoSessions": [
        {"when": "matin", "steps": ["accouplements (par génération, makinas)", "clonages", "reposer bébés/clones/captures par sérénité", "traversées de 0 (Caresseur/Baffeur + Mangeoire) avec alarme", "3e statistique + Mangeoire, palier 2–3"]},
        {"when": "midi (option)", "steps": ["couper les jauges de sérénité arrivées (à distance)", "recharger paliers 2–3", "captures pour les places libres"]},
        {"when": "soir", "steps": ["accouplements des lots finis + clonages", "nouveaux lots en phase double", "jauges de statistiques à 20 000–40 000 en Extraits (palier 1)", "aucune jauge de sérénité active la nuit"]},
    ],
    "weekly": ["audit carburants et filets", "audit lignées (goulots, sexes, stériles isolées, G10 à sortir)", "capture ciblée", "ventes (G8–G10, ressources d'extraction, runes)", "planning almanax"],
    "sources": ["dafous", "dragodinde_fr", "dpln_guide"],
}

ALMANAX = [
    {"date": "2026-10-10", "name": "Benjo – Montures sages", "effect": "bébés Sage", "use": "accouplements dont on garde/vend les bébés"},
    {"date": "2026-10-12", "name": "Takeza – Génération montante", "effect": "+20 % génération cible", "use": "accouplements à fort enjeu"},
    {"date": "2026-10-22", "name": "Expérience des métiers", "effect": "+50 % XP Éleveurs", "use": "crafts de montée"},
    {"date": "2026-11-10", "name": "Otoul – Montures précoces", "effect": "bébés Précoce"},
    {"date": "2026-12-10", "name": "Foya – Efficacité des enclos", "effect": "Dragofesse ×2", "use": "phases d'amour"},
    {"date": "2027-01-10", "name": "Trôma", "effect": "Abreuvoir ×2", "use": "phases de maturité"},
    {"date": "2027-02-10", "name": "Meash", "effect": "bébés Endurante"},
    {"date": "2027-03-10", "name": "Inndo", "effect": "Foudroyeur ×2", "use": "phases d'endurance"},
    {"date": "2027-04-01", "name": "Créatures marines", "effect": "+50 % XP et butin (créatures marines)", "use": "captures de Muldos (probable)"},
    {"date": "2027-04-10", "name": "Nunu", "effect": "Baffeur ×2"},
    {"date": "2027-05-01", "name": "Fabrique Féérique", "effect": "+50 % XP tous métiers", "use": "crafts"},
    {"date": "2027-05-10", "name": "Loumi", "effect": "−15 % d'ingrédients (Éleveurs)", "use": "crafts chers"},
    {"date": "2027-06-10", "name": "Jibejan", "effect": "Mangeoire ×2", "use": "XP des montures"},
    {"date": "2027-07-10", "name": "Jihelair", "effect": "bébés Amoureuse"},
    {"date": "2027-08-10", "name": "Rigamix", "effect": "25 % de chances de double craft (Éleveurs)", "use": "makinas, carburants chers"},
    {"date": "2027-09-10", "name": "Mau", "effect": "Caresseur ×2"},
    {"date": "2027-09-11", "name": "Points d'expérience", "effect": "+75 % XP au Territoire des Dragodindes Sauvages", "use": "captures de Dragodindes"},
    {"date": "2027-10-11", "name": "Takeza", "effect": "+20 % génération cible"},
    {"date": "2027-10-22", "name": "Expérience des métiers", "effect": "+50 % XP Éleveurs"},
]

VERSION_37 = {
    "status": "bêta depuis le 2026-09-17 (client 3.7.3.3) ; date live inconnue (probablement automne 2026, la 3.8 étant annoncée pour nov.–déc.)",
    "confidenceDate": "low",
    "changes": ["carburants ×2 (durabilité)", "jauges ×2 (80k/140k/180k/200k, ticks inchangés : palier 1 = 22 h 13)", "génétons ×2 (2 → 500)", "Optimakina +20 %", "Animakina = choix du sexe (stocks convertis)", "capacités aléatoires sans makina : Reproductrice 3 %, Sage 6 %, Précoce/Amoureuse/Endurante 8 %", "étable 500", "clone conserve la sérénité", "recettes de makinas revues", "PNJ de guilde : ressources d'élevage 15 → 30", "fenêtre de confirmation au remplissage", "relance rapide accouplement/clonage, transfert auto entre enclos, filtres de fertilité combinables"],
    "strategyBefore37": ["garder les Animakinas", "reporter les gros accouplements G8/G9 si la sortie est proche (génétons ×2)", "les stocks de carburants devraient doubler (non confirmé)"],
    "sources": ["devblog37", "mechanics", "crafts", "guidactik"],
}

TOOLS_REVIEW = [
    {"tool": "DPLN Gestion d'enclos", "source": "dpln_tool", "features": ["6 enclos × 10 montures", "2 jauges, Baffeur/Caresseur exclusifs", "boutons T1/T2/T3/T4 max", "valeur de départ par monture", "capacité ×2", "sérénité cible (Caresseur 0, Baffeur −1)", "niveau cible Mangeoire (table XP 1–200)", "simulation tick par tick", "compte à rebours et heure d'arrivée", "alerte sonore", "avertissement « jauge vide avant la fin »", "bannière almanax (actif + à venir)", "sauvegarde locale"], "missing": ["éligibilité par zone de sérénité", "coûts", "planification de lots et d'accouplements"]},
    {"tool": "dragodinde.fr", "source": "dragodinde_fr", "features": ["étable par compteurs (total + mâles)", "import par capture d'écran via LLM", "modes Succès / Génétons", "plan par étapes : Reproduire, Plan d'action (captures par couleur/sexe/proportion, retraits), taux de réussite", "banque IN/OUT", "resynchronisation"], "missing": ["généalogies individuelles", "coûts en kamas"], "errors": ["guide Muldo : énergie, « 2 reproductions par monture »", "maturité entre −1 000 et +1 000"]},
    {"tool": "Registre des Abysses", "source": "registre", "features": ["cheptel avec généalogie", "synchronisation OCR", "GPS d'appariement ♂/♀ maximisant les couples utiles", "assistant de clonage", "noms générés pour renommage en jeu", "calculateur de carburant (moins cher pour 1 000 points, rentabilité/heure)", "valeur du cheptel, prix communautaires par serveur", "partage public, forum"], "missing": ["ordonnancement des enclos et alarmes", "porteurs"]},
    {"tool": "muldo-calculator", "source": "muldo_calc", "features": ["cascade de bébés attendus", "paramètres niveau/Optimakina/clonage/Reproducteur par génération", "Veilleur des Enclos"], "missing": ["recyclage des bébés ratés", "Dragodindes/Volkornes"]},
    {"tool": "dofuselevage.fr", "source": "dofuselevage", "features": ["simulateur de reproduction", "roadmap succès génération en génération", "calculateur de fécondité (ordre optimal, conversion en carburants)", "calculateur d'XP"], "errors": ["niveaux de filets 100/150 inversés", "amour à partir de 1"]},
    {"tool": "dafous.app", "source": "dafous", "features": ["simulateur en cascade", "arbres", "enclos & carburants", "almanax", "checklists", "pack métier 1→200", "journal .xls"], "errors": ["partage égal entre cibles", "XP d'accouplement 10 (3.5)"]},
    {"tool": "FabEnclos", "source": "fabenclos", "features": ["plan de captures et croisements vers une cible", "multi-éleveurs"], "errors": ["le niveau ne changerait pas le bébé (faux)"]},
]

DISAGREEMENTS = [
    {"topic": "Niveau idéal des parents", "A": "dragodinde.fr : pas au-delà de 40", "B": "next-stage : au moins 100 ; Solomonk : 50–60", "retained": "40 par défaut, 100 pour les parents chers"},
    {"topic": "Zone de maturité", "A": "dragodinde.fr/next-stage : ±1 000", "B": "client/DPLN/devblog : ±2 000", "retained": "±2 000"},
    {"topic": "Niveaux des filets", "A": "devblog II/dofuselevage : renforcé 100, multiplicateur 150", "B": "jeu/DPLN : multiplicateur 100, renforcé 150", "retained": "jeu"},
    {"topic": "XP d'accouplement", "A": "dafous/next-stage : 10", "B": "client 3.6/DPLN : 30", "retained": "30 (3.6)"},
    {"topic": "Génétons échangeables", "A": "DPLN/devblog : liés au compte", "B": "DofusDB (effet 983 « Échangeable : date »), dragodinde.fr", "retained": "à vérifier"},
    {"topic": "Brisage des montures", "A": "devblog II : impossible", "B": "Solomonk-e : démontré (11 000 montures)", "retained": "possible (3.5/3.6)"},
    {"topic": "Optimakina", "A": "dafous : Gen 7+ seulement", "B": "simulation : partout si bon marché", "retained": "règle de prix"},
    {"topic": "Barème de crafts", "A": "dofus-portals (dofustool)", "B": "formule du jeu (~7 000 crafts 1→200)", "retained": "formule"},
]

OPEN_QUESTIONS = [
    "Fréquences des couleurs sauvages, taille des groupes, réapparition",
    "XP de capture des doublons (filet multiplicateur)",
    "Niveau conservé au clonage ?",
    "Génétons liés au compte ou échangeables après délai ?",
    "Effet exact des jours « effet doublé » et cumul avec une capacité",
    "Archimonstres Draglida/Dragnoute capturables ?",
    "Date de sortie 3.7, conversion des stocks de carburants et d'Animakinas",
    "Prix réels des makinas basses générations (décide de « Optimakina partout »)",
    "PNJ de guilde vendant des ressources d'élevage : lesquelles, quelle monnaie ?",
    "Rendement du brisage selon niveau et couleur",
]


def load_sim():
    r1 = json.load(open(EV + '/sim/pyramid-results.json'))
    r2 = json.load(open(EV + '/sim/pyramid-results-v2.json'))
    det = json.load(open(EV + '/sim/deterministic-tables.json'))
    def slim(x):
        keys = ['captures', 'matings', 'clones', 'raises', 'cycles', 'genetons', 'optimakinas', 'stat_fuel_points', 'xp_fuel_points']
        return {k: {'mean': x[k]['mean'], 'p90': x[k]['p90']} for k in keys if k in x}
    out1 = {fam: {t: {s: slim(v) for s, v in d.items()} for t, d in ts.items()} for fam, ts in r1['results'].items()}
    out2 = {fam: {t: {s: slim(v) for s, v in d.items()} for t, d in ts.items()} for fam, ts in r2['results'].items()}
    return {
        "method": "Monte-Carlo, 40 tirages (5 pour G7 sans clonage), politique pilotée par la demande, clonage systématique (sauf mention), 1 cycle = 1/2 journée = 1 lot fécondé, captures limitées aux places libres ; modèle de probabilités validé (mechanics).",
        "caveats": ["joueur parfait (2 sessions/jour) : multiplier les durées par ~1,5–2", "pas de porteurs ni d'achats/ventes", "XP au-delà du niveau 40 à 3 XP/s en moyenne, dans les places d'enclos", "niveau 200 : chiffres de captures gonflés par la politique de remplissage des places"],
        "scenarioKeys": {"L1_noopti_clone": "niveau 1, sans makina, clonage", "L1_noopti_noclone": "niveau 1, sans clonage", "L40_noopti_clone": "niveau 40", "L40_opti_clone": "niveau 40 + Optimakina partout", "L60_noopti_clone": "niveau 60", "L40_noopti_clone_20slots": "niveau 40, 2 enclos", "L100_noopti_clone": "niveau 100", "L100_opti_clone": "niveau 100 + Optimakina", "L200_opti_clone": "niveau 200 + Optimakina", "L40_opti20_clone_v37": "3.7 : niveau 40 + Optimakina 20 % partout",
                         "L1_noopti": "niveau 1", "L40_noopti": "niveau 40", "L40_opti_from_G6": "niveau 40, Optimakina dès la cible G6", "L40_opti_all": "niveau 40, Optimakina partout", "mixed_L40_60_100_opti_from_G8": "niveaux 40/60/100 selon la génération, Optimakina dès G8", "v37_L40_opti20_from_G6": "3.7 : niveau 40, Optimakina 20 % dès G6"},
        "grid1": out1,
        "grid2_withFuel": out2,
        "deterministic": det,
        "keyFindings": [
            "Clonage indispensable : sans lui une G7 demande ~14 000–18 000 captures au niveau 1.",
            "Niveau 40 ≈ ÷3 à ÷4 sur captures, accouplements et carburant par rapport au niveau 1.",
            "Optimakina partout : −40 à −65 % supplémentaires, au prix d'une makina par accouplement ; dès G6 seulement : −20 à −48 %.",
            "Niveau 100 : moins de captures mais plus lent (places immobilisées par l'XP).",
            "G9 : ~110–190 captures, ~400–800 accouplements, ~5–11 M de points de carburant, ~40–56 demi-journées à 6 enclos (joueur parfait).",
            "G10 la moins chère ≈ G9 + 10 à 30 %.",
        ],
        "sources": ["sim", "mechanics"],
        "confidence": "medium",
    }


JOB_LEVELING_PLAN = [
    {"from": 1, "to": 5, "xpNeeded": 200, "recipes": ["Filet de capture universel (niv. 1, 10 XP)"], "craftsCumulative": 26, "resourcesCumulative": 520, "unlocks": ["Extraits (niv. 5)"], "alternatives": "7 captures"},
    {"from": 5, "to": 15, "xpNeeded": 1900, "recipes": ["Minuscule Extrait (niv. 5)"], "craftsCumulative": 790, "resourcesCumulative": 2048, "unlocks": ["Petit Extrait (15)"], "alternatives": "~63 captures ou 32 accouplements G1×G1"},
    {"from": 15, "to": 40, "xpNeeded": 13500, "recipes": ["Petit Extrait (15)", "Extrait (25)", "Grand Extrait (35)"], "craftsCumulative": 1739, "resourcesCumulative": 3946, "unlocks": ["2e enclos (40)"], "alternatives": "450 captures / 56 accouplements G4×G4"},
    {"from": 40, "to": 55, "xpNeeded": 14100, "recipes": ["Gigantesque Extrait (45)"], "craftsCumulative": 2317, "resourcesCumulative": 5102, "unlocks": ["Philtres – palier 2 (55)"]},
    {"from": 55, "to": 80, "xpNeeded": 33500, "recipes": ["Minuscule/Petit/Philtre (55–75)"], "craftsCumulative": 3122, "resourcesCumulative": 7517, "unlocks": ["3e enclos (80)"]},
    {"from": 80, "to": 100, "xpNeeded": 35800, "recipes": ["Grand/Gigantesque Philtre (85–95)"], "craftsCumulative": 3782, "resourcesCumulative": 9497, "unlocks": ["Filet multiplicateur (100)"]},
    {"from": 100, "to": 120, "xpNeeded": 43800, "recipes": ["Minuscule/Petite Potion (105–115)"], "craftsCumulative": 4434, "resourcesCumulative": 11903, "unlocks": ["4e enclos (120)", "Potions – palier 3 (105)"]},
    {"from": 120, "to": 150, "xpNeeded": 80700, "recipes": ["Potion/Grande/Gigantesque Potion (125–145)"], "craftsCumulative": 5402, "resourcesCumulative": 15775, "unlocks": ["Filet renforcé (150)"]},
    {"from": 150, "to": 160, "xpNeeded": 30900, "recipes": ["Gigantesque Potion (145)", "Minuscule Élixir (155)"], "craftsCumulative": 5721, "resourcesCumulative": 17175, "unlocks": ["Élixirs – palier 4 (155)", "5e enclos (160)"]},
    {"from": 160, "to": 200, "xpNeeded": 143600, "recipes": ["Élixirs (165–195)"], "craftsCumulative": 6993, "resourcesCumulative": 23535, "unlocks": ["6e enclos (200)", "Filet multiplicateur renforcé (200)"]},
]
JOB_LEVELING_NOTES = {
    "method": "Craft de la taille de carburant la plus récemment débloquée (une tous les 10 niveaux) ; formule d'XP du client (ratio 5 %) ; table DPLN 10·L·(L−1). Pack Tenmalexis/dafous vérifié : 26 filets + 6 996 carburants ≈ 23 600 ressources → niveau 200.",
    "xpSources": {"craft": "L XP au niveau L, ~45 % à L+9", "mating_3_6": "30 × (gen A + gen B) × bébés", "capture": "30 par monture"},
    "chainXp": "Une chaîne jusqu'à une G9 (niveau 40) rapporte ~35 000–105 000 XP d'accouplement et 3 000–6 000 XP de capture (simulation).",
    "variants": {
        "rush": "acheter le pack complet (~23 600 ressources) ; ou version éco : 768 × le Minuscule Extrait le moins cher pour 1→15 puis la recette la moins chère de chaque palier",
        "progressive": "captures + accouplements au début, crafts des carburants réellement consommés au palier débloqué, Optimakinas crafties à leur niveau",
    },
    "fuelMixDuringLeveling": {"foudroyeur": 0.23, "abreuvoir": 0.23, "dragofesse": 0.23, "mangeoire": 0.23, "caresseur": 0.04, "baffeur": 0.04},
    "almanax": ["22/10 +50 % XP Éleveurs", "01/05 +50 % XP tous métiers", "10/05 −15 % d'ingrédients", "10/08 25 % de double craft"],
    "milestones": [{"level": 40, "why": "2e enclos"}, {"level": 80, "why": "3e enclos"}, {"level": 100, "why": "filet multiplicateur"}, {"level": 120, "why": "4e enclos (objectif minimal DPLN)"}, {"level": 150, "why": "filet renforcé"}, {"level": 160, "why": "5e enclos"}, {"level": 200, "why": "6e enclos + filet multiplicateur renforcé"}],
    "sources": ["dpln_guide", "crafts", "mechanics", "yt_tenmalexis_pack", "dafous", "sim"],
    "confidence": "high",
}


def main():
    data = {
        "meta": {
            "title": "ElevageSimu – stratégie d'élevage optimisée (Dofus 3.5+)",
            "generated": datetime.date(2026, 10, 1).isoformat(),
            "rulesets": {"current": "3.6", "historical": "3.5", "beta": "3.7"},
            "confidenceLegend": {"high": "donnée du jeu, devblog, capture in-game", "medium": "source communautaire fiable ou calcul sur modèle validé", "low": "témoignage isolé, hypothèse"},
            "conditionDsl": "when = prédicat {field, op (lt|le|gt|ge|eq|between|in), value} ou {all:[…]} / {any:[…]} ; value peut référencer un autre champ (ex. 'pair.targetGeneration')",
            "related": ["research/strategy.md", "research/data/mechanics.json", "research/data/crafts.json", "research/data/tree-*.json"],
            "builder": "research/raw/strategy-evidence/build_strategy_json.py",
        },
        "phases": PHASES,
        "paddockRules": PADDOCK_RULES,
        "paddockAllocationByCount": ALLOCATION_BY_PADDOCKS,
        "matingRules": MATING_RULES,
        "captureRules": CAPTURE_RULES,
        "captureZones": CAPTURE_ZONES,
        "nets": NETS,
        "jobLevelingPlan": JOB_LEVELING_PLAN,
        "jobLevelingNotes": JOB_LEVELING_NOTES,
        "mountFateGrid": MOUNT_FATE_GRID,
        "formulas": FORMULAS,
        "genetonShop": GENETON_SHOP,
        "communityPricePoints": COMMUNITY_PRICE_POINTS,
        "dailyRoutine": DAILY_ROUTINE,
        "almanaxCalendar": ALMANAX,
        "version37": VERSION_37,
        "simulation": load_sim(),
        "toolsReview": TOOLS_REVIEW,
        "disagreements": DISAGREEMENTS,
        "commonMistakes": COMMON_MISTAKES,
        "openQuestions": OPEN_QUESTIONS,
        "sources": SOURCES,
    }
    # sanity: every referenced source id exists
    ids = {s['id'] for s in SOURCES}
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ('sources',) and isinstance(v, list):
                    for s in v:
                        assert s in ids, f'unknown source {s}'
                elif k == 'source' and isinstance(v, str) and not v.startswith('http'):
                    assert v in ids, f'unknown source {v}'
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk({k: v for k, v in data.items() if k != 'sources'})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(data, open(OUT, 'w'), ensure_ascii=False, indent=1)
    print('written', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
