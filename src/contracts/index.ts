/**
 * `contracts` — канон внешнего контракта.
 *
 * Здесь живут JSON Schema ответов доставки, сгенерированные из них типы и
 * эталонные фикстуры. Это единственный источник истины по форме выдачи:
 * схема — закон на обеих границах (ТЗ разд. 3).
 *
 * Правила:
 *  · каждый ответ валидируется схемой ПЕРЕД отправкой наружу;
 *  · каждый внешний ответ (MDS) валидируется схемой ПЕРЕД использованием;
 *  · каждое поле схемы с `format`, `enum` или `pattern` обязано иметь
 *    эквивалентный валидатор в админке — асимметрия «строгий выход, свободный
 *    вход» и есть причина падений;
 *  · схемы пишутся заново под новую модель. Схемы существующей CMS описывают
 *    модель из 14 плоских ресурсов и не переиспользуются (ADR-0006).
 *
 * Слой ничего не импортирует из `platform` и `modules` — и это принуждается
 * линтером. Канон, зависящий от реализации, перестаёт быть каноном: его начнут
 * править под удобство кода.
 */

export { CONTRACT_VERSION, ERROR_CODES } from './types'
export type {
  ArticleFeedItemResponse,
  ArticleFeedResponse,
  ErrorCode,
  ErrorResponse,
  FeedItemReference,
  PromoBoardResponse,
  PromoItemResponse,
  SearchHitResponse,
  SearchResponse,
  SiteConfigResponse,
  VideoFeedItemResponse,
  VideoFeedResponse,
} from './types'

export {
  checkAgainstSchema,
  ContractViolationError,
  SCHEMA_IDS,
  validateOutgoing,
} from './validate'
export type { ContractIssue, SchemaId } from './validate'
