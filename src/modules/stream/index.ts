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

export { afterCursorWhere, CursorError, decodeCursor, encodeCursor } from './feed/cursor'
export type { CursorPosition } from './feed/cursor'
export { mapFeed, MappingError, requireText, requireValue } from './feed/mapper'
export type { MappedItem, MappingOutcome } from './feed/mapper'
export {
  buildFeedQuery,
  buildPinnedQuery,
  DEFAULT_PAGE_SIZE,
  FEED_SORT_FIELD,
  FeedQueryError,
  MAX_PAGE_SIZE,
} from './feed/query'
export type { FeedFilters, FeedQuery, FeedRequest } from './feed/query'
export { toArticleFeedItem } from './feed/article-item'
export type { ArticleFeedItem } from './feed/article-item'
export { loadArticleFeed } from './feed/load'
export type { FeedPage } from './feed/load'

export { Articles } from './articles/articles.collection'
export { Authors } from './taxonomy/authors.collection'
export { Categories } from './taxonomy/categories.collection'
export { Tags } from './taxonomy/tags.collection'

export const MODULE_NAME = 'stream' as const
