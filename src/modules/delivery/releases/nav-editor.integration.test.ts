import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  buildNavEditorTree,
  insertNavItem,
  moveNavItemTo,
  setNavField,
  siteIdsUnder,
  tenantRows,
} from '@/modules/design'

import { buildBootstrapResponse } from '../api/bootstrap'

import { buildRelease } from './build'

import type { EditorNavItem } from '@/modules/design'
import type { Payload } from 'payload'

/**
 * Редактор меню против движка (ТЗ 2.2, [[DEBT-011]], ADR-0034).
 *
 * Проверяется **связка**, и утверждение у неё одно: дерево, собранное
 * операциями редактора, сервер принимает, а сборка релиза доводит до ответа
 * `bootstrap` без потерь. Операции проверены в `nav-ops.test.ts` до
 * последнего сдвига индексов, разметка — в `NavTreeField.test.tsx`, но ни то
 * ни другое не заметит, если редактор начнёт производить дерево, которое не
 * сохраняется или не доезжает.
 *
 * Это ровно то, на чём обожглись в BUG-007: интерфейс оказался **строже**
 * движка, и расхождение нашлось случайно.
 */

let payload: Payload
let brandId: number | string
let siteId: number | string
let homeId: string
let forexId: string

const stamp = Date.now()

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: `Меню ${stamp}`,
      slug: `nav-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'en' },
    } as never,
  })

  brandId = brand.id

  await payload.create({
    collection: 'global-areas',
    overrideAccess: true,
    data: {
      title: 'Предупреждение о риске',
      kind: 'risk-warning',
      owner: brandId,
      locale: 'en',
      isActive: true,
      riskWarning: { text: 'Торговля CFD сопряжена с высоким риском.', lossPercentage: 74 },
    } as never,
  })

  const primitive = async (name: string, value: string) => {
    await payload.create({
      collection: 'design-primitives',
      overrideAccess: true,
      data: { name, category: 'color', value, owner: brandId } as never,
    })
  }

  const role = async (name: string, group: string, light: string, dark: string) => {
    await payload.create({
      collection: 'design-roles',
      overrideAccess: true,
      data: { name, group, light, dark, owner: brandId } as never,
    })
  }

  await primitive('color.white', '#FFFFFF')
  await primitive('color.ink', '#111111')
  await role('surface.base', 'surface', 'color.white', 'color.ink')
  await role('text.primary', 'text', 'color.ink', 'color.white')

  const site = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: `Сайт меню ${stamp}`,
      slug: `nav-site-${stamp}`,
      kind: 'site',
      parent: brandId,
    } as never,
  })

  siteId = site.id

  const page = async (path: string, title: string) => {
    const doc = await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: { title, path, locale: 'en', site: siteId, status: 'published' } as never,
    })

    return String(doc.id)
  }

  homeId = await page('/', 'Главная')
  forexId = await page(`/forex-${stamp}`, 'Форекс')
}, 180_000)

/**
 * Собирает дерево **операциями редактора**, а не руками.
 *
 * Разница принципиальная: руками собранное дерево проверяло бы движок, а не
 * редактор. Здесь каждое действие — то самое, которое выполняет человек:
 * добавить пункт, заполнить поля, добавить подпункт, перетащить.
 */
function treeFromEditorActions(): EditorNavItem[] {
  let tree = buildNavEditorTree(null)

  tree = insertNavItem(tree, [], 0, { label: '', target: 'page', pageId: null, children: [] })
  tree = setNavField(tree, [0], 'label', 'Главная')
  tree = setNavField(tree, [0], 'pageId', homeId)

  tree = insertNavItem(tree, [], 1, { label: '', target: 'none', children: [] })
  tree = setNavField(tree, [1], 'label', 'Рынки')
  tree = insertNavItem(tree, [1], 0, { label: '', target: 'page', pageId: null, children: [] })
  tree = setNavField(tree, [1, 0], 'label', 'Форекс')
  tree = setNavField(tree, [1, 0], 'pageId', forexId)
  tree = setNavField(tree, [1], 'layout', 'mega')

  /**
   * Перенос «Главной» в «Рынки» и обратно наверх.
   *
   * Оба переноса здесь не для красоты: первый сдвигает адрес назначения
   * (вынули первый — «Рынки» стали первыми), второй выносит пункт из
   * подраздела. Без них проверка «дерево доезжает» проверяла бы дерево,
   * собранное вставками, то есть самый простой случай.
   */
  tree = moveNavItemTo(tree, [0], [1], 0)
  tree = moveNavItemTo(tree, [0, 0], [], 0)

  return tree
}

describe('дерево из редактора доезжает до выдачи', () => {
  it('сервер принимает дерево, собранное операциями редактора', async () => {
    const created = await payload.create({
      collection: 'navigations',
      overrideAccess: true,
      data: {
        title: 'Главное меню',
        placement: 'primary',
        owner: siteId,
        locale: 'en',
        isActive: true,
        items: treeFromEditorActions(),
      } as never,
    })

    expect(created.id).toBeDefined()
  })

  it('ссылки разрешаются в адреса, а признак мега-меню переживает сборку', async () => {
    const built = await buildRelease({ payload, siteId })

    expect(built.report.blocking).toEqual([])
    expect(built.status).toBe('ready')

    const response = buildBootstrapResponse({
      snapshot: built.snapshot,
      release: { number: built.number, builtAt: new Date().toISOString() },
    })

    const items = response.navigation.primary ?? []

    expect(items.map((item) => item.label)).toEqual(['Главная', 'Рынки'])
    expect(items[0]?.url).toBe('/')
    /** Пункт без потомков — всегда `list`, каким бы ни было поле (ADR-0033). */
    expect(items[0]?.layout).toBe('list')

    expect(items[1]?.layout).toBe('mega')
    expect(items[1]?.children?.[0]?.url).toBe(`/forex-${stamp}`)
  })

  it('перенос в подраздел и обратно не теряет и не дублирует пункты', () => {
    const tree = treeFromEditorActions()

    expect(tree).toHaveLength(2)
    expect(tree[0]?.label).toBe('Главная')
    expect(tree[1]?.children).toHaveLength(1)
  })

  it('список страниц редактора — те же страницы, что видит сборка', async () => {
    /**
     * Проверка на расхождение источников. Редактор предлагает страницы
     * сайтов из поддерева владельца; сборка разрешает ссылки по страницам
     * сайта. Разошлись бы они молча: редактор предлагал бы страницу, которая
     * в меню не появится.
     */
    const tenants = await payload.find({
      collection: 'tenants',
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })

    const sites = siteIdsUnder(tenantRows({ docs: tenants.docs }), String(siteId))

    expect(sites).toEqual([String(siteId)])

    const pages = await payload.find({
      collection: 'pages',
      where: { site: { in: sites }, locale: { equals: 'en' } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })

    expect(pages.docs.map((doc) => String((doc as { id: unknown }).id)).sort()).toEqual(
      [homeId, forexId].sort(),
    )
  })
})
