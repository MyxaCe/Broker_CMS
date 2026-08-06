import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadTokenSet } from './load'

import type { Payload } from 'payload'

/**
 * Токены на живой базе (ТЗ 2.1).
 *
 * Проверяется наследование: сайт получает палитру бренда и переопределяет
 * часть её, не переобъявляя целиком.
 *
 * Блокировка сборки релиза проверяется в модуле доставки: сборка живёт там, и
 * тянуть её сюда запрещено правилом границ — доменный модуль не знает о том,
 * что его данные кто-то отдаёт наружу.
 */

let payload: Payload
let brandId: number | string
let goodSiteId: number | string
let badSiteId: number | string

const stamp = Date.now()

async function primitive(owner: number | string, name: string, value: string) {
  await payload.create({
    collection: 'design-primitives',
    overrideAccess: true,
    data: { name, category: 'color', value, owner } as never,
  })
}

async function role(owner: number | string, name: string, light: string, dark: string) {
  await payload.create({
    collection: 'design-roles',
    overrideAccess: true,
    data: { name, group: name.split('.')[0], light, dark, owner } as never,
  })
}

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Токены — бренд',
      slug: `tok-brand-${stamp}`,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'en' },
    } as never,
    overrideAccess: true,
  })

  brandId = brand.id

  const good = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Токены — сайт',
      slug: `tok-good-${stamp}`,
      kind: 'site',
      parent: brand.id,
    } as never,
    overrideAccess: true,
  })

  const bad = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Токены — плохой контраст',
      slug: `tok-bad-${stamp}`,
      kind: 'site',
      parent: brand.id,
    } as never,
    overrideAccess: true,
  })

  goodSiteId = good.id
  badSiteId = bad.id

  /** Палитра бренда: проходит AA в обеих темах. */
  await primitive(brand.id, 'color.white', '#FFFFFF')
  await primitive(brand.id, 'color.ink', '#111111')
  await primitive(brand.id, 'color.gray.600', '#595959')

  await role(brand.id, 'surface.base', 'color.white', 'color.ink')
  await role(brand.id, 'surface.raised', 'color.white', 'color.ink')
  await role(brand.id, 'text.primary', 'color.ink', 'color.white')
  await role(brand.id, 'text.secondary', 'color.gray.600', 'color.white')
  await role(brand.id, 'text.muted', 'color.gray.600', 'color.white')

  await payload.create({
    collection: 'design-component-tokens',
    overrideAccess: true,
    data: {
      name: 'button.primary.bg',
      source: 'role',
      reference: 'surface.base',
      owner: brand.id,
    } as never,
  })

  /**
   * Плохой сайт переопределяет **только** приглушённый текст — и делает его
   * нечитаемым. Ровно так это и происходит в жизни: «чуть светлее» на глаз.
   */
  await primitive(bad.id, 'color.gray.300', '#BFBFBF')
  await role(bad.id, 'text.muted', 'color.gray.300', 'color.gray.300')
})

describe('наследование палитры', () => {
  it('сайт получает токены бренда, ничего не объявляя', async () => {
    const { resolved } = await loadTokenSet({ payload, siteId: goodSiteId })

    expect(resolved.byTheme.light['surface.base']).toBe('#FFFFFF')
    expect(resolved.byTheme.dark['surface.base']).toBe('#111111')
    expect(resolved.byTheme.light['button.primary.bg']).toBe('#FFFFFF')
  })

  /** Сайт, меняющий один цвет, не обязан переобъявлять всю палитру. */
  it('переопределение сайта перекрывает бренд по одному имени', async () => {
    const { resolved } = await loadTokenSet({ payload, siteId: badSiteId })

    expect(resolved.byTheme.light['text.muted']).toBe('#BFBFBF')
    expect(resolved.byTheme.light['text.primary']).toBe('#111111')
  })

  it('у бренда своя цепочка без сайтов-потомков', async () => {
    const { chain } = await loadTokenSet({ payload, siteId: brandId })

    expect(chain).toEqual([String(brandId)])
  })

  it('здоровый набор не даёт расхождений', async () => {
    const { resolved } = await loadTokenSet({ payload, siteId: goodSiteId })

    expect(resolved.issues).toEqual([])
  })
})
