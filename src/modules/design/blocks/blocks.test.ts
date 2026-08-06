import { describe, expect, it } from 'vitest'

import { BLOCK_REGISTRY, findBlock, isAllowedSlot, isAllowedVariant } from './registry'
import { DEFAULT_BLOCK_STYLE, validateBlockStyle } from './style'
import { MAX_BLOCK_DEPTH, validateBlockTree } from './validate-tree'

const ROLES = new Set(['surface.base', 'surface.raised', 'accent.default'])

function block(overrides: Record<string, unknown> = {}) {
  return { type: 'heading-text', style: { ...DEFAULT_BLOCK_STYLE }, ...overrides }
}

describe('реестр блоков', () => {
  it('содержит стартовую библиотеку из ТЗ', () => {
    expect(BLOCK_REGISTRY.length).toBeGreaterThan(30)
    expect(findBlock('hero')).toBeDefined()
    expect(findBlock('news-feed')).toBeDefined()
  })

  it('имена типов уникальны', () => {
    const types = BLOCK_REGISTRY.map((definition) => definition.type)

    expect(new Set(types).size).toBe(types.length)
  })

  /** Блок «лента новостей» описывает запрос, а не копирует контент. */
  it('динамические блоки привязаны к коллекциям', () => {
    expect(findBlock('news-feed')?.boundTo).toBe('articles')
    expect(findBlock('broadcast-grid')?.boundTo).toBe('videos')
  })

  it('вложенность разрешена только там, где объявлена', () => {
    expect(isAllowedSlot('columns', 'columns')).toBe(true)
    expect(isAllowedSlot('heading-text', 'columns')).toBe(false)
  })

  it('вариант проверяется по типу', () => {
    expect(isAllowedVariant('hero', 'split')).toBe(true)
    expect(isAllowedVariant('hero', 'выдумка')).toBe(false)
    expect(isAllowedVariant('нет-такого', 'split')).toBe(false)
  })

  /** У большинства типов вариант один, и задавать его незачем. */
  it('отсутствие варианта допустимо всегда', () => {
    expect(isAllowedVariant('hero', null)).toBe(true)
    expect(isAllowedVariant('heading-text', undefined)).toBe(true)
  })

  /** Произвольная разметка на витрине брокера — не для редактора. */
  it('произвольный код помечен как ограниченный', () => {
    expect(findBlock('raw-embed')?.restricted).toBe(true)
  })
})

describe('стиль блока', () => {
  it('умолчания проходят проверку', () => {
    expect(validateBlockStyle(DEFAULT_BLOCK_STYLE, ROLES)).toEqual([])
  })

  it.each([
    ['paddingY', 'огромный'],
    ['width', 'резиновая'],
    ['theme', 'сепия'],
    ['align', 'по-центру'],
  ])('значение вне перечня отвергается: %s', (field, value) => {
    const issues = validateBlockStyle({ [field]: value } as never, ROLES)

    expect(issues[0]?.code).toBe('invalid-enum')
  })

  it('фон принимает существующую семантическую роль', () => {
    expect(validateBlockStyle({ background: 'surface.raised' }, ROLES)).toEqual([])
  })

  /** Ссылка на несуществующую роль означает блок без фона, и увидит это читатель. */
  it('фон с несуществующей ролью отвергается', () => {
    const issues = validateBlockStyle({ background: 'нет.такой.роли' }, ROLES)

    expect(issues[0]?.code).toBe('unknown-role')
  })

  /**
   * Иначе одно упущение в токенах порождало бы ошибку в каждом блоке страницы,
   * и настоящая причина утонула бы в списке.
   */
  it('при пустом наборе ролей фон не проверяется', () => {
    expect(validateBlockStyle({ background: 'что.угодно' }, new Set())).toEqual([])
  })

  it('пустой фон допустим', () => {
    expect(validateBlockStyle({ background: null }, ROLES)).toEqual([])
  })
})

describe('дерево блоков', () => {
  const context = { roles: ROLES }

  it('здоровое дерево не даёт расхождений', () => {
    expect(validateBlockTree([block(), block({ type: 'quote' })], context)).toEqual([])
  })

  it('неизвестный тип отвергается', () => {
    const issues = validateBlockTree([block({ type: 'выдумка' })], context)

    expect(issues[0]?.code).toBe('unknown-type')
  })

  it('путь в расхождении указывает на конкретный блок', () => {
    const issues = validateBlockTree([block(), block({ type: 'выдумка' })], context)

    expect(issues[0]?.path).toBe('blocks[1]')
  })

  it('недопустимый вариант отвергается', () => {
    const issues = validateBlockTree([block({ type: 'hero', variant: 'выдумка' })], context)

    expect(issues.some((issue) => issue.code === 'unknown-variant')).toBe(true)
  })

  it('вложенность в разрешённый слот проходит', () => {
    const tree = [{ type: 'columns', variant: 'two', slots: { columns: [block()] } }]

    expect(validateBlockTree(tree, context)).toEqual([])
  })

  it('вложенность в неразрешённый слот отвергается', () => {
    const tree = [{ type: 'quote', slots: { columns: [block()] } }]
    const issues = validateBlockTree(tree, context)

    expect(issues[0]?.code).toBe('unknown-slot')
  })

  /** Глубже — это уже не вёрстка, а структура, которую нельзя удержать в голове. */
  it('чрезмерная вложенность отвергается', () => {
    let tree: unknown = [block()]

    for (let level = 0; level < MAX_BLOCK_DEPTH + 1; level += 1) {
      tree = [{ type: 'columns', slots: { columns: tree } }]
    }

    expect(validateBlockTree(tree, context).some((issue) => issue.code === 'too-deep')).toBe(true)
  })

  it('вложенный блок проверяется так же, как верхний', () => {
    const tree = [{ type: 'columns', slots: { columns: [block({ type: 'выдумка' })] } }]
    const issues = validateBlockTree(tree, context)

    expect(issues[0]?.code).toBe('unknown-type')
    expect(issues[0]?.path).toContain('slots.columns')
  })

  it('собираются все расхождения, а не первое', () => {
    const issues = validateBlockTree(
      [block({ type: 'выдумка' }), block({ type: 'ещё-выдумка' })],
      context,
    )

    expect(issues).toHaveLength(2)
  })

  describe('источник данных', () => {
    it('привязанный блок без источника отвергается', () => {
      const issues = validateBlockTree([{ type: 'news-feed' }], context)

      expect(issues[0]?.code).toBe('missing-data-source')
    })

    it('привязанный блок с источником проходит', () => {
      const tree = [{ type: 'news-feed', dataSource: { collection: 'articles', limit: 6 } }]

      expect(validateBlockTree(tree, context)).toEqual([])
    })

    it('источник у непривязанного блока отвергается', () => {
      const issues = validateBlockTree([block({ dataSource: { collection: 'articles' } })], context)

      expect(issues[0]?.code).toBe('not-data-bound')
    })

    /** Блок, умеющий запросить любую коллекцию, — способ показать что угодно. */
    it('источник на чужую коллекцию отвергается', () => {
      const tree = [{ type: 'news-feed', dataSource: { collection: 'users' } }]
      const issues = validateBlockTree(tree, context)

      expect(issues.some((issue) => issue.code === 'not-data-bound')).toBe(true)
    })
  })

  describe('ограниченные блоки', () => {
    it('произвольный код отвергается без полномочий', () => {
      const issues = validateBlockTree([{ type: 'raw-embed' }], context)

      expect(issues[0]?.code).toBe('restricted-block')
    })

    it('с полномочиями проходит', () => {
      const issues = validateBlockTree([{ type: 'raw-embed' }], {
        ...context,
        allowRestricted: true,
      })

      expect(issues).toEqual([])
    })
  })

  describe('испорченный вход', () => {
    /** Дерево приходит из поля JSON и может содержать что угодно. */
    it.each([
      ['строка вместо списка', 'не список'],
      ['число вместо списка', 42],
    ])('%s даёт расхождение, а не исключение', (_name, value) => {
      expect(() => validateBlockTree(value, context)).not.toThrow()
      expect(validateBlockTree(value, context)[0]?.code).toBe('malformed')
    })

    it('пустое дерево допустимо', () => {
      expect(validateBlockTree([], context)).toEqual([])
      expect(validateBlockTree(null, context)).toEqual([])
    })

    it('циклическая ссылка не зацикливает обход', () => {
      const node: Record<string, unknown> = { type: 'columns' }
      node.slots = { columns: [node] }

      expect(() => validateBlockTree([node], context)).not.toThrow()
    })
  })
})
