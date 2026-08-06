import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Payload } from 'payload'

/**
 * Страницы на живой базе (ТЗ 2.2, 2.3).
 *
 * Проверяется то, что нельзя увидеть на чистых функциях: уникальность пути в
 * пределах сайта и языка, автоматическая запись прежнего пути в историю и
 * запрет произвольной разметки для обычного редактора.
 */

let payload: Payload
let siteId: number | string
let otherSiteId: number | string
let editor: unknown
let developer: unknown

const stamp = Date.now()

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Страницы — бренд',
      slug: `pg-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }, { code: 'de' }] },
      defaultLocale: { mode: 'override', value: 'en' },
    } as never,
    overrideAccess: true,
  })

  const site = await payload.create({
    collection: 'tenants',
    data: { name: 'Страницы', slug: `pg-site-${stamp}`, kind: 'site', parent: brand.id } as never,
    overrideAccess: true,
  })

  const other = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Страницы — чужой',
      slug: `pg-other-${stamp}`,
      kind: 'site',
      parent: brand.id,
    } as never,
    overrideAccess: true,
  })

  siteId = site.id
  otherSiteId = other.id

  editor = await payload.create({
    collection: 'users',
    data: {
      email: `pg-editor-${stamp}@example.test`,
      password: 'pages-integration-password-32c!',
      fullName: 'Редактор страниц',
      role: 'editor',
      tenants: [site.id],
      isActive: true,
    } as never,
    overrideAccess: true,
  })

  developer = await payload.create({
    collection: 'users',
    data: {
      email: `pg-dev-${stamp}@example.test`,
      password: 'pages-integration-password-32c!',
      fullName: 'Разработчик',
      role: 'developer',
      tenants: [],
      isActive: true,
    } as never,
    overrideAccess: true,
  })
})

async function createPage(data: Record<string, unknown>) {
  return payload.create({
    collection: 'pages',
    overrideAccess: true,
    data: {
      title: 'Страница',
      locale: 'en',
      site: siteId,
      status: 'draft',
      ...data,
    } as never,
  })
}

describe('уникальность пути', () => {
  it('две страницы с одним путём на одном сайте и языке не создаются', async () => {
    await createPage({ path: `/unique-${stamp}` })

    await expect(createPage({ path: `/unique-${stamp}` })).rejects.toThrow()
  })

  /** Путь уникален в пределах пары «сайт + локаль», а не глобально. */
  it('тот же путь на другом языке допустим', async () => {
    await createPage({ path: `/by-locale-${stamp}`, locale: 'en' })

    await expect(createPage({ path: `/by-locale-${stamp}`, locale: 'de' })).resolves.toBeTruthy()
  })

  it('тот же путь на другом сайте допустим', async () => {
    await createPage({ path: `/by-site-${stamp}` })

    await expect(createPage({ path: `/by-site-${stamp}`, site: otherSiteId })).resolves.toBeTruthy()
  })

  /**
   * `/about` и `/about/` — один адрес для человека. Без приведения к одному
   * виду уникальность не сработала бы.
   */
  it('различие только в завершающей черте не создаёт второй страницы', async () => {
    await createPage({ path: `/normalized-${stamp}` })

    await expect(createPage({ path: `/normalized-${stamp}/` })).rejects.toThrow()
  })
})

describe('история путей', () => {
  /**
   * Старый адрес уже в поисковой выдаче и в чужих ссылках. Без записи в
   * историю он перестал бы работать молча.
   */
  it('прежний путь попадает в историю при смене', async () => {
    const page = await createPage({ path: `/old-${stamp}` })

    const updated = await payload.update({
      collection: 'pages',
      id: page.id,
      overrideAccess: true,
      data: { path: `/new-${stamp}` } as never,
    })

    const history = (updated.pathHistory ?? []) as { path: string }[]

    expect(history.map((entry) => entry.path)).toContain(`/old-${stamp}`)
  })

  it('повторная смена дописывает, а не затирает', async () => {
    const page = await createPage({ path: `/first-${stamp}` })

    await payload.update({
      collection: 'pages',
      id: page.id,
      overrideAccess: true,
      data: { path: `/second-${stamp}` } as never,
    })

    const updated = await payload.update({
      collection: 'pages',
      id: page.id,
      overrideAccess: true,
      data: { path: `/third-${stamp}` } as never,
    })

    const history = (updated.pathHistory ?? []) as { path: string }[]

    expect(history.map((entry) => entry.path).sort()).toEqual(
      [`/first-${stamp}`, `/second-${stamp}`].sort(),
    )
  })

  it('сохранение без смены пути историю не трогает', async () => {
    const page = await createPage({ path: `/stable-${stamp}` })

    const updated = await payload.update({
      collection: 'pages',
      id: page.id,
      overrideAccess: true,
      data: { title: 'Переименована' } as never,
    })

    expect(updated.pathHistory ?? []).toHaveLength(0)
  })
})

describe('нормализация при сохранении', () => {
  it('путь приводится к одному виду', async () => {
    const page = await createPage({ path: `/Mixed-Case-${stamp}/` })

    expect(page.path).toBe(`/mixed-case-${stamp}`)
  })
})

describe('произвольная разметка', () => {
  const rawBlock = [{ type: 'raw-embed', props: { html: '<script>alert(1)</script>' } }]

  /** Один вставленный скрипт превращает страницу брокера в чужую. */
  it('редактор не может сохранить блок произвольного кода', async () => {
    await expect(
      payload.create({
        collection: 'pages',
        overrideAccess: false,
        user: editor as never,
        data: {
          title: 'С произвольным кодом',
          path: `/raw-${stamp}`,
          locale: 'en',
          site: siteId,
          status: 'draft',
          blocks: rawBlock,
        } as never,
      }),
    ).rejects.toThrow(/разработчику/)
  })

  /** Спрятать блок в колонке было бы простейшим обходом правила. */
  it('вложенный блок произвольного кода тоже отклоняется', async () => {
    await expect(
      payload.create({
        collection: 'pages',
        overrideAccess: false,
        user: editor as never,
        data: {
          title: 'С вложенным кодом',
          path: `/raw-nested-${stamp}`,
          locale: 'en',
          site: siteId,
          status: 'draft',
          blocks: [{ type: 'columns', slots: { columns: rawBlock } }],
        } as never,
      }),
    ).rejects.toThrow(/разработчику/)
  })

  it('разработчик может', async () => {
    await expect(
      payload.create({
        collection: 'pages',
        overrideAccess: false,
        user: developer as never,
        data: {
          title: 'Разработчик',
          path: `/raw-dev-${stamp}`,
          locale: 'en',
          site: siteId,
          status: 'draft',
          blocks: rawBlock,
        } as never,
      }),
    ).resolves.toBeTruthy()
  })
})

describe('изоляция тенантов действует и на страницах', () => {
  it('редактор чужого сайта не видит страниц', async () => {
    await createPage({ path: `/isolated-${stamp}` })

    const stranger = await payload.create({
      collection: 'users',
      data: {
        email: `pg-stranger-${stamp}@example.test`,
        password: 'pages-integration-password-32c!',
        fullName: 'Чужой редактор',
        role: 'editor',
        tenants: [otherSiteId],
        isActive: true,
      } as never,
      overrideAccess: true,
    })

    const found = await payload.find({
      collection: 'pages',
      where: { site: { equals: siteId } },
      pagination: false,
      overrideAccess: false,
      user: stranger as never,
    })

    expect(found.docs).toHaveLength(0)
  })
})
