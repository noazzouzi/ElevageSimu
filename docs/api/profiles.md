# API — Profils et serveurs (`src/store/profiles.ts`, `src/store/profileRegistry.ts`)

Un **profil** = un élevage (un compte sur un serveur) : réglages, montures, enclos, plans d'enclos,
avancement du plan, journal, préférences des pages. Un **serveur** = une économie : prix saisis et prix du
marché importés (export HDV), **partagés par tous ses profils**. Spécification : `docs/SPEC-v2.md` §2.
Tests : `src/store/profileRegistry.test.ts` (pur, faux stockage), `src/store/profiles.test.ts` (jsdom).

## Stockage (localStorage)

| Clé | Contenu |
|---|---|
| `elevagesimu:profiles` | Registre `{ version: 1, activeProfileId, profiles: ProfileEntry[], servers: ServerEntry[], legacy? }` (pas au format `{state, version}` de persist). `activeProfileId` = profil ouvert **par défaut dans un nouvel onglet** (chaque onglet garde le sien, voir ci-dessous). |
| `elevagesimu:profiles-precedent` | **Copie de secours** du dernier registre lisible (réécrite après chaque enregistrement réussi du registre et à chaque démarrage) : sert à reconstruire noms, serveurs, couleurs et options si le registre devient illisible ou disparaît. Clé globale. |
| `elevagesimu:p:<profil>:<base>` | Données du profil : `settings`, `inventory`, `paddocks`, `paddockPlans`, `planProgress`, `journal` + préférences des pages (`montures-ui`, `rentabilite`, `optimiseur`, `metier`…). |
| `elevagesimu:s:<serveur>:<base>` | Données du serveur : `prices` (prix saisis), `market` (instantané HDV courant), `market-history` (imports précédents). |
| `elevagesimu:enclos-notifications` | Réglage de l'appareil (notifications du navigateur), **global**. |
| `elevagesimu:profiles-corrompu` | Copie d'un registre illisible (gardée avant reconstruction). |
| `elevagesimu:<base>` | Anciennes clés (v1) : copie de sécurité après migration, supprimable dans Réglages. |
| sessionStorage `elevagesimu-tab-profile` | Profil ouvert dans **cet onglet** (`src/store/tabProfile.ts` : `readTabProfile`, `writeTabProfile`, `clearTabProfile`) ; hors sauvegarde. |
| sessionStorage `elevagesimu-market-undo:<serveur>` | Prix du marché d'avant le dernier import de ce serveur, pour « Annuler l'import » (`src/store/market.ts`) ; propre à l'onglet, hors quota du localStorage et hors sauvegarde. |

Identifiants : minuscules, chiffres, tirets (`isValidScopeId`), dérivés du nom (« Tylezia » → `tylezia`,
`tylezia-2` si pris, y compris par des données restées dans le stockage). Renommer garde l'identifiant.

## Profil actif (résolu au chargement, avant les stores)

`profiles.ts` lit (ou crée, ou migre) le registre de façon **synchrone** à son chargement ; les clés du
profil ouvert sont alors fixes pour toute la vie de la page. Changer de profil = écrire le registre (et le
choix de l'onglet) puis recharger (`window.location.reload()`).

**Un profil par onglet** : au démarrage, le profil choisi dans l'onglet (sessionStorage
`elevagesimu-tab-profile`) est ouvert s'il existe encore (`resolveOpenProfile`), sans réécrire
`registry.activeProfileId` ; sinon le profil par défaut du registre, avec le message « Le profil de cet onglet
a été supprimé : « X » ouvert. ». Deux onglets sur deux comptes gardent donc chacun leur élevage d'un
rechargement à l'autre (et les alarmes de leurs enclos). `switchProfile`, la suppression du profil ouvert et
l'import d'un profil écrivent ce choix ; l'import « remplacer tout » et la remise à zéro l'effacent.

| Export | Rôle |
|---|---|
| `ACTIVE_PROFILE_ID`, `ACTIVE_SERVER_ID` | Profil ouvert et son serveur (constantes). |
| `STORE_KEYS: Record<StoreBase, string>` | Clés des stores du profil ouvert (`settings` … `journal` en `p:`, `prices`/`market`/`market-history` en `s:`). En mode `legacy`, les anciennes clés. **Tout nouveau store persisté l'utilise** : `persistOptions({ name: STORE_KEYS.xxx, … })` après avoir déclaré sa base dans `STORE_BASES` (schema.ts). |
| `profileKey(base)` | Clé d'une préférence de page propre au profil : `profileKey('montures-ui')` → `elevagesimu:p:<profil>:montures-ui`. **À utiliser par toute page qui enregistre des préférences** (elles suivent le profil et sa sauvegarde). |
| `serverKey(base)` | Clé d'une donnée propre au serveur ouvert. |
| `PROFILE_MODE: 'profiles' \| 'legacy' \| 'memory'` | `legacy` : migration impossible (stockage plein) → anciennes clés, profils désactivés ; `memory` : pas de stockage. |
| `MIGRATED_AT_BOOT` | Les anciennes données viennent d'être reprises (premier chargement de la v2) : message « Vos données ont été reprises dans le profil Principal. Fermez ou rechargez les autres onglets ElevageSimu… ». |
| `hasPendingForActive()` | Des modifications du profil ouvert ou de son serveur n'ont pas pu être enregistrées (quota) : elles seraient perdues par un rechargement. |
| `PENDING_SWITCH_ERROR` | Message du refus `code: 'pending'`. |
| `useProfiles` | Store zustand (non persisté par persist ; écrit le registre avec `safeWriteText`) : `registry`, `mode`, `readOnly`, `readOnlyReason` et les actions ci-dessous. |
| `useActiveProfile()`, `useActiveServer()` ; `activeProfile()`, `activeServer()` | Profil / serveur ouverts (hooks, et hors React). |

Actions de `useProfiles` (renvoient `ActionResult = {ok: true, id?, message?} | {ok: false, error, code?}`,
message français prêt à afficher ; refus si `readOnly`). `code: 'pending'` : refus parce que des
modifications ne sont pas enregistrées (stockage plein) et seraient perdues au rechargement ; l'interface
appelle `confirmPendingThenRetry(result, quoi, retry)` (`src/ui/confirmPending.ts` : sauvegarde proposée — elle
contient ces modifications —, puis confirmation) et relance avec `{force: true}` :

| Action | Effet |
|---|---|
| `createProfile({name, serverId? \| newServerName?, duplicateFrom?, color?})` | Crée un profil (vierge, ou copie de toutes les données d'un profil : tout ou rien), éventuellement sur un nouveau serveur. Noms uniques (casse et accents ignorés), 40 caractères max. |
| `duplicateProfile(id, name?)` | Copie d'un profil sur le même serveur (« <nom> (copie) » par défaut). |
| `renameProfile(id, name)`, `setProfileColor(id, color \| null)` | Couleur de repère : `accent \| gold \| info \| ok \| warn \| danger` (variables CSS). |
| `setProfileServer(id, serverId, {force?})` | Change le serveur d'un profil (profil ouvert : recharge ; refus `pending` sans `force`). Le même serveur **confirme** un serveur deviné (`serverToCheck` effacé). |
| `deleteProfile(id)` | Supprime le profil et ses données (jamais le dernier) ; profil ouvert : bascule sur un autre, `freezeWrites()`, recharge. |
| `createServer(name, {priceStat?})`, `renameServer(id, name)` | Serveurs (noms uniques). |
| `setServerOptions(id, {priceStat?, maxMarketShare?})` | Statistique de prix des imports HDV (`auto` défaut) ; part du volume quotidien vendable (0,15 défaut, 1–100 %). |
| `deleteServer(id)` | Refusé s'il porte un profil ; sinon supprime ses prix, son marché et son historique. |
| `switchProfile(id, flash?, {force?})` | Enregistre le profil actif (registre + choix de l'onglet), bloque les écritures (`freezeWrites`), recharge ; `flash` affiché au retour. Refus `pending` sans `force`. |
| `removeLegacyCopy({force?})` | Supprime les anciennes clés (copie d'avant les profils) : refus si `readOnly` ; **registre enregistré d'abord** (`legacy.removedAt`), clés effacées seulement ensuite ; refus si une ancienne clé a été modifiée après la reprise (`legacyDivergence`), sauf `force`. |
| `adoptLegacyChanges(keys)` | « Reprendre ces changements » : recopie ces anciennes clés vers les clés du profil `principal` (et de son serveur pour les prix) — tout ou rien —, met à jour leurs empreintes, puis recharge. |
| `ignoreLegacyChanges(keys)` | « Ignorer » : nouvelles empreintes, l'ancienne copie redevient supprimable. |

`settings.server` reste un **libellé dérivé** du serveur ouvert (recopié au chargement et à chaque
renommage) ; `useSettings.update({server})` renomme le serveur ouvert (refusé si le nom est pris).

Plusieurs onglets : un événement « storage » sur le registre le relit ; si le profil ouvert dans cet
onglet a été **supprimé** ailleurs, ou **rattaché à un autre serveur**, les écritures sont bloquées
(`freezeWrites`) et la page se recharge (« Le serveur de ce profil a été changé dans un autre onglet… ») —
sauf si des modifications ne sont pas enregistrées ici : alerte `onglet` (« Profil modifié dans un autre
onglet », télécharger une sauvegarde puis recharger) au lieu d'un rechargement qui les perdrait. Une ancienne
clé (v1) réécrite par un onglet resté sur l'ancienne version déclenche aussitôt l'alerte `divergence`
(« Données modifiées par l'ancienne version », lien vers Réglages › Profils) ; elle est aussi vérifiée à
chaque démarrage.

## Logique pure (`profileRegistry.ts`, testable sans navigateur)

| Export | Rôle |
|---|---|
| `ProfileEntry {id, name, serverId, createdAt, color?, serverToCheck?}`, `ServerEntry {id, name, createdAt, priceStat, maxMarketShare}`, `ProfilesRegistry`, `LegacyCopyInfo {migratedAt, keys, moved, removedAt, fingerprints?}`, `LegacyFingerprint {len, hash}` | Types. `serverToCheck` : serveur deviné à la reconstruction du registre (badge « serveur à vérifier », bouton « C'est le bon »). `fingerprints` : empreinte (longueur + FNV-1a 32 bits, `fingerprintOf`, `hashText`) de chaque ancienne clé copiée, au moment de la reprise. |
| `sanitizeRegistry(raw)` | `{registry \| null, issues, newer}` : doublons et entrées illisibles écartés, serveur manquant recréé (ses données restent joignables), profil actif inconnu → premier ; `newer` si version > 1 (lecture seule). |
| `addServer`, `renameServer`, `setServerOptions`, `removeServer`, `addProfile`, `renameProfile`, `setProfileServer`, `setProfileColor`, `removeProfile`, `setActiveProfile` | Opérations pures → `RegistryResult`. |
| `bootProfiles(storage \| null, now)` | Démarrage : registre lu et normalisé (réécrit s'il a été corrigé ; copie de secours tenue à jour) ; plus récent → lecture seule ; illisible → copie `profiles-corrompu` + `rebuildRegistry` ; **absent alors que des profils (clés `p:`) ou une copie de secours existent → `rebuildRegistry` aussi** (alerte « corrigé »), puis reprise des anciennes clés seulement si `principal` n'a aucune donnée ; absent sinon → `migrateLegacyStorage` ou `defaultRegistry` (« Principal » sur « Mon serveur »). Migration impossible → mode `legacy` et alerte `migration` (« Profils non activés (stockage plein) », sans « Réessayer d'enregistrer »). |
| `rebuildRegistry(storage, now, corruptRaw?)` | `{registry, toCheck, recovered} \| null` : d'abord le registre illisible lu au mieux ou la copie de secours (noms, serveurs, couleurs, options, copie d'avant les profils), puis les profils et serveurs trouvés seulement dans les clés. Profil sans entrée : serveur noté dans ses réglages ; sinon le seul serveur qui a des données, ou le premier par ordre alphabétique, **marqué `serverToCheck`** et listé dans l'alerte (jamais en silence). |
| `resolveOpenProfile(registry, préféré)` | Profil à ouvrir dans un onglet : `{profile, missing}` (`missing` : profil de l'onglet supprimé entre-temps). |
| `migrateLegacyStorage(storage, now, base?)` | Anciennes clés → profil `principal` sur le serveur nommé d'après `settings.server` (« Mon serveur » sinon) ; `prices` → serveur ; préférences de page → profil ; `enclos-notifications` reste global. **Copie** (anciennes clés gardées, avec leur empreinte) ; faute de place, une clé est **déplacée** ; si même un déplacement ne tient pas (nouvelle clé plus longue) ou si le registre ne tient pas, des copies déjà faites deviennent des déplacements pour libérer de la place ; registre écrit en dernier ; échec → tout est annulé (`ok: false`, mode `legacy`). Idempotente. `base` : registre (reconstruit) à compléter d'un profil `principal`. |
| `legacyDivergence(storage, registry)` | Anciennes clés modifiées **après** la reprise (empreinte différente, clé déplacée puis réécrite, ou nouvelle ancienne clé) : un onglet est resté sur l'ancienne version. Vide si la copie a été supprimée. |
| `acknowledgeLegacyKeys(storage, registry, keys)` | Registre où ces anciennes clés sont tenues pour à jour (après « Reprendre » ou « Ignorer »). |
| `copyProfileData`, `removeProfileData`, `removeServerData`, `keysWithPrefix`, `idsWithData`, `legacyKeys`, `removeLegacyCopy` | Données d'un profil / serveur dans un stockage. |
| `profileDataSummary(storage, id)` | `{mounts, journal, jobLevel, chars}` pour les listes (`chars` : caractères, clés + valeurs — l'unité du quota). |
| `serverMarketMeta(storage, serverId)` | Dernier import HDV d'un serveur (`exportDate`, `importedAt`, `source`, `useful`). |

## Interface

- `src/ui/ProfileSwitcher.tsx` (barre latérale, hors `<nav>`) : « Profil — Serveur », date du dernier
  import HDV du serveur (orange au-delà de 14 jours), liste des profils groupés par serveur, lien « Gérer ».
- `src/ui/ProfilesSection.tsx` (Réglages › « Profils et serveurs », `#/reglages?s=profils`) : profils
  (ouvrir, renommer, couleur, serveur — badge « serveur à vérifier » après une reconstruction —, dupliquer,
  sauvegarder, supprimer avec confirmation et sauvegarde proposée), création (vierge ou copie, serveur
  existant ou nouveau, « Charger les prix de Tylezia du 02/10/2026 » proposé pour un serveur nommé Tylezia —
  ou tout serveur, avec avertissement ; ouverture annulée → « Profil créé (non ouvert) »), serveurs
  (statistique de prix, part du marché, dernier import, préréglage, suppression), copie des données d'avant
  les profils (taille en caractères ; changements de l'ancienne version à « Reprendre » ou « Ignorer » ;
  « Supprimer l'ancienne copie » désactivé tant qu'il en reste, et en lecture seule). « Ouvrir », le
  changement de serveur du profil ouvert et l'ouverture d'un profil créé passent par `confirmPendingThenRetry`
  quand des modifications ne sont pas enregistrées, comme le sélecteur de la barre latérale.
- Sauvegarde : tout ou un profil (`docs/api/backup.md`).
