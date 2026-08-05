import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadArticleFeed } from './load'

import type { Payload } from 'payload'

/**
 * Лента на живой базе (ТЗ 1.2, ADR-0021).
 *
 * Главное, что здесь проверяется, — **устойчивость курсорной пагинации**:
 * обход всей ленты по страницам не должен ни повторить запись, ни потерять её,
 * в том числе когда у половины записей одинаковая отметка времени. Именно на
 * этом ломается пагинация по смещению, и именно это невозможно увидеть на
 * фикстуре из трёх записей с разными датами.
 */

let payload: Payload
let siteId: number | string

const stamp = Date.now()
const TOTAL = 25

/** Половина записей выпущена «одним нажатием» — с общей отметкой времени. */
const SHARED_MOMENT = '2026-07-01T12:00:00.000Z'

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Лента — бренд',
      slug: `feed-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'en' },
    } as never,
    overrideAccess: true,
  })

  const site = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Лента — сайт',
      slug: `feed-site-${stamp}`,
      kind: 'site',
      parent: brand.id,
    } as never,
    overrideAccess: true,
  })

  siteId = site.id

  const category = await payload.create({
    collection: 'categories',
    data: {
      title: 'Аналитика',
      slug: `analytics-${stamp}`,
      owner: brand.id,
    } as never,
    overrideAccess: true,
  })

  for (let index = 0; index < TOTAL; index += 1) {
    await payload.create({
      collection: 'articles',
      overrideAccess: true,
      data: {
        title: `Материал ${index}`,
        slug: `feed-${index}-${stamp}`,
        site: site.id,
        locale: 'en',
        status: 'published',
        publishAt:
          index % 2 === 0
            ? SHARED_MOMENT
            : new Date(Date.parse('2026-06-01T00:00:00.000Z') + index * 3_600_000).toISOString(),
        category: index < 5 ? category.id : null,
        excerpt: `Анонс ${index}`,
      } as never,
    })
  }

  /** Записи, которых в ленте быть не должно. */
  await payload.create({
    collection: 'articles',
    overrideAccess: true,
    data: {
      title: 'Черновик',
      slug: `feed-draft-${stamp}`,
      site: site.id,
      locale: 'en',
      status: 'draft',
      publishAt: SHARED_MOMENT,
    } as never,
  })

  await payload.create({
    collection: 'articles',
    overrideAccess: true,
    data: {
      title: 'Истёкший',
      slug: `feed-expired-${stamp}`,
      site: site.id,
      locale: 'en',
      status: 'published',
      publishAt: '2026-06-01T00:00:00.000Z',
      unpublishAt: '2026-06-02T00:00:00.000Z',
    } as never,
  })
})

async function walkAll(pageSize: number): Promise<string[]> {
  const seen: string[] = []
  let cursor: string | null = null
  let guard = 0

  for (;;) {
    const page: Awaited<ReturnType<typeof loadArticleFeed>> = await loadArticleFeed({
      payload,
      request: { siteId, limit: pageSize, cursor },
    })

    seen.push(...page.items.map((item) => item.slug))

    if (page.nextCursor === null) {
      break
    }

    cursor = page.nextCursor
    guard += 1

    /** Защита от бесконечного цикла: пагинация, не двигающаяся вперёд, — это дефект. */
    expect(guard, 'обход ленты не сходится').toBeLessThan(50)
  }

  return seen
}

describe('обход ленты по страницам', () => {
  it('не повторяет и не теряет записи при половине одинаковых дат', async () => {
    const seen = await walkAll(4)

    expect(seen).toHaveLength(TOTAL)
    expect(new Set(seen).size).toBe(TOTAL)
  })

  it('результат не зависит от размера страницы', async () => {
    const byFour = await walkAll(4)
    const bySeven = await walkAll(7)

    expect(bySeven).toEqual(byFour)
  })

  it('на последней странице курсора нет', async () => {
    const page = await loadArticleFeed({ payload, request: { siteId, limit: 100 } })

    expect(page.nextCursor).toBeNull()
    expect(page.items).toHaveLength(TOTAL)
  })

  it('порядок — от новых к старым', async () => {
    const page = await loadArticleFeed({ payload, request: { siteId, limit: 100 } })
    const dates = page.items.map((item) => Date.parse(item.publishedAt))

    expect(dates).toEqual([...dates].sort((left, right) => right - left))
  })
})

describe('в ленту попадает только видимое', () => {
  it('черновик и истёкший материал отсутствуют', async () => {
    const seen = await walkAll(10)

    expect(seen).not.toContain(`feed-draft-${stamp}`)
    expect(seen).not.toContain(`feed-expired-${stamp}`)
  })

  /**
   * Именно этот тест поймал [[BUG-005]]: в локальном API Payload
   * `overrideAccess` по умолчанию **истина**, поэтому «не выставлять» означало
   * обойти все правила доступа, и черновик попадал в ленту. Теперь значение
   * задаётся явно, а тест сторожит, чтобы его не убрали.
   */
  it('запрос ленты не обходит правила доступа', async () => {
    const page = await loadArticleFeed({ payload, request: { siteId, limit: 100 } })

    expect(page.items.every((item) => !item.slug.includes('draft'))).toBe(true)
  })
})

describe('лента одноязычна', () => {
  /**
   * Материалы на разных языках — самостоятельные записи (решение заказчика от
   * 2026-08-05). Смешать их в одном списке значит показать читателю половину
   * ленты на чужом языке.
   */
  it('запрошенный язык отсекает записи на другом', async () => {
    await payload.create({
      collection: 'tenants',
      data: {
        name: 'Лента — двуязычный бренд',
        slug: `feed-bi-brand-${stamp}`,
        kind: 'brand',
        jurisdiction: { mode: 'override', value: 'eu-mifid' },
        availableLocales: { mode: 'extend', items: [{ code: 'en' }, { code: 'de' }] },
        defaultLocale: { mode: 'override', value: 'en' },
      } as never,
      overrideAccess: true,
    })

    const bilingual = await payload.create({
      collection: 'tenants',
      data: {
        name: 'Лента — двуязычный сайт',
        slug: `feed-bi-site-${stamp}`,
        kind: 'site',
        parent: (
          await payload.find({
            collection: 'tenants',
            where: { slug: { equals: `feed-bi-brand-${stamp}` } },
            pagination: false,
            overrideAccess: true,
          })
        ).docs[0]!.id,
      } as never,
      overrideAccess: true,
    })

    for (const locale of ['en', 'en', 'de']) {
      await payload.create({
        collection: 'articles',
        overrideAccess: true,
        data: {
          title: `Материал ${locale}`,
          slug: `feed-bi-${locale}-${Math.random().toString(36).slice(2, 8)}-${stamp}`,
          site: bilingual.id,
          locale,
          status: 'published',
          publishAt: '2026-07-01T00:00:00.000Z',
        } as never,
      })
    }

    const english = await loadArticleFeed({
      payload,
      request: { siteId: bilingual.id, locale: 'en', limit: 100 },
    })
    const german = await loadArticleFeed({
      payload,
      request: { siteId: bilingual.id, locale: 'de', limit: 100 },
    })

    expect(english.items).toHaveLength(2)
    expect(german.items).toHaveLength(1)
  })

  /**
   * Материал на языке, не объявленном у сайта, существовал бы в админке и
   * никогда не попадал в выдачу: лента спрашивает язык из разрешения сайта.
   * Редактор видел бы свою работу и не понимал, почему её нет на витрине.
   */
  it('материал на необъявленном языке не создаётся', async () => {
    await expect(
      payload.create({
        collection: 'articles',
        overrideAccess: true,
        data: {
          title: 'На французском',
          slug: `feed-fr-${stamp}`,
          site: siteId,
          locale: 'fr',
          status: 'draft',
        } as never,
      }),
    ).rejects.toThrow(/fr/)
  })
})

describe('фильтры', () => {
  it('по категории отдаётся только её материалы', async () => {
    const page = await loadArticleFeed({
      payload,
      request: { siteId, category: `analytics-${stamp}`, limit: 100 },
    })

    expect(page.items).toHaveLength(5)
    expect(page.items.every((item) => item.category?.slug === `analytics-${stamp}`)).toBe(true)
  })

  it('несуществующая категория даёт пустую ленту, а не ошибку', async () => {
    const page = await loadArticleFeed({
      payload,
      request: { siteId, category: 'нет-такой', limit: 100 },
    })

    expect(page.items).toHaveLength(0)
    expect(page.nextCursor).toBeNull()
  })

  it('диапазон дат сужает выборку', async () => {
    const page = await loadArticleFeed({
      payload,
      request: { siteId, since: '2026-07-01T00:00:00.000Z', limit: 100 },
    })

    expect(page.items.length).toBeLessThan(TOTAL)
    expect(page.items.every((item) => item.publishedAt >= '2026-07-01T00:00:00.000Z')).toBe(true)
  })
})

describe('ближайший переход ограничивает срок жизни кеша', () => {
  /**
   * Ответ ленты меняется без единой записи в базу. Кеш, переживший этот
   * момент, показывает погасший материал — требование «промо гаснет само»
   * перестаёт выполняться (ADR-0021).
   */
  it('материал с будущей датой снятия задаёт момент перехода', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString()

    await payload.create({
      collection: 'articles',
      overrideAccess: true,
      data: {
        title: 'Гаснет через час',
        slug: `feed-fading-${stamp}`,
        site: siteId,
        locale: 'en',
        status: 'published',
        publishAt: '2026-08-01T00:00:00.000Z',
        unpublishAt: expiresAt,
      } as never,
    })

    const page = await loadArticleFeed({ payload, request: { siteId, limit: 100 } })

    expect(page.nextTransitionAt).toBe(expiresAt)
  })

  it('без будущих переходов момент не задаётся', async () => {
    const page = await loadArticleFeed({
      payload,
      request: { siteId, until: '2026-07-02T00:00:00.000Z', limit: 5 },
    })

    expect(page.nextTransitionAt).toBeNull()
  })
})

describe('закреплённое', () => {
  it('отдаётся отдельно и только на первой странице', async () => {
    await payload.create({
      collection: 'articles',
      overrideAccess: true,
      data: {
        title: 'Закреплённый',
        slug: `feed-pinned-${stamp}`,
        site: siteId,
        locale: 'en',
        status: 'published',
        publishAt: '2026-01-01T00:00:00.000Z',
        pinned: true,
      } as never,
    })

    const first = await loadArticleFeed({ payload, request: { siteId, limit: 5 } })

    expect(first.pinned.map((item) => item.slug)).toContain(`feed-pinned-${stamp}`)

    const second = await loadArticleFeed({
      payload,
      request: { siteId, limit: 5, cursor: first.nextCursor },
    })

    expect(second.pinned).toHaveLength(0)
  })
})

describe('тотальность маппера', () => {
  /**
   * Через API испорченную видимую запись создать нельзя: обязательные поля
   * закрыты и схемой, и ограничениями БД. Это хороший признак, а не пробел —
   * поэтому исключение битой записи проверяется модульно, а здесь фиксируется
   * то, что реально наблюдаемо: лента собирается без исключённых.
   */
  it('на здоровой фикстуре исключённых нет', async () => {
    const page = await loadArticleFeed({ payload, request: { siteId, limit: 100 } })

    expect(page.excluded).toEqual([])
  })
})
