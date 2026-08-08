import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildRelease } from './build'

import type { Payload } from 'payload'

/**
 * Слой В на живой базе (ТЗ 2.3).
 *
 * Проверяется то, чего не увидеть на подменённых данных: что граф hreflang
 * действительно собирается **между сайтами** бренда, что переименование
 * страницы само порождает 301, и что цикл перенаправлений останавливает сборку.
 */

let payload: Payload
let ruSiteId: number | string
let dePageId: number | string

const stamp = Date.now()

async function site(
  name: string,
  slug: string,
  url: string,
  parent: number | string,
  overrides: Record<string, unknown> = {},
) {
  return payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: { name, slug, kind: 'site', parent, publicUrl: url, ...overrides } as never,
  })
}

async function page(data: Record<string, unknown>) {
  return payload.create({
    collection: 'pages',
    overrideAccess: true,
    data: { status: 'published', blocks: [], ...data } as never,
  })
}

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: 'Слой В — бренд',
      slug: `routing-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'ru' }] },
      defaultLocale: { mode: 'override', value: 'ru' },
    } as never,
  })

  await payload.create({
    collection: 'global-areas',
    overrideAccess: true,
    data: {
      title: 'Предупреждение о риске',
      kind: 'risk-warning',
      owner: brand.id,
      locale: 'ru',
      isActive: true,
      riskWarning: { text: 'Торговля CFD сопряжена с высоким риском.', lossPercentage: 74 },
    } as never,
  })

  await payload.create({
    collection: 'seo-profiles',
    overrideAccess: true,
    data: {
      title: 'Умолчания бренда',
      owner: brand.id,
      locale: 'ru',
      isActive: true,
      titleTemplate: '%s — Apex',
      defaultDescription: 'Брокер с 2011 года',
      allowIndexing: true,
      disallowPaths: [{ path: '/preview' }],
      organization: { name: 'Apex Broker', legalName: 'Apex Markets Ltd' },
    } as never,
  })

  const ru = await site('Слой В — ru', `routing-ru-${stamp}`, 'https://apex.ru', brand.id)
  /**
   * Немецкая витрина отвязывается от языков бренда: языковая версия на
   * отдельном сайте — это и есть случай, ради которого граф hreflang в ТЗ
   * назван графом «между сайтами».
   */
  const de = await site('Слой В — de', `routing-de-${stamp}`, 'https://apex.de', brand.id, {
    availableLocales: { mode: 'fork', items: [{ code: 'de' }] },
    defaultLocale: { mode: 'override', value: 'de' },
  })

  ruSiteId = ru.id

  await page({ title: 'Главная', path: '/', locale: 'ru', site: ru.id })
  await page({
    title: 'О компании',
    path: '/about',
    locale: 'ru',
    site: ru.id,
    translationKey: 'about',
  })

  const dePage = await page({
    title: 'Über uns',
    path: '/ueber-uns',
    locale: 'de',
    site: de.id,
    translationKey: 'about',
  })

  dePageId = dePage.id
})

describe('манифест собирается из живых данных', () => {
  it('релиз собирается, а страницы попадают в снапшот с умолчаниями бренда', async () => {
    const result = await buildRelease({ payload, siteId: ruSiteId })

    expect(result.status).toBe('ready')

    const about = result.snapshot.routing.pages.find((item) => item.path === '/about')

    expect(about).toMatchObject({
      title: 'О компании — Apex',
      description: 'Брокер с 2011 года',
      canonical: 'https://apex.ru/about',
    })
  })

  /** Реквизиты организации — только на главной, и только из профиля. */
  it('разметка организации стоит на главной', async () => {
    const result = await buildRelease({ payload, siteId: ruSiteId })
    const home = result.snapshot.routing.pages.find((item) => item.path === '/')

    expect(home?.jsonLd).toContainEqual(
      expect.objectContaining({ '@type': 'Organization', name: 'Apex Broker' }),
    )
  })

  /** «Между сайтами» из ТЗ: страница живёт на соседнем сайте того же бренда. */
  it('граф hreflang связывает страницы разных сайтов бренда', async () => {
    const result = await buildRelease({ payload, siteId: ruSiteId })
    const about = result.snapshot.routing.pages.find((item) => item.path === '/about')

    expect(about?.alternates).toContainEqual({
      locale: 'de',
      href: 'https://apex.de/ueber-uns',
    })
  })

  it('директивы robots приезжают из профиля', async () => {
    const result = await buildRelease({ payload, siteId: ruSiteId })

    expect(result.snapshot.routing.robots).toEqual({
      allowIndexing: true,
      disallow: ['/preview'],
    })
  })
})

describe('перенаправления', () => {
  /** ТЗ 2.3: «смена пути → автоматический 301 из истории путей». */
  it('переименование страницы само порождает 301', async () => {
    const moved = await page({
      title: 'Тарифы',
      path: '/tariffs',
      locale: 'ru',
      site: ruSiteId,
    })

    await payload.update({
      collection: 'pages',
      id: moved.id,
      overrideAccess: true,
      data: { path: '/pricing' } as never,
    })

    try {
      const result = await buildRelease({ payload, siteId: ruSiteId })

      expect(result.snapshot.routing.redirects).toContainEqual({
        from: '/tariffs',
        to: '/pricing',
        status: 301,
        locale: 'ru',
      })
    } finally {
      await payload.delete({ collection: 'pages', id: moved.id, overrideAccess: true })
    }
  })

  it('заведённое руками правило доезжает до снапшота', async () => {
    const rule = await payload.create({
      collection: 'redirects',
      overrideAccess: true,
      data: {
        from: '/old-offer',
        to: '/about',
        status: '301',
        site: ruSiteId,
        isActive: true,
        note: 'Акция закончилась',
      } as never,
    })

    try {
      const result = await buildRelease({ payload, siteId: ruSiteId })

      expect(result.snapshot.routing.redirects.map((item) => item.from)).toContain('/old-offer')
    } finally {
      await payload.delete({ collection: 'redirects', id: rule.id, overrideAccess: true })
    }
  })

  /** Браузер в цикле не открывает страницу вовсе. */
  it('цикл перенаправлений не даёт собрать релиз', async () => {
    const first = await payload.create({
      collection: 'redirects',
      overrideAccess: true,
      data: { from: '/a', to: '/b', status: '301', site: ruSiteId, isActive: true } as never,
    })

    const second = await payload.create({
      collection: 'redirects',
      overrideAccess: true,
      data: { from: '/b', to: '/a', status: '301', site: ruSiteId, isActive: true } as never,
    })

    try {
      const result = await buildRelease({ payload, siteId: ruSiteId })

      expect(result.status).toBe('failed')
      expect(result.report.blocking.some((finding) => finding.code === 'redirect-cycle')).toBe(true)
    } finally {
      await payload.delete({ collection: 'redirects', id: first.id, overrideAccess: true })
      await payload.delete({ collection: 'redirects', id: second.id, overrideAccess: true })
    }
  })
})

describe('расхождения слоя В блокируют сборку', () => {
  it('два перевода одного языка с одним ключом останавливают релиз', async () => {
    const duplicate = await page({
      title: 'О нас',
      path: '/about-us',
      locale: 'ru',
      site: ruSiteId,
      translationKey: 'about',
    })

    try {
      const result = await buildRelease({ payload, siteId: ruSiteId })

      expect(result.status).toBe('failed')
      expect(result.report.blocking.some((finding) => finding.code === 'hreflang-ambiguous')).toBe(
        true,
      )
    } finally {
      await payload.delete({ collection: 'pages', id: duplicate.id, overrideAccess: true })
    }
  })

  /** Соседний сайт без публичного адреса лишь укорачивает граф. */
  it('сайт без публичного адреса даёт предупреждение, но не отказ', async () => {
    const de = await payload.findByID({
      collection: 'pages',
      id: dePageId,
      overrideAccess: true,
      depth: 0,
    })

    const deSiteId = typeof de.site === 'object' ? (de.site as { id: unknown }).id : de.site

    await payload.update({
      collection: 'tenants',
      id: deSiteId as string | number,
      overrideAccess: true,
      data: { publicUrl: '' } as never,
    })

    try {
      const result = await buildRelease({ payload, siteId: ruSiteId })

      expect(result.status).toBe('ready')
      expect(
        result.report.warnings.some((finding) => finding.code === 'hreflang-no-public-url'),
      ).toBe(true)
    } finally {
      await payload.update({
        collection: 'tenants',
        id: deSiteId as string | number,
        overrideAccess: true,
        data: { publicUrl: 'https://apex.de' } as never,
      })
    }
  })
})
