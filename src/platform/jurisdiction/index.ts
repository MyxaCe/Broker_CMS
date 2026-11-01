/**
 * Профиль юрисдикции и стартовый баланс счёта (CMS-24, CMS-25; Р-236, Р-237).
 *
 * Именованная сущность, где собраны регуляторные числа, и правило стартового
 * баланса, разведённое по типу счёта. Коллекция Payload регистрируется в
 * корневой конфигурации; наружу отсюда уходит только чистое ядро — типы,
 * дефолт и функции разрешения, покрытые тестами.
 */

export {
  CLIENT_CATEGORIES,
  CLIENT_CATEGORY_LABELS,
  DEFAULT_JURISDICTION_CODE,
  SEYCHELLES_DEFAULT_PROFILE,
  isClientCategory,
  profileForCode,
  resolveDefaultProfile,
} from './profile'
export type { ClientCategory, JurisdictionProfile } from './profile'

export {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  REAL_ACCOUNT_START_BALANCE_MINOR_UNITS,
  isAccountType,
  resolveStartBalance,
} from './start-balance'
export type { AccountType, StartBalanceResolution, StartBalanceSource } from './start-balance'

export { JurisdictionProfiles } from './jurisdiction-profiles.collection'
