/**
 * Модуль `stream` — часть 1 ТЗ: контент с временем жизни.
 * Новости, видео и эфиры, промо, обучение, статус сервисов, авторы, таксономии.
 *
 * Публикуется ВНЕ релизов, мгновенно (ADR-0021). Короткий TTL и точечный purge
 * по тегам; срок жизни ответа ограничен ближайшим переходом видимости.
 *
 * Границы: использует `@/platform`, не знает о `@/modules/delivery`.
 * Всё, что не экспортировано отсюда, — внутренность модуля.
 */

export {
  createStreamReadAccess,
  createStreamWriteAccess,
  streamDeleteAccess,
  andWhere,
} from './access'

export {
  earliestTransition,
  isVisible,
  nextTransitionAt,
  publishedWhere,
  STREAM_STATUS_LABELS,
  STREAM_STATUSES,
  VISIBILITY_STATES,
  visibilityState,
} from './visibility'
export type { Publishable, StreamStatus, VisibilityState } from './visibility'

export { publishingFields, siteField } from './publishing-fields'

export { countWords, estimateReadingMinutes, extractText } from './articles/reading-time'

export { Articles } from './articles/articles.collection'
export { Authors } from './taxonomy/authors.collection'
export { Categories } from './taxonomy/categories.collection'
export { Tags } from './taxonomy/tags.collection'

export const MODULE_NAME = 'stream' as const
