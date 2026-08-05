import { describe, expect, it } from 'vitest'

import { checkAgainstSchema, SCHEMA_IDS } from '@/contracts'

import {
  BASE_FEED_TTL_SECONDS,
  feedTtlSeconds,
  handleArticleFeed,
  STREAM_RELEASE_AXIS,
} from './feed-handler'

import { stubDeliverySource } from './source.fixture'

import type { FeedDeliveryRequest } from './feed-handler'
import type { DeliverySource } from './handler'
import type { ArticleFeedItem, FeedPage } from '@/modules/stream'

const NOW = new Date('2026-08-05T12:00:00.000Z')

function item(overrides: Partial<ArticleFeedItem> = {}): ArticleFeedItem {
  return {
    slug: 'stavka-povyshena',
    title: 'Ставка повышена',
    excerpt: 'Коротко',
    publishedAt: '2026-08-05T10:00:00.000Z',
    readingMinutes: 4,
    category: { slug: 'analytics', title: 'Аналитика' },
    tags: ['rates'],
    authors: [{ slug: 'ivanov', title: 'Иванов' }],
    cover: null,
    instruments: ['EURUSD'],
    featured: false,
    pinned: false,
    ...overrides,
  }
}

function page(overrides: Partial<FeedPage<ArticleFeedItem>> = {}): FeedPage<ArticleFeedItem> {
  return {
    items: [item()],
    pinned: [],
    nextCursor: null,
    excluded: [],
    nextTransitionAt: null,
    ...overrides,
  }
}

function source(overrides: Partial<DeliverySource> = {}): DeliverySource {
  return stubDeliverySource({
    resolveSiteId: async (slug) => (slug === 'apex-de' ? '10' : null),
    authorize: async ({ siteId }) =>
      siteId === '10'
        ? { kind: 'allow', keyId: 'abc', siteIds: ['10'] }
        : { kind: 'deny', reason: 'site-not-allowed' },
    loadArticles: async () => page(),
    ...overrides,
  })
}

function request(overrides: Partial<FeedDeliveryRequest> = {}): FeedDeliveryRequest {
  return {
    siteSlug: 'apex-de',
    authorizationHeader: 'Bearer bkc_abcdef1234567890_секрет-достаточной-длины',
    ifNoneMatch: null,
    locale: null,
    variant: null,
    channel: null,
    requestId: 'req-1',
    ...overrides,
  }
}

describe('срок жизни ответа', () => {
  it('без переходов — базовый срок', () => {
    expect(feedTtlSeconds(null, NOW)).toBe(BASE_FEED_TTL_SECONDS)
  })

  /**
   * Условие корректности, а не оптимизация: кеш, переживший переход, показывает
   * погасший материал, и «промо гаснет само» перестаёт выполняться.
   */
  it('близкий переход укорачивает срок', () => {
    const soon = new Date(NOW.getTime() + 10_000).toISOString()

    expect(feedTtlSeconds(soon, NOW)).toBe(10)
  })

  it('далёкий переход не удлиняет срок сверх базового', () => {
    const later = new Date(NOW.getTime() + 86_400_000).toISOString()

    expect(feedTtlSeconds(later, NOW)).toBe(BASE_FEED_TTL_SECONDS)
  })

  it.each([
    ['переход уже наступил', new Date(NOW.getTime() - 1_000).toISOString()],
    ['испорченная дата', 'вчера'],
  ])('%s — кешировать нечего', (_name, value) => {
    expect(feedTtlSeconds(value, NOW)).toBe(0)
  })
})

describe('ответ ленты', () => {
  it('проходит схему контракта', async () => {
    const result = await handleArticleFeed(request(), source(), NOW)

    expect(result.status).toBe(200)
    expect(checkAgainstSchema(SCHEMA_IDS.articleFeed, result.body)).toEqual({
      valid: true,
      issues: [],
    })
  })

  it('срок жизни попадает в заголовок', async () => {
    const soon = new Date(NOW.getTime() + 15_000).toISOString()
    const result = await handleArticleFeed(
      request(),
      source({ loadArticles: async () => page({ nextTransitionAt: soon }) }),
      NOW,
    )

    expect(result.headers['Cache-Control']).toBe('private, max-age=15')
  })

  /** Поток не собирается релизами, поэтому ось релиза константна (ADR-0021). */
  it('ось релиза в ключе кеша — stream', async () => {
    const result = await handleArticleFeed(request(), source(), NOW)

    expect(result.cacheKey).toContain(`rel=${STREAM_RELEASE_AXIS}`)
  })

  /**
   * Иначе лента с фильтром и лента без него делят одну запись кеша и вытесняют
   * друг друга — дефект, который проявляется только под нагрузкой.
   */
  it('фильтры входят в ключ кеша', async () => {
    const plain = await handleArticleFeed(request(), source(), NOW)
    const filtered = await handleArticleFeed(request({ category: 'analytics' }), source(), NOW)

    expect(filtered.cacheKey).not.toBe(plain.cacheKey)
  })

  it('разные курсоры дают разные ключи кеша', async () => {
    const first = await handleArticleFeed(request(), source(), NOW)
    const second = await handleArticleFeed(request({ cursor: 'абв' }), source(), NOW)

    expect(second.cacheKey).not.toBe(first.cacheKey)
  })

  it('совпавший ETag даёт 304 без тела', async () => {
    const first = await handleArticleFeed(request(), source(), NOW)
    const second = await handleArticleFeed(
      request({ ifNoneMatch: first.headers.ETag! }),
      source(),
      NOW,
    )

    expect(second.status).toBe(304)
    expect(second.body).toBeNull()
  })

  it('изменение состава ленты обесценивает ETag', async () => {
    const first = await handleArticleFeed(request(), source(), NOW)
    const changed = await handleArticleFeed(
      request({ ifNoneMatch: first.headers.ETag! }),
      source({ loadArticles: async () => page({ items: [item({ slug: 'drugoe' })] }) }),
      NOW,
    )

    expect(changed.status).toBe(200)
  })

  it('курсор следующей страницы отдаётся, когда он есть', async () => {
    const result = await handleArticleFeed(
      request(),
      source({ loadArticles: async () => page({ nextCursor: 'дальше' }) }),
      NOW,
    )

    expect(result.body).toMatchObject({ page: { nextCursor: 'дальше' } })
  })

  /**
   * Наружу уходит факт «лента короче ожидаемого», но не идентификаторы
   * записей: они внутренние, а подробности остаются в журнале.
   */
  it('исключённые записи отдаются числом, а не списком', async () => {
    const result = await handleArticleFeed(
      request(),
      source({
        loadArticles: async () => page({ excluded: [{ id: '7', reason: 'нет заголовка' }] }),
      }),
      NOW,
    )

    expect(result.body).toMatchObject({ page: { excluded: 1 } })
    expect(JSON.stringify(result.body)).not.toContain('нет заголовка')
    expect(JSON.stringify(result.body)).not.toContain('"7"')
  })

  it('пустое закреплённое не отдаётся полем', async () => {
    const result = await handleArticleFeed(request(), source(), NOW)

    expect(result.body).not.toHaveProperty('pinned')
  })

  it('закреплённое отдаётся, когда оно есть', async () => {
    const result = await handleArticleFeed(
      request(),
      source({ loadArticles: async () => page({ pinned: [item({ pinned: true })] }) }),
      NOW,
    )

    expect(result.body).toHaveProperty('pinned')
  })
})

describe('отказы ленты', () => {
  it('без ключа — 401', async () => {
    const result = await handleArticleFeed(
      request({ authorizationHeader: null }),
      source({ authorize: async () => ({ kind: 'deny', reason: 'missing-header' }) }),
      NOW,
    )

    expect(result.status).toBe(401)
    expect(checkAgainstSchema(SCHEMA_IDS.error, result.body).valid).toBe(true)
  })

  it('чужой сайт — 404', async () => {
    const result = await handleArticleFeed(
      request(),
      source({ authorize: async () => ({ kind: 'deny', reason: 'site-not-allowed' }) }),
      NOW,
    )

    expect(result.status).toBe(404)
  })

  it('незаявленная локаль — 400', async () => {
    const result = await handleArticleFeed(request({ locale: 'fr' }), source(), NOW)

    expect(result.status).toBe(400)
  })

  /** Неполные настройки сайта дали бы выдуманные измерения разрешения. */
  it('сайт без юрисдикции — 400, а не выдуманное значение', async () => {
    const result = await handleArticleFeed(
      request(),
      source({
        loadSiteResolution: async () => ({
          defaultLocale: 'de',
          availableLocales: ['de'],
          jurisdiction: null,
          publicUrl: null,
          title: null,
        }),
      }),
      NOW,
    )

    expect(result.status).toBe(400)
  })
})
