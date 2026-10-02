# API — Sauvegarde locale (`src/lib/backup.ts`)

Export, import et remise à zéro de **toutes** les données de l'application (tous les profils et
serveurs : chaque clé du localStorage qui commence par `elevagesimu:`, registre des profils compris) ou
d'**un seul profil** (ses données et celles de son serveur). Les fonctions de calcul sont pures et prennent
un stockage en paramètre (`StorageLike`, défaut : localStorage du navigateur) ; testées dans
`src/lib/backup.test.ts` (40 tests, faux stockage avec quota). Page associée : `src/ui/pages/SettingsPage.tsx`
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
- **un profil** (`importProfileBackup`) : le profil du même identifiant est remplacé (`replace` efface d'abord
  ses données absentes du fichier) ou créé ; `asNewProfile: true` l'importe comme **copie** (nouvel
  identifiant, nom suffixé « (2) » si pris) ; son serveur est créé avec ses prix et son marché s'il n'existe
  pas ici (même identifiant ou même nom), sinon les prix locaux sont **gardés** (avertissement) ; le profil
  importé devient le profil actif. Les clés d'autres profils glissées dans le fichier sont ignorées.

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
automatiquement avec son profil ; ajouter un libellé dans `PAGE_PREFS` (par base ; sinon « Préférences (base) »).
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
| `ImportOptions` | `{mode?, asNewProfile?, storage?, reload?, now?}` (défauts : `'replace'`, faux, localStorage, `true`). |
| `ImportResult` | `{ok: true, mode, written, removed, warnings, profileId?}` ou `{ok: false, error}`. |
| `ScopeNames`, `scopeNamesOf(registry)` | Noms des profils et serveurs pour les libellés. |
| `KNOWN_STORES: Record<clé, libellé>` | Stores zustand dont la valeur doit être `{state: {…}, version}` (validé à l'import), dérivé de `PERSISTED_STORES` (schema.ts). |
| `STORE_VERSIONS: Record<clé, number>` | Version actuelle du schéma de chaque store (une sauvegarde plus récente est refusée). |
| `StorageUsage` | `{totalBytes, entries: {key, label, bytes}[]}`. |
| `BackupSummaryLine` | `{key, label, detail}` (« 42 montures », « règles 3.6, Éleveur niv. 87 »…). |
| `TYPICAL_STORAGE_QUOTA_BYTES` | ≈ 5 Mo (quota habituel du localStorage). |

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
| `importAll(input, opts?): ImportResult` | Valide (texte, objet ou `BackupFile`), écrit, efface en mode `replace` les clés absentes du fichier ; si une écriture échoue (quota), restaure l'état précédent. Les clés d'autres sites ne sont jamais touchées. |
| `resetAll({storage?, keep?, reload?}): string[]` | Efface les clés de l'application (sauf `keep`) ; renvoie les clés effacées. |
| `storageUsage(storage?): StorageUsage` | Taille par clé (2 octets par caractère), de la plus grosse à la plus petite. |
| `summarizeBackup(backup): BackupSummaryLine[]` | Contenu d'une sauvegarde pour l'aperçu avant import. |

## Navigateur

| Export | Rôle |
|---|---|
| `getBrowserStorage(): StorageLike \| null` | localStorage, ou null s'il est indisponible. |
| `downloadBackup(backup?, date?): string` | Télécharge la sauvegarde (défaut : instantané actuel **avec** les modifications non enregistrées, `pendingWrites()`), renvoie le nom du fichier. |
| `downloadProfileBackup(profileId, date?): string \| null` | Télécharge la sauvegarde d'un profil. |
| `readBackupFile(file: Blob): Promise<BackupValidation>` | Lit et valide un fichier choisi. |
| `reloadApp(flash?)` | Recharge l'application (sans effet hors navigateur) en laissant un message. |
| `setFlash(message)`, `takeFlash(): string \| null` | Message à afficher après le prochain chargement (sessionStorage, clé `elevagesimu-flash`, hors sauvegarde) ; affiché par `App.tsx` (`FlashBanner`) sur n'importe quelle page. |
