import config from '@payload-config'
import { getPayload } from 'payload'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildRelease } from '../releases/build'
import { switchChannel } from '../releases/publish'

import { handleSiteConfig } from './handler'
import { createPayloadSource } from './payload-source'
import { handlePublicBrand } from './public-brand'
import { buildSiteConfigResponse } from './site-config'
import { permissiveRateLimiter } from './source.fixture'

import type { DeliverySource } from './handler'
import type { Payload } from 'payload'

/**
 * Публичный бренд на живой базе (Р-039, [[ADR-0035]]).
 *
 * Проверяется **связка**, а не функция: карточка бренда → снапшот релиза →
 * публикация в канал → ответ без ключа → файл по собранному адресу. Сборка
 * ответа покрыта модульно и останется зелёной, даже если ресурс перестанет
 * находить релиз, начнёт требовать ключ или отдавать бренд другого сайта.
 *
 * Два утверждения, ради которых тест и существует:
 *
 *  · **исключение ровно одной двери шириной.** Тот же сайт, тот же источник,
 *    тот же отсутствующий ключ: публичный бренд отдаёт `200`, конфигурация
 *    сайта — `401`. Проверять только первое значит проверять свойство, а не
 *    барьер;
 *  · **источник один.** Бренд в публичном ответе совпадает с брендом в
 *    `site-config` байт в байт. Р-039 отказался от проксирования именно
 *    затем, чтобы два пути доставки одного бренда не разошлись, — и это
 *    единственное место, где такое расхождение заметно до переезда.
 */

let payload: Payload
let source: DeliverySource
let siteSlug: string
let siteId: number | string

const stamp = Date.now()

beforeAll(async () => {
  payload = await getPayload({ config })

  /**
   * Перец для проверки ключей обязателен, а значение здесь не важно:
   * действующих ключей в тесте нет вовсе — в этом и смысл.
   */
  source = createPayloadSource({
    payload,
    pepper: 'перец-для-проверки-публичного-ресурса-бренда',
    rateLimiter: permissiveRateLimiter,
  })

  const brand = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: `Публичный бренд ${stamp}`,
      slug: `pub-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'en' },
    } as never,
  })

  await payload.create({
    collection: 'global-areas',
    overrideAccess: true,
    data: {
      title: 'Предупреждение о риске',
      kind: 'risk-warning',
      owner: brand.id,
      locale: 'en',
      isActive: true,
      riskWarning: { text: 'Торговля CFD сопряжена с высоким риском.', lossPercentage: 74 },
    } as never,
  })

  const primitive = async (name: string, value: string) => {
    await payload.create({
      collection: 'design-primitives',
      overrideAccess: true,
      data: { name, category: 'color', value, owner: brand.id } as never,
    })
  }

  await primitive('color.white', '#FFFFFF')
  await primitive('color.ink', '#111111')

  for (const [name, group, light, dark] of [
    ['surface.base', 'surface', 'color.white', 'color.ink'],
    ['text.primary', 'text', 'color.ink', 'color.white'],
  ]) {
    await payload.create({
      collection: 'design-roles',
      overrideAccess: true,
      data: { name, group, light, dark, owner: brand.id } as never,
    })
  }

  const png = await sharp({
    create: { width: 240, height: 64, channels: 3, background: { r: 212, g: 164, b: 55 } },
  })
    .png()
    .toBuffer()

  const logo = await payload.create({
    collection: 'media',
    overrideAccess: true,
    data: { alt: 'Логотип публичного бренда', owner: brand.id } as never,
    file: { data: png, mimetype: 'image/png', name: `pub-logo-${stamp}.png`, size: png.byteLength },
  })

  /** Ассеты заводятся у бренда: проверяется наследование, а не чтение своего поля. */
  await payload.update({
    collection: 'tenants',
    id: brand.id,
    overrideAccess: true,
    data: {
      logoLight: { mode: 'override', value: logo.id },
      primaryColor: { mode: 'override', value: '#d4a437' },
      socials: { mode: 'extend', items: [{ name: 'telegram', url: 'https://t.me/apex' }] },
    } as never,
  })

  siteSlug = `pub-site-${stamp}`

  const site = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: `Публичный сайт ${stamp}`,
      slug: siteSlug,
      kind: 'site',
      parent: brand.id,
    } as never,
  })

  siteId = site.id
}, 180_000)

describe('до публикации', () => {
  it('сайт без опубликованного релиза отвечает так же, как несуществующий', async () => {
    const unpublished = await handlePublicBrand(
      { siteSlug, ifNoneMatch: null, channel: null, requestId: 'r1', clientIp: '203.0.113.9' },
      source,
    )

    const missing = await handlePublicBrand(
      {
        siteSlug: `pub-none-${stamp}`,
        ifNoneMatch: null,
        channel: null,
        requestId: 'r1',
        clientIp: '203.0.113.9',
      },
      source,
    )

    expect(unpublished.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(JSON.stringify(unpublished.body)).toBe(JSON.stringify(missing.body))
  })
})

describe('после публикации', () => {
  beforeAll(async () => {
    const built = await buildRelease({ payload, siteId })

    expect(built.report.blocking).toEqual([])
    expect(built.status).toBe('ready')

    await switchChannel({
      payload,
      siteId: String(siteId),
      siteSlug,
      channel: 'live',
      releaseId: String(built.releaseId),
      releaseNumber: built.number,
      intent: 'publish',
    })
  }, 180_000)

  it('бренд отдаётся без ключа доставки', async () => {
    const result = await handlePublicBrand(
      { siteSlug, ifNoneMatch: null, channel: null, requestId: 'r2', clientIp: '203.0.113.9' },
      source,
    )

    expect(result.status).toBe(200)

    const body = result.body as unknown as {
      site: { slug: string; name: string }
      brand: Record<string, unknown>
    }

    expect(body.site.slug).toBe(siteSlug)
    expect(body.brand.primaryColor).toBe('#d4a437')
    expect(body.brand.logoLight).toMatchObject({
      width: 240,
      height: 64,
      alt: 'Логотип публичного бренда',
      mimeType: 'image/png',
    })
  })

  it('та же дверь без ключа у конфигурации сайта даёт 401', async () => {
    /**
     * Барьер, а не свойство. Без этой пары «бренд отдался» доказывало бы
     * только, что ресурс работает, — но не что исключение одно.
     */
    const result = await handleSiteConfig(
      {
        siteSlug,
        authorizationHeader: null,
        ifNoneMatch: null,
        locale: null,
        variant: null,
        channel: null,
        requestId: 'r3',
        clientIp: '203.0.113.9',
      },
      source,
    )

    expect(result.status).toBe(401)
  })

  it('бренд в публичном ответе совпадает с брендом site-config байт в байт', async () => {
    const release = await source.loadChannelRelease({ siteId: String(siteId), channel: 'live' })

    expect(release).not.toBeNull()

    const config = buildSiteConfigResponse({
      snapshot: release!.snapshot,
      release: { number: release!.number, builtAt: release!.builtAt },
    })

    const open = await handlePublicBrand(
      { siteSlug, ifNoneMatch: null, channel: null, requestId: 'r4', clientIp: '203.0.113.9' },
      source,
    )

    expect(JSON.stringify((open.body as unknown as { brand: unknown }).brand)).toBe(
      JSON.stringify(config.brand),
    )
  })

  it('адрес логотипа ведёт к файлу — проверено запросом', async () => {
    /**
     * Без этого проверка доказывала бы, что мы умеем склеивать строку. Для
     * публичного ресурса это важнее, чем для закрытого: по нему ходит
     * браузер анонимного посетителя, и битая ссылка видна сразу всем.
     */
    const result = await handlePublicBrand(
      { siteSlug, ifNoneMatch: null, channel: null, requestId: 'r5', clientIp: '203.0.113.9' },
      source,
    )

    const url = (result.body as unknown as { brand: { logoLight: { url: string } } }).brand
      .logoLight.url
    const response = await fetch(url)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/png')
  })

  it('ответ кешируется публично и подтверждается условным запросом', async () => {
    const first = await handlePublicBrand(
      { siteSlug, ifNoneMatch: null, channel: null, requestId: 'r6', clientIp: '203.0.113.9' },
      source,
    )

    expect(first.headers['Cache-Control']).toContain('public')
    expect(first.headers['Access-Control-Allow-Origin']).toBe('*')

    const again = await handlePublicBrand(
      {
        siteSlug,
        ifNoneMatch: first.headers.ETag ?? null,
        channel: null,
        requestId: 'r7',
        clientIp: '203.0.113.9',
      },
      source,
    )

    expect(again.status).toBe(304)
  })

  it('бренд чужого сайта по этому адресу не отдаётся', async () => {
    const other = await payload.create({
      collection: 'tenants',
      overrideAccess: true,
      data: {
        name: `Чужой бренд ${stamp}`,
        slug: `pub-other-brand-${stamp}`,
        kind: 'brand',
        jurisdiction: { mode: 'override', value: 'uk-fca' },
        availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
        defaultLocale: { mode: 'override', value: 'en' },
      } as never,
    })

    const otherSlug = `pub-other-site-${stamp}`

    await payload.create({
      collection: 'tenants',
      overrideAccess: true,
      data: { name: otherSlug, slug: otherSlug, kind: 'site', parent: other.id } as never,
    })

    const result = await handlePublicBrand(
      {
        siteSlug: otherSlug,
        ifNoneMatch: null,
        channel: null,
        requestId: 'r8',
        clientIp: '203.0.113.9',
      },
      source,
    )

    /** У чужого сайта релиза нет — и бренд соседа ему не подставляется. */
    expect(result.status).toBe(404)
  })
})
