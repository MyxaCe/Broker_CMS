/**
 * Модуль `design` — часть 2 ТЗ: дизайн-система и композиция.
 *
 * Токены (примитив → семантическая роль → токен компонента), реестр блоков,
 * переиспользуемые секции, конструктор страниц, навигация, SEO,
 * комплаенс-ограничители.
 *
 * Свободного CSS не существует: `block.style` берёт значения только из токенов.
 *
 * Границы: использует `@/platform`, не знает о `@/modules/delivery`.
 */

export {
  AA_LARGE_TEXT,
  AA_NON_TEXT,
  AA_NORMAL_TEXT,
  ColorParseError,
  contrastRatio,
  meetsAA,
  parseColor,
  relativeLuminance,
  requiredRatio,
} from './contrast'
export type { ContrastUsage } from './contrast'

export { DEFAULT_FORBIDDEN_PHRASES, findForbiddenPhrases } from './forbidden-claims'
export type { ContentClass, ForbiddenMatch, TextItem } from './forbidden-claims'

export {
  complianceValidator,
  contrastValidator,
  forbiddenClaimsValidator,
  tokenGraphValidator,
} from './validators'
export type {
  ColorPair,
  ComplianceValidatorInput,
  ContrastInput,
  ForbiddenClaimsInput,
  TokenGraphInput,
} from './validators'

export { isKnownJurisdiction, JURISDICTIONS, requirementsFor } from './compliance/jurisdictions'
export type { JurisdictionRequirements } from './compliance/jurisdictions'

export {
  BLOCK_DISCLAIMERS,
  checkImageAlt,
  checkJurisdictionVisibility,
  checkRiskWarning,
  collectBlocks,
  collectMediaReferences,
  requiredDisclaimers,
  runComplianceRules,
} from './compliance/rules'
export type {
  ComplianceFinding,
  ComplianceInput,
  CompliancePageInput,
  RiskWarningArea,
} from './compliance/rules'

export { loadComplianceInput } from './compliance/load'
export {
  GLOBAL_AREA_KINDS,
  GLOBAL_AREA_LABELS,
  GlobalAreas,
} from './compliance/global-areas.collection'
export type { GlobalAreaKind } from './compliance/global-areas.collection'

export {
  PRIMITIVE_CATEGORIES,
  PRIMITIVE_CATEGORY_LABELS,
  ROLE_GROUP_LABELS,
  ROLE_GROUPS,
  THEMES,
  TOKEN_NAME_PATTERN,
  TOKEN_SOURCES,
} from './tokens/types'
export type {
  ComponentToken,
  Primitive,
  PrimitiveCategory,
  RoleGroup,
  SemanticRole,
  Theme,
  TokenSet,
  TokenSource,
} from './tokens/types'

export { mergeTokenSets, resolveTokens, TokenResolutionError } from './tokens/resolve'
export type { ResolvedTokens, TokenIssue } from './tokens/resolve'

export { collectContrastPairs, REQUIRED_CONTRAST_PAIRS } from './tokens/contrast-pairs'
export type { ContrastRequirement } from './tokens/contrast-pairs'

export {
  BLOCK_ALIGNMENTS,
  BLOCK_THEMES,
  BLOCK_WIDTHS,
  BREAKPOINTS,
  DEFAULT_BLOCK_STYLE,
  DEFAULT_BLOCK_VISIBILITY,
  PADDING_STEPS,
  validateBlockStyle,
} from './blocks/style'
export type {
  BlockAlignment,
  BlockStyle,
  BlockTheme,
  BlockVisibility,
  BlockWidth,
  Breakpoint,
  PaddingStep,
  StyleIssue,
} from './blocks/style'

export {
  BLOCK_GROUP_LABELS,
  BLOCK_GROUPS,
  BLOCK_REGISTRY,
  BOUND_COLLECTIONS,
  findBlock,
  isAllowedSlot,
  isAllowedVariant,
  isKnownBlock,
} from './blocks/registry'
export type { BlockDefinition, BlockGroup, BoundCollection } from './blocks/registry'

export { MAX_BLOCK_DEPTH, validateBlockTree } from './blocks/validate-tree'
export type { BlockNode, TreeContext, TreeIssue } from './blocks/validate-tree'

export {
  findRedirectIssues,
  isValidPath,
  normalizePath,
  PATH_PATTERN,
  ROOT_PATH,
} from './pages/path'
export type { RedirectIssue, RedirectRule } from './pages/path'

export { Pages } from './pages/pages.collection'

export { loadTokenSet } from './tokens/load'
export { DesignComponentTokens, DesignPrimitives, DesignRoles } from './tokens/collections'

export {
  CSS_VARIABLE_PREFIX,
  cssVariableName,
  sanitizeCssValue,
  TOKEN_EXPORT_SCHEMA_VERSION,
  toCssCustomProperties,
  toTokenJson,
} from './tokens/export'
export type { CssExportOptions, TokenJsonExport } from './tokens/export'

export const MODULE_NAME = 'design' as const
