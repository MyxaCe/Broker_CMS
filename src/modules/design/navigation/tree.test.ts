import { describe, expect, it } from 'vitest'

import { MAX_NAV_DEPTH, resolveNavTree, validateNavTree } from './tree'

import type { NavContext } from './tree'

const context: NavContext = { knownPages: new Set(['10', '11', '12']) }

function codes(nodes: unknown, ctx: NavContext = context): string[] {
  return validateNavTree(nodes, ctx).map((issue) => issue.code)
}

describe('дерево навигации', () => {
  it('правильное меню не даёт замечаний', () => {
    const nav = [
      { label: 'Главная', target: 'page', pageId: '10' },
      {
        label: 'Торговля',
        target: 'none',
        children: [
          { label: 'Счета', target: 'page', pageId: '11' },
          { label: 'Условия', target: 'page', pageId: '12' },
        ],
      },
      { label: 'Кабинет', target: 'external', href: 'https://my.example.com', openInNewTab: true },
    ]

    expect(validateNavTree(nav, context)).toEqual([])
  })

  it('пункт без подписи виден как расхождение, а не как пустое место в меню', () => {
    expect(codes([{ label: '   ', target: 'page', pageId: '10' }])).toContain('missing-label')
  })

  it('неизвестное назначение отклоняется', () => {
    expect(codes([{ label: 'Что-то', target: 'anchor' }])).toContain('unknown-target')
  })
})

describe('ссылка на страницу, а не адрес строкой', () => {
  /**
   * Ради этого навигация и хранит ссылку: удалённая страница ломает меню
   * заметно. Массив адресов молча вёл бы в 404.
   */
  it('ссылка на несуществующую страницу — расхождение', () => {
    expect(codes([{ label: 'Битая', target: 'page', pageId: '99' }])).toContain('dangling-page')
  })

  it('пункт «страница» без выбранной страницы — расхождение', () => {
    expect(codes([{ label: 'Пусто', target: 'page' }])).toContain('missing-page')
  })

  /** Числовые идентификаторы Postgres не должны считаться другими, чем строки. */
  it('числовой идентификатор страницы сравнивается со строковым', () => {
    expect(codes([{ label: 'Главная', target: 'page', pageId: 10 }])).toEqual([])
  })

  /**
   * Пустой набор известных страниц означает «список не загружен», а не «страниц
   * нет»: иначе проверка в отрыве от базы объявила бы битым всё меню сразу.
   */
  it('без списка страниц ссылки не объявляются битыми', () => {
    const issues = codes([{ label: 'Главная', target: 'page', pageId: '77' }], {
      knownPages: new Set(),
    })

    expect(issues).not.toContain('dangling-page')
  })
})

describe('внешние ссылки', () => {
  it('адрес не по https отклоняется', () => {
    expect(codes([{ label: 'Партнёр', target: 'external', href: 'http://example.com' }])).toContain(
      'insecure-href',
    )
  })

  it('внешний пункт без адреса отклоняется', () => {
    expect(codes([{ label: 'Партнёр', target: 'external', href: '  ' }])).toContain('missing-href')
  })
})

describe('форма дерева', () => {
  it('заголовок раздела без вложенных пунктов отклоняется', () => {
    expect(codes([{ label: 'Раздел', target: 'none', children: [] }])).toContain('empty-group')
  })

  it(`вложенность глубже ${MAX_NAV_DEPTH} уровней отклоняется`, () => {
    let node: Record<string, unknown> = { label: 'Лист', target: 'page', pageId: '10' }

    for (let level = 0; level < MAX_NAV_DEPTH; level += 1) {
      node = { label: `Уровень ${level}`, target: 'none', children: [node] }
    }

    expect(codes([node])).toContain('too-deep')
  })

  it('не бросает на мусоре вместо дерева', () => {
    expect(() => validateNavTree('меню', context)).not.toThrow()
    expect(codes('меню')).toContain('malformed')
    expect(codes([42])).toContain('malformed')
  })

  it('цикл не зацикливает обход', () => {
    const node: Record<string, unknown> = { label: 'Раздел', target: 'none' }
    node.children = [node]

    expect(codes([node])).toContain('cycle')
  })

  it('собирает все расхождения, а не первое', () => {
    const issues = codes([
      { label: '', target: 'page' },
      { label: 'Партнёр', target: 'external', href: 'http://x.test' },
    ])

    expect(issues).toEqual(
      expect.arrayContaining(['missing-label', 'missing-page', 'insecure-href']),
    )
  })
})

describe('разворачивание для выдачи', () => {
  const paths = new Map([
    ['10', '/'],
    ['11', '/accounts'],
  ])

  it('ссылка на страницу превращается в адрес', () => {
    const resolved = resolveNavTree([{ label: 'Счета', target: 'page', pageId: '11' }], paths)

    expect(resolved).toEqual([
      { label: 'Счета', url: '/accounts', openInNewTab: false, children: [] },
    ])
  })

  /** Пустая ссылка в меню — тупик; отсутствующий пункт честнее. */
  it('пункт с недоступной страницей исключается', () => {
    expect(resolveNavTree([{ label: 'Битая', target: 'page', pageId: '99' }], paths)).toEqual([])
  })

  it('заголовок раздела остаётся без адреса, но с потомками', () => {
    const resolved = resolveNavTree(
      [
        {
          label: 'Торговля',
          target: 'none',
          children: [{ label: 'Счета', target: 'page', pageId: '11' }],
        },
      ],
      paths,
    )

    expect(resolved).toEqual([
      {
        label: 'Торговля',
        url: null,
        openInNewTab: false,
        children: [{ label: 'Счета', url: '/accounts', openInNewTab: false, children: [] }],
      },
    ])
  })

  /** Раздел, у которого все потомки отвалились, показывать нечем. */
  it('заголовок раздела без уцелевших потомков исчезает', () => {
    const resolved = resolveNavTree(
      [
        {
          label: 'Торговля',
          target: 'none',
          children: [{ label: 'Битая', target: 'page', pageId: '99' }],
        },
      ],
      paths,
    )

    expect(resolved).toEqual([])
  })

  it('мусор не роняет разворачивание', () => {
    expect(resolveNavTree(null, paths)).toEqual([])
    expect(resolveNavTree([null, 'строка', {}], paths)).toEqual([])
  })
})
