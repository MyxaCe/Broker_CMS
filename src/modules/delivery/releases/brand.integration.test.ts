import config from '@payload-config'
import { getPayload } from 'payload'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildSiteConfigResponse } from '../api/site-config'

import { buildRelease } from './build'

import type { Payload } from 'payload'

/**
 * Брендовые ассеты: цепочка «карточка бренда → снапшот релиза → ответ
 * выдачи → файл, который реально отдаётся» (ТЗ 2.1, DEBT-014, Р-014).
 *
 * Покрытие единицы не является покрытием пути. Между полем тенанта и
 * витриной здесь четыре перехода, и три из них нельзя проверить без базы:
 * наследование по цепочке, чтение карточки файла и сборка публичного адреса.
 *
 * Последний шаг — **живой запрос по собранному адресу**. Без него проверка
 * доказывала бы, что мы умеем склеивать строку, а не что по ней что-то есть:
 * у нас уже был `MDS_HTTP_URL`, который «выглядел как URL» и указывал на
 * порт, которого нет.
 */

let payload: Payload
let brandId: number | string
let siteId: number | string
let logoId: number | string
let faviconId: number | string

const stamp = Date.now()

async function uploadImage(args: {
  readonly name: string
  readonly alt: string
  readonly width: number
  readonly height: number
  readonly owner: number | string
}): Promise<number | string> {
  const data = await sharp({
    create: {
      width: args.width,
      height: args.height,
      channels: 3,
      background: { r: 212, g: 164, b: 55 },
    },
  })
    .png()
    .toBuffer()

  const doc = await payload.create({
    collection: 'media',
    overrideAccess: true,
    data: { alt: args.alt, owner: args.owner } as never,
    file: { data, mimetype: 'image/png', name: args.name, size: data.byteLength },
  })

  return doc.id
}

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: 'Бренд с ассетами',
      slug: `brand-assets-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'de' }] },
      defaultLocale: { mode: 'override', value: 'de' },
    } as never,
  })

  brandId = brand.id

  /** Полоса риск-предупреждения: без неё комплаенс-гейт не даст собрать релиз. */
  await payload.create({
    collection: 'global-areas',
    overrideAccess: true,
    data: {
      title: 'Предупреждение (de)',
      kind: 'risk-warning',
      owner: brandId,
      locale: 'de',
      isActive: true,
      riskWarning: { text: 'Торговля CFD сопряжена с высоким риском.', lossPercentage: 74 },
    } as never,
  })

  logoId = await uploadImage({
    name: `logo-${stamp}.png`,
    alt: 'Логотип бренда',
    width: 240,
    height: 64,
    owner: brandId,
  })

  faviconId = await uploadImage({
    name: `favicon-${stamp}.png`,
    alt: 'Фавикон бренда',
    width: 64,
    height: 64,
    owner: brandId,
  })

  /**
   * Ассеты заводятся у **бренда**, а релиз собирается у сайта: проверяется
   * наследование, а не чтение собственного поля. Сайт, которому завели
   * логотип отдельно, прошёл бы этот тест и при полностью сломанном
   * наследовании.
   */
  await payload.update({
    collection: 'tenants',
    id: brandId,
    overrideAccess: true,
    data: {
      logoLight: { mode: 'override', value: logoId },
      favicon: { mode: 'override', value: faviconId },
      primaryColor: { mode: 'override', value: '#d4a437' },
      demoStartBalanceCents: { mode: 'override', value: 1_000_000 },
      socials: {
        mode: 'extend',
        items: [
          { name: 'youtube', url: 'https://www.youtube.com/@apexcapital' },
          { name: 'telegram', url: 'https://t.me/apexcapital' },
        ],
      },
    } as never,
  })

  const site = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: 'Сайт с унаследованными ассетами',
      slug: `site-assets-${stamp}`,
      kind: 'site',
      parent: brandId,
    } as never,
  })

  siteId = site.id
}, 180_000)

describe('брендовые ассеты доезжают до выдачи', () => {
  it('логотип и фавикон бренда попадают в ответ сайта наследованием', async () => {
    const result = await buildRelease({ payload, siteId })

    expect(result.report.blocking).toEqual([])
    expect(result.status).toBe('ready')

    const response = buildSiteConfigResponse({
      snapshot: result.snapshot,
      release: { number: result.number, builtAt: new Date().toISOString() },
    })

    expect(response.brand.logoLight).toMatchObject({
      width: 240,
      height: 64,
      alt: 'Логотип бренда',
      mimeType: 'image/png',
    })
    expect(response.brand.favicon).toMatchObject({ width: 64, height: 64 })
    expect(response.brand.primaryColor).toBe('#d4a437')

    /** Отсортированы по названию сети — порядок не зависит от обхода цепочки. */
    expect(response.brand.socials.map((social) => social.name)).toEqual(['telegram', 'youtube'])

    /** Слот без файла — `null`, а не отсутствующее поле. */
    expect(response.brand.logoDark).toBeNull()
  })

  /**
   * Адрес проверяется запросом, а не чтением кода.
   *
   * Собранный адрес обязан вести к файлу: относительный путь Payload
   * (`/api/media/file/...`) у потребителя на другом домене не разрешился бы
   * ни во что, и обнаружилось бы это на витрине, а не здесь.
   */
  it('адрес из ответа ведёт к файлу — проверено запросом', async () => {
    const result = await buildRelease({ payload, siteId })
    const url = result.snapshot.brand?.assets.logoLight?.url

    expect(url).toBeTruthy()

    const response = await fetch(String(url))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/png')
  })

  it('стартовый демо-баланс наследуется и приезжает целым числом', async () => {
    const result = await buildRelease({ payload, siteId })

    /**
     * Postgres хранит поле как `numeric` и отдаёт строкой. Проверка на
     * строгое равенство числу ловит потерю приведения: `'1000000'` прошёл бы
     * любую проверку «значение есть».
     */
    expect(result.snapshot.settings.demoStartBalanceCents).toBe(1_000_000)

    const response = buildSiteConfigResponse({
      snapshot: result.snapshot,
      release: { number: result.number, builtAt: new Date().toISOString() },
    })

    expect(response.settings.demoStartBalanceCents).toBe(1_000_000)
  })
})

describe('сайт без ассетов', () => {
  it('собирается, но предупреждает о регрессе при переезде', async () => {
    const bareBrand = await payload.create({
      collection: 'tenants',
      overrideAccess: true,
      data: {
        name: 'Бренд без ассетов',
        slug: `brand-bare-${stamp}`,
        kind: 'brand',
        jurisdiction: { mode: 'override', value: 'eu-mifid' },
        availableLocales: { mode: 'extend', items: [{ code: 'de' }] },
        defaultLocale: { mode: 'override', value: 'de' },
      } as never,
    })

    await payload.create({
      collection: 'global-areas',
      overrideAccess: true,
      data: {
        title: 'Предупреждение (de)',
        kind: 'risk-warning',
        owner: bareBrand.id,
        locale: 'de',
        isActive: true,
        riskWarning: { text: 'Торговля CFD сопряжена с высоким риском.', lossPercentage: 74 },
      } as never,
    })

    const bareSite = await payload.create({
      collection: 'tenants',
      overrideAccess: true,
      data: {
        name: 'Сайт без ассетов',
        slug: `site-bare-${stamp}`,
        kind: 'site',
        parent: bareBrand.id,
      } as never,
    })

    const result = await buildRelease({ payload, siteId: bareSite.id })

    expect(result.status).toBe('ready')
    expect(result.report.warnings.map((finding) => finding.code).sort()).toEqual([
      'brand-asset-absent',
      'brand-asset-absent',
      'brand-color-absent',
      'demo-balance-missing',
    ])

    /** «Нечего было проверять», а не «нарушений нет» (ADR-0029). */
    expect(result.report.coverage['brand-assets']).toEqual({
      kind: 'empty',
      reason: 'ни один слот брендовых ассетов не заполнен',
    })

    const response = buildSiteConfigResponse({
      snapshot: result.snapshot,
      release: { number: result.number, builtAt: new Date().toISOString() },
    })

    /** Поле присутствует всегда: отсутствие объекта потребитель прочитал бы как undefined. */
    expect(response.brand.logoLight).toBeNull()
    expect(response.settings.demoStartBalanceCents).toBeNull()
  })
})

describe('удаление файла из медиатеки', () => {
  /**
   * Тест-растяжка, а не проверка корректности (урок команды `terminal`).
   *
   * Внешний ключ объявлен `ON DELETE SET NULL`, поэтому удаление файла
   * **молча обнуляет ссылку** у всех тенантов, которые его выбрали: карточка
   * остаётся в режиме «переопределено» с пустым файлом, релиз собирается, и
   * логотип просто исчезает с витрины. Ошибки нет нигде.
   *
   * Наблюдаемое следствие — предупреждение `brand-asset-absent` вместо
   * блокировки. Оно закреплено здесь, чтобы связь была видимой: тот, кто
   * сменит поведение ключа на `RESTRICT` или заведёт карту использования
   * медиатеки, увидит этот тест и поймёт, что состояние «ссылка в никуда»
   * станет достижимым, а ветка `brand-asset-unresolved` — живой.
   *
   * Сама ветка проверена отдельно, на чистых функциях: воспроизвести её на
   * живой базе сегодня нечем, и это записано, а не умолчано.
   */
  it('обнуляет ссылку молча — релиз собирается, но предупреждает', async () => {
    const doomedLogo = await uploadImage({
      name: `doomed-${stamp}.png`,
      alt: 'Логотип, который удалят',
      width: 100,
      height: 50,
      owner: brandId,
    })

    const brokenBrand = await payload.create({
      collection: 'tenants',
      overrideAccess: true,
      data: {
        name: 'Бренд с исчезающим логотипом',
        slug: `brand-broken-${stamp}`,
        kind: 'brand',
        jurisdiction: { mode: 'override', value: 'eu-mifid' },
        availableLocales: { mode: 'extend', items: [{ code: 'de' }] },
        defaultLocale: { mode: 'override', value: 'de' },
        logoLight: { mode: 'override', value: doomedLogo },
      } as never,
    })

    await payload.create({
      collection: 'global-areas',
      overrideAccess: true,
      data: {
        title: 'Предупреждение (de)',
        kind: 'risk-warning',
        owner: brokenBrand.id,
        locale: 'de',
        isActive: true,
        riskWarning: { text: 'Торговля CFD сопряжена с высоким риском.', lossPercentage: 74 },
      } as never,
    })

    const brokenSite = await payload.create({
      collection: 'tenants',
      overrideAccess: true,
      data: {
        name: 'Сайт с исчезающим логотипом',
        slug: `site-broken-${stamp}`,
        kind: 'site',
        parent: brokenBrand.id,
      } as never,
    })

    const before = await buildRelease({ payload, siteId: brokenSite.id })

    expect(before.status).toBe('ready')
    expect(before.snapshot.brand?.assets.logoLight).not.toBeNull()
    expect(before.report.warnings.map((finding) => finding.location)).not.toContain('logoLight')

    await payload.delete({ collection: 'media', id: doomedLogo, overrideAccess: true })

    const after = await buildRelease({ payload, siteId: brokenSite.id })

    /** Ни ошибки, ни блокировки: ссылка исчезла вместе с файлом. */
    expect(after.status).toBe('ready')
    expect(after.snapshot.brand?.assets.logoLight).toBeNull()
    expect(after.report.warnings.map((finding) => finding.location)).toContain('logoLight')

    /** Карточка тенанта по-прежнему утверждает «переопределено» — с пустым файлом. */
    const card = (await payload.findByID({
      collection: 'tenants',
      id: brokenBrand.id,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, { mode: string; value: unknown }>

    expect(card.logoLight?.mode).toBe('override')
    expect(card.logoLight?.value ?? null).toBeNull()
  })
})
