import { describe, expect, it } from 'vitest'

import { composeStructure } from './compose'

import type { ComposeStructureArgs, GlobalAreaRecord, NavigationRecord } from './compose'

const CHAIN = ['brand', 'region', 'site']

const PAGES = new Map([
  [
    'ru',
    new Map([
      ['1', '/'],
      ['2', '/accounts'],
    ]),
  ],
])

function compose(overrides: Partial<ComposeStructureArgs> = {}) {
  return composeStructure({
    chainIds: CHAIN,
    locales: ['ru'],
    sections: [],
    navigations: [],
    globalAreas: [],
    pagePaths: PAGES,
    ...overrides,
  })
}

function nav(overrides: Partial<NavigationRecord> = {}): NavigationRecord {
  return {
    placement: 'primary',
    locale: 'ru',
    ownerId: 'brand',
    isActive: true,
    items: [{ label: 'Счета', target: 'page', pageId: '2' }],
    ...overrides,
  }
}

function area(overrides: Partial<GlobalAreaRecord> = {}): GlobalAreaRecord {
  return {
    kind: 'footer',
    locale: 'ru',
    ownerId: 'brand',
    isActive: true,
    blocks: [{ type: 'rich-text' }],
    riskWarning: null,
    jurisdictions: [],
    ...overrides,
  }
}

describe('навигация в снапшоте', () => {
  it('меню бренда доезжает до сайта с разрешёнными адресами', () => {
    const structure = compose({ navigations: [nav()] })

    expect(structure.navigation).toEqual([
      {
        locale: 'ru',
        placement: 'primary',
        items: [{ label: 'Счета', url: '/accounts', openInNewTab: false, children: [] }],
      },
    ])
    expect(structure.findings).toEqual([])
  })

  it('меню сайта перекрывает меню бренда того же размещения', () => {
    const structure = compose({
      navigations: [
        nav(),
        nav({ ownerId: 'site', items: [{ label: 'Главная', target: 'page', pageId: '1' }] }),
      ],
    })

    expect(structure.navigation[0]?.items[0]?.label).toBe('Главная')
  })

  /**
   * Снятие страницы с публикации — обычное редакторское действие, и оно не
   * должно останавливать выкатку всего сайта.
   */
  it('битая ссылка — предупреждение, а пункт исчезает', () => {
    const structure = compose({
      navigations: [nav({ items: [{ label: 'Битая', target: 'page', pageId: '99' }] })],
    })

    expect(structure.findings).toEqual([
      expect.objectContaining({ code: 'nav-dangling-page', severity: 'warning' }),
    ])
    expect(structure.navigation[0]?.items).toEqual([])
  })

  it('пункт без подписи блокирует релиз', () => {
    const structure = compose({
      navigations: [nav({ items: [{ label: '', target: 'page', pageId: '2' }] })],
    })

    expect(structure.findings).toContainEqual(
      expect.objectContaining({ code: 'nav-missing-label', severity: 'blocking' }),
    )
  })

  it('в находке видно язык и размещение', () => {
    const structure = compose({
      navigations: [nav({ items: [{ label: 'Битая', target: 'page', pageId: '99' }] })],
    })

    expect(structure.findings[0]?.location).toContain('ru/primary')
  })
})

describe('глобальные области в снапшоте', () => {
  it('область бренда доезжает до сайта', () => {
    const structure = compose({ globalAreas: [area()] })

    expect(structure.globalAreas).toEqual([
      expect.objectContaining({ locale: 'ru', kind: 'footer', blocks: [{ type: 'rich-text' }] }),
    ])
  })

  it('ссылка на секцию раскрывается прямо в области', () => {
    const structure = compose({
      sections: [
        {
          key: 'trust',
          locale: 'ru',
          ownerId: 'brand',
          isActive: true,
          blocks: [{ type: 'quote' }],
        },
      ],
      globalAreas: [area({ blocks: [{ type: 'section-ref', props: { key: 'trust' } }] })],
    })

    expect(structure.globalAreas[0]?.blocks).toEqual([{ type: 'quote' }])
    expect(structure.findings).toEqual([])
  })

  /** Подвал без блока с реквизитами выглядит целым — заметить пропажу негде. */
  it('ненайденная секция блокирует релиз', () => {
    const structure = compose({
      globalAreas: [area({ blocks: [{ type: 'section-ref', props: { key: 'нет' } }] })],
    })

    expect(structure.findings).toContainEqual(
      expect.objectContaining({ code: 'section-unknown-section', severity: 'blocking' }),
    )
  })

  it('отключённая область в снапшот не попадает', () => {
    const structure = compose({ globalAreas: [area({ isActive: false })] })

    expect(structure.globalAreas).toEqual([])
  })
})

describe('детерминированность', () => {
  /**
   * Снапшот участвует в отпечатке содержимого: порядок обхода не должен на
   * него влиять, иначе `ETag` меняется при неизменных данных.
   */
  it('порядок не зависит от порядка записей на входе', () => {
    const records = [
      nav({ placement: 'utility', locale: 'en' }),
      nav({ placement: 'footer' }),
      nav({ placement: 'primary' }),
    ]

    const forward = composeStructure({
      chainIds: CHAIN,
      locales: ['ru', 'en'],
      sections: [],
      navigations: records,
      globalAreas: [],
      pagePaths: PAGES,
    })

    const backward = composeStructure({
      chainIds: CHAIN,
      locales: ['en', 'ru'],
      sections: [],
      navigations: [...records].reverse(),
      globalAreas: [],
      pagePaths: PAGES,
    })

    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward))
  })
})
