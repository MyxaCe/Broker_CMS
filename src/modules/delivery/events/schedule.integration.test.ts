import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { runScheduleTick } from './schedule-worker'

import type { Payload } from 'payload'

/**
 * Планировщик переходов на живой базе (ТЗ 1.2, ADR-0021).
 *
 * Ключевое утверждение здесь не «планировщик работает», а **«планировщик не
 * нужен для корректности»**: материал гаснет сам, даже если планировщик ни
 * разу не запускался. Планировщик только объявляет это событием.
 */

let payload: Payload
let siteId: number | string
let siteSlug: string

const stamp = Date.now()

/**
 * Момент в прошлом, вокруг которого выстроена фикстура.
 *
 * Свой у каждого прогона, а не фиксированная дата: проход планировщика ищет
 * переходы **по всей базе**, поэтому фикстуры предыдущих прогонов попали бы в
 * то же окно и счёт объявленных переходов рос бы от запуска к запуску.
 * Вычтенные сутки гарантируют, что записи уже видны снаружи.
 */
const MOMENT = new Date(stamp - 86_400_000)

beforeAll(async () => {
  payload = await getPayload({ config })
  siteSlug = `sched-site-${stamp}`

  const brand = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Планировщик — бренд',
      slug: `sched-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'en' },
    } as never,
    overrideAccess: true,
  })

  const site = await payload.create({
    collection: 'tenants',
    data: { name: 'Планировщик', slug: siteSlug, kind: 'site', parent: brand.id } as never,
    overrideAccess: true,
  })

  siteId = site.id

  /** Опубликован внутри окна. */
  await payload.create({
    collection: 'articles',
    overrideAccess: true,
    data: {
      title: 'Вышел в окне',
      slug: `sched-published-${stamp}`,
      site: site.id,
      locale: 'en',
      status: 'published',
      publishAt: new Date(MOMENT.getTime() + 10_000).toISOString(),
    } as never,
  })

  /** Погас внутри окна. */
  await payload.create({
    collection: 'promos',
    overrideAccess: true,
    data: {
      title: 'Погасло в окне',
      slug: `sched-expired-${stamp}`,
      site: site.id,
      terms: 'Условия акции',
      priority: 0,
      locale: 'en',
      status: 'published',
      publishAt: '2026-01-01T00:00:00.000Z',
      unpublishAt: new Date(MOMENT.getTime() + 20_000).toISOString(),
    } as never,
  })

  /** Вне окна — не должен попасть. */
  await payload.create({
    collection: 'articles',
    overrideAccess: true,
    data: {
      title: 'Вышел позже',
      slug: `sched-later-${stamp}`,
      site: site.id,
      locale: 'en',
      status: 'published',
      publishAt: new Date(MOMENT.getTime() + 600_000).toISOString(),
    } as never,
  })

  /** Черновик с датой внутри окна — переход не наступает. */
  await payload.create({
    collection: 'articles',
    overrideAccess: true,
    data: {
      title: 'Черновик с датой',
      slug: `sched-draft-${stamp}`,
      site: site.id,
      locale: 'en',
      status: 'draft',
      publishAt: new Date(MOMENT.getTime() + 15_000).toISOString(),
    } as never,
  })
})

async function eventsForSite(): Promise<Record<string, unknown>[]> {
  const found = await payload.find({
    collection: 'outbox',
    where: { tenantId: { equals: String(siteId) } },
    pagination: false,
    overrideAccess: true,
  })

  return found.docs as unknown as Record<string, unknown>[]
}

describe('проход планировщика', () => {
  it('объявляет только переходы внутри окна', async () => {
    const result = await runScheduleTick({
      payload,
      since: MOMENT,
      until: new Date(MOMENT.getTime() + 30_000),
      log: { info: () => undefined, error: () => undefined },
    })

    expect(result.announced).toBe(2)
  })

  it('публикация и снятие — разные события', async () => {
    const events = await eventsForSite()
    const keys = events.map((event) => String(event.routingKey))

    expect(keys).toContain('cms.stream.published.v1')
    expect(keys).toContain('cms.stream.expired.v1')
  })

  it('в событии есть метки для сброса кеша', async () => {
    const events = await eventsForSite()
    const dump = JSON.stringify(events)

    expect(dump).toContain(`site:${siteSlug}`)
    expect(dump).toContain(`promos:sched-expired-${stamp}`)
  })

  /** Черновик не становится видимым сам по себе — значит и перехода у него нет. */
  it('черновик с датой внутри окна не объявляется', async () => {
    const dump = JSON.stringify(await eventsForSite())

    expect(dump).not.toContain(`sched-draft-${stamp}`)
  })

  /**
   * Соседние проходы не должны объявить один и тот же переход дважды: окно
   * полуоткрытое, и следующий проход начинается там, где кончился предыдущий.
   */
  it('повторный проход со сдвинутой границей не дублирует события', async () => {
    const before = (await eventsForSite()).length

    const result = await runScheduleTick({
      payload,
      since: new Date(MOMENT.getTime() + 30_000),
      until: new Date(MOMENT.getTime() + 60_000),
      log: { info: () => undefined, error: () => undefined },
    })

    expect(result.announced).toBe(0)
    expect((await eventsForSite()).length).toBe(before)
  })
})

describe('планировщик не нужен для корректности', () => {
  /**
   * Главное утверждение [[ADR-0021]]: видимость определяется временем и
   * правилом доступа. Планировщик влияет на скорость обновления витрины, а не
   * на то, что она показывает.
   */
  it('погасшее промо невидимо снаружи независимо от планировщика', async () => {
    const found = await payload.find({
      collection: 'promos',
      where: { slug: { equals: `sched-expired-${stamp}` } },
      pagination: false,
      overrideAccess: false,
    })

    expect(found.docs).toHaveLength(0)
  })

  it('материал, вышедший в прошлом, виден снаружи без единого прохода планировщика', async () => {
    const found = await payload.find({
      collection: 'articles',
      where: { slug: { equals: `sched-published-${stamp}` } },
      pagination: false,
      overrideAccess: false,
    })

    expect(found.docs).toHaveLength(1)
  })
})
