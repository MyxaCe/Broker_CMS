import { FeedQueryError } from '@/modules/stream'

import { buildCacheKey, buildETag, contentHash, matchesETag } from '../cache-key'

import {
  buildArticleFeedResponse,
  buildPromoBoardResponse,
  buildVideoFeedResponse,
} from './article-feed'
import { errorResponse, openDeliveryRequest } from './handler'

import type {
  ArticleFeedFilters,
  DeliveryRequest,
  DeliveryResponse,
  DeliverySource,
} from './handler'

/**
 * Выдача ресурсов потока (ТЗ 1.2, ADR-0021).
 *
 * Отличие от конфигурации сайта одно, но существенное: ответ **меняется сам
 * собой** по времени, поэтому срок жизни кеша ограничен ближайшим переходом.
 *
 * Три ресурса — материалы, видео, промо — обслуживаются одним ходом. Разное у
 * них только имя ресурса, загрузчик и сборщик ответа; всё остальное (пределы,
 * авторизация, разрешение локали, `ETag`, срок жизни) обязано совпадать, и
 * совпадает оно потому, что написано один раз.
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

export function filtersOf(request: FeedDeliveryRequest): ArticleFeedFilters {
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
 * Общий ход выдачи ресурса потока.
 *
 * `loaded` возвращает и тело ответа, и момент ближайшего перехода: только
 * загрузчик знает, из чего этот момент складывается — у видео, например, к
 * переходам видимости добавляются переходы эфира.
 */
async function serveStreamResource<TBody>(args: {
  readonly request: FeedDeliveryRequest
  readonly source: DeliverySource
  readonly now: Date
  readonly resource: string
  readonly load: (
    siteId: string,
    resolution: { locale: string; jurisdiction: string },
  ) => Promise<{
    body: TBody
    nextTransitionAt: string | null
    variant: string
  }>
}): Promise<DeliveryResponse> {
  const { request, source, now } = args
  const opened = await openDeliveryRequest(request, source)

  if ('denied' in opened) {
    return opened.denied
  }

  const resolution = await source.loadSiteResolution(opened.siteId)

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

  let loaded

  try {
    loaded = await args.load(opened.siteId, { locale, jurisdiction: resolution.jurisdiction })
  } catch (error) {
    if (error instanceof FeedQueryError) {
      return errorResponse(400, 'bad-request', error.message, request.requestId)
    }

    throw error
  }

  const axes = {
    site: request.siteSlug,
    /** Поток не собирается релизами, поэтому ось релиза константна. */
    releaseId: STREAM_RELEASE_AXIS,
    /**
     * Фильтры входят в ключ отпечатком. Иначе лента с фильтром по категории и
     * лента без него делят одну запись кеша и вытесняют друг друга — дефект,
     * который проявляется только под нагрузкой.
     */
    resource: `${args.resource}:${contentHash(filtersOf(request)).slice(0, 16)}`,
    locale,
    jurisdiction: resolution.jurisdiction,
    variant: loaded.variant,
  }

  const etag = buildETag(axes, loaded.body)
  const ttl = feedTtlSeconds(loaded.nextTransitionAt, now)

  const headers: Record<string, string> = {
    ETag: etag,
    /**
     * `max-age`, а не `no-cache`: в отличие от конфигурации сайта, поток
     * читается часто и меняется предсказуемо. Значение ограничено сверху
     * ближайшим переходом, поэтому кеш физически не может пережить момент,
     * когда материал должен погаснуть.
     */
    'Cache-Control': `private, max-age=${ttl}`,
    Vary: 'Authorization, Accept-Encoding',
  }

  const cacheKey = buildCacheKey(axes)

  if (matchesETag(request.ifNoneMatch, etag)) {
    return { status: 304, headers, body: null, cacheKey }
  }

  return { status: 200, headers, body: loaded.body as never, cacheKey }
}

export async function handleArticleFeed(
  request: FeedDeliveryRequest,
  source: DeliverySource,
  now: Date = new Date(),
): Promise<DeliveryResponse> {
  return serveStreamResource({
    request,
    source,
    now,
    resource: 'articles',
    load: async (siteId, resolution) => {
      const page = await source.loadArticles({ siteId, request: filtersOf(request) })
      const body = buildArticleFeedResponse({
        siteSlug: request.siteSlug,
        page,
        resolution: { ...resolution, variant: request.variant },
      })

      return { body, nextTransitionAt: page.nextTransitionAt, variant: body.resolution.variant }
    },
  })
}

export async function handleVideoFeed(
  request: FeedDeliveryRequest,
  source: DeliverySource,
  now: Date = new Date(),
): Promise<DeliveryResponse> {
  return serveStreamResource({
    request,
    source,
    now,
    resource: 'videos',
    load: async (siteId, resolution) => {
      const page = await source.loadVideos({ siteId, request: filtersOf(request) })
      const body = buildVideoFeedResponse({
        siteSlug: request.siteSlug,
        page,
        resolution: { ...resolution, variant: request.variant },
      })

      return { body, nextTransitionAt: page.nextTransitionAt, variant: body.resolution.variant }
    },
  })
}

export async function handlePromoBoard(
  request: FeedDeliveryRequest,
  source: DeliverySource,
  now: Date = new Date(),
): Promise<DeliveryResponse> {
  return serveStreamResource({
    request,
    source,
    now,
    resource: 'promos',
    load: async (siteId, resolution) => {
      /**
       * Юрисдикция промо берётся из разрешения сайта, а не из параметра
       * запроса: показывать предложение, недопустимое в юрисдикции сайта,
       * нельзя по просьбе потребителя.
       */
      const board = await source.loadPromos({
        siteId,
        jurisdiction: request.jurisdiction ?? resolution.jurisdiction,
      })

      const body = buildPromoBoardResponse({
        siteSlug: request.siteSlug,
        board,
        resolution: { ...resolution, variant: request.variant },
      })

      return { body, nextTransitionAt: board.nextTransitionAt, variant: body.resolution.variant }
    },
  })
}
