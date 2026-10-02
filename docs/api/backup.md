# API — Sauvegarde locale (`src/lib/backup.ts`)

Export, import et remise à zéro de **toutes** les données de l'application (tous les profils et
serveurs : chaque clé du localStorage qui commence par `elevagesimu:`, registre des profils compris) ou
d'**un seul profil** (ses données et celles de son serveur). Les fonctions de calcul sont pures et prennent
un stockage en paramètre (`StorageLike`, défaut : localStorage du navigateur) ; testées dans
`src/lib/backup.test.ts` (faux stockage avec quota en caractères, comme Chrome). Page associée : `src/ui/pages/SettingsPage.tsx`
(`#/reglages`, section « Sauvegarde des données » ; bouton « Sauvegarder » de chaque profil dans « Profils et
serveurs »). Profils et clés : `docs/api/profiles.md`.
Versions, migrations et normalisation des stores : `src/store/schema.ts` (voir `docs/api/infra.md`).

```ts
downloadBackup()                                   // tout : elevagesimu-sauvegarde-AAAA-MM-JJ-HHhMM.json
downloadProfileBackup(ACTIVE_PROFILE_ID)           // un profil : elevagesimu-profil-<nom>-AAAA-MM-JJ-HHhMM.json
const v = await readBackupFile(file)               // décode + valide, rien n'est écrit
if (v.ok) importAll(v.backup, { mode: 'replace' }) // écrit puis recharge la page (message « flash »)
resetAll()                                         // efface les clés elevagesimu:* puis recharge
```

**Format du fichier** (v2) : `{ app: 'ElevageSimu', version: 2, exportedAt: ISO, scope: {kind: 'all'} | {kind: 'profile', profile: ProfileEntry, server: ServerEntry}, stores: { 'elevagesimu:xxx': valeur JSON décodée }, raw?: { clé: texte } }`
(`raw` = valeurs qui n'étaient pas du JSON, recopiées telles quelles). Les fichiers **v1** (avant les profils,
clés `elevagesimu:<base>`, sans `scope`) restent importables.

**Import selon la portée** :
- **tout** (v1 ou v2) : `replace` = l'état local devient celui du fichier (un fichier v1 est ensuite migré vers
  le profil « Principal » au rechargement) ; `merge` = clés du fichier écrites, registres des profils
  **fusionnés** (`mergeRegistries` : profils et serveurs du fichier ajoutés ou mis à jour, profil ouvert
  gardé) ; un fichier v1 est alors **versé dans le profil ouvert** (et son serveur pour les prix) ;
  Un fichier v1 fusionné verse ses **prix saisis** dans ceux du serveur du profil ouvert **clé par clé**
  (ceux du fichier l'emportent en cas de doublon, les autres prix sont gardés), avec un avertissement qui
  nomme le serveur et les profils qui partagent ces prix. Registre du fichier **illisible** (sauvegarde v2) :
  il est **reconstruit** d'après les données du fichier (`rebuildRegistry`, copie de secours comprise) et
  écrit (`replace`), ou ses profils manquants ajoutés au registre d'ici (`merge`) ;
- **un profil** (`importProfileBackup`) : le profil du même identifiant est remplacé (`replace` efface d'abord
  ses données absentes du fichier) ou créé ; `asNewProfile: true` l'importe comme **copie** (nouvel
  identifiant, nom suffixé « (2) » si pris) ; le profil importé devient le profil actif (et celui de
  l'onglet). Les clés d'autres profils glissées dans le fichier sont ignorées. Son **serveur**
  (`planProfileServer`) :
  - absent ici → créé avec les prix, le marché et l'historique du fichier ;
  - présent ici (même nom, casse et accents ignorés) **sans** prix ni marché (cas d'un navigateur neuf et de
    son « Mon serveur » vide) → les données du fichier y sont écrites ;
  - présent **avec** des données des deux côtés → `serverData` : `'keep'` (défaut, avertissement), `'replace'`
    (prix, marché et historique du fichier ; clés absentes du fichier effacées) ou `'merge'` (prix réunis
    clé par clé, ceux d'ici gardés en cas de doublon ; marché le plus récent — date d'export puis d'import ;
    historiques réunis). Réglages propose ce choix (boutons radio, contenu des deux côtés, profils qui
    partagent ces prix) ;
  - même identifiant mais **autre nom** → jamais de rattachement silencieux : serveur distinct créé
    (avertissement), sauf si le serveur d'ici est vide et sans autre profil (il prend alors le nom et les
    données du fichier).

Les avertissements de l'import sont repris dans le message affiché après le rechargement (« Profil
« Principal » importé et ouvert. Prix et marché du serveur « Tylezia » repris de la sauvegarde. »).

**Écriture tout ou rien** (`writeAll`) : suppressions d'abord, puis les écritures qui réduisent la place,
enfin celles qui l'augmentent le plus. En cas d'échec (quota), `restoreSnapshot` remet l'état d'avant
**quel que soit l'ordre** : efface les clés absentes de l'instantané et celles dont la valeur a changé, puis
réécrit leurs valeurs d'origine (le total ne peut que revenir à l'état d'avant, qui tenait). Si même cela
échoue (un autre onglet écrit en même temps), l'erreur le dit (« Import interrompu… ») et `ImportResult`
porte `snapshot` (toutes les données d'avant l'import) : Réglages propose « Télécharger mes données d'avant
l'import ».

**Vérification des stores connus** (toute clé reconnue par `persistedStoreInfo` : profil, serveur ou ancienne
clé ; `KNOWN_STORES` ne liste plus que les anciennes clés), et du registre des profils (`sanitizeRegistry` :
plus récent → refus, illisible → ignoré avec avertissement, les profils seront reconstruits), à l'import, via
`normalizeStoreValue` : structure `{state, version}` obligatoire ; **version plus récente** que
`STORE_VERSIONS[clé]` → import refusé (« créées par une version plus récente de l'application : mettez-la
à jour »), rien n'est écrit ; version plus ancienne → migrée ; état **normalisé** (montures inutilisables
écartées, champs invalides remplacés, réglages hors liste ou hors bornes corrigés, prix invalides retirés)
avec un avertissement par correction (« Montures : 2 montures inutilisables ignorées… ») ; la valeur écrite
est celle normalisée, à la version actuelle. L'aperçu (`summarizeBackup`) décrit donc ce qui sera chargé.

**Rechargement** : après un import ou une remise à zéro, l'application est rechargée
(`window.location.reload()`), seul moyen sûr de relire tous les stores **et** les préférences de page déjà
en mémoire. Un message est conservé en sessionStorage (`setFlash` / `takeFlash`) et affiché au retour.
Une nouvelle page qui persiste ses préférences sous `profileKey(base)` (src/store/profiles.ts) est sauvegardée
automatiquement avec son profil ; ajouter un libellé dans `PAGE_PREFS` (par base ; sinon « Préférences (base) ») ;
une donnée qui se recalcule à la demande va aussi dans `REGENERABLE_BASES` (`modes` : oui ; `mode-plan`, plan
d'investissement suivi, libellé « Plan d’investissement suivi » : non — c'est un choix du joueur).
Avant chaque rechargement, `freezeWrites()` bloque les écritures des stores.

## Constantes et types

| Élément | Rôle |
|---|---|
| `BACKUP_APP = 'ElevageSimu'`, `BACKUP_VERSION = 2`, `STORAGE_PREFIX = 'elevagesimu:'` | Identité et version du format (v2 : profils ; v1 lisible) ; préfixe des clés de l'application. |
| `BackupScope` | `{kind: 'all'}` ou `{kind: 'profile', profile, server}`. |
| `StorageLike` | `length`, `key(i)`, `getItem`, `setItem`, `removeItem` (localStorage ou faux stockage). |
| `BackupFile` | Contenu d'une sauvegarde (voir format). |
| `BackupValidation` | `{ok: true, backup, keys, warnings}` ou `{ok: false, error}` (message FR prêt à afficher). |
| `ImportMode = 'replace' \| 'merge'` | Remplacer tout l'état local, ou n'écrire que les clés présentes dans le fichier. |
| `ImportOptions` | `{mode?, asNewProfile?, serverData?, storage?, reload?, now?}` (défauts : `'replace'`, faux, `'keep'`, localStorage, `true`). |
| `ServerDataChoice = 'keep' \| 'replace' \| 'merge'` | Prix et marché d'un serveur présent des deux côtés (sauvegarde d'un profil). |
| `ImportResult` | `{ok: true, mode, written, removed, warnings, profileId?}` ou `{ok: false, error, snapshot?}`. |
| `ServerDataSummary` | `{prices, geneton, marketExportDate, marketItems, history, unreadable}` : contenu des données d'un serveur. |
| `ProfileServerPlan` | `{action: 'create' \| 'existing' \| 'adopt', server, local, localData, backupData, needsChoice, sharedWith, idConflict}`. |
| `ScopeNames`, `scopeNamesOf(registry)` | Noms des profils et serveurs pour les libellés. |
| `KNOWN_STORES: Record<clé, libellé>` | Stores zustand dont la valeur doit être `{state: {…}, version}` (validé à l'import), dérivé de `PERSISTED_STORES` (schema.ts). |
| `STORE_VERSIONS: Record<clé, number>` | Version actuelle du schéma de chaque store (une sauvegarde plus récente est refusée). |
| `StorageUsage` | `{totalChars, entries: {key, label, chars, regenerable}[]}` — en **caractères** (clé + valeur). |
| `BackupSummaryLine` | `{key, label, detail}` (« 42 montures », « règles 3.6, Éleveur niv. 87 »…). |
| `TYPICAL_STORAGE_QUOTA_CHARS`, `WEBKIT_STORAGE_QUOTA_CHARS` | Limite du localStorage : 5 Mi **caractères** (clés + valeurs) dans Chrome, Edge et Firefox (mesuré : 5 242 880, quels que soient les caractères) ; moitié moins dans WebKit (Safari, tout navigateur sur iPhone/iPad), qui compte des octets UTF-16. |
| `REGENERABLE_BASES` | Bases de clés de profil recalculables (`modes` : résultats de la comparaison des modes, souvent la plus grosse donnée d'un profil). |

## Fonctions pures (testées)

| Export | Rôle |
|---|---|
| `isAppKey(key): boolean` | La clé est-elle `elevagesimu:<quelque chose>` ? |
| `appKeys(storage?): string[]` | Clés de l'application présentes, triées. |
| `storeLabel(key, names?): string` | Libellé lisible d'une clé (« Montures (étable…) — profil Principal », « Prix saisis — serveur Tylezia », « Ancienne copie : Réglages »). |
| `isKnownStoreKey(key)` | Store persisté (n'importe quelle portée) ? |
| `readRegistry(storage?)` | Registre des profils normalisé (ou null). |
| `exportProfile(profileId, storage?, now?, pending?)` | Sauvegarde d'un profil (null si introuvable). |
| `importProfileBackup(backup, opts)` | Restauration d'un profil (voir ci-dessus). |
| `mergeRegistries(local, incoming)` | Fusion de registres (import « fusionner »). |
| `exportAll(storage?, now?, pending?): BackupFile` | Instantané de toutes les clés de l'application (valeurs décodées, `scope: {kind: 'all'}`). `pending` (clé → texte JSON) remplace la valeur stockée : modifications qu'un quota plein a empêché d'enregistrer (`pendingWrites()`). |
| `serializeBackup(backup): string` | JSON indenté. |
| `backupFileName(date?, profileName?): string` | Nom de fichier daté (heure locale) ; « elevagesimu-profil-<nom>-… » pour un profil. |
| `validateBackup(data): BackupValidation` | Vérifie `app`, `version` (entier ≥ 1, ≤ `BACKUP_VERSION`), `stores`, forme et **version** des stores connus (refus si plus récente), migre et normalise leur état (avertissements) ; ignore (avec avertissement) les clés étrangères ; signale sauvegarde vide et date illisible. |
| `parseBackup(text): BackupValidation` | `JSON.parse` + `validateBackup`. |
| `importAll(input, opts?): ImportResult` | Valide (texte, objet ou `BackupFile`), écrit, efface en mode `replace` les clés absentes du fichier ; si une écriture échoue (quota), restaure l'état précédent. Les clés d'autres sites ne sont jamais touchées. Copie d'avant les profils : la normalisation peut réécrire une ancienne clé (champ ajouté) ; une clé à jour dans le fichier (empreinte du registre du fichier = son texte d'origine, retrouvé aussi pour une sauvegarde déjà passée par `validateBackup`) reçoit l'empreinte de la valeur écrite — pas de fausse alerte « Données modifiées par l'ancienne version » après une restauration ; une clé déjà divergente le reste. |
| `resetAll({storage?, keep?, reload?}): string[]` | Efface les clés de l'application (sauf `keep`) ; renvoie les clés effacées. |
| `storageUsage(storage?): StorageUsage` | Taille par clé en caractères (l'unité du quota), de la plus grosse à la plus petite ; `regenerable` marque les données recalculables. Réglages › Données l'affiche contre `storageQuotaChars()` (« x % de la limite de ce navigateur »), seuils 50 % / 80 %. |
| `storageQuotaChars(userAgent?)`, `isWebKitStorage(userAgent)` | Limite (caractères) pour ce navigateur. |
| `isRegenerableKey(key)`, `removeRegenerableData(storage?)` | Données recalculables ; suppression pour **tous** les profils (bouton « Supprimer les résultats recalculables », proposé en premier quand le stockage est presque plein et dans les messages de quota). |
| `planProfileServer(backup, storage, {asNewProfile?, registry?})` | Sort du serveur d'une sauvegarde de profil (voir plus haut) ; utilisé par l'import et par l'aperçu. |
| `serverDataSummary(storage, serverId)`, `isServerDataEmpty(summary)` | Contenu des données d'un serveur ici. |
| `mergePriceStates(local, incoming, prefer)`, `newerMarketSnapshot(a, b)`, `mergeMarketHistories(a, b)` | Fusions pures (un prix absent n'est jamais compté comme 0). |
| `summarizeBackup(backup): BackupSummaryLine[]` | Contenu d'une sauvegarde pour l'aperçu avant import. |

## Navigateur

| Export | Rôle |
|---|---|
| `getBrowserStorage(): StorageLike \| null` | localStorage, ou null s'il est indisponible. |
| `downloadBackup(backup?, date?): string` | Télécharge la sauvegarde (défaut : instantané actuel **avec** les modifications non enregistrées, `pendingWrites()`), renvoie le nom du fichier. |
| `downloadProfileBackup(profileId, date?): string \| null` | Télécharge la sauvegarde d'un profil. |
| `readBackupFile(file: Blob): Promise<BackupValidation>` | Lit et valide un fichier choisi. |
| `reloadApp(flash?)` | Recharge l'application (sans effet hors navigateur) en laissant un message. |
| `setFlash(message)`, `appendFlash(message)`, `takeFlash(): string \| null` | Message à afficher après le prochain chargement (sessionStorage, clé `elevagesimu-flash`, hors sauvegarde) ; affiché par `App.tsx` (`FlashBanner`) sur n'importe quelle page. `appendFlash` complète le message en attente (avant le premier rendu : message du chargement en cours). |
