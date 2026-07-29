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
