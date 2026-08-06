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

export { contrastValidator, forbiddenClaimsValidator, tokenGraphValidator } from './validators'
export type { ColorPair, ContrastInput, ForbiddenClaimsInput, TokenGraphInput } from './validators'

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
