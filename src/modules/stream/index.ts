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
export { toVideoFeedItem } from './feed/video-item'
export type { VideoFeedItem } from './feed/video-item'
export { loadPromoBoard, toPromoItem } from './feed/promo-board'
export type { PromoBoard, PromoItem } from './feed/promo-board'
export { loadArticleFeed, loadStreamFeed, loadVideoFeed } from './feed/load'
export type { FeedPage } from './feed/load'

export {
  BROADCAST_LABELS,
  BROADCAST_STATES,
  broadcastState,
  nextBroadcastTransition,
} from './video/broadcast'
export type { Broadcast, BroadcastState } from './video/broadcast'

export { ownerOf, siteOf, tenantOfField } from './shared/site-of'

export {
  changedTagsFor,
  SCHEDULED_COLLECTIONS,
  TRANSITION_KINDS,
  transitionWindow,
} from './schedule/transitions'
export type { PendingTransition, ScheduledCollection, TransitionKind } from './schedule/transitions'

export { Articles } from './articles/articles.collection'
export { Videos, VIDEO_PROVIDERS } from './video/videos.collection'
export type { VideoProvider } from './video/videos.collection'
export { Promos } from './promo/promos.collection'
export { Authors } from './taxonomy/authors.collection'
export { Categories } from './taxonomy/categories.collection'
export { Tags } from './taxonomy/tags.collection'

export const MODULE_NAME = 'stream' as const
