import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildBootstrapResponse } from '../api/bootstrap'
import { buildPageManifestResponse } from '../api/page-manifest'

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
        blocks: [{ type: 'hero', props: { title: 'С картинкой', image: '999999' } }],
      } as never,
    })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.findings.some((finding) => finding.code === 'image-without-alt')).toBe(
      true,
    )
  })

  /**
   * Три поля из восьми правило не видело вовсе (найдено `2026-10-06` при
   * ADR-0034). Перечень имён вёлся руками и отставал от реестра пропсов:
   * `icon`, `avatar` и `file` объявлены как медиа, а в списке их не было.
   *
   * Регресс пишется на том состоянии, в котором дефект жил: страница с
   * блоком, ссылающимся на недоступный файл **через такое поле**. На `image`
   * тот же тест был зелёным и тогда.
   */
  it('поля icon, avatar и file проверяются наравне с image', async () => {
    const site = await makeSite(coveredBrandId, `cmp-alt-fields-${stamp}`)

    await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'Карточки и файлы',
        path: `/alt-fields-${stamp}`,
        locale: 'en',
        site: site.id,
        status: 'published',
        blocks: [
          { type: 'benefit-stack', props: { items: [{ title: 'Пункт', icon: '999991' }] } },
          {
            type: 'testimonials',
            props: { items: [{ quote: 'Хорошо', author: 'Клиент', avatar: '999992' }] },
          },
          {
            type: 'downloads',
            props: { items: [{ file: '999993', label: 'Договор' }] },
          },
        ],
      } as never,
    })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')

    const alt = result.report.findings.filter((finding) => finding.code === 'image-without-alt')

    /** Все три, а не одно: правило обязано осмотреть каждое поле, а не первое. */
    expect(alt).toHaveLength(3)
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

/**
 * Стоп-словарь обещаний доходности (ТЗ 2.4).
 *
 * Проверок на него здесь не было ни одной — и это ровно та причина, по которой
 * DEBT-013 прожил месяц незамеченным: валидатор был покрыт своими тестами, а
 * связку «страница в базе → текст в снапшоте → отказ сборки» не проверял никто.
 */
describe('стоп-словарь блокирует релиз', () => {
  it('обещание доходности на опубликованной странице не даёт собрать релиз', async () => {
    const site = await makeSite(coveredBrandId, `cmp-claim-${stamp}`)

    await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'Условия',
        path: `/claim-${stamp}`,
        locale: 'en',
        site: site.id,
        status: 'published',
        blocks: [
          {
            type: 'hero',
            props: { title: 'Условия', subtitle: 'Гарантированная доходность 30% годовых' },
          },
        ],
      } as never,
    })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.findings.some((finding) => finding.code === 'forbidden-claim')).toBe(true)
  })

  /**
   * Адрес находки обязан вести к конкретному пропсу конкретного блока:
   * «где-то на сайте есть обещание доходности» — не то сообщение, по которому
   * редактор что-то исправит.
   */
  it('находка указывает на страницу и блок', async () => {
    const site = await makeSite(coveredBrandId, `cmp-claim-where-${stamp}`)
    const path = `/claim-where-${stamp}`

    await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'Условия',
        path,
        locale: 'en',
        site: site.id,
        status: 'published',
        blocks: [{ type: 'quote', props: { text: 'Прибыль гарантирована' } }],
      } as never,
    })

    const result = await buildRelease({ payload, siteId: site.id })
    const finding = result.report.findings.find((item) => item.code === 'forbidden-claim')

    expect(finding?.location).toContain(path)
    expect(finding?.location).toContain('blocks[0]')
  })

  /** Черновик в релиз не попадает — стоп-словарь обязан вести себя так же. */
  it('черновик с обещанием доходности сборку не ломает', async () => {
    const site = await makeSite(coveredBrandId, `cmp-claim-draft-${stamp}`)

    await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'Черновик',
        path: `/claim-draft-${stamp}`,
        locale: 'en',
        site: site.id,
        status: 'draft',
        blocks: [{ type: 'hero', props: { title: 'Гарантированная доходность' } }],
      } as never,
    })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('ready')
  })

  /**
   * Главное свойство, ради которого переделан каркас: сборка обязана
   * докладывать, что тексты действительно осматривались. Отчёт, в котором
   * стоп-словарь «не выполнялся», — не чистый отчёт.
   */
  it('отчёт показывает, что тексты осмотрены, а не пропущены', async () => {
    const site = await makeSite(coveredBrandId, `cmp-claim-coverage-${stamp}`)

    await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'Чистая страница',
        path: `/claim-clean-${stamp}`,
        locale: 'en',
        site: site.id,
        status: 'published',
        blocks: [{ type: 'hero', props: { title: 'Торговые условия' } }],
      } as never,
    })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('ready')

    /**
     * Осмотрены и заголовок страницы, и текст унаследованной полосы
     * риск-предупреждения: она приходит от бренда и живёт отдельным полем,
     * а не блоком.
     */
    const coverage = result.report.coverage['forbidden-claims']

    expect(coverage?.kind).toBe('checked')
    expect(coverage?.kind === 'checked' && coverage.examined).toBeGreaterThanOrEqual(2)
  })
})

describe('дисклеймер продукта — пятый ограничитель, включённый блокирующим', () => {
  /**
   * CMS-07 и BUG-010. Правило было написано и не вызывалось ниоткуда; включить
   * его было нельзя, потому что текста дисклеймера взять было неоткуда, а
   * гейт, который невозможно удовлетворить, отключают.
   *
   * Поэтому проверяются **оба исхода**: страница с калькулятором собирается,
   * когда текст есть, и не собирается, когда его нет. Один исход без второго
   * ничего не доказывает — именно это и отличает исполнимое правило от
   * неисполнимого.
   */
  async function pageWithCalculator(siteId: number | string, suffix: string) {
    return payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'Калькулятор маржи',
        path: `/calc-${suffix}-${stamp}`,
        locale: 'en',
        site: siteId,
        status: 'published',
        blocks: [
          { type: 'hero', props: { title: 'Калькулятор' } },
          { type: 'calculator', variant: 'margin', props: { title: 'Маржа' } },
        ],
      } as never,
    })
  }

  async function addDisclaimer(owner: number | string, overrides: Record<string, unknown> = {}) {
    return payload.create({
      collection: 'disclaimers',
      overrideAccess: true,
      data: {
        key: 'disclaimer.calculator',
        locale: 'en',
        owner,
        text: 'Результат расчёта носит справочный характер и не является офертой.',
        isActive: true,
        ...overrides,
      } as never,
    })
  }

  it('страница с калькулятором НЕ собирается, когда текста нет', async () => {
    const site = await makeSite(coveredBrandId, `dsc-missing-${stamp}`)
    await pageWithCalculator(site.id, 'missing')

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.blocking.map((finding) => finding.code)).toContain(
      'disclaimer-text-missing',
    )
  })

  it('и собирается, когда текст есть — правило удовлетворимо', async () => {
    const site = await makeSite(coveredBrandId, `dsc-present-${stamp}`)
    await pageWithCalculator(site.id, 'present')
    await addDisclaimer(site.id)

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('ready')
    expect(result.report.coverage.disclaimers).toEqual({
      kind: 'checked',
      examined: 1,
      unit: 'требуемых дисклеймеров после раскрытия ссылок на секции',
    })
  })

  /**
   * Текст бренда действует на его сайтах — иначе одна регуляторная
   * формулировка жила бы в двадцати копиях.
   */
  it('текст бренда покрывает его сайт', async () => {
    const brand = await makeBrand(`dsc-brand-${stamp}`)
    await addRiskWarning(brand.id)
    await addDisclaimer(brand.id)

    const site = await makeSite(brand.id, `dsc-inherited-${stamp}`)
    await pageWithCalculator(site.id, 'inherited')

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('ready')
  })

  /**
   * Выключенный текст сайта **не** откатывает к тексту бренда. Тихая подмена
   * регуляторной формулировки на чужую хуже отказа: её никто не заметит, а
   * пустое место заметят — релиз не соберётся.
   */
  it('выключенный текст сайта не откатывает к тексту бренда', async () => {
    const brand = await makeBrand(`dsc-brand-off-${stamp}`)
    await addRiskWarning(brand.id)
    await addDisclaimer(brand.id)

    const site = await makeSite(brand.id, `dsc-off-${stamp}`)
    await pageWithCalculator(site.id, 'off')
    await addDisclaimer(site.id, { isActive: false })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.blocking.map((finding) => finding.code)).toContain(
      'disclaimer-text-missing',
    )
  })

  /**
   * Инвариант контракта целиком (Р-028): ключ приезжает к витрине **при
   * блоке**, из которого выведен, а текст — картой на сайт и локаль. Проверка
   * идёт по двум ручкам сразу, потому что порознь инвариант не проверяется:
   * смысл в том, что ключ одной ручки гарантированно есть в карте другой.
   */
  it('ключ приезжает при блоке, текст — картой, и они сходятся', async () => {
    const site = await makeSite(coveredBrandId, `dsc-contract-${stamp}`)
    const page = await pageWithCalculator(site.id, 'contract')
    await addDisclaimer(site.id)

    const result = await buildRelease({ payload, siteId: site.id })
    expect(result.status).toBe('ready')

    const release = { number: result.number, builtAt: new Date().toISOString() }

    const manifest = buildPageManifestResponse({ snapshot: result.snapshot, release })
    const entry = manifest.pages.find((candidate) => candidate.path === page.path)

    expect(entry?.disclaimers.blocks).toEqual([
      { path: 'blocks[1]', type: 'calculator', keys: ['disclaimer.calculator'] },
    ])

    const bootstrap = buildBootstrapResponse({ snapshot: result.snapshot, release })

    for (const key of entry?.disclaimers.blocks.flatMap((block) => block.keys) ?? []) {
      expect(bootstrap.disclaimers[key]).toBe(
        'Результат расчёта носит справочный характер и не является офертой.',
      )
    }
  })

  /**
   * Регресс пишется на состоянии, в котором дефект жил: страница без
   * требующих блоков. Месяц правило не вызывалось вовсе, и отчёт выглядел
   * чистым — теперь он обязан сказать «проверять было нечего».
   */
  it('сайт без требующих блоков даёт «нечего было проверять», а не «нарушений нет»', async () => {
    const site = await makeSite(coveredBrandId, `dsc-empty-${stamp}`)

    await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'Обычная страница',
        path: `/plain-${stamp}`,
        locale: 'en',
        site: site.id,
        status: 'published',
        blocks: [{ type: 'hero', props: { title: 'О компании' } }],
      } as never,
    })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('ready')
    expect(result.report.coverage.disclaimers).toEqual({
      kind: 'empty',
      reason: 'ни одна страница сайта не содержит блоков, требующих дисклеймера',
    })
  })
})

/**
 * Переиспользуемые секции в блоках страниц (DEBT-021, Р-060).
 *
 * Найдено при CMS-09б тестом, который ожидал обратного: `expandSections`
 * звали только сборка структуры и предпросмотр, а блоки страниц в проверку
 * шли **сырыми**. То есть один и тот же текст проверялся или нет в
 * зависимости от того, вставили его в глобальную область или в страницу, —
 * и обойти комплаенс можно было не злым умыслом, а обычной работой.
 *
 * Это регуляторная поверхность, а не техдолг, поэтому проверяется каждое
 * правило по отдельности, а не «раскрытие работает».
 *
 * Регресс пишется на том состоянии, в котором дефект жил: страница со
 * ссылкой на секцию, а нарушение — **внутри секции**. На странице без ссылки
 * все эти тесты были зелёными и до правки.
 */
describe('комплаенс видит содержимое переиспользуемых секций', () => {
  async function addSection(
    owner: number | string,
    key: string,
    blocks: unknown[],
    overrides: Record<string, unknown> = {},
  ) {
    return payload.create({
      collection: 'sections',
      overrideAccess: true,
      data: {
        title: `секция ${key}`,
        key,
        locale: 'en',
        owner,
        isActive: true,
        blocks,
        ...overrides,
      } as never,
    })
  }

  async function pageWithRef(siteId: number | string, suffix: string, key: string) {
    return payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'Страница со ссылкой',
        path: `/ref-${suffix}-${stamp}`,
        locale: 'en',
        site: siteId,
        status: 'published',
        blocks: [
          { type: 'hero', props: { title: 'Торговые условия' } },
          { type: 'section-ref', props: { key } },
        ],
      } as never,
    })
  }

  /** Стоп-словарь — то самое правило, которое отдавало чистый отчёт. */
  it('обещание доходности внутри секции не даёт собрать релиз', async () => {
    const site = await makeSite(coveredBrandId, `sec-claim-${stamp}`)
    const key = `claim-${stamp}`

    await addSection(site.id, key, [
      { type: 'quote', props: { text: 'Гарантированная доходность 30% годовых' } },
    ])
    await pageWithRef(site.id, 'claim', key)

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.blocking.map((finding) => finding.code)).toContain('forbidden-claim')
  })

  /**
   * Адрес находки ведёт **в секцию**, а не в блок страницы.
   *
   * Это и есть причина, по которой раскрытие для проверок сохраняет узел
   * ссылки: при обычном раскрытии содержимое вклеивается на место ссылки, и
   * находка называлась бы `blocks[1].text` — адресом блока, которого на
   * странице нет. Редактор пошёл бы править страницу, а править надо секцию,
   * одну на десяток страниц. Неверный адрес хуже расплывчатого.
   */
  it('находка называет секцию, в которой лежит текст', async () => {
    const site = await makeSite(coveredBrandId, `sec-where-${stamp}`)
    const key = `where-${stamp}`

    await addSection(site.id, key, [{ type: 'quote', props: { text: 'Прибыль гарантирована' } }])
    const page = await pageWithRef(site.id, 'where', key)

    const result = await buildRelease({ payload, siteId: site.id })
    const finding = result.report.findings.find((item) => item.code === 'forbidden-claim')

    expect(finding?.location).toContain(page.path)
    expect(finding?.location).toContain(`slots.section:${key}`)
  })

  /** Второе правило той же поверхности: дисклеймер продукта. */
  it('калькулятор внутри секции требует дисклеймера', async () => {
    const site = await makeSite(coveredBrandId, `sec-dsc-${stamp}`)
    const key = `calc-${stamp}`

    await addSection(site.id, key, [
      { type: 'calculator', variant: 'margin', props: { title: 'Маржа' } },
    ])
    await pageWithRef(site.id, 'dsc', key)

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.blocking.map((finding) => finding.code)).toContain(
      'disclaimer-text-missing',
    )
  })

  /**
   * И правило удовлетворимо: с текстом та же страница собирается. Один исход
   * без второго ничего не доказывает — гейт, который нельзя удовлетворить,
   * отключают.
   */
  it('и собирается, когда текст дисклеймера есть', async () => {
    const site = await makeSite(coveredBrandId, `sec-dsc-ok-${stamp}`)
    const key = `calc-ok-${stamp}`

    await addSection(site.id, key, [
      { type: 'calculator', variant: 'margin', props: { title: 'Маржа' } },
    ])
    await pageWithRef(site.id, 'dsc-ok', key)

    await payload.create({
      collection: 'disclaimers',
      overrideAccess: true,
      data: {
        key: 'disclaimer.calculator',
        locale: 'en',
        owner: site.id,
        text: 'Результат расчёта носит справочный характер.',
        isActive: true,
      } as never,
    })

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('ready')
  })

  /** Третье правило: alt у изображения. */
  it('изображение без alt внутри секции блокирует релиз', async () => {
    const site = await makeSite(coveredBrandId, `sec-alt-${stamp}`)
    const key = `alt-${stamp}`

    await addSection(site.id, key, [{ type: 'hero', props: { title: 'Баннер', image: '999994' } }])
    await pageWithRef(site.id, 'alt', key)

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.findings.some((finding) => finding.code === 'image-without-alt')).toBe(
      true,
    )
  })

  /** Четвёртое: юрисдикционная видимость блока. */
  it('блок с недостижимой юрисдикцией внутри секции блокирует релиз', async () => {
    const site = await makeSite(coveredBrandId, `sec-jur-${stamp}`)
    const key = `jur-${stamp}`

    await addSection(site.id, key, [
      {
        type: 'quote',
        props: { text: 'Только для Британии' },
        visibility: { jurisdictions: [{ code: 'uk-fca' }] },
      },
    ])
    await pageWithRef(site.id, 'jur', key)

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(
      result.report.findings.some((finding) => finding.code === 'unreachable-jurisdiction'),
    ).toBe(true)
  })

  /**
   * Наследование: секция бренда действует на его сайтах, и проверяться она
   * обязана там же. Отбор секций идёт тем же `resolveSections`, которым
   * пользуется сборка, — свой обход цепочки разошёлся бы с движком в
   * наследовании, там, где заметить это труднее всего.
   */
  it('секция бренда проверяется на сайте бренда', async () => {
    const brand = await makeBrand(`sec-brand-${stamp}`)
    await addRiskWarning(brand.id)

    const key = `brand-claim-${stamp}`
    await addSection(brand.id, key, [
      { type: 'quote', props: { text: 'Гарантированная доходность' } },
    ])

    const site = await makeSite(brand.id, `sec-inherited-${stamp}`)
    await pageWithRef(site.id, 'inherited', key)

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.blocking.map((finding) => finding.code)).toContain('forbidden-claim')
  })

  /**
   * Ссылка, которой нечего подставить, — дыра в странице, и она обязана быть
   * видна. До правки такой `section-ref` не замечал никто: сборка страницы
   * его не раскрывала, а проверка структуры смотрит только области.
   */
  it('ссылка на отключённую секцию блокирует релиз и названа отдельным кодом', async () => {
    const site = await makeSite(coveredBrandId, `sec-off-${stamp}`)
    const key = `off-${stamp}`

    await addSection(site.id, key, [{ type: 'quote', props: { text: 'Текст' } }], {
      isActive: false,
    })
    await pageWithRef(site.id, 'off', key)

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')
    expect(result.report.blocking.map((finding) => finding.code)).toContain('section-missing')
  })

  /**
   * Цикл в ссылках: прогон не виснет, и это проверяется **кодом находки**, а
   * не фактом завершения.
   *
   * Разница существенна. Защит от бесконечного раскрытия здесь две — счётчик
   * цикла и предел вложенности, — и утверждение «не зависло» держится на
   * любой из них. Тест, проверяющий только завершение, остался бы зелёным
   * после снятия защиты от цикла: её подстраховал бы предел глубины. Это
   * ровно тот случай, когда зелёный тест на защиту не означает, что защита
   * работает, поэтому проверяется **барьер**: код `cycle`, а не `too-deep`.
   *
   * **Измерено, и результат не тот, которого ждали.** Мутация «защита от
   * цикла снята» прогон не вешает — в отличие от обхода цепочки тенантов в
   * CMS-09б, — но и **этот тест не красит**: 2 модульных / 0 интеграционных.
   * Причина честная: подстраховывает предел вложенности, и наружу, в код
   * комплаенс-находки, цикл и превышенная глубина приходят одним и тем же
   * `section-unexamined` — сознательно, потому что для проверки это один и
   * тот же исход «содержимое в проверку не вошло».
   *
   * То есть барьер здесь закрепляют **модульные** тесты раскрытия
   * (`sections/resolve.test.ts`), где утверждается код `cycle`, а не
   * `too-deep`. Этот тест проверяет уровнем выше: что такое содержимое
   * блокирует релиз и названо непроверенным. Он зелёный при снятой защите
   * **правильно** — он ловит другое, и это написано здесь, чтобы следующий
   * не решил, что мутацию не прогоняли.
   */
  it('цикл в ссылках не вешает сборку и называется непроверенным содержимым', async () => {
    const site = await makeSite(coveredBrandId, `sec-cycle-${stamp}`)
    const first = `cyc-a-${stamp}`
    const second = `cyc-b-${stamp}`

    await addSection(site.id, first, [{ type: 'section-ref', props: { key: second } }])
    await addSection(site.id, second, [{ type: 'section-ref', props: { key: first } }])
    await pageWithRef(site.id, 'cycle', first)

    const result = await buildRelease({ payload, siteId: site.id })

    expect(result.status).toBe('failed')

    const codes = result.report.blocking.map((finding) => finding.code)

    /**
     * Содержимое существует, но в проверку не вошло: это «результат
     * неизвестен», а не «нарушений нет», и код обязан быть другим, чем у
     * ссылки, которой нечего подставить.
     */
    expect(codes).toContain('section-unexamined')
    expect(codes).not.toContain('section-missing')
  })

  /**
   * Охват объявляется **с названием единицы** — главный урок находки. Число
   * было верным и тогда: считались страницы по сырому дереву, и текст внутри
   * секции в него не входил никогда. Мера, которой мы закрываем класс
   * «проверка молчит о том, работала ли она», сама стала его носителем.
   */
  it('охват назван единицей и растёт на содержимое секции', async () => {
    const withoutRef = await makeSite(coveredBrandId, `sec-cov-plain-${stamp}`)

    await payload.create({
      collection: 'pages',
      overrideAccess: true,
      data: {
        title: 'Без ссылки',
        path: `/cov-plain-${stamp}`,
        locale: 'en',
        site: withoutRef.id,
        status: 'published',
        blocks: [{ type: 'hero', props: { title: 'Торговые условия' } }],
      } as never,
    })

    const plain = await buildRelease({ payload, siteId: withoutRef.id })

    const site = await makeSite(coveredBrandId, `sec-cov-${stamp}`)
    const key = `cov-${stamp}`

    await addSection(site.id, key, [
      { type: 'quote', props: { text: 'Осторожно' } },
      { type: 'quote', props: { text: 'И ещё раз' } },
    ])
    await pageWithRef(site.id, 'cov', key)

    const expanded = await buildRelease({ payload, siteId: site.id })

    expect(expanded.status).toBe('ready')

    const coverage = expanded.report.coverage.compliance

    expect(coverage?.kind).toBe('checked')
    expect(coverage?.kind === 'checked' && coverage.unit).toBe(
      'блоков страниц после раскрытия ссылок на секции',
    )

    /**
     * Сравнение с сайтом без ссылки, а не с константой: число зависит от
     * состава фикстур, а утверждение — свойство. Два блока секции плюс сам
     * узел ссылки дают ровно три сверх той же страницы без неё.
     */
    const plainCoverage = plain.report.coverage.compliance
    const grown =
      coverage?.kind === 'checked' && plainCoverage?.kind === 'checked'
        ? coverage.examined - plainCoverage.examined
        : null

    expect(grown).toBe(3)

    /** Охват доезжает до сохранённой записи релиза, а не умирает в памяти. */
    const stored = (await payload.findByID({
      collection: 'releases',
      id: expanded.releaseId,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>

    const report = stored.validationReport as Record<string, unknown>
    const summary = report.coverageSummary as Record<string, string>

    expect(summary.compliance).toContain('блоков страниц после раскрытия ссылок на секции')

    /**
     * И машинная форма рядом с человеческой: по фразе фильтровать нельзя, а
     * сверять релизы между собой придётся именно по ней. Утверждаются обе —
     * мутация, убравшая одну, иначе не покраснела бы (измерено 19.10: снятие
     * только `coverage` дало 0/0).
     */
    const machine = (report.coverage as Record<string, Record<string, unknown>>).compliance

    expect(machine?.unit).toBe('блоков страниц после раскрытия ссылок на секции')
    expect(machine?.kind).toBe('checked')
  })
})
