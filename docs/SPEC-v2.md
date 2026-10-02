# ElevageSimu v2 — profils multi-serveurs, prix HDV par CSV, modes de rentabilité, estimateur d'investissement

Spécification produit et technique partagée par toutes les tranches de la v2. Elle complète
`docs/ARCHITECTURE.md` (contrats existants) et `research/README.md` (règles du jeu).

Demande du joueur (résumé) :
1. **Prix HDV par CSV** : importer un export CSV de l'HDV d'un serveur (prix actualisés de tous les objets en
   vente) pour chiffrer toutes les ressources, carburants, makinas, filets, montures… Chaque serveur a sa
   propre économie : l'import se fait **par serveur**. Un fichier réel est fourni : serveur **Tylezia**,
   02/10/2026 (`research/raw/hdv/tylezia-2026-10-02.csv`, non versionné ; ~9 745 lignes).
2. **Profils** : plusieurs élevages sur plusieurs serveurs ; chaque serveur a ses propres valeurs (prix,
   montures, etc.).
3. **Modes de rentabilité** : ex. « Rush Volkorne » = produire le plus de Volkornes possible pour obtenir le
   plus de **Corne de volkorne** possible et rentabiliser ; un mode par ressource (Corne de volkorne, Ambre de
   muldo, Neurone de dragodinde) ; d'autres modes utiles sont bienvenus (brisage, vente de montures…).
4. **Estimation d'investissement** : le joueur indique un budget (ex. 20 M de kamas) ; l'application propose
   le **plan d'action pour être rentable le plus vite possible**, avec une **feuille de route**, le **délai de
   retour sur investissement** et la **rentabilité journalière** possible.

## 1. Format CSV HDV (source : export du joueur)

En-tête (séparateur `;`, UTF-8, sans guillemets dans l'exemple) :

```
gid;nom;niveau;type;categorie;vendus_24h;vendus_7j;vendus_30j;median_30j;moyen_30j;median_24h;kamas_par_jour
```

- `gid` = **id d'objet DofusDB / client** (le même que nos `itemId`, ids d'ingrédients, carburants, makinas,
  filets, objets-montures 33000–33308, ressources d'extraction 33515/17864/19975…).
- `median_30j`, `moyen_30j`, `median_24h` : prix unitaires en kamas (0 = pas de vente sur la période).
- `vendus_24h/7j/30j` : nombre d'unités vendues ; `kamas_par_jour` : volume d'échange quotidien en kamas.
- Couverture mesurée sur Tylezia : 471/471 ingrédients, 120/120 carburants, 74/81 makinas, 10/10 filets,
  307/308 objets-montures, Neurone 26 056 (2 203 vendus/24 h), Ambre 33 823 (2 410/24 h), **Corne 30 205
  (10 744/24 h)**, Rune Ga Pa 29 534, Rune Ga Pme 21 460, Puissants Parchemins ≈ 66–69 k, Tourmaline 44 355,
  Pépite 290.
- **Piège des montures** : le prix d'un objet-monture mélange niveaux, états (fertile/stérile) et montures
  **séniles** (d'avant la 3.5, extraction = 1 ressource). Des G8–G10 « bradées » (24–40 k) sont très
  probablement séniles. Un prix de monture issu du CSV est donc une **indication de marché** (badge
  « HDV mixte : niveau/sénilité non distingués »), jamais une opportunité d'extraction automatique.
- Le parseur doit être tolérant : BOM, séparateur `;` ou `,` ou tabulation, guillemets, en-têtes en
  minuscules/majuscules, alias (`id`/`gid`, `name`/`nom`, `median_30d`…), nombres avec espaces ou virgules,
  lignes vides ou incomplètes (ignorées et comptées).

## 2. Profils et serveurs

- **Serveur** : `{ id, name }` (ex. « Tylezia »). Il porte l'**économie** : prix saisis à la main et
  **instantanés de marché** importés (CSV).
- **Profil** : `{ id, name, serverId, createdAt, color? }` = un élevage (un compte sur un serveur). Il porte :
  réglages, montures, enclos, plans d'enclos, avancement du plan, journal, préférences d'interface. Plusieurs
  profils peuvent partager un serveur (ils partagent alors ses prix).
- **Stockage** (localStorage) :
  - registre : `elevagesimu:profiles` → `{ version, activeProfileId, profiles[], servers[] }` ;
  - données de profil : `elevagesimu:p:<profileId>:<store>` (settings, inventory, paddocks, paddockPlans,
    planProgress, journal, préférences d'interface des pages) ;
  - données de serveur : `elevagesimu:s:<serverId>:prices` (prix saisis) et `elevagesimu:s:<serverId>:market`
    (instantané CSV courant, compact) + `elevagesimu:s:<serverId>:market-history` (métadonnées des imports
    précédents et quelques prix clés pour suivre l'évolution).
- **Migration** (première ouverture de la v2) : les anciennes clés non préfixées deviennent le profil
  « Principal » sur un serveur nommé d'après `settings.server` (ou « Mon serveur ») ; les anciens prix vont à
  ce serveur. Les anciennes clés sont conservées en lecture seule (sauvegarde) jusqu'à confirmation, jamais
  supprimées silencieusement.
- **Changement de profil** : met à jour le registre puis recharge l'application (simple et sûr) ; toutes les
  pages lisent alors les données du profil actif et l'économie de son serveur.
- **Interface** :
  - barre latérale : sélecteur « Profil — Serveur » toujours visible (avec la date du dernier import de prix
    du serveur) ;
  - Réglages → « Profils et serveurs » : créer (vierge ou dupliqué), renommer, changer de serveur, supprimer
    (avec confirmation et sauvegarde proposée), créer/renommer un serveur ;
  - sauvegarde/restauration : tout (tous profils et serveurs) ou un seul profil.
- `settings.server` devient un libellé dérivé du serveur du profil (compatibilité).

## 3. Prix de marché (instantanés CSV)

- Import : page **Prix** → « Importer un export HDV (CSV) » : choix du fichier, serveur cible (par défaut
  celui du profil actif), date de l'export (par défaut la date de modification du fichier, modifiable),
  aperçu (lignes lues, objets reconnus, objets utiles à l'application, couverture par catégorie, lignes
  ignorées), puis « Remplacer les prix du marché de <serveur> ».
- Stockage compact : uniquement les objets **utiles** à l'application (ingrédients, carburants, makinas,
  filets, objets-montures, ressources d'extraction, runes de brisage et runes Pa/Ra si utiles, parchemins et
  Tourmaline de la boutique de génétons, Pépite, Parchemin d'Éleveur…) ≈ 1 100 objets × 7 nombres.
- **Statistique de prix** (réglage par serveur, défaut `auto`) : `median30` | `median24` | `mean30` | `auto`
  (= médiane 24 h si ≥ 5 ventes en 24 h, sinon médiane 30 j, sinon moyenne 30 j). Un prix 0 = pas de prix.
- **Ordre de résolution d'un prix** : prix saisi par le joueur (serveur) > marché importé (serveur) > défaut
  de la recherche (sourcé/estimé) > coût de fabrication. `resolvePrice` garde la règle « le moins cher entre
  le prix connu et le craft complet », et signale l'origine (`joueur`, `marche`, `defaut`, `craft`).
- **Liquidité** : `vendus_24h`, `vendus_30j` et `kamas_par_jour` sont exposés (`marketDepth(id)`) pour
  plafonner les ventes prévues (par défaut ≤ 15 % du volume quotidien moyen, réglable) et avertir quand une
  production dépasse ce que le marché absorbe.
- Prix dérivés du marché (par serveur) : **valeur du généton** = max(prix ÷ coût) sur la boutique d'Eugène
  Éton (Puissants Parchemins 160, Grands 100, normaux 50, Petits 10, Tourmaline 130 — net de taxe) ; **runes
  de brisage** (Ga Pa 1557, Ga Pme 1558) ; ressources d'extraction (33515, 17864, 19975).
- Montures : `mountSalePrice` peut utiliser le prix de l'objet-monture (origine `marche`, badge « HDV mixte »,
  volume) ; les décisions automatiques (sort des montures, modes) ne s'en servent que comme **plafond de
  vente** prudent et jamais pour acheter des montures à extraire sans avertissement sénile.
- **Préréglage fourni** : l'extrait utile du CSV de Tylezia (02/10/2026) est versionné
  (`src/data/market/tylezia-2026-10-02.json`) et proposé en un clic (« Charger les prix de Tylezia du
  02/10/2026 ») pour un serveur nommé Tylezia. Un script `scripts/import-hdv-csv.mjs <csv> <serveur> <date>`
  régénère un préréglage depuis un CSV.

## 4. Modes de rentabilité

Un **mode** fixe l'objectif économique du profil et oriente tous les conseils :

| Mode | Objectif | Revenus principaux |
|---|---|---|
| `rush-corne` | Volkornes extraites → **Corne de volkorne** | extraction (génération × Corne) |
| `rush-ambre` | Muldos extraits → **Ambre de muldo** | extraction |
| `rush-neurone` | Dragodindes extraites → **Neurone de dragodinde** | extraction |
| `brisage-pa` / `brisage-pm` | Volkornes / Muldos montés vers le niveau optimal puis brisés (Ga Pa / Ga Pme) — risque de correctif signalé | runes |
| `vente-montures` | Produire les montures que le marché de **ce serveur** paie le mieux, dans la limite de son volume | ventes |
| `progression` | Objectif de génération/succès (comportement actuel) | génétons, progression |
| `auto` | Le mode le plus rentable par jour pour ce profil (prix et liquidité du serveur) | — |

Moteur commun (`src/domain/production.ts`) : **simulation de production en continu** (jour par jour ou par
session) d'un élevage contraint par le profil : enclos débloqués (niveau d'Éleveur) × 10 places, sessions par
jour (`hoursPerDay`), personnages (captures par combat), filet disponible (niveau), palier de jauge, niveau
visé des parents, politique d'Optimakina, génération d'extraction/de vente ciblée, clonage. Elle produit des
séries journalières : captures, fécondations, accouplements, bébés par génération, extractions (ressources),
brisages, ventes (plafonnées par la liquidité), génétons ; coûts (filets, carburant par jauge au prix du
marché du serveur, makinas, XP) ; **bénéfice net par jour**, cumul, régime permanent après la montée en charge.
Un **optimiseur** explore les paramètres (génération ciblée, niveau des parents, Optimakina, palier,
« accoupler avant d'extraire », vendre vs extraire selon le prix et la liquidité) et retient la meilleure
stratégie de chaque mode. Les hypothèses (lot typique du planificateur, sexes 50/50, captures/heure) sont
explicites et réglables ; un prix inconnu n'est jamais compté 0 (résultats « ≥ / inconnu »).

Page **Modes de rentabilité** (section Économie) : tableau comparatif des modes pour le profil actif
(kamas/jour en régime permanent, délai de montée en charge, capital immobilisé, ressources/jour vs volume du
marché, risques), détail d'un mode (stratégie retenue, routine quotidienne précise : quoi capturer, quelles
générations accoupler/extraire/vendre/cloner, jauges et paliers, quantités de carburant), bouton « Activer ce
mode » (réglage du profil). Le conseiller (« Que faire maintenant ? ») et le Plan suivent le mode actif
(captures de la famille du mode, extraction/vente au lieu de garder, génération d'extraction, etc.).

## 5. Estimateur d'investissement

Page **Investissement** (section Économie), module `src/domain/investment.ts` :

- Entrées : budget en kamas (ex. 20 000 000), horizon (ex. 30/60/90 jours), mode (`auto` ou un mode),
  contraintes du profil (niveau d'Éleveur actuel, heures/jour, personnages, enclos), options d'achat
  autorisées (acheter des montures G1 à l'HDV plutôt que capturer, acheter les carburants plutôt que les
  fabriquer, monter le métier en achetant les ingrédients, acheter des filets/makinas), réserve de sécurité.
- Leviers évalués : **monter le métier d'Éleveur** (coût réel via `job.ts` aux prix du serveur → enclos
  supplémentaires, carburants de palier supérieur, filets multiplicateurs), **stock de départ** (montures G1
  achetées, carburant, filets), **palier de jauge** (vitesse vs coût), **mode** de rentabilité.
- Sortie :
  - **plan d'action** chronologique (« Jour 0 : acheter … (quantités, kamas) ; crafter … ; Jour 1–3 : … ;
    Jour 5 : niveau 80 atteint → 3e enclos … ») ;
  - **feuille de route** par jalons (métier, enclos, première extraction/vente, régime permanent) ;
  - **courbe de trésorerie** (cumul investissement → bénéfices, SVG), **jour de retour sur investissement**
    (point mort), **bénéfice net par jour** en régime permanent, projection à 30/60/90 jours, ROI ;
  - comparaison de 2–3 allocations (ex. « tout dans le métier », « équilibré », « stock de montures ») et
    sensibilité (prix des ressources −20 %/+20 %, liquidité, durée réelle ×1,5) ;
  - risques : saturation du marché (production vs volume quotidien), prix datés (date de l'import), brisage
    pouvant être corrigé, hypothèses de temps de jeu.
- Le budget ne peut jamais être dépassé (dépenses du jour 0 + besoins de trésorerie avant les premières
  ventes) ; si le budget est insuffisant, l'estimateur le dit et propose le minimum utile.

## 6. Critères d'acceptation (tests et vérification navigateur)

- Import du CSV de Tylezia : ≥ 99 % des objets utiles reconnus ; le coût d'un lot de fécondation, de la
  montée du métier et des makinas devient **complet** ; les pages Prix, Rentabilité, Enclos, Métier,
  Accouplement, Optimiseur utilisent ces prix (origine « marché » visible).
- Deux profils sur deux serveurs : montures et prix strictement séparés ; changement de profil sans perte ;
  sauvegarde/restauration de tous les profils.
- Modes : pour Tylezia, chaque mode affiche un kamas/jour plausible avec ses hypothèses ; « Rush Volkorne »
  produit des Cornes et conseille quoi capturer/accoupler/extraire chaque jour ; le volume du marché est
  vérifié.
- Investissement : pour 20 M sur Tylezia, plan daté, point mort, bénéfice/jour, sans dépassement du budget.
- `npm run build`, `npm test`, `npm run lint` verts ; aucune régression des 577 tests existants (sauf mise à
  jour justifiée).
