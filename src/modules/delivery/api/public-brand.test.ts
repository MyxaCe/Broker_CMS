import { describe, expect, it } from 'vitest'

import { checkAgainstSchema, SCHEMA_IDS } from '@/contracts'
import { EMPTY_BRAND, EMPTY_DISCLAIMERS, EMPTY_ROUTING, EMPTY_STRUCTURE } from '@/modules/design'

import {
  buildPublicBrandResponse,
  handlePublicBrand,
  PUBLIC_BRAND_CACHE_CONTROL,
  PUBLIC_BRAND_RULE,
} from './public-brand'
import { stubDeliverySource } from './source.fixture'

import type { PublicBrandRequest } from './public-brand'
import type { DeliverySource, ResolvedRelease } from './handler'
import type { BrandImage } from '@/modules/design'
import type { ReleaseSnapshot } from '../releases/snapshot'

/**
 * Публичный бренд (Р-039, ADR-0035) — единственная дверь без ключа.
 *
 * Проверяется не только то, что ответ приходит, но и **границы исключения**:
 * что в ответ не попадает ничего, кроме полей для отрисовки; что канал,
 * отличный от опубликованного, отклоняется; что предел частоты свой и
 * закрывает при отказе счётчика; что неопубликованный сайт неотличим от
 * несуществующего.
 *
 * Граница, проверенная «ответ приходит», — это не проверка границы.
 */

const LOGO: BrandImage = {
  url: 'https://media.example.test/logo.png',
  width: 240,
  height: 64,
  alt: 'Логотип Apex',
  mimeType: 'image/png',
}

const SNAPSHOT: ReleaseSnapshot = {
  schemaVersion: 'snapshot-v1',
  site: { id: '10', slug: 'apex-de', kind: 'site' },
  settings: {
    jurisdiction: { value: 'eu-mifid', source: '2' },
    defaultLocale: { value: 'de', source: '2' },
    availableLocales: ['de', 'en'],
    demoStartBalanceCents: 1_000_000,
  },
  brand: {
    ...EMPTY_BRAND,
    assets: { ...EMPTY_BRAND.assets, logoLight: LOGO },
    primaryColor: '#d4a437',
    socials: [{ name: 'telegram', url: 'https://t.me/apex' }],
  },
  disclaimers: EMPTY_DISCLAIMERS,
  colorPairs: [],
  instruments: { symbols: ['BTCUSD'], configured: true, confirmedUnquoted: [] },
  texts: [],
  examined: { tokens: 0, structureNodes: 0, routedPages: 0, compliancePages: 0 },
  tokenIssues: [],
  tokens: {},
  complianceFindings: [],
  structure: EMPTY_STRUCTURE,
  routing: EMPTY_ROUTING,
}

const RELEASE: ResolvedRelease = {
  siteId: '10',
  releaseId: '77',
  number: 42,
  builtAt: '2026-08-03T10:00:00.000Z',
  snapshot: SNAPSHOT,
}

function source(overrides: Partial<DeliverySource> = {}): DeliverySource {
  return stubDeliverySource({
    resolveSiteId: async (slug) => (slug === 'apex-de' ? '10' : null),
    loadChannelRelease: async () => RELEASE,
    ...overrides,
  })
}

function request(overrides: Partial<PublicBrandRequest> = {}): PublicBrandRequest {
  return {
    siteSlug: 'apex-de',
    ifNoneMatch: null,
    channel: null,
    requestId: 'req-1',
    clientIp: '203.0.113.7',
    ...overrides,
  }
}

describe('ответ собирается и проходит схему', () => {
  it('бренд, название и слаг — и больше ничего', () => {
    const body = buildPublicBrandResponse({ snapshot: SNAPSHOT, siteName: 'Apex Germany' })

    expect(Object.keys(body).sort()).toEqual(['brand', 'contract', 'site'])
    expect(body.site).toEqual({ slug: 'apex-de', name: 'Apex Germany' })
    expect(body.brand.logoLight).toEqual(LOGO)
    expect(body.brand.primaryColor).toBe('#d4a437')
  })

  it('схема запрещает лишнее: настройки в публичный ответ не просочатся', () => {
    const body = buildPublicBrandResponse({ snapshot: SNAPSHOT, siteName: 'Apex Germany' })

    const withExtra = { ...body, settings: { jurisdiction: 'eu-mifid' } }

    expect(checkAgainstSchema(SCHEMA_IDS.publicBrand, withExtra).valid).toBe(false)
  })

  it('ни юрисдикции, ни локалей, ни инструментов, ни демо-баланса, ни номера релиза', () => {
    const serialized = JSON.stringify(
      buildPublicBrandResponse({ snapshot: SNAPSHOT, siteName: 'Apex Germany' }),
    )

    for (const leaked of ['eu-mifid', 'BTCUSD', '1000000', 'demoStartBalanceCents', 'release']) {
      expect(serialized).not.toContain(leaked)
    }
  })

  it('релиз без бренда даёт пустые слоты, а не отсутствующий объект', () => {
    const body = buildPublicBrandResponse({
      snapshot: { ...SNAPSHOT, brand: undefined } as unknown as ReleaseSnapshot,
      siteName: 'Apex Germany',
    })

    expect(body.brand.logoLight).toBeNull()
    expect(body.brand.socials).toEqual([])
    expect(checkAgainstSchema(SCHEMA_IDS.publicBrand, body).valid).toBe(true)
  })

  it('пустое название сайта ответа не даёт: схема требует непустого', () => {
    /**
     * Отдать «бренд без имени» значит заставить потребителя подставлять
     * своё — то есть вернуть ровно ту подмену, от которой ресурс и спасает.
     */
    expect(() => buildPublicBrandResponse({ snapshot: SNAPSHOT, siteName: '' })).toThrow()
  })
})

describe('ключа не требует', () => {
  it('отдаёт 200 без заголовка авторизации', async () => {
    const result = await handlePublicBrand(request(), source())

    expect(result.status).toBe(200)
  })

  it('источник ни разу не спрашивают про авторизацию', async () => {
    /**
     * Проверка барьера, а не свойства. Ответ `200` пришёл бы и в том случае,
     * если бы авторизация вызывалась и разрешала: заглушка её не запрещает.
     * Здесь утверждается другое — что публичный путь до неё **не доходит**.
     */
    let asked = 0

    await handlePublicBrand(
      request(),
      source({
        authorize: async () => {
          asked += 1

          return { kind: 'deny', reason: 'unknown-key' }
        },
      }),
    )

    expect(asked).toBe(0)
  })
})

describe('границы исключения', () => {
  it('чужой канал отклоняется, а не исполняется молча как опубликованный', async () => {
    const result = await handlePublicBrand(request({ channel: 'staging' }), source())

    expect(result.status).toBe(400)
  })

  it('явный live разрешён', async () => {
    expect((await handlePublicBrand(request({ channel: 'live' }), source())).status).toBe(200)
  })

  it('канал к источнику уходит всегда опубликованный', async () => {
    const seen: string[] = []

    await handlePublicBrand(
      request(),
      source({
        loadChannelRelease: async ({ channel }) => {
          seen.push(channel)

          return RELEASE
        },
      }),
    )

    expect(seen).toEqual(['live'])
  })

  it('негодный слаг отсекается до обращения к базе', async () => {
    let asked = 0

    const result = await handlePublicBrand(
      request({ siteSlug: '../../etc/passwd' }),
      source({
        resolveSiteId: async () => {
          asked += 1

          return '10'
        },
      }),
    )

    expect(result.status).toBe(400)
    expect(asked).toBe(0)
  })

  it('слаг длиннее предела тоже отсекается', async () => {
    const result = await handlePublicBrand(request({ siteSlug: 'a'.repeat(65) }), source())

    expect(result.status).toBe(400)
  })

  it('несуществующий сайт и сайт без релиза отвечают одинаково', async () => {
    /**
     * Р-039: публичный ресурс не отдаёт перечня тенантов. Разные ответы
     * отдавали бы его по одному — по ним видно, какие слаги заведены, но
     * ещё не опубликованы.
     */
    const missing = await handlePublicBrand(request({ siteSlug: 'no-such-site' }), source())
    const unpublished = await handlePublicBrand(
      request(),
      source({ loadChannelRelease: async () => null }),
    )

    expect(missing.status).toBe(404)
    expect(unpublished.status).toBe(404)
    expect(JSON.stringify(unpublished.body)).toBe(JSON.stringify(missing.body))
  })
})

describe('кеширование и CORS', () => {
  it('ответ кешируется жёстко и публично', async () => {
    const result = await handlePublicBrand(request(), source())

    expect(result.headers['Cache-Control']).toBe(PUBLIC_BRAND_CACHE_CONTROL)
    expect(result.headers['Cache-Control']).toContain('public')
  })

  it('кеш не разбивается по заголовку, которого здесь не бывает', () => {
    /**
     * `Vary: Authorization` на двери без ключа заставил бы общий кеш держать
     * отдельную запись под каждое значение заголовка, которого никто не шлёт.
     */
    expect(PUBLIC_BRAND_CACHE_CONTROL).not.toContain('private')
  })

  it('CORS открыт: ресурс читает браузер с чужого origin', async () => {
    const result = await handlePublicBrand(request(), source())

    expect(result.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(result.headers.Vary).toBe('Accept-Encoding')
  })

  it('любой отказ отдаётся с CORS, иначе браузер покажет сетевую ошибку вместо кода', async () => {
    const notFound = await handlePublicBrand(request({ siteSlug: 'no-such-site' }), source())
    const badSlug = await handlePublicBrand(request({ siteSlug: 'ПЛОХОЙ' }), source())
    const badChannel = await handlePublicBrand(request({ channel: 'staging' }), source())

    for (const result of [notFound, badSlug, badChannel]) {
      expect(result.headers['Access-Control-Allow-Origin']).toBe('*')
    }
  })

  it('отказ не кешируется: «сайт не найден» не должен пережить первую публикацию', async () => {
    const result = await handlePublicBrand(request({ siteSlug: 'no-such-site' }), source())

    expect(result.headers['Cache-Control']).toBe('no-store')
  })

  it('повторный запрос с тем же ETag даёт 304 без тела', async () => {
    const first = await handlePublicBrand(request(), source())
    const second = await handlePublicBrand(
      request({ ifNoneMatch: first.headers.ETag ?? null }),
      source(),
    )

    expect(second.status).toBe(304)
    expect(second.body).toBeNull()
    /** `ETag` в `304` обязателен: без него посредник не обновит свою запись. */
    expect(second.headers.ETag).toBe(first.headers.ETag)
  })

  it('другой релиз даёт другой ETag', async () => {
    const first = await handlePublicBrand(request(), source())
    const other = await handlePublicBrand(
      request(),
      source({ loadChannelRelease: async () => ({ ...RELEASE, releaseId: '78' }) }),
    )

    expect(other.headers.ETag).not.toBe(first.headers.ETag)
  })
})

describe('предел частоты — единственное, чем ограничена дверь', () => {
  it('свой, а не общий с чтением по ключу', async () => {
    const buckets: string[] = []

    await handlePublicBrand(
      request(),
      source({
        rateLimiter: {
          consume: async (bucket) => {
            buckets.push(bucket)

            return { allowed: true, remaining: 1, retryAfterSec: 1 }
          },
          peek: async () => ({ allowed: true, remaining: 1, retryAfterSec: 1 }),
        },
      }),
    )

    expect(buckets).toEqual(['public-brand:203.0.113.7'])
  })

  it('считается по адресу источника: ключа, по которому считать, здесь нет', async () => {
    const buckets: string[] = []
    const limiter = {
      consume: async (bucket: string) => {
        buckets.push(bucket)

        return { allowed: true, remaining: 1, retryAfterSec: 1 }
      },
      peek: async () => ({ allowed: true, remaining: 1, retryAfterSec: 1 }),
    }

    await handlePublicBrand(request({ clientIp: '198.51.100.1' }), source({ rateLimiter: limiter }))
    await handlePublicBrand(request({ clientIp: null }), source({ rateLimiter: limiter }))

    expect(buckets).toEqual(['public-brand:198.51.100.1', 'public-brand:неизвестный'])
  })

  it('исчерпанный предел даёт 429 с Retry-After', async () => {
    const result = await handlePublicBrand(
      request(),
      source({
        rateLimiter: {
          consume: async () => ({ allowed: false, remaining: 0, retryAfterSec: 17 }),
          peek: async () => ({ allowed: false, remaining: 0, retryAfterSec: 17 }),
        },
      }),
    )

    expect(result.status).toBe(429)
    expect(result.headers['Retry-After']).toBe('17')
  })

  it('недоступный счётчик **закрывает** дверь, а не открывает', async () => {
    /**
     * Осознанное расхождение с чтением по ключу, где отказ ведра пропускает
     * запрос дальше. Там дверь всё равно закрыта ключом; здесь предел — то
     * самое условие, на котором штаб разрешил исключение (Р-039). Условие,
     * исчезающее при недоступности Redis, — это защита, держащаяся на
     * побочном свойстве чего-то другого.
     */
    let reached = 0

    const result = await handlePublicBrand(
      request(),
      source({
        rateLimiter: {
          consume: async () => {
            throw new Error('redis недоступен')
          },
          peek: async () => ({ allowed: true, remaining: 1, retryAfterSec: 1 }),
        },
        resolveSiteId: async () => {
          reached += 1

          return '10'
        },
      }),
    )

    expect(result.status).toBe(429)
    expect(reached).toBe(0)
  })

  it('предел проверяется до обращения к базе', async () => {
    let reached = 0

    await handlePublicBrand(
      request(),
      source({
        rateLimiter: {
          consume: async () => ({ allowed: false, remaining: 0, retryAfterSec: 5 }),
          peek: async () => ({ allowed: false, remaining: 0, retryAfterSec: 5 }),
        },
        resolveSiteId: async () => {
          reached += 1

          return '10'
        },
      }),
    )

    expect(reached).toBe(0)
  })

  it('правило названо числом, а не взято из чтения по ключу', () => {
    expect(PUBLIC_BRAND_RULE.limit).toBeGreaterThan(0)
    expect(PUBLIC_BRAND_RULE.windowMs).toBe(60_000)
  })
})
