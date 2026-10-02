# Données extraites du client officiel Dofus 3 (Unity)

Extraites le 2026-10-01 par l'agent « arbre Dragodindes » (ElevageSimu), directement depuis le CDN Ankama.

- Live : `https://cytrus.cdn.ankama.com/dofus/releases/dofus3/linux/6.0_3.6.12.16.manifest` (version 3.6.12.16 = version live au 2026-10-01, même version que DofusDB `/version`).
- Bêta : `https://cytrus.cdn.ankama.com/dofus/releases/beta/linux/6.0_3.7.3.3.manifest` (3.7.3.3).
- Index des versions : `https://cytrus.cdn.ankama.com/cytrus.json`.

Méthode (outils dans `tools/`) :
1. `cytrus.py <manifest> <index.json>` : décode le manifeste FlatBuffers (fragments -> fichiers -> chunks -> bundles).
2. `fetchfile.py <index.json> <outdir> <nom_de_fichier>...` : télécharge un fichier du jeu par requêtes HTTP Range dans les bundles du CDN (vérification SHA-1 OK).
3. `dumpbundle.py <outdir> <bundle>...` : lit l'AssetBundle Unity avec UnityPy (`FALLBACK_UNITY_VERSION=2022.3.42f1`, typetree présent) et écrit le MonoBehaviour `*DataRoot` en JSON.

Fichiers (champ `data` = liste d'objets du jeu) :

| Fichier | Table client | Contenu |
|---|---|---|
| `rides-<ver>.json` | `Core.DataCenter.Metadata.Ride.RidesData` | 308 montures élevables (speciesId 1 = Dragodinde, 2 = Muldo, 3 = Volkorne, cf. `ride-species`) : `id` (= id DofusDB /mounts), `generation` (0 = spéciale non reproductible), `parents` (liste de paires = TOUS les croisements possibles), `children`, `geneticWeight`, `linkedItemGid` (objet-monture 3.5, DofusDB items), `extractionRewardQuantity`, `breedingTokenRewardQuantity` (génétons par parent), `breedingExperienceRewardQuantity` (XP métier par parent). |
| `evolutive-effects-<ver>.json` | `EvolutiveEffects` (filtré aux objets 33000-33999) | `actionId` (= effectId), `targetId` (objet-monture), `progressionPerLevelRange` = [[100, p1], [200, p2]] : gain par niveau jusqu'au niveau 100 puis du 101 au 200 (arrondi à 6 décimales, valeurs float32 à l'origine). |
| `paddock-gauges-<ver>.json` | `PaddockGaugesData` | Jauges d'enclos (SLAPPER = baffeur, PATTER = caresseur, BLASTER = foudroyeur, DRINKING_TROUGH = abreuvoir, DRAGO_BUTT = dragofesse, FEEDER = mangeoire) : plafond de chaque palier et consommation par tick. |
| `ride-gauges-<ver>.json` | `RideGaugesData` | Jauges de la monture (1 amour, 2 maturité, 3 endurance — déduit des bornes de sérénité) : max 20 000, intervalles de sérénité. |
| `ride-species-3.6.12.16.json` | `RideSpeciesData` | Espèces et ressource d'extraction (33515 Neurone de dragodinde, 17864 Ambre de muldo, 19975 Corne de volkorne). |
| `evolutive-item-types-3.6.12.16.json` | `EvolutiveItemTypes` | Types évolutifs (maxLevel, table d'XP) — non exploité ici. |

Différences 3.6.12.16 -> 3.7.3.3 bêta constatées : seul `breedingTokenRewardQuantity` change dans RidesData (génétons ~x2) et les paliers des jauges d'enclos doublent (80 000/140 000/180 000/200 000). EvolutiveEffects et RideGauges identiques.
