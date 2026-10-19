import { describe, expect, it } from 'vitest'

import { expandSections, MAX_SECTION_DEPTH, resolveSections } from './resolve'

import type { SectionRecord } from './resolve'

const CHAIN = ['brand', 'region', 'site']

function section(overrides: Partial<SectionRecord> = {}): SectionRecord {
  return {
    key: 'trust',
    locale: 'ru',
    ownerId: 'brand',
    isActive: true,
    blocks: [{ type: 'quote', props: { text: 'бренд' } }],
    ...overrides,
  }
}

describe('наследование секций', () => {
  it('секция бренда действует на сайте', () => {
    const resolved = resolveSections({ chainIds: CHAIN, records: [section()], locale: 'ru' })

    expect(resolved.get('trust')).toMatchObject({ ownerId: 'brand', provenance: 'inherited' })
  })

  it('секция сайта перекрывает одноимённую секцию бренда', () => {
    const resolved = resolveSections({
      chainIds: CHAIN,
      records: [
        section(),
        section({ ownerId: 'site', blocks: [{ type: 'quote', props: { text: 'сайт' } }] }),
      ],
      locale: 'ru',
    })

    expect(resolved.get('trust')).toMatchObject({ ownerId: 'site', provenance: 'own' })
  })

  it('регион перекрывает бренд, но уступает сайту', () => {
    const resolved = resolveSections({
      chainIds: CHAIN,
      records: [section(), section({ ownerId: 'region' })],
      locale: 'ru',
    })

    expect(resolved.get('trust')?.ownerId).toBe('region')
  })

  /**
   * Тихий откат к тексту бренда был бы подменой текста без ведома редактора —
   * на сайте брокера это хуже пустого места.
   */
  it('отключённая секция сайта не откатывает к секции бренда', () => {
    const resolved = resolveSections({
      chainIds: CHAIN,
      records: [section(), section({ ownerId: 'site', isActive: false })],
      locale: 'ru',
    })

    expect(resolved.has('trust')).toBe(false)
  })

  it('секция другого языка не подставляется', () => {
    const resolved = resolveSections({
      chainIds: CHAIN,
      records: [section({ locale: 'en' })],
      locale: 'ru',
    })

    expect(resolved.size).toBe(0)
  })

  it('секция чужого тенанта игнорируется', () => {
    const resolved = resolveSections({
      chainIds: CHAIN,
      records: [section({ ownerId: 'чужой-бренд' })],
      locale: 'ru',
    })

    expect(resolved.size).toBe(0)
  })
})

describe('раскрытие ссылок на секции', () => {
  const sections = resolveSections({
    chainIds: CHAIN,
    records: [
      section({ key: 'trust', blocks: [{ type: 'quote', props: { text: 'доверие' } }] }),
      section({
        key: 'pair',
        blocks: [{ type: 'divider' }, { type: 'spacer' }],
      }),
    ],
    locale: 'ru',
  })

  it('ссылка заменяется содержимым секции', () => {
    const result = expandSections(
      [{ type: 'hero' }, { type: 'section-ref', props: { key: 'trust' } }],
      sections,
    )

    expect(result.issues).toEqual([])
    expect(result.blocks).toEqual([{ type: 'hero' }, { type: 'quote', props: { text: 'доверие' } }])
  })

  /** Секция из нескольких блоков встаёт в поток, а не оборачивается в узел. */
  it('секция из нескольких блоков разворачивается в плоский список', () => {
    const result = expandSections([{ type: 'section-ref', props: { key: 'pair' } }], sections)

    expect(result.blocks).toEqual([{ type: 'divider' }, { type: 'spacer' }])
  })

  it('ссылка внутри слота тоже раскрывается', () => {
    const result = expandSections(
      [{ type: 'columns', slots: { columns: [{ type: 'section-ref', props: { key: 'trust' } }] } }],
      sections,
    )

    expect(result.blocks).toEqual([
      { type: 'columns', slots: { columns: [{ type: 'quote', props: { text: 'доверие' } }] } },
    ])
  })

  it('ссылка на несуществующую секцию видна как расхождение', () => {
    const result = expandSections([{ type: 'section-ref', props: { key: 'нет' } }], sections)

    expect(result.issues.map((issue) => issue.code)).toEqual(['unknown-section'])
    expect(result.blocks).toEqual([])
  })

  it('ссылка без выбранной секции видна как расхождение', () => {
    const result = expandSections([{ type: 'section-ref', props: {} }], sections)

    expect(result.issues.map((issue) => issue.code)).toEqual(['missing-key'])
  })

  it('секция внутри секции раскрывается', () => {
    const nested = resolveSections({
      chainIds: CHAIN,
      records: [
        section({ key: 'outer', blocks: [{ type: 'section-ref', props: { key: 'inner' } }] }),
        section({ key: 'inner', blocks: [{ type: 'quote', props: { text: 'вложенная' } }] }),
      ],
      locale: 'ru',
    })

    const result = expandSections([{ type: 'section-ref', props: { key: 'outer' } }], nested)

    expect(result.issues).toEqual([])
    expect(result.blocks).toEqual([{ type: 'quote', props: { text: 'вложенная' } }])
  })

  it('циклическая ссылка не раскручивается бесконечно', () => {
    const cyclic = resolveSections({
      chainIds: CHAIN,
      records: [
        section({ key: 'loop', blocks: [{ type: 'section-ref', props: { key: 'loop' } }] }),
      ],
      locale: 'ru',
    })

    const result = expandSections([{ type: 'section-ref', props: { key: 'loop' } }], cyclic)

    expect(result.issues.map((issue) => issue.code)).toEqual(['cycle'])
    expect(result.blocks).toEqual([])
  })

  it(`вложенность глубже ${MAX_SECTION_DEPTH} уровней отклоняется`, () => {
    const deep = resolveSections({
      chainIds: CHAIN,
      records: [
        section({ key: 'a', blocks: [{ type: 'section-ref', props: { key: 'b' } }] }),
        section({ key: 'b', blocks: [{ type: 'section-ref', props: { key: 'c' } }] }),
        section({ key: 'c', blocks: [{ type: 'quote' }] }),
      ],
      locale: 'ru',
    })

    const result = expandSections([{ type: 'section-ref', props: { key: 'a' } }], deep)

    expect(result.issues.map((issue) => issue.code)).toEqual(['too-deep'])
  })

  it('мусор вместо дерева не роняет раскрытие', () => {
    expect(() => expandSections('не дерево', sections)).not.toThrow()
    expect(expandSections([null, 42], sections).blocks).toEqual([null, 42])
  })
})

/**
 * Раскрытие для проверок: узел ссылки сохраняется (DEBT-021).
 *
 * Форма отличается от выдачи ровно одним шагом — подстановкой, — и этот
 * набор закрепляет, что всё остальное у них общее: наследование, вложенность
 * и обе защиты от бесконечного раскрытия.
 */
describe('раскрытие для проверок сохраняет адрес ссылки', () => {
  const sections = resolveSections({
    chainIds: CHAIN,
    records: [section({ key: 'trust', blocks: [{ type: 'quote', props: { text: 'доверие' } }] })],
    locale: 'ru',
  })

  const forChecks = (
    blocks: unknown,
    map: ReturnType<typeof resolveSections<SectionRecord>> = sections,
  ) => expandSections(blocks, map, { keepReference: true })

  it('содержимое секции ложится в слот с её ключом, а не вклеивается', () => {
    const result = forChecks([{ type: 'section-ref', props: { key: 'trust' } }])

    expect(result.issues).toEqual([])
    expect(result.blocks).toEqual([
      {
        type: 'section-ref',
        props: { key: 'trust' },
        slots: { 'section:trust': [{ type: 'quote', props: { text: 'доверие' } }] },
      },
    ])
  })

  /**
   * Главное свойство формы: адрес находки внутри секции читается как адрес
   * ссылки на странице плюс путь внутри секции. При обычном раскрытии он
   * указывал бы на блок страницы, которого там нет.
   */
  it('адрес вложенной находки называет ключ секции', () => {
    const nested = resolveSections({
      chainIds: CHAIN,
      records: [
        section({ key: 'outer', blocks: [{ type: 'section-ref', props: { key: 'нет' } }] }),
      ],
      locale: 'ru',
    })

    const result = forChecks([{ type: 'section-ref', props: { key: 'outer' } }], nested)

    expect(result.issues.map((issue) => issue.path)).toEqual(['blocks[0].slots.section:outer[0]'])
  })

  /** Защита от цикла и предел глубины — те же, что у выдачи. */
  it('цикл даёт тот же код находки, что и при обычном раскрытии', () => {
    const cyclic = resolveSections({
      chainIds: CHAIN,
      records: [
        section({ key: 'loop', blocks: [{ type: 'section-ref', props: { key: 'loop' } }] }),
      ],
      locale: 'ru',
    })

    const result = forChecks([{ type: 'section-ref', props: { key: 'loop' } }], cyclic)

    expect(result.issues.map((issue) => issue.code)).toEqual(['cycle'])
  })

  /**
   * Нераскрытая ссылка не остаётся в дереве: подставлять нечего, а лишний
   * узел раздувал бы объявленный охват на материал, которого нет.
   */
  it('ссылка, которую нечем раскрыть, из дерева убирается', () => {
    expect(forChecks([{ type: 'section-ref', props: { key: 'нет' } }]).blocks).toEqual([])
  })

  /** Выдача этой формы не получает: там раскрытие прежнее, плоское. */
  it('без флага содержимое по-прежнему вклеивается на место ссылки', () => {
    const result = expandSections([{ type: 'section-ref', props: { key: 'trust' } }], sections)

    expect(result.blocks).toEqual([{ type: 'quote', props: { text: 'доверие' } }])
  })
})
