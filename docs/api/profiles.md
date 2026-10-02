# API — Profils et serveurs (`src/store/profiles.ts`, `src/store/profileRegistry.ts`)

Un **profil** = un élevage (un compte sur un serveur) : réglages, montures, enclos, plans d'enclos,
avancement du plan, journal, préférences des pages. Un **serveur** = une économie : prix saisis et prix du
marché importés (export HDV), **partagés par tous ses profils**. Spécification : `docs/SPEC-v2.md` §2.
Tests : `src/store/profileRegistry.test.ts` (pur, faux stockage), `src/store/profiles.test.ts` (jsdom).

## Stockage (localStorage)

| Clé | Contenu |
|---|---|
| `elevagesimu:profiles` | Registre `{ version: 1, activeProfileId, profiles: ProfileEntry[], servers: ServerEntry[], legacy? }` (pas au format `{state, version}` de persist). |
| `elevagesimu:p:<profil>:<base>` | Données du profil : `settings`, `inventory`, `paddocks`, `paddockPlans`, `planProgress`, `journal` + préférences des pages (`montures-ui`, `rentabilite`, `optimiseur`, `metier`…). |
| `elevagesimu:s:<serveur>:<base>` | Données du serveur : `prices` (prix saisis), `market` (instantané HDV courant), `market-history` (imports précédents). |
| `elevagesimu:enclos-notifications` | Réglage de l'appareil (notifications du navigateur), **global**. |
| `elevagesimu:profiles-corrompu` | Copie d'un registre illisible (gardée avant reconstruction). |
| `elevagesimu:<base>` | Anciennes clés (v1) : copie de sécurité après migration, supprimable dans Réglages. |

Identifiants : minuscules, chiffres, tirets (`isValidScopeId`), dérivés du nom (« Tylezia » → `tylezia`,
`tylezia-2` si pris, y compris par des données restées dans le stockage). Renommer garde l'identifiant.

## Profil actif (résolu au chargement, avant les stores)

`profiles.ts` lit (ou crée, ou migre) le registre de façon **synchrone** à son chargement ; les clés du
profil ouvert sont alors fixes pour toute la vie de la page. Changer de profil = écrire le registre puis
recharger (`window.location.reload()`).

| Export | Rôle |
|---|---|
| `ACTIVE_PROFILE_ID`, `ACTIVE_SERVER_ID` | Profil ouvert et son serveur (constantes). |
| `STORE_KEYS: Record<StoreBase, string>` | Clés des stores du profil ouvert (`settings` … `journal` en `p:`, `prices`/`market`/`market-history` en `s:`). En mode `legacy`, les anciennes clés. **Tout nouveau store persisté l'utilise** : `persistOptions({ name: STORE_KEYS.xxx, … })` après avoir déclaré sa base dans `STORE_BASES` (schema.ts). |
| `profileKey(base)` | Clé d'une préférence de page propre au profil : `profileKey('montures-ui')` → `elevagesimu:p:<profil>:montures-ui`. **À utiliser par toute page qui enregistre des préférences** (elles suivent le profil et sa sauvegarde). |
| `serverKey(base)` | Clé d'une donnée propre au serveur ouvert. |
| `PROFILE_MODE: 'profiles' \| 'legacy' \| 'memory'` | `legacy` : migration impossible (stockage plein) → anciennes clés, profils désactivés ; `memory` : pas de stockage. |
| `MIGRATED_AT_BOOT` | Les anciennes données viennent d'être reprises (premier chargement de la v2). |
| `useProfiles` | Store zustand (non persisté par persist ; écrit le registre avec `safeWriteText`) : `registry`, `mode`, `readOnly`, `readOnlyReason` et les actions ci-dessous. |
| `useActiveProfile()`, `useActiveServer()` ; `activeProfile()`, `activeServer()` | Profil / serveur ouverts (hooks, et hors React). |

Actions de `useProfiles` (renvoient `ActionResult = {ok: true, id?, message?} | {ok: false, error}`, message
français prêt à afficher ; refus si `readOnly`) :

| Action | Effet |
|---|---|
| `createProfile({name, serverId? \| newServerName?, duplicateFrom?, color?})` | Crée un profil (vierge, ou copie de toutes les données d'un profil : tout ou rien), éventuellement sur un nouveau serveur. Noms uniques (casse et accents ignorés), 40 caractères max. |
| `duplicateProfile(id, name?)` | Copie d'un profil sur le même serveur (« <nom> (copie) » par défaut). |
| `renameProfile(id, name)`, `setProfileColor(id, color \| null)` | Couleur de repère : `accent \| gold \| info \| ok \| warn \| danger` (variables CSS). |
| `setProfileServer(id, serverId)` | Change le serveur d'un profil (profil ouvert : recharge). |
| `deleteProfile(id)` | Supprime le profil et ses données (jamais le dernier) ; profil ouvert : bascule sur un autre, `freezeWrites()`, recharge. |
| `createServer(name, {priceStat?})`, `renameServer(id, name)` | Serveurs (noms uniques). |
| `setServerOptions(id, {priceStat?, maxMarketShare?})` | Statistique de prix des imports HDV (`auto` défaut) ; part du volume quotidien vendable (0,15 défaut, 1–100 %). |
| `deleteServer(id)` | Refusé s'il porte un profil ; sinon supprime ses prix, son marché et son historique. |
| `switchProfile(id, flash?)` | Enregistre le profil actif, bloque les écritures (`freezeWrites`), recharge ; `flash` affiché au retour. |
| `removeLegacyCopy()` | Supprime les anciennes clés (copie d'avant les profils). |

`settings.server` reste un **libellé dérivé** du serveur ouvert (recopié au chargement et à chaque
renommage) ; `useSettings.update({server})` renomme le serveur ouvert (refusé si le nom est pris).

Plusieurs onglets : un événement « storage » sur le registre le relit ; si le profil ouvert dans cet
onglet a été supprimé ailleurs, les écritures sont bloquées et la page se recharge.

## Logique pure (`profileRegistry.ts`, testable sans navigateur)

| Export | Rôle |
|---|---|
| `ProfileEntry {id, name, serverId, createdAt, color?}`, `ServerEntry {id, name, createdAt, priceStat, maxMarketShare}`, `ProfilesRegistry`, `LegacyCopyInfo {migratedAt, keys, moved, removedAt}` | Types. |
| `sanitizeRegistry(raw)` | `{registry \| null, issues, newer}` : doublons et entrées illisibles écartés, serveur manquant recréé (ses données restent joignables), profil actif inconnu → premier ; `newer` si version > 1 (lecture seule). |
| `addServer`, `renameServer`, `setServerOptions`, `removeServer`, `addProfile`, `renameProfile`, `setProfileServer`, `setProfileColor`, `removeProfile`, `setActiveProfile` | Opérations pures → `RegistryResult`. |
| `bootProfiles(storage \| null, now)` | Démarrage : registre lu et normalisé (réécrit s'il a été corrigé) ; plus récent → lecture seule ; illisible → copie `profiles-corrompu` + `rebuildRegistry` d'après les clés ; absent → `migrateLegacyStorage` ou `defaultRegistry` (« Principal » sur « Mon serveur »). |
| `migrateLegacyStorage(storage, now)` | Anciennes clés → profil `principal` sur le serveur nommé d'après `settings.server` (« Mon serveur » sinon) ; `prices` → serveur ; préférences de page → profil ; `enclos-notifications` reste global. **Copie** (anciennes clés gardées) ; faute de place, une clé est **déplacée** ; registre écrit en dernier ; échec → tout est annulé (`ok: false`, mode `legacy`). Idempotente. |
| `copyProfileData`, `removeProfileData`, `removeServerData`, `keysWithPrefix`, `idsWithData`, `legacyKeys`, `removeLegacyCopy` | Données d'un profil / serveur dans un stockage. |
| `profileDataSummary(storage, id)` | `{mounts, journal, jobLevel, bytes}` pour les listes. |
| `serverMarketMeta(storage, serverId)` | Dernier import HDV d'un serveur (`exportDate`, `importedAt`, `source`, `useful`). |

## Interface

- `src/ui/ProfileSwitcher.tsx` (barre latérale, hors `<nav>`) : « Profil — Serveur », date du dernier
  import HDV du serveur (orange au-delà de 14 jours), liste des profils groupés par serveur, lien « Gérer ».
- `src/ui/ProfilesSection.tsx` (Réglages › « Profils et serveurs », `#/reglages?s=profils`) : profils
  (ouvrir, renommer, couleur, serveur, dupliquer, sauvegarder, supprimer avec confirmation et sauvegarde
  proposée), création (vierge ou copie, serveur existant ou nouveau, « Charger les prix de Tylezia du
  02/10/2026 » proposé pour un serveur nommé Tylezia — ou tout serveur, avec avertissement), serveurs
  (statistique de prix, part du marché, dernier import, préréglage, suppression), copie des données d'avant
  les profils (« Supprimer l'ancienne copie »).
- Sauvegarde : tout ou un profil (`docs/api/backup.md`).
