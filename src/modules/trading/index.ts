/**
 * Модуль `trading` — часть 4 ТЗ: торговая часть.
 * Тема и layout терминала, локальный снапшот вселенной MDS, allow-list символов,
 * вотчлисты, конфигурация кабинета, витрина торговых условий.
 *
 * CMS никогда не обращается к MDS синхронно — только фоновый воркер и только в
 * собственный снапшот (ТЗ 4.2). Витрина торговых условий не является источником
 * истины (ADR-0004); режим работы задаётся `TRADING_TERMS_MODE` (ADR-0005).
 *
 * Границы: использует `@/platform`, не знает о `@/modules/delivery`.
 *
 * Собран allow-list инструментов (Р-026, ADR-0030). Остальное — этап M4.
 */

export const MODULE_NAME = 'trading' as const

export {
  allowedSymbols,
  checkAllowList,
  requiresConfirmation,
  standingOf,
  ALLOW_LIST_ISSUE_CODES,
  STANDING_LABELS,
  STANDING_REASONS,
  STANDINGS,
} from './allow-list/rules'
export type {
  AllowListCheck,
  AllowListInput,
  AllowListIssue,
  AllowListIssueCode,
  AllowListRow,
  Standing,
} from './allow-list/rules'

export { isValidSymbol, normalizeSymbol, SYMBOL_PATTERN } from './allow-list/symbol'

export {
  buildUniverseSnapshot,
  coverageOf,
  SYNC_OUTCOME_LABELS,
  SYNC_OUTCOMES,
} from './allow-list/universe'
export type {
  SyncOutcome,
  UniverseCoverage,
  UniverseEntry,
  UniverseSnapshot,
  UniverseState,
} from './allow-list/universe'

export { EMPTY_ALLOW_LIST, resolveAllowList, resolveFromDoc } from './allow-list/resolve'
export type { AllowListResolution } from './allow-list/resolve'

export { InstrumentAccess } from './allow-list/instrument-access.collection'
export { MdsInstruments, MdsUniverseSyncs } from './universe/collections'

export { fetchUniverse, parseQuotedSymbols, parseUniverse } from './universe/mds'
export type { FetchLike, UniverseFetch } from './universe/mds'

export { readUniverse, syncUniverse } from './universe/sync'
export type { SyncResult } from './universe/sync'
