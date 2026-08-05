import { FeedQueryError } from '@/modules/stream'

import { buildCacheKey, buildETag, contentHash, matchesETag } from '../cache-key'

import { buildArticleFeedResponse } from './article-feed'
import { errorResponse, openDeliveryRequest } from './handler'

import type {
  ArticleFeedFilters,
  DeliveryRequest,
  DeliveryResponse,
  DeliverySource,
} from './handler'
import type { ArticleFeedResponse } from '@/contracts'

/**
 * Выдача ленты материалов (ТЗ 1.2, ADR-0021).
 *
 * Отличие от конфигурации сайта одно, но существенное: ответ **меняется сам
 * собой** по времени, поэтому срок жизни кеша ограничен ближайшим переходом
 * видимости.
 */

export interface FeedDeliveryRequest extends DeliveryRequest, ArticleFeedFilters {}

/** Ось релиза для потока: он не собирается релизами (ADR-0021). */
export const STREAM_RELEASE_AXIS = 'stream'

/**
 * Базовый срок жизни ответа ленты.
 *
 * Минута — компромисс: поток публикуется мгновенно, и держать ответ дольше
 * значит обещать мгновенность и не выполнять её.
 */
export const BASE_FEED_TTL_SECONDS = 60

/**
 * Срок жизни ответа.
 *
 * Ограничение ближайшим переходом — это **условие корректности**, а не
 * оптимизация: без него погасший материал висит ровно столько, сколько живёт
 * запись кеша, и требование «промо гаснет само» перестаёт выполняться.
 */
export function feedTtlSeconds(nextTransitionAt: string | null, now: Date): number {
  if (nextTransitionAt === null) {
    return BASE_FEED_TTL_SECONDS
  }

  const untilMs = Date.parse(nextTransitionAt) - now.getTime()

  if (Number.isNaN(untilMs) || untilMs <= 0) {
    /**
     * Переход уже наступил или дата испорчена — кешировать нечего. Ноль
     * означает «перепроверяй каждый раз», а не «кешируй вечно».
     */
    return 0
  }

  return Math.min(BASE_FEED_TTL_SECONDS, Math.floor(untilMs / 1000))
}

export async function handleArticleFeed(
  request: FeedDeliveryRequest,
  source: DeliverySource,
  now: Date = new Date(),
): Promise<DeliveryResponse> {
  const opened = await openDeliveryRequest(request, source)

  if ('denied' in opened) {
    return opened.denied
  }

  const { siteId } = opened

  const resolution = await source.loadSiteResolution(siteId)

  if (
    resolution === null ||
    resolution.jurisdiction === null ||
    resolution.defaultLocale === null
  ) {
    /**
     * Сайт без разрешённой юрисдикции или локали по умолчанию отдавать нельзя:
     * ответ был бы неполным, а измерения разрешения — выдуманными.
     */
    return errorResponse(400, 'bad-request', 'Настройки сайта неполны.', request.requestId)
  }

  const locale = request.locale ?? resolution.defaultLocale

  if (!resolution.availableLocales.includes(locale)) {
    return errorResponse(
      400,
      'bad-request',
      'Локаль у этого сайта не объявлена.',
      request.requestId,
    )
  }

  let page

  try {
    page = await source.loadArticles({ siteId, request: filtersOf(request) })
  } catch (error) {
    if (error instanceof FeedQueryError) {
      return errorResponse(400, 'bad-request', error.message, request.requestId)
    }

    throw error
  }

  const body = buildArticleFeedResponse({
    siteSlug: request.siteSlug,
    page,
    resolution: {
      locale,
      jurisdiction: resolution.jurisdiction,
      variant: request.variant,
    },
  })

  return respond({ request, body, page, locale, jurisdiction: resolution.jurisdiction, now })
}

function filtersOf(request: FeedDeliveryRequest): ArticleFeedFilters {
  return {
    cursor: request.cursor ?? null,
    limit: request.limit ?? null,
    category: request.category ?? null,
    tag: request.tag ?? null,
    author: request.author ?? null,
    instrument: request.instrument ?? null,
    jurisdiction: request.jurisdiction ?? null,
    since: request.since ?? null,
    until: request.until ?? null,
    featured: request.featured ?? null,
  }
}

/**
 * Фильтры входят в ключ кеша через отпечаток.
 *
 * Иначе лента с фильтром по категории и лента без него делят одну запись кеша
 * и вытесняют друг друга — дефект, который проявляется только под нагрузкой и
 * не воспроизводится в отладке.
 *
 * Отпечатком, а не перечислением: ключ должен оставаться ограниченной длины
 * при любом наборе фильтров, а сравнивать его по частям нам незачем.
 */
function resourceKey(request: FeedDeliveryRequest): string {
  return `articles:${contentHash(filtersOf(request)).slice(0, 16)}`
}

function respond(args: {
  request: FeedDeliveryRequest
  body: ArticleFeedResponse
  page: { nextTransitionAt: string | null }
  locale: string
  jurisdiction: string
  now: Date
}): DeliveryResponse {
  const axes = {
    site: args.request.siteSlug,
    /** Поток не собирается релизами, поэтому ось релиза константна. */
    releaseId: STREAM_RELEASE_AXIS,
    resource: resourceKey(args.request),
    locale: args.locale,
    jurisdiction: args.jurisdiction,
    variant: args.body.resolution.variant,
  }

  const etag = buildETag(axes, args.body)
  const ttl = feedTtlSeconds(args.page.nextTransitionAt, args.now)

  const headers: Record<string, string> = {
    ETag: etag,
    /**
     * `max-age`, а не `no-cache`: в отличие от конфигурации сайта, лента
     * читается часто и меняется предсказуемо. Значение ограничено сверху
     * ближайшим переходом, поэтому кеш физически не может пережить момент,
     * когда материал должен погаснуть.
     */
    'Cache-Control': `private, max-age=${ttl}`,
    Vary: 'Authorization, Accept-Encoding',
  }

  if (matchesETag(args.request.ifNoneMatch, etag)) {
    return { status: 304, headers, body: null, cacheKey: buildCacheKey(axes) }
  }

  return { status: 200, headers, body: args.body, cacheKey: buildCacheKey(axes) }
}
