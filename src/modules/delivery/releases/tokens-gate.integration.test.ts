import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildRelease } from './build'

import type { Payload } from 'payload'

/**
 * Дизайн-токены как условие сборки релиза (ТЗ 2.1).
 *
 * Главное утверждение: «несоответствие контраста **блокирует сборку**». Не
 * предупреждение в интерфейсе, которое можно закрыть, а отказ.
 *
 * Тест живёт в модуле доставки, а не дизайна: сборка релиза принадлежит
 * доставке, и доменный модуль о ней не знает — это правило границ, и оно уже
 * один раз поймало меня на этом же файле.
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
      name: 'Гейт токенов — бренд',
      slug: `gate-brand-${stamp}`,
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
      name: 'Гейт — годный',
      slug: `gate-good-${stamp}`,
      kind: 'site',
      parent: brand.id,
    } as never,
    overrideAccess: true,
  })

  const bad = await payload.create({
    collection: 'tenants',
    data: {
      name: 'Гейт — плохой',
      slug: `gate-bad-${stamp}`,
      kind: 'site',
      parent: brand.id,
    } as never,
    overrideAccess: true,
  })

  goodSiteId = good.id
  badSiteId = bad.id

  await primitive(brand.id, 'color.white', '#FFFFFF')
  await primitive(brand.id, 'color.ink', '#111111')
  await primitive(brand.id, 'color.gray.600', '#595959')

  await role(brand.id, 'surface.base', 'color.white', 'color.ink')
  await role(brand.id, 'surface.raised', 'color.white', 'color.ink')
  await role(brand.id, 'text.primary', 'color.ink', 'color.white')
  await role(brand.id, 'text.secondary', 'color.gray.600', 'color.white')
  await role(brand.id, 'text.muted', 'color.gray.600', 'color.white')

  /**
   * Плохой сайт переопределяет **только** приглушённый текст и делает его
   * нечитаемым. Ровно так это и происходит в жизни: «чуть светлее» на глаз.
   */
  await primitive(bad.id, 'color.gray.300', '#BFBFBF')
  await role(bad.id, 'text.muted', 'color.gray.300', 'color.gray.300')
})

describe('контраст блокирует сборку', () => {
  it('релиз сайта с нечитаемым текстом не собирается', async () => {
    const result = await buildRelease({ payload, siteId: badSiteId })

    expect(result.status).toBe('failed')
    expect(result.report.findings.some((finding) => finding.code === 'contrast-below-aa')).toBe(
      true,
    )
  })

  it('в отчёте видно, какая именно роль и в какой теме', async () => {
    const result = await buildRelease({ payload, siteId: badSiteId })
    const finding = result.report.findings.find((item) => item.code === 'contrast-below-aa')

    expect(finding?.location).toContain('text.muted')
    expect(finding?.location).toContain('surface.base')
  })

  it('релиз сайта с проходящей палитрой собирается', async () => {
    const result = await buildRelease({ payload, siteId: goodSiteId })

    expect(result.status).toBe('ready')
  })

  /**
   * Токены замораживаются в снапшоте: иначе откат вернул бы старую разметку с
   * новыми цветами — состояние, которого никогда не публиковали.
   */
  it('разрешённые токены попадают в снапшот релиза', async () => {
    const result = await buildRelease({ payload, siteId: goodSiteId })

    expect(result.snapshot.tokens.light?.['surface.base']).toBe('#FFFFFF')
    expect(result.snapshot.tokens.dark?.['surface.base']).toBe('#111111')
  })
})

describe('битый граф блокирует сборку', () => {
  it('роль со ссылкой на несуществующий примитив не даёт собрать релиз', async () => {
    const site = await payload.create({
      collection: 'tenants',
      data: {
        name: 'Гейт — битая ссылка',
        slug: `gate-broken-${stamp}`,
        kind: 'site',
        parent: brandId,
      } as never,
      overrideAccess: true,
    })

    await role(site.id, 'accent.default', 'нет.такого.примитива', 'color.ink')

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.findings.some((finding) => finding.code === 'unknown-primitive')).toBe(
      true,
    )
  })
})
