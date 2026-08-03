import { describe, expect, it } from 'vitest'

import { handleSiteConfig } from './handler'
import {
  decide,
  DEFAULT_AUTH_FAILURE_RULE,
  DEFAULT_READ_RULE,
  estimateUsage,
  windowBounds,
} from './rate-limit'

import type { DeliveryRequest, DeliverySource } from './handler'
import type { RateLimiter, RateLimitRule } from './rate-limit'
import type { ReleaseSnapshot } from '../releases/snapshot'

const RULE: RateLimitRule = { limit: 10, windowMs: 60_000 }

describe('оценка скользящим окном', () => {
  it('в начале окна учитывается почти всё предыдущее ведро', () => {
    expect(
      estimateUsage({ previousCount: 10, currentCount: 0, elapsedMs: 0, windowMs: 60_000 }),
    ).toBe(10)
  })

  it('к концу окна предыдущее ведро перестаёт учитываться', () => {
    expect(
      estimateUsage({ previousCount: 10, currentCount: 0, elapsedMs: 60_000, windowMs: 60_000 }),
    ).toBe(0)
  })

  it('на середине окна предыдущее ведро учитывается наполовину', () => {
    expect(
      estimateUsage({ previousCount: 10, currentCount: 3, elapsedMs: 30_000, windowMs: 60_000 }),
    ).toBe(8)
  })

  /**
   * Главное свойство, ради которого окно скользящее: фиксированное позволяет
   * выбрать предел в конце одного окна и сразу заново в начале следующего —
   * то есть двойной предел на стыке.
   */
  it('всплеск на стыке окон не проходит', () => {
    const atBoundary = estimateUsage({
      previousCount: RULE.limit,
      currentCount: 1,
      elapsedMs: 100,
      windowMs: RULE.windowMs,
    })

    expect(decide({ usage: atBoundary, rule: RULE, elapsedMs: 100 }).allowed).toBe(false)
  })
})

describe('решение', () => {
  it('в пределах — разрешено', () => {
    expect(decide({ usage: 5, rule: RULE, elapsedMs: 0 })).toMatchObject({
      allowed: true,
      remaining: 5,
    })
  })

  it('на пределе — ещё разрешено', () => {
    expect(decide({ usage: 10, rule: RULE, elapsedMs: 0 }).allowed).toBe(true)
  })

  it('сверх предела — отказ', () => {
    expect(decide({ usage: 11, rule: RULE, elapsedMs: 0 }).allowed).toBe(false)
  })

  it('остаток не бывает отрицательным', () => {
    expect(decide({ usage: 999, rule: RULE, elapsedMs: 0 }).remaining).toBe(0)
  })

  /** Ноль означал бы «повторяй немедленно» — то есть отсутствие паузы. */
  it('пауза всегда не меньше секунды', () => {
    expect(decide({ usage: 99, rule: RULE, elapsedMs: 59_999 }).retryAfterSec).toBe(1)
  })
})

describe('границы окна', () => {
  it('окна выравнены и не пересекаются', () => {
    const bounds = windowBounds(1_000_000, 60_000)

    expect(bounds.start % 60_000).toBe(0)
    expect(bounds.previousStart).toBe(bounds.start - 60_000)
    expect(bounds.elapsedMs).toBeLessThan(60_000)
  })
})

describe('пределы по умолчанию', () => {
  /**
   * Один предел на чтение и на подбор означал бы, что подбор ключа ограничен
   * так же слабо, как обычное чтение витрины.
   */
  it('неудачных авторизаций разрешено заметно меньше, чем чтений', () => {
    expect(DEFAULT_AUTH_FAILURE_RULE.limit).toBeLessThan(DEFAULT_READ_RULE.limit / 10)
  })
})

const SNAPSHOT: ReleaseSnapshot = {
  schemaVersion: 'snapshot-v1',
  site: { id: '10', slug: 'apex-de', kind: 'site' },
  settings: {
    jurisdiction: { value: 'eu-mifid', source: '2' },
    defaultLocale: { value: 'de', source: '2' },
    availableLocales: ['de', 'en'],
  },
  colorPairs: [],
  texts: [],
}

function source(limiter: RateLimiter, allow = true): DeliverySource {
  return {
    rateLimiter: limiter,
    resolveSiteId: async () => '10',
    authorize: async () =>
      allow
        ? { kind: 'allow', keyId: 'abc', siteIds: ['10'] }
        : { kind: 'deny', reason: 'bad-secret' },
    loadChannelRelease: async () => ({
      siteId: '10',
      releaseId: '77',
      number: 42,
      builtAt: '2026-08-03T10:00:00.000Z',
      snapshot: SNAPSHOT,
    }),
  }
}

function request(overrides: Partial<DeliveryRequest> = {}): DeliveryRequest {
  return {
    siteSlug: 'apex-de',
    authorizationHeader: 'Bearer bkc_abcdef1234567890_секрет-достаточной-длины',
    ifNoneMatch: null,
    locale: null,
    variant: null,
    channel: null,
    requestId: 'req-1',
    clientIp: '203.0.113.7',
    ...overrides,
  }
}

const allowAll: RateLimiter = {
  consume: async () => ({ allowed: true, remaining: 1, retryAfterSec: 1 }),
  peek: async () => ({ allowed: true, remaining: 1, retryAfterSec: 1 }),
}

describe('обработчик под ограничением', () => {
  it('превышение предела чтения даёт 429 с Retry-After', async () => {
    const limiter: RateLimiter = {
      ...allowAll,
      consume: async () => ({ allowed: false, remaining: 0, retryAfterSec: 17 }),
    }

    const result = await handleSiteConfig(request(), source(limiter))

    expect(result.status).toBe(429)
    expect(result.headers['Retry-After']).toBe('17')
    expect(result.body).toMatchObject({ error: { code: 'rate-limited' } })
  })

  /**
   * Отказ обязан наступать до обращения к базе — иначе перебор продолжает
   * стоить нам запроса на каждую попытку и после срабатывания предела.
   */
  it('исчерпанный предел неудачных авторизаций отсекает запрос до базы', async () => {
    let touchedDatabase = false

    const limiter: RateLimiter = {
      ...allowAll,
      peek: async () => ({ allowed: false, remaining: 0, retryAfterSec: 30 }),
    }

    const result = await handleSiteConfig(request(), {
      ...source(limiter),
      resolveSiteId: async () => {
        touchedDatabase = true
        return '10'
      },
    })

    expect(result.status).toBe(429)
    expect(touchedDatabase).toBe(false)
  })

  it('неудачная авторизация увеличивает счётчик отказов', async () => {
    const consumed: string[] = []

    const limiter: RateLimiter = {
      peek: async () => ({ allowed: true, remaining: 1, retryAfterSec: 1 }),
      consume: async (bucket) => {
        consumed.push(bucket)
        return { allowed: true, remaining: 1, retryAfterSec: 1 }
      },
    }

    await handleSiteConfig(request(), source(limiter, false))

    expect(consumed).toContain('fail:203.0.113.7')
  })

  /** За одним адресом сидит целый сайт, а ключ у каждого потребителя свой. */
  it('чтение считается по ключу, а не по адресу', async () => {
    const consumed: string[] = []

    const limiter: RateLimiter = {
      peek: async () => ({ allowed: true, remaining: 1, retryAfterSec: 1 }),
      consume: async (bucket) => {
        consumed.push(bucket)
        return { allowed: true, remaining: 1, retryAfterSec: 1 }
      },
    }

    await handleSiteConfig(request(), source(limiter))

    expect(consumed[0]).toMatch(/^key:/)
  })

  it('без ключа чтение считается по адресу', async () => {
    const consumed: string[] = []

    const limiter: RateLimiter = {
      peek: async () => ({ allowed: true, remaining: 1, retryAfterSec: 1 }),
      consume: async (bucket) => {
        consumed.push(bucket)
        return { allowed: true, remaining: 1, retryAfterSec: 1 }
      },
    }

    await handleSiteConfig(request({ authorizationHeader: null }), source(limiter, false))

    expect(consumed[0]).toBe('fail:203.0.113.7')
  })
})

describe('поведение при недоступном счётчике', () => {
  /**
   * Осознанный разрыв с общим fail-closed: отказ вспомогательного хранилища
   * не должен гасить выдачу всех сайтов.
   */
  it('отказ счётчика чтений не роняет выдачу', async () => {
    const limiter: RateLimiter = {
      peek: async () => ({ allowed: true, remaining: 1, retryAfterSec: 1 }),
      consume: async () => {
        throw new Error('Redis недоступен')
      },
    }

    const result = await handleSiteConfig(request(), source(limiter))

    expect(result.status).toBe(200)
  })

  /**
   * А здесь наоборот: закрывается, потому что затрагивает только тех, кто уже
   * не прошёл проверку.
   */
  it('отказ счётчика неудачных авторизаций закрывает дверь', async () => {
    const limiter: RateLimiter = {
      consume: async () => ({ allowed: true, remaining: 1, retryAfterSec: 1 }),
      peek: async () => {
        throw new Error('Redis недоступен')
      },
    }

    const result = await handleSiteConfig(request(), source(limiter))

    expect(result.status).toBe(429)
  })
})
