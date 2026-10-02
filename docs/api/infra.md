# API — Infrastructure : persistance, temps serveur, formatage, champs

Modules transverses (tranche « robustesse ») : `src/store/schema.ts`, `src/store/persistence.ts`,
`src/store/sync.ts`, ajouts aux stores `settings`, `inventory`, `prices`, `journal`,
`src/domain/almanax.ts` (heure du serveur), `src/ui/useServerDay.ts`, `src/lib/format.ts`,
`NumberField` / `StorageAlerts` / `DataRecoveryActions` (`src/ui/components.tsx`).
Tests : `src/store/stores.test.ts` (jsdom), `src/lib/backup.test.ts`, `src/domain/almanax.test.ts`
(plusieurs fuseaux), `src/lib/format.test.ts`, `src/ui/components.test.tsx` (jsdom).

## Persistance des stores (`src/store/persistence.ts`, `src/store/schema.ts`)

```ts
import { STORE_KEYS } from './profiles'            // clés du profil ouvert (v2)
export const useXxx = create<XxxStore>()(
  persist((set) => ({ … }), persistOptions<XxxStore, XxxData>({ name: STORE_KEYS.xxx, sanitize: sanitizeXxx, migrate? })),
)
syncAcrossTabs(useXxx)
```

**v2 — profils et serveurs** (`docs/api/profiles.md`) : les stores ne lisent plus `elevagesimu:<base>` mais
`elevagesimu:p:<profil>:<base>` (données du profil) ou `elevagesimu:s:<serveur>:<base>` (prix saisis, marché
importé et son historique). Le profil ouvert est résolu de façon synchrone par `src/store/profiles.ts`
(importé par chaque store) **avant** la création des stores ; `STORE_KEYS` (exporté par `profiles.ts`, plus
par `schema.ts`) en donne les clés. Nouveau store : déclarer sa base dans `STORE_BASES` (schema.ts, avec
`scope: 'profile' | 'server'`), puis `name: STORE_KEYS.<base>`. Préférences de page : `profileKey(base)`.

| Garantie | Comment |
|---|---|
| Version plus **récente** que l'application (onglet resté sur une ancienne version, sauvegarde d'une version plus récente…) | La donnée stockée est **gardée telle quelle** : écriture bloquée pour cette clé, état affiché au mieux (normalisé), alerte « Données d'une version plus récente » (recharger, télécharger une sauvegarde, ou écraser après confirmation : `overwriteBlocked(key)`). |
| Version plus **ancienne** | `migrate(state, from)` (identité par défaut) : jamais de remise à zéro. La version migrée est enregistrée aussitôt. |
| Donnée **illisible** (JSON cassé, forme inattendue) ou erreur de migration/normalisation | Gardée telle quelle (écriture bloquée), alerte « Données illisibles » ; « Repartir de zéro » après confirmation. |
| Donnée **mal formée** | `sanitize` à chaque lecture : entrée inutilisable écartée, champ invalide → valeur neutre ou par défaut, nombres bornés ; alerte « Données corrigées » (« 2 montures inutilisables ignorées… »). Un prix invalide est **retiré**, jamais remplacé par 0. |
| **Écriture refusée** (quota plein, stockage indisponible) | Plus d'exception au milieu d'une action : l'état en mémoire reste cohérent, l'échec est signalé (« Modifications non enregistrées »), la valeur est gardée (`pendingWrites()`, incluse dans `downloadBackup()`) et réécrite au prochain enregistrement réussi ou via `retryPendingWrites()`. |
| **Plusieurs onglets** | `syncAcrossTabs(store)` : un seul écouteur « storage » ; quand un autre onglet écrit une clé, le store la relit (sans la réécrire) ; si elle est effacée, il revient à son état initial. `src/store/sync.ts` (importé par `settings.ts`) enregistre aussi `usePaddocks`, `usePaddockPlans`, `usePlanProgress` (sans effet s'ils se sont déjà enregistrés). Les **7 stores** passent désormais par `persistOptions` (versions, normalisation, écriture sûre). |

| Export | Rôle |
|---|---|
| `STORE_BASES: Record<StoreBase, {label, version, scope}>` (schema) | Source unique des libellés, **versions** et portées des stores (`settings`, `inventory`, `paddocks`, `paddockPlans`, `planProgress`, `journal` : profil ; `prices`, `market`, `market-history` : serveur). Changer une forme = incrémenter la version ici + fournir la migration. |
| `STORE_KEYS` (**profiles.ts**), `profileKey(base)`, `serverKey(base)` | Clés du profil et du serveur ouverts. |
| `persistedStoreInfo(key)` (schema) | `{label, version, scope, base}` d'une clé de store sous n'importe quelle forme (profil, serveur, ancienne clé) ; undefined pour une préférence de page ou une base hors de sa portée. `storeVersion(key)` s'appuie dessus. |
| `profileStoreKey(id, base)`, `serverStoreKey(id, base)`, `storeKeysFor(profil, serveur)`, `parseStoreKey(key)` → `{kind: 'profile' \| 'server' \| 'global' \| 'legacy', id?, base}`, `isValidScopeId`, `PROFILES_KEY`, `GLOBAL_KEYS`, `LEGACY_STORE_KEYS`, `STORAGE_PREFIX`, `StorageLike` (schema) | Construction et analyse des clés. |
| `PERSISTED_STORES` (schema) | Compatibilité : stores d'avant les profils, par ancienne clé (sauvegardes v1). |
| `normalizeStoreValue(key, value)` (schema) | `{state, version}` → refus si version plus récente / structure inattendue ; sinon migration + normalisation : `{ok, value: {state, version: actuelle}, issues}` — pour la clé de n'importe quel profil ou serveur. |
| `registerStoreSchema(keyOrBase, {migrate?, sanitize?})` (schema) | Déclare la normalisation d'un store défini ailleurs, par **base** (`'paddocks'`) ou par clé : `paddocks.ts`, `paddockPlans.ts` et `planProgress.ts` y inscrivent leur sanitizer, appliqué aussi à l'import d'une sauvegarde. Les sanitizers du marché (`sanitizeMarketState`, `sanitizeMarketHistoryState`) sont inscrits directement dans schema.ts. |
| `sanitizeSettings(raw, now?)`, `migrateSettings(raw, from, now?)`, `sanitizeMount(raw)`, `sanitizeInventory(raw)`, `sanitizePrices(raw)`, `sanitizeJournal(raw)` (schema) | Normalisations pures (`{state, issues}`), jamais d'exception. |
| `Settings`, `Goal`, `DEFAULT_SETTINGS`, `SETTINGS_BOUNDS` (schema, ré-exportés par `settings.ts`) | Type, valeurs par défaut et bornes des réglages. |
| `persistOptions(cfg)` | Options de `persist` ci-dessus (`name`, `version?` = `PERSISTED_STORES`, `sanitize`, `migrate?`, `partialize?`). |
| `safeStorage` | `PersistStorage` qui ne lève jamais d'exception. |
| `syncAcrossTabs(store)` | Synchronisation entre onglets (sans effet hors navigateur). |
| `useStorageHealth` | Store non persisté : `issues: StorageIssue[]` (`key, kind: 'ecriture' \| 'version' \| 'illisible' \| 'corrige', label, message, quota?, at`), `dismiss(key, kind)`. |
| `retryPendingWrites()`, `pendingWrites()`, `writeBlockReason(key)`, `overwriteBlocked(key)` | Réessai, valeurs non enregistrées, blocage d'une clé, levée du blocage (écrase la donnée stockée). |
| `freezeWrites()`, `writesFrozen()` | Bloque toute écriture des stores jusqu'au rechargement (changement / suppression de profil, import, remise à zéro) : un store ne peut plus réécrire les données d'un profil supprimé. |
| `safeWriteText(key, text)` | Écriture sûre hors store (registre des profils, marché d'un autre serveur) : échec signalé, renvoie `false`. |
| `reportStorageIssue({key, kind, message, label?})` | Signale un problème de stockage (bandeau) pour une donnée hors store zustand. |

Les alertes s'affichent en haut de chaque page via `PageHeader` (`StorageAlerts`). Le message laissé avant
un rechargement (`setFlash`, import, changement de profil) est affiché par `App.tsx` (`FlashBanner`), quelle
que soit la page. `DataRecoveryActions`
(télécharger une sauvegarde, réinitialiser les réglages avec confirmation) est affiché dans le filet d'erreur
de page (`App.tsx`, `PageBoundary`), qui retente l'affichage quand l'adresse change (autre onglet, autre enclos).

## Ajouts aux stores

| Store | Ajout |
|---|---|
| `useSettings` | `almanaxGaugeDoubling` (booléen, défaut **false**) : appliquer aux plans et projections d'enclos le doublement Almanax d'une jauge (« effet doublé », non vérifié) — seulement pendant le jour de jeu Almanax (heure de Paris). Ajouté sans changement de version (champ absent → valeur par défaut). |
| `useSettings` | `jobLevelUpdatedAt` (ms) : instant de la dernière saisie de `jobLevel`, mis à jour par `update({jobLevel})` quand le niveau change (sauf si fourni) ; `reset()` le date de maintenant ; 0 = tout le journal compte. Migration v2 → v3 : niveau > 1 daté de la migration, niveau 1 → 0. |
| `useInventory` | `removeMany(ids)`, `updateMany(ids, patch)`, `patchMany({id: patch})` : actions groupées en **une** écriture (à utiliser pour les suppressions/marquages multiples). |
| `useJournal` | `removeBefore(ms)` (alléger le journal, renvoie le nombre supprimé) ; `journalJobXp(entries, since)` → `{xp, entries, captures, matings, crafts}` : XP d'Éleveur enregistrée après `since` (captures × 30, accouplements et crafts : XP de l'entrée). Niveau estimé = `jobLevelFromXp(jobXpForLevel(jobLevel) + xp)` (plancher : bonus Almanax non comptés). |
| `usePrices` | Un prix négatif ou non numérique est retiré (« pas de prix »), jamais enregistré. `usePriceContext()` inclut désormais **`jobLevel`** (réglages) : une recette hors de portée prend le prix HDV sur toutes les pages (la page Métier l'omet, son plan de montée fabrique aux niveaux futurs). |
| `usePlanProgress` | `persistOptions` + `sanitizePlanProgress(raw)` (entrées « clé → instant » invalides écartées). |
| `usePrices` (v2) | Clé du **serveur** ouvert (`elevagesimu:s:<serveur>:prices`) : partagés par les profils du serveur. `usePriceContext()` inclut `market` (marché importé du serveur, statistique du serveur) : ordre prix saisi > marché > défaut > craft (`docs/api/market.md`). |
| `useSettings` (v2) | Clé du profil ; `server` = libellé dérivé du serveur ouvert, `update({server})` renomme le serveur ouvert. |
| `useMarket`, `useMarketHistory` (v2, `src/store/market.ts`) | Marché importé du serveur ouvert et historique des imports (`docs/api/market.md`). |

## Jour de jeu (`src/domain/almanax.ts`, `src/ui/useServerDay.ts`)

Les jours Almanax et Takeza suivent l'heure des serveurs (**Europe/Paris**), pas celle du navigateur.

| Export | Rôle |
|---|---|
| `SERVER_TZ = 'Europe/Paris'` | Fuseau des serveurs. |
| `serverDay(ms)` | AAAA-MM-JJ du jour de jeu, quel que soit le fuseau du navigateur. **À utiliser pour toute recherche Almanax/Takeza/bonus du métier.** |
| `almanaxAt(ms)` | `almanaxOn(serverDay(ms))`. |
| `upcomingAlmanax(nowMs, days)`, `upcomingAlmanaxFrom(todayIso, days)` | Bonus à venir (jours de calendrier, sans saut ni doublon au changement d'heure). |
| `serverDayStart(iso)`, `nextServerDayStart(ms)`, `serverUtcOffsetMs(ms)` | Minuit à Paris (ms), prochain changement de jour, décalage UTC de Paris. |
| `serverDayChangeIfNotLocalMidnight(dayOrMs)` | Instant où le jour de jeu se termine si ce n'est pas minuit chez le joueur (ex. 18:00 au Québec), sinon null. |
| `addIsoDays(iso, n)`, `isoDaysBetween(a, b)` | Arithmétique de dates de calendrier. |
| `isoDay(ms)` | Date **locale** du navigateur (affichage purement local seulement). Plus aucun appel Almanax/Takeza ne l'utilise : conseiller (`analyzeState`, échéances `dueAt` = `serverDayStart`), Accueil, Plan, Enclos, plans d'enclos (`fertility.almanaxScheduleFrom`) et projections sont en jour de jeu. |
| `useServerDay()` (hook) | Jour de jeu courant, mis à jour à minuit (heure de Paris), au retour sur l'onglet et au focus : remplace `useMemo(() => isoDay(Date.now()), [])` figé au montage. |

## Formatage (`src/lib/format.ts`)

| Export | Rôle |
|---|---|
| `formatDuration(s, {long?})` | Helper **unique** des durées : court « 4 h 09 », « 1 j 2 h » ; `long` « 4 h 09 min », « 1 j 2 h 05 min » (`paddock.formatDuration` n'en est plus qu'un appel en format long). |
| `formatKamasRange({low, high}, compact?)` | Intervalle de kamas : exact, « X à Y », « ≤ Y », « ≥ X » ou « inconnu » — jamais « ≈ » pour un montant incomplet (classement du Plan). |
| `plural(n, one, many?)`, `pluralWord(n, one, many?)` | « 3 montures » / « montures » (pluriel à partir de 2). |
| `capitalize(text)` | Première lettre en majuscule. |
| `formatInDays(n)` | « aujourd’hui », « demain », « dans 12 jours », « il y a 3 jours ». |
| `formatIsoDay(iso, {year?})` | « lundi 12 octobre [2026] » d'une date AAAA-MM-JJ, indépendant du fuseau. |

## `NumberField` (`src/ui/components.tsx`)

`<NumberField label value onChange min? max? step? integer? suffix? width? />` : brouillon local ; la
saisie est validée (bornée, arrondie si `integer`, défaut : `step` absent ou entier) **en quittant le
champ ou avec Entrée**, et `onChange` n'est appelé que si la valeur change. Pendant la saisie, une valeur
hors bornes ou non entière est signalée (`aria-invalid` + message « ramenée à … »), pas corrigée ; un
champ vidé reprend la valeur précédente ; Échap annule ; flèches et boutons du champ valident tout de
suite. `commitNumberDraft(text, {min, max, integer})` expose la règle de validation.
