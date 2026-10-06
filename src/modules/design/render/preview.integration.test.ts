import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadPreview, PreviewError } from './load-preview'

import type { Payload } from 'payload'

/**
 * Выбор юрисдикции в предпросмотре (ТЗ 5.4, [[DEBT-011]], ADR-0034).
 *
 * Проверяется **связка**: ограничение, записанное в базе, доходит до того,
 * что видно в предпросмотре. Правило видимости проверено отдельно
 * (`visibility.test.ts`) и останется зелёным, даже если предпросмотр его не
 * позовёт, — ровно тот класс, который модульные тесты не ловят в принципе.
 *
 * Отдельно проверяется, что ограниченная **страница** не исчезает, а
 * объясняется: «не найдена» отправило бы редактора искать опечатку в пути.
 */

let payload: Payload
let siteSlug: string

const stamp = Date.now()

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: `Юрисдикции ${stamp}`,
      slug: `jur-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'en' },
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

  await payload.create({
    collection: 'design-roles',
    overrideAccess: true,
    data: {
      name: 'surface.base',
      group: 'surface',
      light: 'color.white',
      dark: 'color.ink',
      owner: brand.id,
    } as never,
  })

  siteSlug = `jur-site-${stamp}`

  const site = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: { name: siteSlug, slug: siteSlug, kind: 'site', parent: brand.id } as never,
  })

  /**
   * Область с блоком, ограниченным **другой** юрисдикцией, и блоком без
   * ограничений. Оба нужны: область, где ограничено всё, не отличила бы
   * «отфильтровали» от «область не приехала».
   */
  await payload.create({
    collection: 'global-areas',
    overrideAccess: true,
    data: {
      title: 'Шапка',
      kind: 'header',
      owner: site.id,
      locale: 'en',
      isActive: true,
      blocks: [
        { type: 'rich-text', props: { body: 'Везде' } },
        {
          type: 'rich-text',
          props: { body: 'Только для Британии' },
          visibility: { jurisdictions: ['uk-fca'] },
        },
      ],
    } as never,
  })

  await payload.create({
    collection: 'pages',
    overrideAccess: true,
    data: {
      title: 'Главная',
      path: '/',
      locale: 'en',
      site: site.id,
      status: 'published',
      blocks: [
        { type: 'hero', props: { title: 'Видно всем' } },
        {
          type: 'columns',
          variant: 'two',
          slots: {
            columns: [
              { type: 'quote', props: { text: 'В колонке видно' } },
              {
                type: 'quote',
                props: { text: 'В колонке только Британия' },
                visibility: { jurisdictions: ['uk-fca'] },
              },
            ],
          },
        },
        {
          type: 'rich-text',
          props: { body: 'Только Британия' },
          visibility: { jurisdictions: ['uk-fca'] },
        },
      ],
    } as never,
  })

  await payload.create({
    collection: 'pages',
    overrideAccess: true,
    data: {
      title: 'Британская',
      path: `/uk-${stamp}`,
      locale: 'en',
      site: site.id,
      status: 'published',
      jurisdictions: [{ code: 'uk-fca' }],
      blocks: [{ type: 'hero', props: { title: 'Только для Британии' } }],
    } as never,
  })
}, 180_000)

describe('предпросмотр показывает то, что увидит посетитель этой юрисдикции', () => {
  it('без выбора берётся юрисдикция сайта, а не «все»', async () => {
    const result = await loadPreview({ payload, siteSlug, path: '/', locale: null })

    expect(result.jurisdiction).toBe('eu-mifid')
    expect(result.availableJurisdictions[0]).toBe('eu-mifid')
  })

  it('ограниченный блок скрыт, и число скрытого названо', async () => {
    const result = await loadPreview({ payload, siteSlug, path: '/', locale: null })

    const types = (result.page?.blocks as { type: string }[]).map((node) => node.type)

    expect(types).toEqual(['hero', 'columns'])
    /** Блок страницы, блок в колонке и блок шапки — три штуки. */
    expect(result.hiddenByJurisdiction).toBe(3)
  })

  it('вложенный блок фильтруется тоже: перенос в колонку правило не обходит', async () => {
    const result = await loadPreview({ payload, siteSlug, path: '/', locale: null })
    const columns = (
      result.page?.blocks as { slots?: { columns: { props: { text: string } }[] } }[]
    )[1]

    expect(columns?.slots?.columns.map((node) => node.props.text)).toEqual(['В колонке видно'])
  })

  it('блок глобальной области фильтруется наравне с блоком страницы', async () => {
    const result = await loadPreview({ payload, siteSlug, path: '/', locale: null })
    const header = result.areas.find((area) => area.kind === 'header')

    expect(
      (header?.blocks as { props: { body: string } }[]).map((node) => node.props.body),
    ).toEqual(['Везде'])
  })

  it('в выбранной юрисдикции тот же блок показывается', async () => {
    const result = await loadPreview({
      payload,
      siteSlug,
      path: '/',
      locale: null,
      jurisdiction: 'uk-fca',
    })

    const types = (result.page?.blocks as { type: string }[]).map((node) => node.type)

    expect(types).toEqual(['hero', 'columns', 'rich-text'])
    expect(result.hiddenByJurisdiction).toBe(0)
  })
})

describe('страница, ограниченная юрисдикцией', () => {
  it('не исчезает, а объясняется', async () => {
    const result = await loadPreview({ payload, siteSlug, path: `/uk-${stamp}`, locale: null })

    expect(result.page).not.toBeNull()
    expect(result.pageHiddenReason).toContain('uk-fca')
  })

  it('в своей юрисдикции показывается без оговорок', async () => {
    const result = await loadPreview({
      payload,
      siteSlug,
      path: `/uk-${stamp}`,
      locale: null,
      jurisdiction: 'uk-fca',
    })

    expect(result.pageHiddenReason).toBeNull()
  })

  it('страница без ограничений оговорок не получает', async () => {
    const result = await loadPreview({ payload, siteSlug, path: '/', locale: null })

    expect(result.pageHiddenReason).toBeNull()
  })
})

describe('неизвестная юрисдикция', () => {
  it('отказ, а не молчаливый откат к своей', async () => {
    /**
     * То же правило, что для локали: подмена приводит к тому, что редактор
     * смотрит на страницу одной юрисдикции, считая её другой, и расхождение
     * обнаруживается на витрине.
     */
    await expect(
      loadPreview({ payload, siteSlug, path: '/', locale: null, jurisdiction: 'выдумка' }),
    ).rejects.toBeInstanceOf(PreviewError)
  })
})
