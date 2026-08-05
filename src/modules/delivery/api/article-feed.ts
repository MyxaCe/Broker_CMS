import { CONTRACT_VERSION, SCHEMA_IDS, validateOutgoing } from '@/contracts'

import { DEFAULT_VARIANT } from '../cache-key'

import type {
  ArticleFeedResponse,
  PromoBoardResponse,
  SearchResponse,
  VideoFeedResponse,
} from '@/contracts'
import type {
  ArticleFeedItem,
  FeedPage,
  PromoBoard,
  PromoItem,
  SearchResult,
  VideoFeedItem,
} from '@/modules/stream'

/**
 * Сборка ответа ленты (ТЗ 1.2, ADR-0019, ADR-0021).
 *
 * Как и у конфигурации сайта, проверка схемой встроена в саму сборку: наружу
 * уходит только то, что вернула эта функция.
 */

export interface FeedResolution {
  readonly locale: string
  readonly jurisdiction: string
  readonly variant?: string | null
}

function toItem(item: ArticleFeedItem) {
  return {
    slug: item.slug,
    title: item.title,
    excerpt: item.excerpt,
    publishedAt: item.publishedAt,
    readingMinutes: item.readingMinutes,
    category: item.category,
    tags: [...item.tags],
    authors: item.authors.map((author) => ({ slug: author.slug, title: author.title })),
    cover: item.cover,
    instruments: [...item.instruments],
    featured: item.featured,
    pinned: item.pinned,
  }
}

function toVideo(item: VideoFeedItem) {
  return {
    slug: item.slug,
    title: item.title,
    description: item.description,
    publishedAt: item.publishedAt,
    provider: item.provider,
    externalId: item.externalId,
    fileUrl: item.fileUrl,
    poster: item.poster,
    broadcast: {
      state: item.broadcast.state,
      startsAt: item.broadcast.startsAt,
      endsAt: item.broadcast.endsAt,
    },
    speakers: item.speakers.map((speaker) => ({ slug: speaker.slug, title: speaker.title })),
    tags: [...item.tags],
  }
}

function toPromo(item: PromoItem) {
  return {
    slug: item.slug,
    title: item.title,
    badge: item.badge,
    description: item.description,
    terms: item.terms,
    cta: item.cta,
    image: item.image,
    jurisdictions: [...item.jurisdictions],
    priority: item.priority,
    featured: item.featured,
  }
}

function resolutionOf(resolution: FeedResolution) {
  return {
    locale: resolution.locale,
    jurisdiction: resolution.jurisdiction,
    variant: resolution.variant ?? DEFAULT_VARIANT,
  }
}

export function buildVideoFeedResponse(args: {
  readonly siteSlug: string
  readonly page: FeedPage<VideoFeedItem>
  readonly resolution: FeedResolution
}): VideoFeedResponse {
  const payload = {
    contract: CONTRACT_VERSION,
    site: { slug: args.siteSlug },
    resolution: resolutionOf(args.resolution),
    items: args.page.items.map(toVideo),
    page: {
      size: args.page.items.length,
      ...(args.page.nextCursor === null ? {} : { nextCursor: args.page.nextCursor }),
      excluded: args.page.excluded.length,
    },
  }

  return validateOutgoing<VideoFeedResponse>(SCHEMA_IDS.videoFeed, payload)
}

export function buildPromoBoardResponse(args: {
  readonly siteSlug: string
  readonly board: PromoBoard
  readonly resolution: FeedResolution
}): PromoBoardResponse {
  const payload = {
    contract: CONTRACT_VERSION,
    site: { slug: args.siteSlug },
    resolution: resolutionOf(args.resolution),
    items: args.board.items.map(toPromo),
    excluded: args.board.excluded.length,
  }

  return validateOutgoing<PromoBoardResponse>(SCHEMA_IDS.promoBoard, payload)
}

/**
 * Сборка ответа поиска.
 *
 * Элемент выдачи намеренно беднее элемента ленты: результаты поиска
 * показывают списком, и теги с авторами там не нужны. Отдавать больше «на
 * всякий случай» — это лишний трафик на каждом нажатии клавиши.
 */
export function buildSearchResponse(args: {
  readonly siteSlug: string
  readonly query: string
  readonly result: SearchResult
  readonly resolution: FeedResolution
}): SearchResponse {
  const payload = {
    contract: CONTRACT_VERSION,
    site: { slug: args.siteSlug },
    resolution: resolutionOf(args.resolution),
    query: args.query,
    hits: args.result.hits.map((hit) => ({
      kind: hit.kind,
      slug: hit.item.slug,
      title: hit.item.title,
      excerpt: 'excerpt' in hit.item ? hit.item.excerpt : hit.item.description,
      publishedAt: hit.item.publishedAt,
      category: 'category' in hit.item ? hit.item.category : null,
      cover: 'cover' in hit.item ? hit.item.cover : hit.item.poster,
    })),
    excluded: args.result.excluded.length,
  }

  return validateOutgoing<SearchResponse>(SCHEMA_IDS.search, payload)
}

export function buildArticleFeedResponse(args: {
  readonly siteSlug: string
  readonly page: FeedPage<ArticleFeedItem>
  readonly resolution: FeedResolution
}): ArticleFeedResponse {
  const { page } = args

  const payload = {
    contract: CONTRACT_VERSION,
    site: { slug: args.siteSlug },
    resolution: {
      locale: args.resolution.locale,
      jurisdiction: args.resolution.jurisdiction,
      variant: args.resolution.variant ?? DEFAULT_VARIANT,
    },
    /** Пустой список закреплённого не отдаётся: отсутствие поля короче и честнее. */
    ...(page.pinned.length > 0 ? { pinned: page.pinned.map(toItem) } : {}),
    items: page.items.map(toItem),
    page: {
      size: page.items.length,
      ...(page.nextCursor === null ? {} : { nextCursor: page.nextCursor }),
      /**
       * Число, а не список: наружу уходит факт «лента короче ожидаемого», но
       * не идентификаторы записей — они внутренние. Подробности остаются в
       * журнале, где их и разбирают (ADR-0021).
       */
      excluded: page.excluded.length,
    },
  }

  return validateOutgoing<ArticleFeedResponse>(SCHEMA_IDS.articleFeed, payload)
}
