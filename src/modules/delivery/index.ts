/**
 * Модуль `delivery` — часть 3 ТЗ: плоскость доставки.
 *
 * Единственная дверь наружу: версионированный API, релизы и каналы, кеш и
 * инвалидация, события через outbox, ключи и скоупы.
 *
 * Сквозной слой: читает публичные интерфейсы `stream`, `design`, `trading` и
 * `@/platform`. Обратной зависимости нет — это условие, при котором delivery
 * позже выделяется в отдельный сервис без переписывания.
 *
 * Ответ доставки — функция от кортежа разрешённых измерений (ADR-0003):
 *   (site, releaseId, locale, jurisdiction, variant) → ответ
 * Все пять участвуют в ключе кеша и в ETag с этапа M1; до M5 `jurisdiction`
 * берётся из карточки тенанта, а `variant` всегда `default`.
 */

export {
  buildCacheKey,
  buildETag,
  CACHE_KEY_VERSION,
  CacheKeyError,
  contentHash,
  DEFAULT_VARIANT,
  matchesETag,
} from './cache-key'
export type { CacheKeyInput, ResolutionAxes } from './cache-key'

export {
  FIRST_RELEASE_NUMBER,
  nextReleaseNumber,
  ReleaseNumberingError,
} from './releases/numbering'

export {
  BASE_DELAY_MS,
  isExhausted,
  MAX_ATTEMPTS,
  MAX_DELAY_MS,
  nextAttemptAt,
  nextAttemptDelayMs,
} from './events/backoff'
export {
  buildEnvelope,
  buildRoutingKey,
  CMS_EVENTS,
  EVENT_DOMAIN,
  EVENT_VERSION,
  RoutingKeyError,
} from './events/envelope'
export type { CmsEventName, EventEnvelope } from './events/envelope'
export { enqueueEvent } from './events/enqueue'
export type { EnqueueArgs } from './events/enqueue'
export { AmqpPublisher, drainOutbox } from './events/publisher'
export type { DrainResult, Publisher } from './events/publisher'
export { runScheduleTick } from './events/schedule-worker'
export type { ScheduleWorkerOptions, ScheduleWorkerResult } from './events/schedule-worker'
export { runPublishWorker } from './events/publish-worker'
export type { PublishWorkerOptions, PublishWorkerResult } from './events/publish-worker'
export { Outbox } from './events/outbox.collection'

export { authorizeDeliveryRequest } from './keys/authorize'
export type { AuthDecision, DenyReason, StoredKey } from './keys/authorize'
export {
  extractBearer,
  generateKey,
  hashSecret,
  KEY_PREFIX,
  KeyFormatError,
  parseKey,
  secretMatches,
} from './keys/key-format'
export type { GeneratedKey, ParsedKey } from './keys/key-format'
export {
  DELIVERY_SCOPES,
  hasScope,
  isDeliveryScope,
  normalizeScopes,
  SCOPE_LABELS,
} from './keys/scopes'
export type { DeliveryScope } from './keys/scopes'
export { issueDeliveryKey, verifyDeliveryKey } from './keys/issue'
export type { IssuedKey } from './keys/issue'
export { DeliveryKeys } from './keys/keys.collection'

export { buildSiteConfigResponse, DeliveryAssemblyError, resolveLocale } from './api/site-config'
export type { ReleaseFacts, SiteConfigRequest } from './api/site-config'
export { errorResponse, handleSiteConfig, openDeliveryRequest } from './api/handler'
export type {
  ArticleFeedFilters,
  DeliveryRequest,
  DeliveryResponse,
  DeliverySource,
  ResolvedRelease,
  SiteResolution,
} from './api/handler'
export {
  buildArticleFeedResponse,
  buildPromoBoardResponse,
  buildVideoFeedResponse,
} from './api/article-feed'
export type { FeedResolution } from './api/article-feed'
export {
  BASE_FEED_TTL_SECONDS,
  feedTtlSeconds,
  filtersOf,
  handleArticleFeed,
  handlePromoBoard,
  handleSyndication,
  handleVideoFeed,
  STREAM_RELEASE_AXIS,
} from './api/feed-handler'
export {
  escapeXml,
  renderAtom,
  renderRss,
  renderSyndication,
  stripInvalidXml,
  SYNDICATION_CONTENT_TYPE,
} from './api/syndication'
export type { SyndicationFormat, SyndicationOptions } from './api/syndication'
export type { FeedDeliveryRequest } from './api/feed-handler'
export { createPayloadSource } from './api/payload-source'
export {
  readDeliveryRequest,
  readFeedRequest,
  respondArticleFeed,
  respondPromoBoard,
  respondSiteConfig,
  respondSyndication,
  respondVideoFeed,
} from './api/http'
export {
  decide,
  DEFAULT_AUTH_FAILURE_RULE,
  DEFAULT_READ_RULE,
  estimateUsage,
  windowBounds,
} from './api/rate-limit'
export type { RateLimiter, RateLimitRule, RateLimitVerdict } from './api/rate-limit'
export { RedisRateLimiter } from './api/redis-rate-limit'

export { switchChannel } from './releases/publish'
export type { SwitchChannelArgs, SwitchChannelResult } from './releases/publish'

export { buildRelease } from './releases/build'
export type { BuildReleaseArgs, BuildReleaseResult } from './releases/build'
export { composeSnapshot, SNAPSHOT_SCHEMA_VERSION } from './releases/snapshot'
export type { ReleaseSnapshot, ResolvedValue } from './releases/snapshot'
export { RELEASE_VALIDATORS, siteReadinessValidator } from './releases/validators'

export { Releases, RELEASE_STATUSES } from './releases/releases.collection'
export type { ReleaseStatus } from './releases/releases.collection'
export { Channels, CHANNEL_NAMES } from './releases/channels.collection'
export type { ChannelName } from './releases/channels.collection'

/** Измерения, от которых зависит ответ доставки. Порядок значим: он задаёт ключ кеша. */
export const RESOLUTION_AXES = ['site', 'releaseId', 'locale', 'jurisdiction', 'variant'] as const

export type ResolutionAxis = (typeof RESOLUTION_AXES)[number]

export const MODULE_NAME = 'delivery' as const
