import { describe, expect, it } from 'vitest'

import { checkAgainstSchema, SCHEMA_IDS } from '@/contracts'

import { handleSiteConfig } from './handler'
import { readDeliveryRequest } from './http'
import { buildSiteConfigResponse, DeliveryAssemblyError, resolveLocale } from './site-config'

import { stubDeliverySource } from './source.fixture'

import type { DeliveryRequest, DeliverySource, ResolvedRelease } from './handler'
import type { ReleaseSnapshot } from '../releases/snapshot'

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
  tokenIssues: [],
  tokens: {},
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
    authorize: async ({ siteId }) =>
      siteId === '10'
        ? { kind: 'allow', keyId: 'abc', siteIds: ['10'] }
        : { kind: 'deny', reason: 'site-not-allowed' },
    loadChannelRelease: async () => RELEASE,
    ...overrides,
  })
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
    ...overrides,
  }
}

describe('сборка ответа', () => {
  it('ответ соответствует схеме контракта', () => {
    const body = buildSiteConfigResponse({ snapshot: SNAPSHOT, release: RELEASE })

    expect(checkAgainstSchema(SCHEMA_IDS.siteConfig, body)).toEqual({ valid: true, issues: [] })
  })

  /**
   * Провенанс раскрывает структуру наследования: идентификаторы бренда и
   * региона, о существовании которых потребитель знать не должен.
   */
  it('провенанс наследования наружу не выходит', () => {
    const body = buildSiteConfigResponse({ snapshot: SNAPSHOT, release: RELEASE })

    expect(JSON.stringify(body)).not.toContain('source')
    expect(JSON.stringify(body)).not.toContain('"2"')
  })

  it('внутренний идентификатор сайта наружу не выходит', () => {
    const body = buildSiteConfigResponse({ snapshot: SNAPSHOT, release: RELEASE })

    expect(body.site).toEqual({ slug: 'apex-de' })
  })

  it('без запрошенной локали отдаётся локаль по умолчанию', () => {
    const body = buildSiteConfigResponse({ snapshot: SNAPSHOT, release: RELEASE })

    expect(body.resolution.locale).toBe('de')
  })

  /**
   * Тихая подмена хуже отказа: потребитель считает ответ немецким, а он
   * английский, и расхождение обнаруживается на сайте, а не в вызове.
   */
  it('неизвестная локаль — отказ, а не откат к умолчанию', () => {
    expect(() => resolveLocale(SNAPSHOT, 'fr')).toThrow(DeliveryAssemblyError)
  })

  it('объявленная локаль отдаётся как запрошено', () => {
    const body = buildSiteConfigResponse({
      snapshot: SNAPSHOT,
      release: RELEASE,
      request: { locale: 'en' },
    })

    expect(body.resolution.locale).toBe('en')
  })

  it('неполный снапшот не превращается в неполный ответ', () => {
    const broken: ReleaseSnapshot = {
      ...SNAPSHOT,
      settings: { ...SNAPSHOT.settings, jurisdiction: { value: null, source: null } },
    }

    expect(() => buildSiteConfigResponse({ snapshot: broken, release: RELEASE })).toThrow(
      DeliveryAssemblyError,
    )
  })

  it('локали отсортированы независимо от порядка в снапшоте', () => {
    const shuffled: ReleaseSnapshot = {
      ...SNAPSHOT,
      settings: { ...SNAPSHOT.settings, availableLocales: ['en', 'de'] },
    }

    expect(
      buildSiteConfigResponse({ snapshot: shuffled, release: RELEASE }).settings.availableLocales,
    ).toEqual(['de', 'en'])
  })

  it('вариант присутствует в ответе до появления механизма вариантов', () => {
    expect(
      buildSiteConfigResponse({ snapshot: SNAPSHOT, release: RELEASE }).resolution.variant,
    ).toBe('default')
  })
})

describe('обработчик: успешный ответ', () => {
  it('отдаёт 200 со схемой, ETag и запретом общего кеша', async () => {
    const result = await handleSiteConfig(request(), source())

    expect(result.status).toBe(200)
    expect(checkAgainstSchema(SCHEMA_IDS.siteConfig, result.body).valid).toBe(true)
    expect(result.headers.ETag).toMatch(/^"[0-9a-f]{32}"$/)
    expect(result.headers['Cache-Control']).toBe('private, no-cache')
  })

  /**
   * Ответ зависит от ключа доступа, поэтому посредник обязан знать, что
   * заголовок авторизации входит в ключ кеша.
   */
  it('объявляет зависимость ответа от заголовка авторизации', async () => {
    const result = await handleSiteConfig(request(), source())

    expect(result.headers.Vary).toContain('Authorization')
  })

  it('ключ кеша содержит все пять измерений', async () => {
    const result = await handleSiteConfig(request(), source())

    expect(result.cacheKey).toBe(
      'v1|site=apex-de|rel=77|res=site-config|loc=de|jur=eu-mifid|var=default',
    )
  })

  /**
   * Идентификаторы релизов сквозные по всей установке, поэтому отданный
   * наружу ключ кеша позволяет считать активность соседних сайтов. Ключ
   * остаётся внутренним значением.
   */
  it('ключ кеша не уходит в заголовках', async () => {
    const result = await handleSiteConfig(request(), source())

    expect(Object.keys(result.headers).join(' ').toLowerCase()).not.toContain('cache-key')
    expect(JSON.stringify(result.headers)).not.toContain('rel=')
  })

  it('разные локали дают разные ETag', async () => {
    const de = await handleSiteConfig(request(), source())
    const en = await handleSiteConfig(request({ locale: 'en' }), source())

    expect(de.headers.ETag).not.toBe(en.headers.ETag)
  })

  it('одинаковый запрос даёт одинаковый ETag', async () => {
    const first = await handleSiteConfig(request(), source())
    const second = await handleSiteConfig(request(), source())

    expect(first.headers.ETag).toBe(second.headers.ETag)
  })
})

describe('обработчик: условный запрос', () => {
  it('совпавший ETag даёт 304 без тела', async () => {
    const first = await handleSiteConfig(request(), source())
    const second = await handleSiteConfig(request({ ifNoneMatch: first.headers.ETag! }), source())

    expect(second.status).toBe(304)
    expect(second.body).toBeNull()
  })

  /**
   * Без `ETag` в ответе посредник не может обновить свою запись и повторит
   * тот же условный запрос — и так каждый раз.
   */
  it('304 всё равно содержит ETag', async () => {
    const first = await handleSiteConfig(request(), source())
    const second = await handleSiteConfig(request({ ifNoneMatch: first.headers.ETag! }), source())

    expect(second.headers.ETag).toBe(first.headers.ETag)
  })

  it('чужой ETag даёт полный ответ', async () => {
    const result = await handleSiteConfig(request({ ifNoneMatch: '"нечто иное"' }), source())

    expect(result.status).toBe(200)
  })

  /**
   * Релиз неизменяем, поэтому новый релиз — единственная причина смены ответа.
   * Если бы ETag её не улавливал, потребитель держал бы устаревший ответ до
   * истечения кеша, а публикация выглядела бы как «не применилась».
   */
  it('новый релиз обесценивает прежний ETag', async () => {
    const first = await handleSiteConfig(request(), source())
    const next = await handleSiteConfig(
      request({ ifNoneMatch: first.headers.ETag! }),
      source({
        loadChannelRelease: async () => ({ ...RELEASE, releaseId: '78', number: 43 }),
      }),
    )

    expect(next.status).toBe(200)
  })
})

describe('обработчик: отказы', () => {
  it('без ключа — 401, и ответ ошибки тоже проходит схему', async () => {
    const result = await handleSiteConfig(
      request({ authorizationHeader: null }),
      source({ authorize: async () => ({ kind: 'deny', reason: 'missing-header' }) }),
    )

    expect(result.status).toBe(401)
    expect(checkAgainstSchema(SCHEMA_IDS.error, result.body).valid).toBe(true)
  })

  /**
   * Главное свойство двери наружу: по ответу нельзя понять, чем именно
   * не понравился ключ.
   */
  it.each([
    'missing-header',
    'malformed-key',
    'unknown-key',
    'bad-secret',
    'inactive',
    'expired',
    'no-site-binding',
    'missing-scope',
  ] as const)('причина отказа "%s" неразличима снаружи', async (reason) => {
    const result = await handleSiteConfig(
      request(),
      source({ authorize: async () => ({ kind: 'deny', reason }) }),
    )

    expect(result.status).toBe(401)
    expect(result.body).toEqual({
      contract: 'v1',
      error: { code: 'unauthorized', message: 'Доступ запрещён.', requestId: 'req-1' },
    })
  })

  /**
   * Перечень сайтов не должен узнаваться без ключа: несуществующий сайт и
   * сайт, к которому ключ не привязан, обязаны отвечать одинаково.
   */
  it('несуществующий сайт неотличим от чужого', async () => {
    const missing = await handleSiteConfig(request({ siteSlug: 'нет-такого' }), source())
    const foreign = await handleSiteConfig(
      request(),
      source({ authorize: async () => ({ kind: 'deny', reason: 'site-not-allowed' }) }),
    )

    expect(missing.status).toBe(404)
    expect(missing.body).toEqual(foreign.body)
  })

  it('без ключа несуществующий сайт даёт 401, а не 404', async () => {
    const result = await handleSiteConfig(
      request({ siteSlug: 'нет-такого' }),
      source({ authorize: async () => ({ kind: 'deny', reason: 'missing-header' }) }),
    )

    expect(result.status).toBe(401)
  })

  it('сайт без публикаций — 404', async () => {
    const result = await handleSiteConfig(
      request(),
      source({ loadChannelRelease: async () => null }),
    )

    expect(result.status).toBe(404)
  })

  it('неизвестный канал — 400', async () => {
    const result = await handleSiteConfig(request({ channel: 'выдумка' }), source())

    expect(result.status).toBe(400)
  })

  it('ошибки не кешируются', async () => {
    const result = await handleSiteConfig(request({ channel: 'выдумка' }), source())

    expect(result.headers['Cache-Control']).toBe('no-store')
  })

  it('ответ ошибки не содержит внутренних подробностей', async () => {
    const result = await handleSiteConfig(
      request(),
      source({ authorize: async () => ({ kind: 'deny', reason: 'bad-secret' }) }),
    )

    const dump = JSON.stringify(result.body)
    expect(dump).not.toContain('bad-secret')
    expect(dump).not.toContain('secret')
  })

  it('идентификатор запроса возвращается для сопоставления с журналом', async () => {
    const result = await handleSiteConfig(
      request({ requestId: 'трассировка-9' }),
      source({ authorize: async () => ({ kind: 'deny', reason: 'unknown-key' }) }),
    )

    expect(result.body).toMatchObject({ error: { requestId: 'трассировка-9' } })
  })
})

describe('обработчик: скоупы каналов', () => {
  it('боевой канал требует delivery:read', async () => {
    let asked: string | null = null

    await handleSiteConfig(
      request(),
      source({
        authorize: async ({ requiredScope }) => {
          asked = requiredScope
          return { kind: 'allow', keyId: 'abc', siteIds: ['10'] }
        },
      }),
    )

    expect(asked).toBe('delivery:read')
  })

  /** Ключ витрины не должен открывать неопубликованное. */
  it('предпросмотр требует отдельного скоупа', async () => {
    let asked: string | null = null

    await handleSiteConfig(
      request({ channel: 'staging' }),
      source({
        authorize: async ({ requiredScope }) => {
          asked = requiredScope
          return { kind: 'allow', keyId: 'abc', siteIds: ['10'] }
        },
      }),
    )

    expect(asked).toBe('preview:read')
  })
})

describe('чтение вебового запроса', () => {
  it('разбирает заголовки и параметры', () => {
    const parsed = readDeliveryRequest(
      new Request('https://api.example.test/v1/sites/apex-de/config?locale=en&channel=staging', {
        headers: {
          authorization: 'Bearer bkc_abc_def',
          'if-none-match': '"abc"',
          // Значение заголовка обязано быть ByteString: кириллица здесь невозможна.
          'x-request-id': 'from-proxy-1',
          'x-forwarded-for': '203.0.113.7, 10.0.0.1',
        },
      }),
      'apex-de',
    )

    expect(parsed).toEqual({
      siteSlug: 'apex-de',
      authorizationHeader: 'Bearer bkc_abc_def',
      ifNoneMatch: '"abc"',
      locale: 'en',
      variant: null,
      channel: 'staging',
      requestId: 'from-proxy-1',
      /** Первый адрес в цепочке — тот, что проставил ближайший к клиенту прокси. */
      clientIp: '203.0.113.7',
    })
  })

  /** Без идентификатора запроса отказ невозможно сопоставить с журналом. */
  it('порождает идентификатор запроса, если его не проставил прокси', () => {
    const parsed = readDeliveryRequest(new Request('https://api.example.test/v1'), 'apex-de')

    expect(parsed.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
