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

export { contrastValidator, forbiddenClaimsValidator } from './validators'
export type { ColorPair, ContrastInput, ForbiddenClaimsInput } from './validators'

export const MODULE_NAME = 'design' as const
