import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildRelease } from './build'

import type { Payload } from 'payload'

/**
 * Комплаенс-ограничители как условие сборки (ТЗ 2.4).
 *
 * > «Эти правила — часть движка, а не поля в форме»
 *
 * Здесь проверяется именно движковая часть: релиз сайта без риск-предупреждения
 * не собирается, с недоступным изображением — тоже. Не предупреждение в
 * интерфейсе, которое закрывают, а отказ.
 *
 * Тест живёт в доставке: сборка релиза принадлежит ей.
 *
 * Два бренда, а не один: бренд с полосой предупреждения нужен для проверки
 * наследования, бренд без неё — для всех отрицательных случаев. Один общий
 * сделал бы тесты зависимыми от порядка выполнения.
 */

let payload: Payload
let strictBrandId: number | string
let coveredBrandId: number | string

const stamp = Date.now()

async function seedTokens(owner: number | string) {
  const primitive = async (name: string, value: string) => {
    await payload.create({
      collection: 'design-primitives',
      overrideAccess: true,
      data: { name, category: 'color', value, owner } as never,
    })
  }

  const role = async (name: string, light: string, dark: string) => {
    await payload.create({
      collection: 'design-roles',
      overrideAccess: true,
      data: { name, group: name.split('.')[0], light, dark, owner } as never,
    })
  }

  /** Палитра, проходящая контраст: иначе релиз падал бы не по той причине. */
  await primitive('color.white', '#FFFFFF')
  await primitive('color.ink', '#111111')
  await role('surface.base', 'color.white', 'color.ink')
  await role('text.primary', 'color.ink', 'color.white')
}

async function makeBrand(slug: string) {
  const brand = await payload.create({
    collection: 'tenants',
    data: {
      name: slug,
      slug,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'en' },
    } as never,
    overrideAccess: true,
  })

  await seedTokens(brand.id)

  return brand
}

async function makeSite(brandId: number | string, slug: string) {
  return payload.create({
    collection: 'tenants',
    data: { name: slug, slug, kind: 'site', parent: brandId } as never,
    overrideAccess: true,
  })
}

async function addRiskWarning(owner: number | string, overrides: Record<string, unknown> = {}) {
  return payload.create({
    collection: 'global-areas',
    overrideAccess: true,
    data: {
      title: 'Предупреждение о риске',
      kind: 'risk-warning',
      owner,
      locale: 'en',
      isActive: true,
      riskWarning: { text: 'Торговля CFD сопряжена с высоким риском.', lossPercentage: 74 },
      ...overrides,
    } as never,
  })
}

beforeAll(async () => {
  payload = await getPayload({ config })

  strictBrandId = (await makeBrand(`cmp-strict-${stamp}`)).id
  coveredBrandId = (await makeBrand(`cmp-covered-${stamp}`)).id

  await addRiskWarning(coveredBrandId)
})

describe('риск-предупреждение блокирует релиз', () => {
  /** «страница не может быть опубликована без глобальной области риск-варнинга» */
  it('сайт без полосы предупреждения не собирается', async () => {
    const site = await makeSite(strictBrandId, `cmp-no-warning-${stamp}`)
    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.findings.some((finding) => finding.code === 'risk-warning-missing')).toBe(
      true,
    )
  })

  it('сайт со своей полосой собирается', async () => {
    const site = await makeSite(strictBrandId, `cmp-own-warning-${stamp}`)
    await addRiskWarning(site.id)

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('ready')
  })

  /**
   * Полоса бренда действует на его сайтах: требовать собственную у каждого
   * значило бы завести двадцать копий одного регуляторного текста.
   */
  it('полоса бренда покрывает его сайт', async () => {
    const site = await makeSite(coveredBrandId, `cmp-inherited-${stamp}`)
    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('ready')
  })

  /** Пустая полоса — не предупреждение, а место, где оно должно было быть. */
  it('полоса с пустым текстом блокирует', async () => {
    const site = await makeSite(strictBrandId, `cmp-empty-${stamp}`)
    await addRiskWarning(site.id, { riskWarning: { text: '', lossPercentage: 74 } })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.findings.some((finding) => finding.code === 'risk-warning-empty')).toBe(
      true,
    )
  })

  it('отключённая полоса считается отсутствующей', async () => {
    const site = await makeSite(strictBrandId, `cmp-inactive-${stamp}`)
    await addRiskWarning(site.id, { isActive: false })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
  })

  it('незаполненная доля теряющих счетов блокирует в ЕС', async () => {
    const site = await makeSite(strictBrandId, `cmp-loss-${stamp}`)
    await addRiskWarning(site.id, {
      riskWarning: { text: 'Торговля сопряжена с риском.', lossPercentage: null },
    })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(
      result.report.findings.some((finding) => finding.code === 'loss-percentage-missing'),
    ).toBe(true)
  })
})

describe('изображение без alt блокирует релиз', () => {
  /**
   * Ссылка на несуществующий файл проверяется так же, как файл без alt:
   * показать такое изображение всё равно не получится, и молчать об этом хуже,
   * чем сообщить не самой точной формулировкой.
   */
  it('ссылка на недоступный файл не даёт собрать релиз', async () => {
    const site = await makeSite(coveredBrandId, `cmp-alt-${stamp}`)

    await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'С картинкой',
        path: `/alt-${stamp}`,
        locale: 'en',
        site: site.id,
        status: 'published',
        blocks: [{ type: 'hero', props: { image: 999_999 } }],
      } as never,
    })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.findings.some((finding) => finding.code === 'image-without-alt')).toBe(
      true,
    )
  })
})

describe('юрисдикционная видимость блокирует релиз', () => {
  /** Содержимое, которое не покажется никогда, — почти всегда опечатка. */
  it('страница, ограниченная чужой юрисдикцией, не собирается', async () => {
    const site = await makeSite(coveredBrandId, `cmp-jur-${stamp}`)

    await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'Только для Британии',
        path: `/uk-only-${stamp}`,
        locale: 'en',
        site: site.id,
        status: 'published',
        jurisdictions: [{ code: 'uk-fca' }],
      } as never,
    })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(
      result.report.findings.some((finding) => finding.code === 'unreachable-jurisdiction'),
    ).toBe(true)
  })

  /** Черновик в релиз не попадает, и требовать от него комплаенса незачем. */
  it('черновик с тем же нарушением сборку не ломает', async () => {
    const site = await makeSite(coveredBrandId, `cmp-draft-${stamp}`)

    await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'Черновик с нарушением',
        path: `/draft-jur-${stamp}`,
        locale: 'en',
        site: site.id,
        status: 'draft',
        jurisdictions: [{ code: 'uk-fca' }],
      } as never,
    })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('ready')
  })
})
