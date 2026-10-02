# Preuves — mécaniques d'élevage (agent « mécaniques », 2026-10-01)

Pièces justificatives de `research/mechanics.md` et `research/data/mechanics.json`.

- `breeding_model_reference.py` — implémentation de référence du modèle de probabilités 3.5+ ; `python3 breeding_model_reference.py` reproduit les 4 captures ci-dessous.
- `screenshots/` — captures in-game issues du guide DPLN (https://www.dofuspourlesnoobs.com/guide-de-l-eleveur.html) : interfaces d'accouplement (ex1 à ex4), XP de craft, XP d'accouplement, PNJ Adèle Vage et Eugène Éton, clonage.
- `texts/` — devblogs Ankama sur l'élevage (I : 27/02/2025, II : 28/04/2025, 3.7 : 16/09/2026) et page « ancien système » (felis-silvestris).
- `client-data/`
  - `breeding-constants-by-client-version.json` — XP d'accouplement, génétons et paliers de jauges par version du client (3.5.3.1 → 3.6.12.16, bêta 3.7.3.3), décodés depuis le CDN Ankama avec `raw/dofus-client/tools`.
  - `breeding-item-effects-3.6.12.16.json` / `-3.7.3.3-beta.json` — effets des carburants, makinas et filets (identifiant d'objet → [effectId, diceNum, diceSide, value]).
  - `eleveur-recipes-3.7.3.3-beta.json` — recettes Éleveur de la bêta 3.7 (74 recettes de makinas modifiées).
  - `dofusdb-almanax-breeding-and-jobs.json` — bonus Almanax liés à l'élevage et aux métiers (DofusDB).
  - `dpln-xp-tables.json` — tables d'XP monture, métier et familier de DPLN.
