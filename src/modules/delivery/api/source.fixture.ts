import type { DeliverySource } from './handler'
import type { RateLimiter } from './rate-limit'

/**
 * Заглушка источника доставки для тестов.
 *
 * Появилась после третьего раза, когда новый метод источника ломал три
 * тестовых файла сразу. Заглушка в одном месте означает, что расширение
 * интерфейса требует правки одного файла, а не всех, кто его когда-либо
 * подменял.
 *
 * Умолчания намеренно «пустые и разрешающие»: тест, которому важно поведение
 * конкретного метода, переопределяет его явно, и из самого теста видно, что
 * именно он проверяет.
 */

/** Ограничитель, который никогда не мешает: пределы проверяются отдельно. */
export const permissiveRateLimiter: RateLimiter = {
  consume: async () => ({ allowed: true, remaining: 100, retryAfterSec: 1 }),
  peek: async () => ({ allowed: true, remaining: 100, retryAfterSec: 1 }),
}

export function emptyFeedPage() {
  return {
    items: [],
    pinned: [],
    nextCursor: null,
    excluded: [],
    nextTransitionAt: null,
  }
}

/**
 * Момент выдачи по умолчанию — 2026-10-19T12:00:00Z.
 *
 * Постоянный, а не `Date.now()`: подвижное время сделало бы тело ответа
 * разным от прогона к прогону, и проверки `ETag` зеленели бы или краснели в
 * зависимости от того, попал ли прогон на границу окна срока годности.
 * Тесту, которому важен именно срок, момент задаётся явно.
 */
export const STUB_NOW_MS = Date.parse('2026-10-19T12:00:00.000Z')

export function stubDeliverySource(overrides: Partial<DeliverySource> = {}): DeliverySource {
  return {
    rateLimiter: permissiveRateLimiter,
    now: () => STUB_NOW_MS,
    resolveSiteId: async () => null,
    authorize: async () => ({ kind: 'deny', reason: 'unknown-key' }),
    loadChannelRelease: async () => null,
    loadSiteResolution: async () => ({
      defaultLocale: 'de',
      availableLocales: ['de', 'en'],
      jurisdiction: 'eu-mifid',
      publicUrl: 'https://apex.example.test',
      title: 'Apex Germany',
    }),
    loadArticles: async () => emptyFeedPage(),
    loadVideos: async () => emptyFeedPage(),
    loadPromos: async () => ({ items: [], excluded: [], nextTransitionAt: null }),
    search: async () => ({ hits: [], excluded: [], nextTransitionAt: null }),
    ...overrides,
  }
}
