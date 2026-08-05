import { CONTRACT_VERSION, SCHEMA_IDS, validateOutgoing } from '@/contracts'

import { DEFAULT_VARIANT } from '../cache-key'

import type { ArticleFeedResponse } from '@/contracts'
import type { ArticleFeedItem, FeedPage } from '@/modules/stream'

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

export function buildArticleFeedResponse(args: {
  readonly siteSlug: string
  readonly page: FeedPage
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
