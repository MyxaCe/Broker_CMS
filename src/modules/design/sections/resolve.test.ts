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
