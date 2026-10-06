import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildPalettePreview, tokenSetFromDocs } from '@/modules/design'

import { buildRelease } from './build'

import type { TokenSet } from '@/modules/design'
import type { Payload } from 'payload'

/**
 * Предпросмотр палитры против сборки релиза (ТЗ 2.1, [[DEBT-011]]).
 *
 * Проверяется **связка**, а не арифметика: та проверена в `preview.test.ts` и
 * останется зелёной, даже если предпросмотр начнёт читать не те записи, не ту
 * цепочку или не те пары. Покрытие единицы не является покрытием пути, и
 * здесь путь состоит из четырёх переходов: записи в базе → цепочка владельца
 * → разрешённый набор → вердикт.
 *
 * Тест живёт в доставке: сборка релиза принадлежит ей, а доменный модуль о
 * ней знать не должен — границу принуждает линтер.
 *
 * Утверждение одно и оно всё, ради чего предпросмотр делался: **что он
 * обещает до сохранения, то сборка и скажет после**. Два разных ответа хуже,
 * чем отсутствие предпросмотра: редактор перестанет ему верить.
 */

let payload: Payload
let brandId: number | string
let siteId: number | string
let goldId: number | string

const stamp = Date.now()

/** Жёлтый, который проходит AA на белом: исходное здоровое состояние. */
const DARK_GOLD = '#8A6D1F'
/** «Чуть светлее» — типичная правка на глаз, роняющая контраст ниже AA. */
const LIGHT_GOLD = '#F3D77A'

const READ = { pagination: false, depth: 0, overrideAccess: true } as const

async function primitive(name: string, value: string, owner: number | string) {
  return payload.create({
    collection: 'design-primitives',
    overrideAccess: true,
    data: { name, category: 'color', value, owner } as never,
  })
}

async function role(name: string, group: string, light: string, dark: string) {
  await payload.create({
    collection: 'design-roles',
    overrideAccess: true,
    data: { name, group, light, dark, owner: brandId } as never,
  })
}

/** Набор по цепочке — тем же разбором, которым его собирает админка. */
async function savedSet(chain: readonly string[]): Promise<TokenSet> {
  const [primitives, roles, components] = await Promise.all([
    payload.find({ collection: 'design-primitives', where: { owner: { in: chain } }, ...READ }),
    payload.find({ collection: 'design-roles', where: { owner: { in: chain } }, ...READ }),
    payload.find({
      collection: 'design-component-tokens',
      where: { owner: { in: chain } },
      ...READ,
    }),
  ])

  return tokenSetFromDocs(chain, {
    primitives: primitives.docs,
    roles: roles.docs,
    components: components.docs,
  })
}

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: `Палитра ${stamp}`,
      slug: `palette-brand-${stamp}`,
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

  await primitive('color.white', '#FFFFFF', brandId)
  await primitive('color.ink', '#111111', brandId)
  goldId = (await primitive('color.gold', DARK_GOLD, brandId)).id

  await role('surface.base', 'surface', 'color.white', 'color.ink')
  await role('text.primary', 'text', 'color.ink', 'color.white')
  await role('text.inverse', 'text', 'color.white', 'color.white')
  await role('accent.default', 'accent', 'color.gold', 'color.gold')

  await payload.create({
    collection: 'design-component-tokens',
    overrideAccess: true,
    data: {
      name: 'button.primary.bg',
      source: 'role',
      reference: 'accent.default',
      owner: brandId,
    } as never,
  })

  const site = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: `Сайт палитры ${stamp}`,
      slug: `palette-site-${stamp}`,
      kind: 'site',
      parent: brandId,
    } as never,
  })

  siteId = site.id
}, 180_000)

describe('предпросмотр и сборка говорят одно и то же', () => {
  it('исправная палитра: релиз собирается, предпросмотр сломанных пар не показывает', async () => {
    const built = await buildRelease({ payload, siteId })

    expect(built.status).toBe('ready')

    const preview = buildPalettePreview({
      saved: await savedSet([String(brandId), String(siteId)]),
      draft: null,
    })

    expect(preview.broken).toEqual([])
    expect(preview.contrast.length).toBeGreaterThan(0)
  })

  it('правка, которую предпросмотр назвал сломанной, ломает ровно ту же пару при сборке', async () => {
    const saved = await savedSet([String(brandId), String(siteId)])

    const preview = buildPalettePreview({
      saved,
      draft: {
        level: 'primitive',
        value: { name: 'color.gold', category: 'color', value: LIGHT_GOLD },
      },
    })

    expect(preview.broken.length).toBeGreaterThan(0)

    /** Та же правка, но уже сохранённая. */
    await payload.update({
      collection: 'design-primitives',
      id: goldId,
      overrideAccess: true,
      data: { value: LIGHT_GOLD } as never,
    })

    const built = await buildRelease({ payload, siteId })

    expect(built.status).toBe('failed')

    const contrast = built.report.findings.filter((finding) => finding.code === 'contrast-below-aa')

    expect(contrast.length).toBeGreaterThan(0)

    /**
     * Совпадение **по имени пары**, а не по числу находок. Одинаковое
     * количество двух разных списков доказывало бы меньше, чем кажется:
     * совпасть могли бы и несвязанные пары.
     */
    const fromBuild = new Set(contrast.map((finding) => finding.location))

    for (const row of preview.broken) {
      expect(fromBuild.has(`токен: ${row.label}`)).toBe(true)
    }

    /** Возврат состояния: иначе второй прогон стартует со сломанной палитры. */
    await payload.update({
      collection: 'design-primitives',
      id: goldId,
      overrideAccess: true,
      data: { value: DARK_GOLD } as never,
    })
  })

  it('наследование читается: токен сайта перекрывает токен бренда и в предпросмотре', async () => {
    await payload.create({
      collection: 'design-primitives',
      overrideAccess: true,
      data: { name: 'color.gold', category: 'color', value: '#0A5C2A', owner: siteId } as never,
    })

    const saved = await savedSet([String(brandId), String(siteId)])

    expect(saved.primitives.find((item) => item.name === 'color.gold')?.value).toBe('#0A5C2A')

    const preview = buildPalettePreview({ saved, draft: null })
    const accent = preview.swatches.find((swatch) => swatch.name === 'accent.default')

    expect(accent?.light).toBe('#0A5C2A')
  })
})
