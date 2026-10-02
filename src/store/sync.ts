// Synchronisation entre onglets des stores persistés qui ne passent pas (encore) par
// `persistOptions` (src/store/persistence.ts) : enclos, plans d'enclos, avancement du plan. Les stores
// réglages, montures, prix et journal s'enregistrent eux-mêmes. Importé pour son effet par
// src/store/settings.ts (chargé par toutes les pages). Un double enregistrement est sans effet.
import { usePaddockPlans } from './paddockPlans'
import { usePaddocks } from './paddocks'
import { syncAcrossTabs } from './persistence'
import { usePlanProgress } from './planProgress'

syncAcrossTabs(usePaddocks)
syncAcrossTabs(usePaddockPlans)
syncAcrossTabs(usePlanProgress)
