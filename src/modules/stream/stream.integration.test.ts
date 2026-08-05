import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Payload } from 'payload'

/**
 * Невидимость черновика на живой базе (ТЗ 1.3, ADR-0021).
 *
 * Проверяется не «фильтр отработал», а то, что черновика **не существует** для
 * запроса без учётной записи: ни в списке, ни по прямому идентификатору, ни
 * по точному совпадению машинного имени.
 *
 * Прямой доступ по идентификатору проверяется отдельно намеренно: именно так
 * выглядит попытка вытащить запись, о существовании которой узнали иначе.
 */

let payload: Payload
/** Числовой идентификатор: связи Payload проверяются по типу ключа коллекции. */
let siteId: number | string
let brandId: number | string
let editor: unknown

const stamp = Date.now()
const ids: Record<string, string> = {}

async function makeArticle(key: string, data: Record<string, unknown>): Promise<void> {
  const created = await payload.create({
    collection: 'articles',
    overrideAccess: true,
    data: {
      title: `Материал ${key}`,
      slug: `${key}-${stamp}`,
      site: siteId,
      status: 'published',
      publishAt: '2026-01-01T00:00:00.000Z',
      ...data,
    } as never,
  })

  ids[key] = String(created.id)
}

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Поток — бренд',
      slug: `stream-brand-${stamp}`,
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
      name: 'Поток — сайт',
      slug: `stream-site-${stamp}`,
      kind: 'site',
      parent: brand.id,
    } as never,
    overrideAccess: true,
  })

  siteId = site.id
  brandId = brand.id

  editor = await payload.create({
    collection: 'users',
    data: {
      email: `stream-editor-${stamp}@example.test`,
      password: 'stream-integration-password-32c!',
      fullName: 'Редактор потока',
      role: 'editor',
      tenants: [site.id],
      isActive: true,
    } as never,
    overrideAccess: true,
  })

  await makeArticle('visible', {})
  await makeArticle('draft', { status: 'draft' })
  await makeArticle('archived', { status: 'archived' })
  await makeArticle('scheduled', { publishAt: '2099-01-01T00:00:00.000Z' })
  await makeArticle('expired', { unpublishAt: '2026-01-02T00:00:00.000Z' })
  await makeArticle('no-publish-date', { publishAt: null })
})

/** Запрос доставки: без учётной записи и без обхода правил доступа. */
function asDelivery() {
  return payload.find({
    collection: 'articles',
    where: { site: { equals: siteId } },
    pagination: false,
    depth: 0,
    overrideAccess: false,
  })
}

describe('снаружи виден только опубликованный материал', () => {
  it('в списке ровно один материал из шести', async () => {
    const found = await asDelivery()

    expect(found.docs.map((doc) => String(doc.id))).toEqual([ids.visible])
  })

  it.each(['draft', 'archived', 'scheduled', 'expired', 'no-publish-date'])(
    'по прямому идентификатору недоступен: %s',
    async (key) => {
      const doc = await payload.findByID({
        collection: 'articles',
        id: ids[key]!,
        overrideAccess: false,
        disableErrors: true,
      })

      expect(doc).toBeNull()
    },
  )

  /**
   * Точное совпадение машинного имени — самый вероятный способ наткнуться на
   * черновик: адрес будущего материала часто известен заранее.
   */
  it('поиск по точному машинному имени черновика ничего не находит', async () => {
    const found = await payload.find({
      collection: 'articles',
      where: { slug: { equals: `draft-${stamp}` } },
      pagination: false,
      overrideAccess: false,
    })

    expect(found.docs).toHaveLength(0)
  })

  /** Эмбарго обязано соблюдаться до секунды, а не «примерно». */
  it('материал под эмбарго появляется ровно в свой срок, а не раньше', async () => {
    const embargoed = await payload.create({
      collection: 'articles',
      overrideAccess: true,
      data: {
        title: 'Под эмбарго',
        slug: `embargo-${stamp}`,
        site: siteId,
        status: 'published',
        publishAt: new Date(Date.now() + 60_000).toISOString(),
      } as never,
    })

    const before = await payload.findByID({
      collection: 'articles',
      id: embargoed.id,
      overrideAccess: false,
      disableErrors: true,
    })

    expect(before).toBeNull()

    await payload.update({
      collection: 'articles',
      id: embargoed.id,
      overrideAccess: true,
      data: { publishAt: new Date(Date.now() - 1_000).toISOString() } as never,
    })

    const after = await payload.findByID({
      collection: 'articles',
      id: embargoed.id,
      overrideAccess: false,
      disableErrors: true,
    })

    expect(after).not.toBeNull()
  })
})

describe('редактор видит свои черновики', () => {
  it('в списке все шесть материалов', async () => {
    const found = await payload.find({
      collection: 'articles',
      where: { site: { equals: siteId } },
      pagination: false,
      depth: 0,
      overrideAccess: false,
      user: editor as never,
    })

    expect(found.docs.length).toBeGreaterThanOrEqual(6)
  })

  it('черновик открывается по идентификатору', async () => {
    const doc = await payload.findByID({
      collection: 'articles',
      id: ids.draft!,
      overrideAccess: false,
      disableErrors: true,
      user: editor as never,
    })

    expect(doc).not.toBeNull()
  })
})

describe('изоляция тенантов действует и на потоке', () => {
  it('редактор чужого сайта не видит материалов', async () => {
    const otherSite = await payload.create({
      collection: 'tenants',
      data: {
        name: 'Поток — чужой сайт',
        slug: `stream-other-${stamp}`,
        kind: 'site',
        parent: brandId,
      } as never,
      overrideAccess: true,
    })

    const stranger = await payload.create({
      collection: 'users',
      data: {
        email: `stream-stranger-${stamp}@example.test`,
        password: 'stream-integration-password-32c!',
        fullName: 'Редактор чужого сайта',
        role: 'editor',
        tenants: [otherSite.id],
        isActive: true,
      } as never,
      overrideAccess: true,
    })

    const found = await payload.find({
      collection: 'articles',
      where: { site: { equals: siteId } },
      pagination: false,
      overrideAccess: false,
      user: stranger as never,
    })

    expect(found.docs).toHaveLength(0)
  })
})

describe('уникальность машинного имени', () => {
  /**
   * Проверка в приложении здесь бесполезна: между «посмотрели, что свободно» и
   * «записали» помещается второй редактор. Ограничение стоит в БД.
   */
  it('два материала с одним именем на одном сайте не создаются', async () => {
    await expect(
      payload.create({
        collection: 'articles',
        overrideAccess: true,
        data: {
          title: 'Двойник',
          slug: `visible-${stamp}`,
          site: siteId,
          status: 'draft',
        } as never,
      }),
    ).rejects.toThrow()
  })
})

describe('сайт с материалами не удаляется', () => {
  /**
   * Найдено отказом, а не придумано: удаление сайта с материалами падало
   * нарушением `NOT NULL` — Payload сначала обнуляет ссылки, а обязательную
   * связь обнулить нельзя. Гарантия была, внятности не было.
   */
  it('удаление отклоняется с объяснением причины', async () => {
    await expect(
      payload.delete({ collection: 'tenants', id: siteId, overrideAccess: true }),
    ).rejects.toThrow(/материалы/)
  })

  it('сайт без материалов удаляется', async () => {
    const empty = await payload.create({
      collection: 'tenants',
      data: {
        name: 'Поток — пустой сайт',
        slug: `stream-empty-${stamp}`,
        kind: 'site',
        parent: brandId,
      } as never,
      overrideAccess: true,
    })

    await expect(
      payload.delete({ collection: 'tenants', id: empty.id, overrideAccess: true }),
    ).resolves.toBeTruthy()
  })
})

describe('время чтения вычисляется при сохранении', () => {
  it('материал с текстом получает ненулевое время чтения', async () => {
    const created = await payload.create({
      collection: 'articles',
      overrideAccess: true,
      data: {
        title: 'С текстом',
        slug: `with-body-${stamp}`,
        site: siteId,
        status: 'draft',
        body: {
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [
                  {
                    type: 'text',
                    version: 1,
                    text: Array.from({ length: 400 }, () => 'слово').join(' '),
                  },
                ],
              },
            ],
            direction: null,
            format: '',
            indent: 0,
            version: 1,
          },
        },
      } as never,
    })

    expect(created.readingMinutes).toBeGreaterThan(0)
  })
})
