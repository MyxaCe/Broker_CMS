import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { searchStream } from './search'

import type { Payload } from 'payload'

/**
 * Поиск на живой базе (ТЗ 1.2).
 *
 * Две вещи, которые невозможно проверить без настоящего Postgres:
 *
 *  · **разбор по языку** — русское «ставки» обязано находиться по запросу
 *    «ставка», а это делает словарь, а не наш код;
 *  · **невидимое не находится** — SQL находит запись по тексту, но правило
 *    доступа не даёт ей попасть в выдачу.
 */

let payload: Payload
let siteId: number | string

const stamp = Date.now()

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Поиск — бренд',
      slug: `search-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'ru' }, { code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'ru' },
    } as never,
    overrideAccess: true,
  })

  const site = await payload.create({
    collection: 'tenants',
    data: { name: 'Поиск', slug: `search-site-${stamp}`, kind: 'site', parent: brand.id } as never,
    overrideAccess: true,
  })

  siteId = site.id

  await payload.create({
    collection: 'articles',
    overrideAccess: true,
    data: {
      title: 'Центробанк повысил ставки',
      slug: `search-rates-${stamp}`,
      site: site.id,
      locale: 'ru',
      status: 'published',
      publishAt: '2026-07-01T00:00:00.000Z',
      excerpt: 'Решение по денежно-кредитной политике',
    } as never,
  })

  await payload.create({
    collection: 'articles',
    overrideAccess: true,
    data: {
      title: 'Нефтяные котировки снижаются',
      slug: `search-oil-${stamp}`,
      site: site.id,
      locale: 'ru',
      status: 'published',
      publishAt: '2026-07-02T00:00:00.000Z',
    } as never,
  })

  /** Черновик со словом из запроса: находиться не должен. */
  await payload.create({
    collection: 'articles',
    overrideAccess: true,
    data: {
      title: 'Черновик про ставку',
      slug: `search-draft-${stamp}`,
      site: site.id,
      locale: 'ru',
      status: 'draft',
      publishAt: '2026-07-01T00:00:00.000Z',
    } as never,
  })

  /** Снятый с публикации — тоже не должен. */
  await payload.create({
    collection: 'articles',
    overrideAccess: true,
    data: {
      title: 'Снятая новость про ставку',
      slug: `search-expired-${stamp}`,
      site: site.id,
      locale: 'ru',
      status: 'published',
      publishAt: '2026-07-01T00:00:00.000Z',
      unpublishAt: '2026-07-02T00:00:00.000Z',
    } as never,
  })

  /** Английский материал: не должен находиться в русском поиске. */
  await payload.create({
    collection: 'articles',
    overrideAccess: true,
    data: {
      title: 'Central bank raised rates',
      slug: `search-en-${stamp}`,
      site: site.id,
      locale: 'en',
      status: 'published',
      publishAt: '2026-07-01T00:00:00.000Z',
    } as never,
  })

  await payload.create({
    collection: 'videos',
    overrideAccess: true,
    data: {
      title: 'Разбор: ставка и рынок',
      slug: `search-video-${stamp}`,
      site: site.id,
      locale: 'ru',
      provider: 'youtube',
      externalId: 'abc123',
      status: 'published',
      publishAt: '2026-07-03T00:00:00.000Z',
    } as never,
  })
})

function slugs(result: Awaited<ReturnType<typeof searchStream>>): string[] {
  return result.hits.map((hit) => hit.item.slug)
}

describe('разбор по языку', () => {
  /**
   * Словоформа находится только правильным словарём: без него «ставка» и
   * «ставки» — разные слова.
   */
  it('русская словоформа находится по начальной форме', async () => {
    const result = await searchStream({ payload, siteId, locale: 'ru', query: 'ставка' })

    expect(slugs(result)).toContain(`search-rates-${stamp}`)
  })

  it('несовпадающее слово не находится', async () => {
    const result = await searchStream({ payload, siteId, locale: 'ru', query: 'криптовалюта' })

    expect(result.hits).toHaveLength(0)
  })

  /** Поиск идёт в пределах языка: смешивать выдачу разных языков нельзя. */
  it('материал на другом языке не находится', async () => {
    const result = await searchStream({ payload, siteId, locale: 'ru', query: 'ставка' })

    expect(slugs(result)).not.toContain(`search-en-${stamp}`)
  })

  it('английский поиск находит английский материал', async () => {
    const result = await searchStream({ payload, siteId, locale: 'en', query: 'rates' })

    expect(slugs(result)).toContain(`search-en-${stamp}`)
  })
})

describe('невидимое не находится', () => {
  /**
   * Главное свойство двухшаговой схемы: SQL находит запись по тексту, но
   * отдаёт её обычное чтение через правила доступа — и не отдаёт.
   */
  it('черновик со словом из запроса отсутствует в выдаче', async () => {
    const result = await searchStream({ payload, siteId, locale: 'ru', query: 'ставка' })

    expect(slugs(result)).not.toContain(`search-draft-${stamp}`)
  })

  it('снятый с публикации материал отсутствует', async () => {
    const result = await searchStream({ payload, siteId, locale: 'ru', query: 'ставка' })

    expect(slugs(result)).not.toContain(`search-expired-${stamp}`)
  })
})

describe('выдача', () => {
  it('видео находится наравне с материалами', async () => {
    const result = await searchStream({ payload, siteId, locale: 'ru', query: 'ставка' })

    expect(slugs(result)).toContain(`search-video-${stamp}`)
    expect(result.hits.some((hit) => hit.kind === 'video')).toBe(true)
    expect(result.hits.some((hit) => hit.kind === 'article')).toBe(true)
  })

  it('порядок — по убыванию релевантности', async () => {
    const result = await searchStream({ payload, siteId, locale: 'ru', query: 'ставка' })
    const ranks = result.hits.map((hit) => hit.rank)

    expect(ranks).toEqual([...ranks].sort((left, right) => right - left))
  })

  it('размер выдачи ограничивается', async () => {
    const result = await searchStream({ payload, siteId, locale: 'ru', query: 'ставка', limit: 1 })

    expect(result.hits).toHaveLength(1)
  })

  /**
   * `to_tsquery` бросил бы на такой строке и уронил ручку; `websearch_to_tsquery`
   * разбирает её как обычный текст.
   */
  it('запрос со скобками и кавычками не роняет поиск', async () => {
    const result = await searchStream({
      payload,
      siteId,
      locale: 'ru',
      query: 'ставка ((( "цб" -нефть',
    })

    expect(Array.isArray(result.hits)).toBe(true)
  })

  it('на здоровой фикстуре исключённых нет', async () => {
    const result = await searchStream({ payload, siteId, locale: 'ru', query: 'ставка' })

    expect(result.excluded).toEqual([])
  })
})

describe('индекс поддерживается при правке', () => {
  it('переименованный материал находится по новому заголовку', async () => {
    const created = await payload.create({
      collection: 'articles',
      overrideAccess: true,
      data: {
        title: 'Первоначальный заголовок',
        slug: `search-renamed-${stamp}`,
        site: siteId,
        locale: 'ru',
        status: 'published',
        publishAt: '2026-07-01T00:00:00.000Z',
      } as never,
    })

    await payload.update({
      collection: 'articles',
      id: created.id,
      overrideAccess: true,
      data: { title: 'Инфляция замедлилась' } as never,
    })

    const result = await searchStream({ payload, siteId, locale: 'ru', query: 'инфляция' })

    expect(slugs(result)).toContain(`search-renamed-${stamp}`)
  })
})
