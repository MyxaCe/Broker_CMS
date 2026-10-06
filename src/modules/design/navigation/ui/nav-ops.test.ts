import { describe, expect, it } from 'vitest'

import { validateNavTree } from '../tree'

import {
  canDropNav,
  createNavItem,
  getNavItem,
  insertNavItem,
  moveNavItem,
  moveNavItemTo,
  navHeight,
  removeNavItem,
  setNavField,
  toNavList,
} from './nav-ops'

import type { EditorNavItem } from './nav-ops'

function link(label: string, pageId: string): EditorNavItem {
  return { label, target: 'page', pageId, children: [] }
}

function group(label: string, children: EditorNavItem[]): EditorNavItem {
  return { label, target: 'none', children }
}

const TREE: EditorNavItem[] = [
  link('Главная', '1'),
  group('О компании', [link('История', '2'), link('Лицензии', '3')]),
]

describe('чтение поля', () => {
  it('мусор не роняет редактор и не попадает в список', () => {
    expect(toNavList(null)).toEqual([])
    expect(toNavList('строка')).toEqual([])
    expect(toNavList([null, 42, 'строка'])).toEqual([])
  })

  it('неизвестное назначение приводится к «странице», а не к пустому', () => {
    /**
     * Пустое назначение не проходит проверку дерева, и редактор увидел бы
     * отказ, ничего не сделав. Приведение к самому частому значению здесь
     * безопасно: ссылка без страницы всё равно не сохранится.
     */
    expect(toNavList([{ label: 'X', target: 'выдумка' }])[0]?.target).toBe('page')
  })

  it('поля, которых редактор не показывает, переживают чтение', () => {
    const read = toNavList([{ label: 'X', target: 'page', pageId: '1', jurisdictions: ['uk-fca'] }])

    expect(read[0]?.jurisdictions).toEqual(['uk-fca'])
  })

  it('вложенность читается рекурсивно', () => {
    const read = toNavList([
      { label: 'A', target: 'none', children: [{ label: 'B', target: 'page' }] },
    ])

    expect(read[0]?.children).toHaveLength(1)
  })
})

describe('правка пункта', () => {
  it('меняет одно поле и не трогает соседей', () => {
    const next = setNavField(TREE, [1, 0], 'label', 'Наша история')

    expect(getNavItem(next, [1, 0])?.label).toBe('Наша история')
    expect(getNavItem(next, [1, 1])?.label).toBe('Лицензии')
  })

  it('не меняет исходное дерево', () => {
    setNavField(TREE, [0], 'label', 'Другое')

    expect(TREE[0]?.label).toBe('Главная')
  })

  it('поля, которых редактор не показывает, переживают правку', () => {
    const tree: EditorNavItem[] = [{ ...link('X', '1'), jurisdictions: ['uk-fca'] }]
    const next = setNavField(tree, [0], 'label', 'Y')

    expect(next[0]?.jurisdictions).toEqual(['uk-fca'])
  })
})

describe('добавление и удаление', () => {
  it('новый пункт — страница без выбранной страницы: сохранить его нельзя', () => {
    /**
     * Умолчание названо: пустой пункт обязан не проходить проверку. Пункт,
     * который сохраняется пустым, попадает в меню пустым местом.
     */
    const item = createNavItem()
    const issues = validateNavTree([item], { knownPages: new Set() })

    expect(issues.map((issue) => issue.code).sort()).toEqual(['missing-label', 'missing-page'])
  })

  it('добавляется в подраздел по адресу', () => {
    const next = insertNavItem(TREE, [1], 0, link('Новый', '9'))

    expect(getNavItem(next, [1, 0])?.label).toBe('Новый')
    expect(next[1]?.children).toHaveLength(3)
  })

  it('позиция вне списка означает «в конец», а не промах', () => {
    expect(insertNavItem(TREE, [], 99, link('Хвост', '9'))).toHaveLength(3)
  })

  it('удаление забирает пункт вместе с подразделом', () => {
    const next = removeNavItem(TREE, [1])

    expect(next).toHaveLength(1)
  })
})

describe('сдвиг на шаг', () => {
  it('двигает внутри подраздела', () => {
    const next = moveNavItem(TREE, [1, 0], 1)

    expect(next[1]?.children?.map((item) => item.label)).toEqual(['Лицензии', 'История'])
  })

  it('упор в границу ничего не меняет', () => {
    expect(moveNavItem(TREE, [0], -1)).toEqual(TREE)
    expect(moveNavItem(TREE, [1, 1], 1)).toEqual(TREE)
  })
})

describe('перенос мышью', () => {
  it('переносит пункт верхнего уровня в подраздел', () => {
    const next = moveNavItemTo(TREE, [0], [1], 0)

    expect(next).toHaveLength(1)
    expect(next[0]?.children?.map((item) => item.label)).toEqual(['Главная', 'История', 'Лицензии'])
  })

  it('адрес назначения поправляется после изъятия', () => {
    /**
     * Та же ошибка, что у блоков: вынули первый — второй стал первым, и
     * прежний адрес `[1]` указывает в пустоту. Пункт исчезал бы целиком,
     * а дерево оставалось бы правильным деревом.
     */
    const next = moveNavItemTo(TREE, [0], [1], 0)

    expect(getNavItem(next, [0, 0])?.label).toBe('Главная')
  })

  it('перенос снизу вверх адреса не сдвигает', () => {
    const tree: EditorNavItem[] = [group('Раздел', []), link('Хвост', '9')]
    const next = moveNavItemTo(tree, [1], [0], 0)

    expect(next).toHaveLength(1)
    expect(next[0]?.children?.map((item) => item.label)).toEqual(['Хвост'])
  })

  it('перенос вниз внутри своего списка не съезжает на единицу', () => {
    const list: EditorNavItem[] = [link('а', '1'), link('б', '2'), link('в', '3')]

    expect(moveNavItemTo(list, [0], [], 2).map((item) => item.label)).toEqual(['б', 'а', 'в'])
  })

  it('выносит пункт из подраздела на верхний уровень', () => {
    const next = moveNavItemTo(TREE, [1, 0], [], 0)

    expect(next.map((item) => item.label)).toEqual(['История', 'Главная', 'О компании'])
    expect(next[2]?.children).toHaveLength(1)
  })
})

describe('запреты переноса', () => {
  it('пункт нельзя вложить в самого себя', () => {
    const verdict = canDropNav(TREE, [1], [1])

    expect(verdict.kind).toBe('refuse')
    expect(moveNavItemTo(TREE, [1], [1], 0)).toEqual(TREE)
  })

  it('и в свой подраздел — тоже', () => {
    expect(canDropNav(TREE, [1], [1, 0]).kind).toBe('refuse')
  })

  it('перенос, делающий дерево глубже предела, отклоняется', () => {
    /**
     * Считается высота **ветки**, а не одного пункта: раздел с подпунктами
     * занимает два уровня, и проверка по пункту пропустила бы ровно тот
     * случай, ради которого предел существует.
     */
    const tree: EditorNavItem[] = [
      group('Ветка', [link('внутри', '1')]),
      group('Цель', [group('Глубже', [])]),
    ]

    expect(canDropNav(tree, [0], [1, 0]).kind).toBe('refuse')
  })

  it('перенос в пределах глубины разрешён', () => {
    const tree: EditorNavItem[] = [link('лист', '1'), group('Цель', [group('Глубже', [])])]

    expect(canDropNav(tree, [0], [1, 0]).kind).toBe('allow')
  })

  it('высота ветки считается по самому глубокому потомку', () => {
    expect(navHeight(link('а', '1'))).toBe(1)
    expect(navHeight(group('а', [link('б', '1')]))).toBe(2)
    expect(navHeight(group('а', [group('б', [link('в', '1')])]))).toBe(3)
  })

  it('предел тот же, что у проверки дерева', () => {
    /**
     * Тест-растяжка: редактор, разрешающий то, что проверка запрещает,
     * сохраняет меню, которое не сохранится. Пределы обязаны совпадать, и
     * сравнивается это против **той же** функции, а не против числа.
     */
    const tooDeep: EditorNavItem[] = [group('1', [group('2', [group('3', [link('4', '1')])])])]

    expect(
      validateNavTree(tooDeep, { knownPages: new Set() }).some((i) => i.code === 'too-deep'),
    ).toBe(true)
    expect(canDropNav([link('лист', '1'), ...tooDeep], [0], [1, 0, 0]).kind).toBe('refuse')
  })
})
