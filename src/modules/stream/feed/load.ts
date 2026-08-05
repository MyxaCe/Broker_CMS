import { earliestTransition } from '../visibility'

import { toArticleFeedItem } from './article-item'
import { encodeCursor } from './cursor'
import { mapFeed } from './mapper'
import { buildFeedQuery, buildPinnedQuery } from './query'

import type { ArticleFeedItem } from './article-item'
import type { FeedRequest } from './query'
import type { Payload } from 'payload'

/**
 * Чтение ленты из базы (ТЗ 1.2).
 *
 * `overrideAccess: false` выставляется **явно** и является главным свойством
 * функции: правило доступа сузит выборку до опубликованного, поэтому черновик
 * не попадёт в ленту даже при ошибке в фильтрах (ADR-0021).
 *
 * Явно — потому что в локальном API Payload умолчание обратное: не указать
 * значит обойти все правила доступа. Умолчание удобно для служебных операций
 * и опасно ровно здесь ([[BUG-005]]).
 */

export interface FeedPage {
  readonly items: readonly ArticleFeedItem[]
  readonly pinned: readonly ArticleFeedItem[]
  /** `null` — следующей страницы нет. */
  readonly nextCursor: string | null
  /**
   * Записи, исключённые тотальным маппером. Пустой список — норма; непустой
   * означает, что лента короче ожидаемого, и требует алерта, а не тишины.
   */
  readonly excluded: readonly { readonly id: string; readonly reason: string }[]
  /**
   * Ближайший момент, когда ответ изменится сам собой. Ограничивает срок жизни
   * кеша сверху: без этого погасшее промо продолжает висеть.
   */
  readonly nextTransitionAt: string | null
}

/** Глубина 1: нужны названия категории, тегов, авторов и адрес обложки. */
const FEED_DEPTH = 1

export async function loadArticleFeed(args: {
  readonly payload: Payload
  readonly request: FeedRequest
  readonly now?: Date
}): Promise<FeedPage> {
  const now = args.now ?? new Date()
  const query = buildFeedQuery(args.request)

  const found = await args.payload.find({
    collection: 'articles',
    where: query.where,
    sort: [...query.sort],
    limit: query.limit,
    pagination: false,
    depth: FEED_DEPTH,
    overrideAccess: false,
  })

  const docs = found.docs as unknown as Record<string, unknown>[]
  const hasMore = docs.length > query.pageSize
  const page = hasMore ? docs.slice(0, query.pageSize) : docs

  const mapped = mapFeed(page, toArticleFeedItem)

  /**
   * Закреплённое запрашивается только на первой странице: оно висит сверху и
   * повторять его на каждой странице значило бы отдавать одно и то же снова.
   */
  const pinned =
    query.position === null
      ? await loadPinned(args.payload, args.request)
      : { items: [] as ArticleFeedItem[], excluded: [] }

  return {
    items: mapped.items,
    pinned: pinned.items,
    /**
     * Курсор строится по **последней отданной** записи, а не по последней
     * прочитанной: лишняя запись читалась только ради ответа на вопрос «есть
     * ли ещё», и в выдачу она не попала.
     */
    nextCursor: hasMore ? cursorOf(page[query.pageSize - 1]) : null,
    excluded: [...mapped.excluded, ...pinned.excluded],
    /**
     * Переход считается по прочитанным записям, включая ту лишнюю: она тоже
     * может погаснуть, и тогда состав страницы изменится.
     */
    nextTransitionAt: earliestTransition(docs as never, now)?.toISOString() ?? null,
  }
}

async function loadPinned(payload: Payload, request: FeedRequest) {
  const pinnedQuery = buildPinnedQuery(request.siteId)

  const found = await payload.find({
    collection: 'articles',
    where: pinnedQuery.where,
    sort: [...pinnedQuery.sort],
    limit: 10,
    pagination: false,
    depth: FEED_DEPTH,
    overrideAccess: false,
  })

  return mapFeed(found.docs as unknown as Record<string, unknown>[], toArticleFeedItem)
}

function cursorOf(doc: Record<string, unknown> | undefined): string | null {
  if (doc === undefined) {
    return null
  }

  const sortValue = doc.publishAt

  if (typeof sortValue !== 'string' || sortValue === '') {
    return null
  }

  return encodeCursor({ sortValue, id: String(doc.id) })
}
