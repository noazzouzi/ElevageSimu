# API — Sauvegarde locale (`src/lib/backup.ts`)

Export, import et remise à zéro de **toutes** les données de l'application : chaque clé du localStorage
qui commence par `elevagesimu:` (stores zustand persistés + préférences d'affichage des pages). Les
fonctions de calcul sont pures et prennent un stockage en paramètre (`StorageLike`, défaut : localStorage
du navigateur) ; testées dans `src/lib/backup.test.ts` (25 tests, faux stockage avec quota). Page
associée : `src/ui/pages/SettingsPage.tsx` (`#/reglages`, section « Sauvegarde des données »).

```ts
downloadBackup()                                   // télécharge elevagesimu-sauvegarde-AAAA-MM-JJ-HHhMM.json
const v = await readBackupFile(file)               // décode + valide, rien n'est écrit
if (v.ok) importAll(v.backup, { mode: 'replace' }) // écrit puis recharge la page (message « flash »)
resetAll()                                         // efface les clés elevagesimu:* puis recharge
```

**Format du fichier** : `{ app: 'ElevageSimu', version: 1, exportedAt: ISO, stores: { 'elevagesimu:xxx': valeur JSON décodée }, raw?: { clé: texte } }`
(`raw` = valeurs qui n'étaient pas du JSON, recopiées telles quelles).

**Rechargement** : après un import ou une remise à zéro, l'application est rechargée
(`window.location.reload()`), seul moyen sûr de relire tous les stores **et** les préférences de page déjà
en mémoire. Un message est conservé en sessionStorage (`setFlash` / `takeFlash`) et affiché au retour.
Une nouvelle page qui persiste ses préférences sous une clé `elevagesimu:*` est sauvegardée
automatiquement ; ajouter un libellé dans `PAGE_PREFS` (sinon « Préférences (clé) »).

## Constantes et types

| Élément | Rôle |
|---|---|
| `BACKUP_APP = 'ElevageSimu'`, `BACKUP_VERSION = 1`, `STORAGE_PREFIX = 'elevagesimu:'` | Identité et version du format ; préfixe des clés de l'application. |
| `StorageLike` | `length`, `key(i)`, `getItem`, `setItem`, `removeItem` (localStorage ou faux stockage). |
| `BackupFile` | Contenu d'une sauvegarde (voir format). |
| `BackupValidation` | `{ok: true, backup, keys, warnings}` ou `{ok: false, error}` (message FR prêt à afficher). |
| `ImportMode = 'replace' \| 'merge'` | Remplacer tout l'état local, ou n'écrire que les clés présentes dans le fichier. |
| `ImportOptions` | `{mode?, storage?, reload?}` (défauts : `'replace'`, localStorage, `true`). |
| `ImportResult` | `{ok: true, mode, written, removed, warnings}` ou `{ok: false, error}`. |
| `KNOWN_STORES: Record<clé, libellé>` | Stores zustand dont la valeur doit être `{state: {…}, version}` (validé à l'import). |
| `StorageUsage` | `{totalBytes, entries: {key, label, bytes}[]}`. |
| `BackupSummaryLine` | `{key, label, detail}` (« 42 montures », « règles 3.6, Éleveur niv. 87 »…). |
| `TYPICAL_STORAGE_QUOTA_BYTES` | ≈ 5 Mo (quota habituel du localStorage). |

## Fonctions pures (testées)

| Export | Rôle |
|---|---|
| `isAppKey(key): boolean` | La clé est-elle `elevagesimu:<quelque chose>` ? |
| `appKeys(storage?): string[]` | Clés de l'application présentes, triées. |
| `storeLabel(key): string` | Libellé lisible d'une clé. |
| `exportAll(storage?, now?): BackupFile` | Instantané de toutes les clés de l'application (valeurs décodées). |
| `serializeBackup(backup): string` | JSON indenté. |
| `backupFileName(date?): string` | Nom de fichier daté (heure locale). |
| `validateBackup(data): BackupValidation` | Vérifie `app`, `version` (entier ≥ 1, ≤ `BACKUP_VERSION`), `stores`, forme des stores connus ; ignore (avec avertissement) les clés étrangères ; signale sauvegarde vide et date illisible. |
| `parseBackup(text): BackupValidation` | `JSON.parse` + `validateBackup`. |
| `importAll(input, opts?): ImportResult` | Valide (texte, objet ou `BackupFile`), écrit, efface en mode `replace` les clés absentes du fichier ; si une écriture échoue (quota), restaure l'état précédent. Les clés d'autres sites ne sont jamais touchées. |
| `resetAll({storage?, keep?, reload?}): string[]` | Efface les clés de l'application (sauf `keep`) ; renvoie les clés effacées. |
| `storageUsage(storage?): StorageUsage` | Taille par clé (2 octets par caractère), de la plus grosse à la plus petite. |
| `summarizeBackup(backup): BackupSummaryLine[]` | Contenu d'une sauvegarde pour l'aperçu avant import. |

## Navigateur

| Export | Rôle |
|---|---|
| `getBrowserStorage(): StorageLike \| null` | localStorage, ou null s'il est indisponible. |
| `downloadBackup(backup?, date?): string` | Télécharge la sauvegarde (défaut : `exportAll()`), renvoie le nom du fichier. |
| `readBackupFile(file: Blob): Promise<BackupValidation>` | Lit et valide un fichier choisi. |
| `reloadApp(flash?)` | Recharge l'application (sans effet hors navigateur) en laissant un message. |
| `setFlash(message)`, `takeFlash(): string \| null` | Message à afficher après le prochain chargement (sessionStorage, clé `elevagesimu-flash`, hors sauvegarde). |
