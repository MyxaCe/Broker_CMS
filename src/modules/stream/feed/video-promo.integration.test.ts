import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadPromoBoard } from './promo-board'
import { loadVideoFeed } from './load'

import type { Payload } from 'payload'

/**
 * Видео и промо на живой базе (ТЗ 1.1, 1.2).
 *
 * Проверяется то, что нельзя увидеть на подменённых данных: порядок промо по
 * приоритету, вычисление состояния эфира из полей записи и то, что погасшее и
 * черновое не доезжают до выдачи.
 */

let payload: Payload
let siteId: number | string

const stamp = Date.now()

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Видео — бренд',
      slug: `vp-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'en' },
    } as never,
    overrideAccess: true,
  })

  const site = await payload.create({
    collection: 'tenants',
    data: { name: 'Видео', slug: `vp-site-${stamp}`, kind: 'site', parent: brand.id } as never,
    overrideAccess: true,
  })

  siteId = site.id

  /** Идущая трансляция: началась час назад, закончится через час. */
  await payload.create({
    collection: 'videos',
    overrideAccess: true,
    data: {
      title: 'Прямой эфир',
      slug: `vp-live-${stamp}`,
      site: site.id,
      provider: 'youtube',
      externalId: 'live-1',
      startsAt: new Date(Date.now() - 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      locale: 'en',
      status: 'published',
      publishAt: '2026-01-01T00:00:00.000Z',
    } as never,
  })

  /** Обычный ролик: времени эфира нет. */
  await payload.create({
    collection: 'videos',
    overrideAccess: true,
    data: {
      title: 'Ролик',
      slug: `vp-clip-${stamp}`,
      site: site.id,
      provider: 'vimeo',
      externalId: 'clip-1',
      locale: 'en',
      status: 'published',
      publishAt: '2026-01-02T00:00:00.000Z',
    } as never,
  })

  /** Черновик — в выдачу попасть не должен. */
  await payload.create({
    collection: 'videos',
    overrideAccess: true,
    data: {
      title: 'Черновик ролика',
      slug: `vp-draft-${stamp}`,
      site: site.id,
      provider: 'youtube',
      externalId: 'draft-1',
      locale: 'en',
      status: 'draft',
      publishAt: '2026-01-03T00:00:00.000Z',
    } as never,
  })

  for (const [index, priority] of [5, 20, 1].entries()) {
    await payload.create({
      collection: 'promos',
      overrideAccess: true,
      data: {
        title: `Промо ${priority}`,
        slug: `vp-promo-${index}-${stamp}`,
        site: site.id,
        terms: 'Условия акции',
        priority,
        locale: 'en',
        status: 'published',
        publishAt: '2026-01-01T00:00:00.000Z',
      } as never,
    })
  }

  /** Погасшее промо. */
  await payload.create({
    collection: 'promos',
    overrideAccess: true,
    data: {
      title: 'Погасшее',
      slug: `vp-promo-dead-${stamp}`,
      site: site.id,
      terms: 'Условия акции',
      priority: 99,
      locale: 'en',
      status: 'published',
      publishAt: '2026-01-01T00:00:00.000Z',
      unpublishAt: '2026-01-02T00:00:00.000Z',
    } as never,
  })
})

describe('лента видео', () => {
  it('черновик в выдачу не попадает', async () => {
    const page = await loadVideoFeed({ payload, request: { siteId, limit: 50 } })

    expect(page.items.map((item) => item.slug)).not.toContain(`vp-draft-${stamp}`)
    expect(page.items).toHaveLength(2)
  })

  /** Состояние вычисляется из полей записи, а не читается из неё. */
  it('идущая трансляция помечена как эфир, ролик — как запись', async () => {
    const page = await loadVideoFeed({ payload, request: { siteId, limit: 50 } })

    const live = page.items.find((item) => item.slug === `vp-live-${stamp}`)
    const clip = page.items.find((item) => item.slug === `vp-clip-${stamp}`)

    expect(live?.broadcast.state).toBe('live')
    expect(clip?.broadcast.state).toBe('past')
  })

  /**
   * У видео два источника самопроизвольных изменений: видимость и эфир.
   * Ответ с идущей трансляцией обязан истечь не позже её окончания.
   */
  it('окончание эфира ограничивает момент ближайшего перехода', async () => {
    const page = await loadVideoFeed({ payload, request: { siteId, limit: 50 } })

    expect(page.nextTransitionAt).not.toBeNull()
    expect(Date.parse(page.nextTransitionAt!)).toBeLessThanOrEqual(Date.now() + 3_600_001)
  })
})

describe('промо-доска', () => {
  it('упорядочена по приоритету, а не по времени', async () => {
    const board = await loadPromoBoard({ payload, siteId })

    expect(board.items.map((item) => item.priority)).toEqual([20, 5, 1])
  })

  it('погасшее промо в доске отсутствует', async () => {
    const board = await loadPromoBoard({ payload, siteId })

    expect(board.items.map((item) => item.slug)).not.toContain(`vp-promo-dead-${stamp}`)
  })

  it('исключённых на здоровой фикстуре нет', async () => {
    const board = await loadPromoBoard({ payload, siteId })

    expect(board.excluded).toEqual([])
  })

  /** Пустой список юрисдикций означает «во всех» — фильтр не должен их прятать. */
  it('фильтр по юрисдикции не прячет промо без указанной юрисдикции', async () => {
    const board = await loadPromoBoard({ payload, siteId, jurisdiction: 'eu-mifid' })

    expect(board.items).toHaveLength(3)
  })
})
