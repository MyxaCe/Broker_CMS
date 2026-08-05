import { describe, expect, it } from 'vitest'

import { checkAgainstSchema, SCHEMA_IDS } from '@/contracts'

import { handlePromoBoard, handleVideoFeed } from './feed-handler'
import { stubDeliverySource } from './source.fixture'

import type { FeedDeliveryRequest } from './feed-handler'
import type { DeliverySource } from './handler'
import type { FeedPage, PromoBoard, PromoItem, VideoFeedItem } from '@/modules/stream'

const NOW = new Date('2026-08-05T12:00:00.000Z')

function video(overrides: Partial<VideoFeedItem> = {}): VideoFeedItem {
  return {
    slug: 'razbor-rynka',
    title: 'Разбор рынка',
    description: 'Еженедельный обзор',
    publishedAt: '2026-08-05T09:00:00.000Z',
    provider: 'youtube',
    externalId: 'abc123',
    fileUrl: null,
    poster: null,
    broadcast: { state: 'past', startsAt: null, endsAt: null },
    speakers: [{ slug: 'ivanov', title: 'Иванов' }],
    tags: ['rates'],
    ...overrides,
  }
}

function videoPage(overrides: Partial<FeedPage<VideoFeedItem>> = {}): FeedPage<VideoFeedItem> {
  return {
    items: [video()],
    pinned: [],
    nextCursor: null,
    excluded: [],
    nextTransitionAt: null,
    ...overrides,
  }
}

function promo(overrides: Partial<PromoItem> = {}): PromoItem {
  return {
    slug: 'letnyaya-aktsiya',
    title: 'Летняя акция',
    badge: 'Новое',
    description: 'Описание',
    terms: 'Условия акции',
    cta: { label: 'Открыть счёт', href: 'https://example.test/open' },
    image: null,
    jurisdictions: ['eu-mifid'],
    priority: 10,
    featured: true,
    ...overrides,
  }
}

function board(overrides: Partial<PromoBoard> = {}): PromoBoard {
  return { items: [promo()], excluded: [], nextTransitionAt: null, ...overrides }
}

function source(overrides: Partial<DeliverySource> = {}): DeliverySource {
  return stubDeliverySource({
    resolveSiteId: async () => '10',
    authorize: async () => ({ kind: 'allow', keyId: 'abc', siteIds: ['10'] }),
    loadVideos: async () => videoPage(),
    loadPromos: async () => board(),
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

describe('лента видео', () => {
  it('ответ проходит схему контракта', async () => {
    const result = await handleVideoFeed(request(), source(), NOW)

    expect(result.status).toBe(200)
    expect(checkAgainstSchema(SCHEMA_IDS.videoFeed, result.body)).toEqual({
      valid: true,
      issues: [],
    })
  })

  it('состояние эфира попадает в ответ', async () => {
    const result = await handleVideoFeed(
      request(),
      source({
        loadVideos: async () =>
          videoPage({
            items: [
              video({
                broadcast: {
                  state: 'live',
                  startsAt: '2026-08-05T11:00:00.000Z',
                  endsAt: '2026-08-05T13:00:00.000Z',
                },
              }),
            ],
          }),
      }),
      NOW,
    )

    expect(result.body).toMatchObject({ items: [{ broadcast: { state: 'live' } }] })
  })

  /**
   * Ответ, в котором трансляция помечена идущей, обязан истечь не позже её
   * окончания — иначе «в эфире» висит на витрине после окончания.
   */
  it('срок жизни ограничен окончанием эфира', async () => {
    const result = await handleVideoFeed(
      request(),
      source({
        loadVideos: async () =>
          videoPage({ nextTransitionAt: new Date(NOW.getTime() + 20_000).toISOString() }),
      }),
      NOW,
    )

    expect(result.headers['Cache-Control']).toBe('private, max-age=20')
  })

  it('ключ кеша отличается от ключа ленты материалов', async () => {
    const videos = await handleVideoFeed(request(), source(), NOW)

    expect(videos.cacheKey).toContain('res=videos')
  })

  it('чужой сайт — 404', async () => {
    const result = await handleVideoFeed(
      request(),
      source({ authorize: async () => ({ kind: 'deny', reason: 'site-not-allowed' }) }),
      NOW,
    )

    expect(result.status).toBe(404)
  })
})

describe('промо-доска', () => {
  it('ответ проходит схему контракта', async () => {
    const result = await handlePromoBoard(request(), source(), NOW)

    expect(result.status).toBe(200)
    expect(checkAgainstSchema(SCHEMA_IDS.promoBoard, result.body)).toEqual({
      valid: true,
      issues: [],
    })
  })

  /** Доска — не лента: курсора у неё нет и быть не должно. */
  it('курсора в ответе нет', async () => {
    const result = await handlePromoBoard(request(), source(), NOW)

    expect(result.body).not.toHaveProperty('page')
    expect(JSON.stringify(result.body)).not.toContain('nextCursor')
  })

  it('исключённые промо считаются числом', async () => {
    const result = await handlePromoBoard(
      request(),
      source({
        loadPromos: async () => board({ excluded: [{ id: '3', reason: 'не заполнены условия' }] }),
      }),
      NOW,
    )

    expect(result.body).toMatchObject({ excluded: 1 })
    expect(JSON.stringify(result.body)).not.toContain('не заполнены условия')
  })

  /**
   * Показывать предложение, недопустимое в юрисдикции сайта, нельзя по
   * просьбе потребителя — юрисдикция берётся из разрешения сайта.
   */
  it('юрисдикция берётся из разрешения сайта, когда её не просили', async () => {
    let asked: string | null | undefined

    await handlePromoBoard(
      request(),
      source({
        loadPromos: async ({ jurisdiction }) => {
          asked = jurisdiction
          return board()
        },
      }),
      NOW,
    )

    expect(asked).toBe('eu-mifid')
  })

  it('срок жизни ограничен ближайшим погасанием', async () => {
    const result = await handlePromoBoard(
      request(),
      source({
        loadPromos: async () =>
          board({ nextTransitionAt: new Date(NOW.getTime() + 5_000).toISOString() }),
      }),
      NOW,
    )

    expect(result.headers['Cache-Control']).toBe('private, max-age=5')
  })

  it('совпавший ETag даёт 304', async () => {
    const first = await handlePromoBoard(request(), source(), NOW)
    const second = await handlePromoBoard(
      request({ ifNoneMatch: first.headers.ETag! }),
      source(),
      NOW,
    )

    expect(second.status).toBe(304)
  })
})

describe('ресурсы не путаются между собой', () => {
  /**
   * Один ключ на три ресурса означал бы, что лента видео вытесняет ленту
   * материалов и наоборот — с непредсказуемым результатом под нагрузкой.
   */
  it('у каждого ресурса свой ключ кеша', async () => {
    const videos = await handleVideoFeed(request(), source(), NOW)
    const promos = await handlePromoBoard(request(), source(), NOW)

    expect(videos.cacheKey).not.toBe(promos.cacheKey)
  })
})
