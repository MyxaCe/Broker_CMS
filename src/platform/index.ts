/**
 * Публичный интерфейс платформенного слоя.
 *
 * `platform` — общее основание: тенанты и наследование, аутентификация, роли и
 * доступ, воркфлоу, аудит, медиа, планировщик. Оно НЕ знает о доменных модулях;
 * зависимость направлена только вниз (`modules → platform`) и принуждается
 * линтером.
 *
 * Всё, что не экспортировано отсюда, считается внутренностью и недоступно
 * извне — импорт `@/platform/<область>/<файл>` падает в CI.
 */

export {
  bootstrapEnv,
  describeEnv,
  ensureEnv,
  getEnv,
  initEnv,
  isSecretKey,
  loadEnv,
  EnvValidationError,
} from './config'
export type { Env } from './config'

export {
  APPROVER_ROLE,
  CROSS_TENANT_ROLES,
  isCrossTenantRole,
  ROLE_LABELS,
  ROLES,
} from './auth/roles'
export type { Role } from './auth/roles'

export { DECLARED_ROUTE_FILES, scanRouteFiles } from './http/declared-routes'

export { toActor } from './auth/actor'
export { validateUserDraft } from './auth/user-rules'
export type { UserDraft } from './auth/user-rules'
export { normalizeRelationId, normalizeRelationIds } from './shared/relation'

export {
  buildChain,
  canAccessTenant,
  createTenantAccess,
  crossTenantOnly,
  crossTenantOnlyField,
  crossTenantOrSelf,
  decisionToWhere,
  isCrossTenantActor,
  canRevertToInherited,
  collectSubtree,
  expandTenantScope,
  MAX_CHAIN_DEPTH,
  resolveCollection,
  resolveEffectiveAccess,
  resolveField,
  resolveTenantAccess,
  revertLeavesEmpty,
  TenantChainError,
  validateTenantDraft,
} from './tenancy'
export type {
  AccessDecision,
  Actor,
  CollectionEntry,
  CollectionLayerState,
  CollectionResolution,
  FieldResolution,
  LayerState,
  Provenance,
  TenantDraft,
  TenantKind,
  TenantNode,
} from './tenancy'
