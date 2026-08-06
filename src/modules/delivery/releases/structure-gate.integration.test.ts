import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildRelease } from './build'

import type { Payload } from 'payload'

/**
 * Структура сайта в релизе на живой базе (ТЗ 2.2).
 *
 * Проверяется то, что нельзя проверить на подменённых данных: что наследование
 * действительно читает записи предков, что ссылка меню на страницу разрешается
 * в путь **той же** записи, и что переиспользуемая секция раскрывается ровно
 * тем содержимым, которое лежит в базе.
 *
 * Тест живёт в модуле доставки, а не дизайна: сборка релиза принадлежит
 * доставке, и доменный модуль о ней не знает.
 */

let payload: Payload
let brandId: number | string
let siteId: number | string
let accountsPageId: number | string

const stamp = Date.now()

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: 'Структура — бренд',
      slug: `struct-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'en' },
    } as never,
  })

  brandId = brand.id

  /** Без полосы предупреждения релиз не соберётся по комплаенсу (ТЗ 2.4). */
  await payload.create({
    collection: 'global-areas',
    overrideAccess: true,
    data: {
      title: 'Предупреждение о риске',
      kind: 'risk-warning',
      owner: brand.id,
      locale: 'en',
      isActive: true,
      riskWarning: { text: 'CFD trading carries a high level of risk.', lossPercentage: 74 },
    } as never,
  })

  const site = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: 'Структура — сайт',
      slug: `struct-site-${stamp}`,
      kind: 'site',
      parent: brand.id,
    } as never,
  })

  siteId = site.id

  const accounts = await payload.create({
    collection: 'pages',
    overrideAccess: true,
    data: {
      title: 'Accounts',
      path: '/accounts',
      locale: 'en',
      site: site.id,
      status: 'published',
      blocks: [],
    } as never,
  })

  accountsPageId = accounts.id

  /** Черновик — чтобы проверить, что меню на него не ведёт. */
  const draft = await payload.create({
    collection: 'pages',
    overrideAccess: true,
    data: {
      title: 'Bonuses',
      path: '/bonuses',
      locale: 'en',
      site: site.id,
      status: 'draft',
      blocks: [],
    } as never,
  })

  /** Секция бренда: одна на все его сайты. */
  await payload.create({
    collection: 'sections',
    overrideAccess: true,
    data: {
      title: 'Доверие',
      key: 'trust',
      owner: brand.id,
      locale: 'en',
      isActive: true,
      blocks: [{ type: 'quote', props: { text: 'Regulated since 2011' } }],
    } as never,
  })

  /** Подвал бренда ссылается на секцию, а не копирует её. */
  await payload.create({
    collection: 'global-areas',
    overrideAccess: true,
    data: {
      title: 'Подвал',
      kind: 'footer',
      owner: brand.id,
      locale: 'en',
      isActive: true,
      blocks: [{ type: 'section-ref', props: { key: 'trust' } }],
    } as never,
  })

  await payload.create({
    collection: 'navigations',
    overrideAccess: true,
    data: {
      title: 'Главное меню',
      placement: 'primary',
      owner: brand.id,
      locale: 'en',
      isActive: true,
      items: [
        { label: 'Accounts', target: 'page', pageId: String(accounts.id) },
        { label: 'Bonuses', target: 'page', pageId: String(draft.id) },
        { label: 'Cabinet', target: 'external', href: 'https://my.example.com' },
      ],
    } as never,
  })
})

describe('структура доезжает до релиза', () => {
  it('релиз собирается, а меню бренда попадает в снапшот сайта', async () => {
    const result = await buildRelease({ payload, siteId })

    expect(result.status).toBe('ready')

    const menu = result.snapshot.structure.navigation.find(
      (item) => item.locale === 'en' && item.placement === 'primary',
    )

    expect(menu?.items.map((item) => item.label)).toEqual(['Accounts', 'Cabinet'])
  })

  /** Ссылка хранится на запись, а путь берётся из неё при сборке. */
  it('ссылка на страницу разрешается в её путь', async () => {
    const result = await buildRelease({ payload, siteId })
    const menu = result.snapshot.structure.navigation[0]

    expect(menu?.items[0]).toMatchObject({ label: 'Accounts', url: '/accounts' })
  })

  /**
   * Пункт, ведущий на черновик, исчезает из меню и остаётся предупреждением в
   * отчёте: снятие страницы с публикации не должно останавливать выкатку.
   */
  it('пункт на неопубликованную страницу исчезает и остаётся в отчёте', async () => {
    const result = await buildRelease({ payload, siteId })

    expect(result.snapshot.structure.navigation[0]?.items.map((item) => item.label)).not.toContain(
      'Bonuses',
    )
    expect(result.report.warnings.some((finding) => finding.code === 'nav-dangling-page')).toBe(
      true,
    )
    expect(result.status).toBe('ready')
  })

  it('секция бренда раскрывается в подвале сайта', async () => {
    const result = await buildRelease({ payload, siteId })
    const footer = result.snapshot.structure.globalAreas.find((area) => area.kind === 'footer')

    expect(footer?.blocks).toEqual([{ type: 'quote', props: { text: 'Regulated since 2011' } }])
  })

  it('полоса риск-предупреждения приезжает отдельным полем', async () => {
    const result = await buildRelease({ payload, siteId })
    const warning = result.snapshot.structure.globalAreas.find(
      (area) => area.kind === 'risk-warning',
    )

    expect(warning?.riskWarning).toEqual({
      text: 'CFD trading carries a high level of risk.',
      lossPercentage: 74,
    })
  })
})

describe('расхождения структуры блокируют сборку', () => {
  it('ссылка на отключённую секцию не даёт собрать релиз', async () => {
    const section = await payload.create({
      collection: 'sections',
      overrideAccess: true,
      data: {
        title: 'Временная',
        key: 'seasonal',
        owner: brandId,
        locale: 'en',
        isActive: false,
        blocks: [{ type: 'promo-banner' }],
      } as never,
    })

    const area = await payload.create({
      collection: 'global-areas',
      overrideAccess: true,
      data: {
        title: 'Полоса объявления',
        kind: 'announcement',
        owner: brandId,
        locale: 'en',
        isActive: true,
        blocks: [{ type: 'section-ref', props: { key: 'seasonal' } }],
      } as never,
    })

    try {
      const result = await buildRelease({ payload, siteId })

      expect(result.status).toBe('failed')
      expect(
        result.report.blocking.some((finding) => finding.code === 'section-unknown-section'),
      ).toBe(true)
    } finally {
      await payload.delete({ collection: 'global-areas', id: area.id, overrideAccess: true })
      await payload.delete({ collection: 'sections', id: section.id, overrideAccess: true })
    }
  })

  /**
   * Меню сайта перекрывает меню бренда целиком: частичное слияние двух деревьев
   * означало бы, что редактор не может убрать унаследованный пункт.
   */
  it('меню сайта перекрывает меню бренда', async () => {
    const own = await payload.create({
      collection: 'navigations',
      overrideAccess: true,
      data: {
        title: 'Своё меню',
        placement: 'primary',
        owner: siteId,
        locale: 'en',
        isActive: true,
        items: [{ label: 'Own', target: 'page', pageId: String(accountsPageId) }],
      } as never,
    })

    try {
      const result = await buildRelease({ payload, siteId })

      expect(result.snapshot.structure.navigation[0]?.items.map((item) => item.label)).toEqual([
        'Own',
      ])
    } finally {
      await payload.delete({ collection: 'navigations', id: own.id, overrideAccess: true })
    }
  })
})
