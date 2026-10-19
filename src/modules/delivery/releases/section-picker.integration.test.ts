import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { chainTo, sectionChoices, sectionRowsOf } from '@/modules/design'

import { buildRelease } from './build'

import type { TenantLink } from '@/modules/design'
import type { Payload } from 'payload'

/**
 * Выбор переиспользуемой секции по ключу ([[DEBT-011]], шестой пункт).
 *
 * Проверяется **связка**, и утверждение у неё одно: то, что редактор
 * предлагает выбрать, — ровно то, что подставит сборка релиза. Разойтись
 * здесь легко и незаметно: наследование бренд → регион → сайт у редактора и
 * у движка считалось бы по-разному, и увидели бы это на пустом месте в
 * опубликованной странице.
 *
 * Это тот же класс, на котором обожглись в BUG-007: интерфейс оказался
 * строже движка, и расхождение нашлось случайно.
 */

let payload: Payload
let brandId: string | number
let siteId: string | number
let tenants: TenantLink[]

const stamp = Date.now()

/** Ключи уникальны на прогон: база между прогонами не стирается. */
const SHARED = `shared-${stamp}`
const BRAND_ONLY = `brand-only-${stamp}`
const OVERRIDDEN = `overridden-${stamp}`

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: `Секции ${stamp}`,
      slug: `sec-brand-${stamp}`,
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

  await primitive('color.white', '#FFFFFF')
  await primitive('color.ink', '#111111')

  await payload.create({
    collection: 'design-roles',
    overrideAccess: true,
    data: {
      name: 'surface.base',
      group: 'surface',
      light: 'color.white',
      dark: 'color.ink',
      owner: brandId,
    } as never,
  })

  const site = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: `Сайт секций ${stamp}`,
      slug: `sec-site-${stamp}`,
      kind: 'site',
      parent: brandId,
    } as never,
  })

  siteId = site.id

  const section = async (args: {
    key: string
    owner: string | number
    title: string
    isActive?: boolean
    text?: string
  }) => {
    await payload.create({
      collection: 'sections',
      overrideAccess: true,
      data: {
        title: args.title,
        key: args.key,
        owner: args.owner,
        locale: 'en',
        isActive: args.isActive ?? true,
        blocks: [{ type: 'rich-text', props: { body: args.text ?? args.title } }],
      } as never,
    })
  }

  /** Своя секция сайта перекрывает одноимённую секцию бренда. */
  await section({ key: SHARED, owner: brandId, title: 'Общая (бренд)', text: 'Текст бренда' })
  await section({ key: SHARED, owner: siteId, title: 'Общая (сайт)', text: 'Текст сайта' })

  /** Только у бренда — наследуется. */
  await section({ key: BRAND_ONLY, owner: brandId, title: 'Только бренд' })

  /**
   * Секция сайта **отключена** и перекрывает секцию бренда. Правило
   * `pickNearest`: отключённая ближняя побеждает и в результат не попадает —
   * ссылка остаётся пустой, а не откатывается к бренду.
   */
  await section({ key: OVERRIDDEN, owner: brandId, title: 'Перекрытая (бренд)' })
  await section({
    key: OVERRIDDEN,
    owner: siteId,
    title: 'Перекрытая (сайт, отключена)',
    isActive: false,
  })

  const rows = await payload.find({
    collection: 'tenants',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  tenants = rows.docs.map((doc) => {
    const record = doc as unknown as Record<string, unknown>
    const parent = record.parent

    return {
      id: String(record.id),
      name: typeof record.name === 'string' ? record.name : String(record.id),
      parentId:
        parent === null || parent === undefined
          ? null
          : typeof parent === 'object' && 'id' in parent
            ? String((parent as { id: unknown }).id)
            : String(parent),
    }
  })
}, 180_000)

async function choicesForSite() {
  const found = await payload.find({
    collection: 'sections',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  return sectionChoices({
    rows: sectionRowsOf({ docs: found.docs }),
    tenants,
    chainIds: chainTo(tenants, String(siteId)),
    locale: 'en',
  })
}

describe('редактор предлагает то, что подставит сборка', () => {
  it('цепочка владельцев строится по живым карточкам тенантов', () => {
    expect(chainTo(tenants, String(siteId))).toEqual([String(brandId), String(siteId)])
  })

  it('перекрытый ключ отдаёт секцию сайта, унаследованный — секцию бренда', async () => {
    const choices = await choicesForSite()
    const byKey = new Map(choices.options.map((option) => [option.key, option]))

    expect(byKey.get(SHARED)?.title).toBe('Общая (сайт)')
    expect(byKey.get(SHARED)?.provenance).toBe('own')
    expect(byKey.get(BRAND_ONLY)?.provenance).toBe('inherited')
  })

  /**
   * Главная проверка.
   *
   * Область ссылается **на каждый предложенный ключ**, и релиз обязан
   * собраться без единого расхождения: предложенный ключ, которого сборка не
   * находит, — это обещание, которого интерфейс не держит.
   *
   * Почему область, а не страница: раскрытие секций при сборке выполняется
   * для глобальных областей, а блоки страниц в релиз сегодня не уезжают
   * вовсе — см. [[DEBT-021]]. Проверять надо там, где правило исполняется.
   */
  it('область со ссылками на все предложенные ключи собирается без расхождений', async () => {
    const choices = await choicesForSite()

    expect(choices.options.length).toBeGreaterThanOrEqual(2)

    const area = await payload.create({
      collection: 'global-areas',
      overrideAccess: true,
      data: {
        title: 'Подвал со ссылками на секции',
        kind: 'footer',
        owner: siteId,
        locale: 'en',
        isActive: true,
        blocks: choices.options.map((option) => ({
          type: 'section-ref',
          props: { key: option.key },
        })),
      } as never,
    })

    const built = await buildRelease({ payload, siteId })

    expect(built.report.blocking).toEqual([])
    expect(built.status).toBe('ready')

    const footer = built.snapshot.structure.globalAreas.find((item) => item.kind === 'footer')
    const dump = JSON.stringify(footer)

    /** Ссылки раскрыты: `section-ref` в снапшот не уезжает. */
    expect(dump).not.toContain('section-ref')
    /** И подставился текст **сайта**, а не бренда: наследование доехало. */
    expect(dump).toContain('Текст сайта')
    expect(dump).not.toContain('Текст бренда')

    await payload.delete({ collection: 'global-areas', id: area.id, overrideAccess: true })
  })

  /**
   * РАСТЯЖКА. Ключ, перекрытый отключённой секцией, редактор **не
   * предлагает** и называет причину отдельно — а сборка на ссылке с этим
   * ключом останавливается. Два утверждения проверяются вместе: по
   * отдельности первое означало бы «интерфейс строже движка», а это тот
   * самый BUG-007.
   */
  it('перекрытый отключённой секцией ключ не предлагается — и сборка на нём встаёт', async () => {
    const choices = await choicesForSite()

    expect(choices.options.map((option) => option.key)).not.toContain(OVERRIDDEN)
    expect(choices.shadowed.map((entry) => entry.key)).toContain(OVERRIDDEN)

    const area = await payload.create({
      collection: 'global-areas',
      overrideAccess: true,
      data: {
        title: 'Подвал с перекрытой секцией',
        kind: 'footer',
        owner: siteId,
        locale: 'en',
        isActive: true,
        blocks: [{ type: 'section-ref', props: { key: OVERRIDDEN } }],
      } as never,
    })

    const built = await buildRelease({ payload, siteId })

    expect(built.status).not.toBe('ready')
    expect(JSON.stringify(built.report.blocking)).toContain(OVERRIDDEN)

    /** Фикстура убирается: иначе следующий прогон начинался бы со сломанного сайта. */
    await payload.delete({ collection: 'global-areas', id: area.id, overrideAccess: true })
  })
})
