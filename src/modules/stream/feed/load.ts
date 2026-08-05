import { earliestTransition } from '../visibility'

import { toArticleFeedItem } from './article-item'
import { encodeCursor } from './cursor'
import { mapFeed } from './mapper'
import { buildFeedQuery, buildPinnedQuery } from './query'
import { toVideoFeedItem } from './video-item'

import type { ArticleFeedItem } from './article-item'
import type { FeedRequest } from './query'
import type { VideoFeedItem } from './video-item'
import type { CollectionSlug, Payload } from 'payload'

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

export interface FeedPage<TItem> {
  readonly items: readonly TItem[]
  readonly pinned: readonly TItem[]
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

/** Сколько закреплённых записей отдаётся. Больше десятка — это уже не «закреплено». */
const PINNED_LIMIT = 10

/**
 * Общий загрузчик ленты.
 *
 * Один на все сущности потока намеренно: пагинация, тотальный маппер и расчёт
 * ближайшего перехода — это то, что легче всего скопировать с ошибкой. Разным
 * остаётся только сборка элемента.
 */
export async function loadStreamFeed<TItem>(args: {
  readonly payload: Payload
  readonly collection: CollectionSlug
  readonly request: FeedRequest
  readonly map: (doc: Record<string, unknown>) => TItem
  /** Закреплённое есть не у всех сущностей: у видео его нет. */
  readonly withPinned?: boolean
  readonly now?: Date
}): Promise<FeedPage<TItem>> {
  const now = args.now ?? new Date()
  const query = buildFeedQuery(args.request)

  const found = await args.payload.find({
    collection: args.collection,
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

  const mapped = mapFeed(page, args.map)

  /**
   * Закреплённое запрашивается только на первой странице: оно висит сверху и
   * повторять его на каждой странице значило бы отдавать одно и то же снова.
   */
  const pinned =
    args.withPinned === true && query.position === null
      ? await loadPinned(args)
      : { items: [] as TItem[], excluded: [] }

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

async function loadPinned<TItem>(args: {
  readonly payload: Payload
  readonly collection: CollectionSlug
  readonly request: FeedRequest
  readonly map: (doc: Record<string, unknown>) => TItem
}) {
  const pinnedQuery = buildPinnedQuery(args.request.siteId)

  const found = await args.payload.find({
    collection: args.collection,
    where: pinnedQuery.where,
    sort: [...pinnedQuery.sort],
    limit: PINNED_LIMIT,
    pagination: false,
    depth: FEED_DEPTH,
    overrideAccess: false,
  })

  return mapFeed(found.docs as unknown as Record<string, unknown>[], args.map)
}

export async function loadArticleFeed(args: {
  readonly payload: Payload
  readonly request: FeedRequest
  readonly now?: Date
}): Promise<FeedPage<ArticleFeedItem>> {
  return loadStreamFeed({
    payload: args.payload,
    collection: 'articles',
    request: args.request,
    map: toArticleFeedItem,
    withPinned: true,
    ...(args.now ? { now: args.now } : {}),
  })
}

/**
 * Лента видео.
 *
 * Закреплённого у видео нет: подборка роликов упорядочена временем, а не
 * редакторским вниманием. Заводить признак «на всякий случай» значит завести
 * поле, которым не пользуются, и потом гадать, почему оно пустое.
 */
export async function loadVideoFeed(args: {
  readonly payload: Payload
  readonly request: FeedRequest
  readonly now?: Date
}): Promise<FeedPage<VideoFeedItem>> {
  const now = args.now ?? new Date()

  const page = await loadStreamFeed({
    payload: args.payload,
    collection: 'videos',
    request: args.request,
    map: (doc) => toVideoFeedItem(doc, now),
    now,
  })

  /**
   * У видео есть **второй** источник самопроизвольных изменений: состояние
   * эфира. Ответ, в котором трансляция помечена идущей, обязан истечь не
   * позже её окончания — иначе «в эфире» висит на витрине после окончания.
   *
   * Считается по отданным элементам: их состояние и попало в ответ.
   */
  const broadcastMoments = page.items
    .flatMap((item) => [item.broadcast.startsAt, item.broadcast.endsAt])
    .filter((moment): moment is string => moment !== null)
    .map((moment) => Date.parse(moment))
    .filter((moment) => moment > now.getTime())

  const soonest = broadcastMoments.length === 0 ? null : Math.min(...broadcastMoments)
  const visibility = page.nextTransitionAt === null ? null : Date.parse(page.nextTransitionAt)

  const combined =
    soonest === null ? visibility : visibility === null ? soonest : Math.min(soonest, visibility)

  return { ...page, nextTransitionAt: combined === null ? null : new Date(combined).toISOString() }
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
