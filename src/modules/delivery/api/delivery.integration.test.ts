import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkAgainstSchema, SCHEMA_IDS } from '@/contracts'
import { ensureEnv } from '@/platform'

import { issueDeliveryKey } from '../keys/issue'
import { buildRelease } from '../releases/build'
import { switchChannel } from '../releases/publish'

import { handleSiteConfig } from './handler'
import { createPayloadSource } from './payload-source'
import { RedisRateLimiter } from './redis-rate-limit'

import type { DeliveryRequest, DeliverySource } from './handler'
import type { Payload } from 'payload'

/**
 * Дверь наружу целиком, на живой базе (ТЗ разд. 3).
 *
 * Модульные тесты проверяют обработчик на подменённом источнике — здесь
 * проверяется то, что подменить нельзя: что настоящий ключ находится в базе,
 * настоящий канал указывает на настоящий релиз, а снапшот доезжает до ответа
 * без потерь.
 */

let payload: Payload
let source: DeliverySource
let limiter: RedisRateLimiter
let siteSlug: string
let otherSlug: string
let liveKey: string
let otherSiteKey: string
let releaseNumber: number

const stamp = Date.now()

async function makeSite(name: string, slug: string) {
  const brand = await payload.create({
    collection: 'tenants',
    data: {
      name: `${name} — бренд`,
      slug: `${slug}-brand`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'de' }, { code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'de' },
    } as never,
    overrideAccess: true,
  })

  /**
   * Полоса риск-предупреждения на каждую локаль: без неё релиз не собирается
   * (ТЗ 2.4), а этому тесту нужен собранный релиз, чтобы было что отдавать.
   */
  for (const locale of ['de', 'en']) {
    await payload.create({
      collection: 'global-areas',
      overrideAccess: true,
      data: {
        title: `Предупреждение (${locale})`,
        kind: 'risk-warning',
        owner: brand.id,
        locale,
        isActive: true,
        riskWarning: { text: 'Торговля CFD сопряжена с высоким риском.', lossPercentage: 74 },
      } as never,
    })
  }

  return payload.create({
    collection: 'tenants',
    data: { name, slug, kind: 'site', parent: brand.id } as never,
    overrideAccess: true,
  })
}

beforeAll(async () => {
  payload = await getPayload({ config })

  /**
   * Счётчик настоящий, а не подменённый: смысл ограничения — в общем на все
   * процессы хранилище, и подделка проверила бы только арифметику. Префикс свой
   * у каждого прогона — иначе счётчики предыдущего запуска влияли бы на этот.
   */
  limiter = new RedisRateLimiter({ url: ensureEnv().REDIS_URL, prefix: `test:${stamp}` })

  source = createPayloadSource({
    payload,
    pepper: ensureEnv().DELIVERY_KEY_PEPPER,
    rateLimiter: limiter,
  })

  siteSlug = `delivery-site-${stamp}`
  otherSlug = `delivery-other-${stamp}`

  const site = await makeSite('Витрина', siteSlug)
  const other = await makeSite('Чужая витрина', otherSlug)

  const built = await buildRelease({ payload, siteId: site.id })
  expect(built.status).toBe('ready')
  releaseNumber = built.number

  await switchChannel({
    payload,
    siteId: String(site.id),
    siteSlug,
    channel: 'live',
    releaseId: String(built.releaseId),
    releaseNumber: built.number,
    intent: 'publish',
  })

  liveKey = (
    await issueDeliveryKey({
      payload,
      pepper: ensureEnv().DELIVERY_KEY_PEPPER,
      name: `Витрина ${stamp}`,
      scopes: ['delivery:read'],
      siteIds: [site.id],
    })
  ).plaintext

  otherSiteKey = (
    await issueDeliveryKey({
      payload,
      pepper: ensureEnv().DELIVERY_KEY_PEPPER,
      name: `Чужая витрина ${stamp}`,
      scopes: ['delivery:read'],
      siteIds: [other.id],
    })
  ).plaintext
})

function request(overrides: Partial<DeliveryRequest> = {}): DeliveryRequest {
  return {
    siteSlug,
    authorizationHeader: `Bearer ${liveKey}`,
    ifNoneMatch: null,
    locale: null,
    variant: null,
    channel: null,
    requestId: 'integration',
    ...overrides,
  }
}

describe('опубликованный сайт отдаётся по ключу', () => {
  it('ответ проходит схему и содержит данные релиза', async () => {
    const result = await handleSiteConfig(request(), source)

    expect(result.status).toBe(200)
    expect(checkAgainstSchema(SCHEMA_IDS.siteConfig, result.body).valid).toBe(true)
    expect(result.body).toMatchObject({
      site: { slug: siteSlug },
      release: { number: releaseNumber },
      resolution: { locale: 'de', jurisdiction: 'eu-mifid', variant: 'default' },
      settings: { defaultLocale: 'de', availableLocales: ['de', 'en'], jurisdiction: 'eu-mifid' },
    })
  })

  /** Наследование от бренда обязано доезжать до выдачи — иначе оно бессмысленно. */
  it('унаследованные от бренда настройки видны в ответе', async () => {
    const result = await handleSiteConfig(request(), source)

    expect(result.body).toMatchObject({ settings: { jurisdiction: 'eu-mifid' } })
  })

  it('внутренние идентификаторы и провенанс наружу не выходят', async () => {
    const dump = JSON.stringify((await handleSiteConfig(request(), source)).body)

    expect(dump).not.toContain('source')
    expect(dump).not.toContain('parent')
  })

  it('повторный запрос с ETag даёт 304', async () => {
    const first = await handleSiteConfig(request(), source)
    const second = await handleSiteConfig(request({ ifNoneMatch: first.headers.ETag! }), source)

    expect(second.status).toBe(304)
    expect(second.body).toBeNull()
  })
})

describe('всё остальное закрыто', () => {
  it('без ключа — 401', async () => {
    const result = await handleSiteConfig(request({ authorizationHeader: null }), source)

    expect(result.status).toBe(401)
    expect(checkAgainstSchema(SCHEMA_IDS.error, result.body).valid).toBe(true)
  })

  /**
   * Ключ соседнего сайта не должен открывать этот — и не должен по ответу
   * отличаться от обращения к несуществующему сайту.
   */
  it('ключ чужого сайта не открывает этот и неотличим от несуществующего', async () => {
    const foreign = await handleSiteConfig(
      request({ authorizationHeader: `Bearer ${otherSiteKey}` }),
      source,
    )
    const missing = await handleSiteConfig(request({ siteSlug: `нет-такого-${stamp}` }), source)

    expect(foreign.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(foreign.body).toEqual(missing.body)
  })

  /** Ключ витрины не имеет скоупа предпросмотра — неопубликованное закрыто. */
  it('предпросмотр по ключу витрины — отказ', async () => {
    const result = await handleSiteConfig(request({ channel: 'staging' }), source)

    expect(result.status).toBe(401)
  })

  it('сайт без публикаций — 404, хотя ключ действителен', async () => {
    const result = await handleSiteConfig(
      request({ siteSlug: otherSlug, authorizationHeader: `Bearer ${otherSiteKey}` }),
      source,
    )

    expect(result.status).toBe(404)
  })

  it('неизвестная локаль — 400, а не тихая подмена', async () => {
    const result = await handleSiteConfig(request({ locale: 'fr' }), source)

    expect(result.status).toBe(400)
  })
})

describe('ограничение частоты на настоящем Redis', () => {
  const rule = { limit: 3, windowMs: 60_000 }

  it('счётчик общий, а не в памяти процесса', async () => {
    const bucket = `общий-${stamp}`
    const other = new RedisRateLimiter({ url: ensureEnv().REDIS_URL, prefix: `test:${stamp}` })

    try {
      await limiter.consume(bucket, rule)
      await limiter.consume(bucket, rule)
      const third = await other.consume(bucket, rule)
      const fourth = await other.consume(bucket, rule)

      /**
       * Третье обращение ещё в пределах, четвёртое — уже нет, и увидел это
       * **второй** экземпляр. Именно это свойство теряется у счётчика в памяти:
       * там каждый процесс считал бы заново.
       */
      expect(third.allowed).toBe(true)
      expect(fourth.allowed).toBe(false)
    } finally {
      await other.close()
    }
  })

  it('исчерпанный предел неудачных авторизаций закрывает дверь целиком', async () => {
    const attacker = { ...request({ authorizationHeader: null }), clientIp: `1.2.3.${stamp % 250}` }

    /** Предел по умолчанию — 20 неудач за минуту; берём с запасом. */
    for (let attempt = 0; attempt < 21; attempt += 1) {
      await handleSiteConfig(attacker, source)
    }

    const result = await handleSiteConfig(attacker, source)

    expect(result.status).toBe(429)
    expect(result.headers['Retry-After']).toBeDefined()
  })

  /** Перебор с одного адреса не должен закрывать выдачу законному потребителю. */
  it('подбор с чужого адреса не мешает нормальному ключу', async () => {
    const result = await handleSiteConfig(
      { ...request(), clientIp: `9.9.9.${(stamp + 7) % 250}` },
      source,
    )

    expect(result.status).toBe(200)
  })
})

afterAll(async () => {
  await limiter.close()
})
