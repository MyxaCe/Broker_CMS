export { buildChain, collectSubtree, MAX_CHAIN_DEPTH, TenantChainError } from './chain'
export {
  canAccessTenant,
  expandTenantScope,
  resolveEffectiveAccess,
  resolveTenantAccess,
} from './access'
export {
  canRevertToInherited,
  resolveCollection,
  resolveField,
  revertLeavesEmpty,
} from './inheritance'
export { validateTenantDraft } from './tenant-rules'
export type { TenantDraft } from './tenant-rules'
export {
  COLLECTION_MODES,
  INHERITABLE_COLLECTIONS,
  INHERITABLE_SCALARS,
  readCollectionLayer,
  readScalarLayer,
  resolveTenantSettings,
  SCALAR_MODES,
  validateResolvedSettings,
} from './layers'
export type { TenantLayerSource, TenantSettings } from './layers'
export {
  loadTenantChainIds,
  loadTenantLayers,
  resolveTenant,
  resolveTenantById,
} from './resolve-tenant'
export {
  createTenantAccess,
  crossTenantOnly,
  crossTenantOnlyField,
  crossTenantOrSelf,
  decisionToWhere,
  isCrossTenantActor,
} from './payload-access'
export type { TenantAccessOptions } from './payload-access'
export type {
  AccessDecision,
  Actor,
  CollectionEntry,
  CollectionLayerState,
  CollectionResolution,
  FieldResolution,
  LayerState,
  Provenance,
  TenantKind,
  TenantNode,
} from './types'
