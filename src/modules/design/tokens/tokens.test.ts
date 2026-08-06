import { describe, expect, it } from 'vitest'

import { collectContrastPairs, REQUIRED_CONTRAST_PAIRS } from './contrast-pairs'
import { cssVariableName, sanitizeCssValue, toCssCustomProperties, toTokenJson } from './export'
import { mergeTokenSets, resolveTokens } from './resolve'

import type { TokenSet } from './types'

function set(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    primitives: [
      { name: 'color.white', category: 'color', value: '#FFFFFF' },
      { name: 'color.ink', category: 'color', value: '#111111' },
      { name: 'color.gold.500', category: 'color', value: '#8A6D00' },
      { name: 'radius.md', category: 'radius', value: '8px' },
    ],
    roles: [
      { name: 'surface.base', group: 'surface', light: 'color.white', dark: 'color.ink' },
      { name: 'text.primary', group: 'text', light: 'color.ink', dark: 'color.white' },
    ],
    components: [
      { name: 'button.primary.bg', source: 'role', reference: 'surface.base' },
      { name: 'card.radius', source: 'primitive', reference: 'radius.md' },
    ],
    ...overrides,
  }
}

describe('разрешение графа', () => {
  it('роль получает значение примитива в каждой теме', () => {
    const resolved = resolveTokens(set())

    expect(resolved.rolesByTheme.light['surface.base']).toBe('#FFFFFF')
    expect(resolved.rolesByTheme.dark['surface.base']).toBe('#111111')
  })

  /**
   * Ради этого уровни и разделены: смена примитива меняет все роли, которые на
   * него ссылаются, а не одну.
   */
  it('смена примитива меняет все ссылающиеся роли', () => {
    const changed = resolveTokens(
      set({
        primitives: [
          { name: 'color.white', category: 'color', value: '#FAFAFA' },
          { name: 'color.ink', category: 'color', value: '#111111' },
          { name: 'color.gold.500', category: 'color', value: '#8A6D00' },
          { name: 'radius.md', category: 'radius', value: '8px' },
        ],
      }),
    )

    expect(changed.rolesByTheme.light['surface.base']).toBe('#FAFAFA')
    expect(changed.byTheme.light['button.primary.bg']).toBe('#FAFAFA')
  })

  it('токен компонента разрешается через роль', () => {
    const resolved = resolveTokens(set())

    expect(resolved.byTheme.light['button.primary.bg']).toBe('#FFFFFF')
    expect(resolved.byTheme.dark['button.primary.bg']).toBe('#111111')
  })

  it('токен компонента может ссылаться прямо на примитив', () => {
    const resolved = resolveTokens(set())

    expect(resolved.byTheme.light['card.radius']).toBe('8px')
    expect(resolved.byTheme.dark['card.radius']).toBe('8px')
  })

  /**
   * Битая ссылка — обычное состояние черновика: роль создана, примитив ещё
   * нет. Исключение здесь означало бы падение админки на полпути правки.
   */
  it('битая ссылка возвращается расхождением, а не исключением', () => {
    const resolved = resolveTokens(
      set({
        roles: [{ name: 'text.primary', group: 'text', light: 'нет.такого', dark: 'color.ink' }],
      }),
    )

    expect(resolved.issues.some((issue) => issue.code === 'unknown-primitive')).toBe(true)
    expect(resolved.rolesByTheme.light['text.primary']).toBeUndefined()
  })

  it('незаполненная тема — расхождение', () => {
    const resolved = resolveTokens(
      set({ roles: [{ name: 'text.primary', group: 'text', light: 'color.ink', dark: '' }] }),
    )

    expect(resolved.issues.some((issue) => issue.code === 'missing-theme')).toBe(true)
  })

  it('ссылка компонента на несуществующую роль — расхождение', () => {
    const resolved = resolveTokens(
      set({ components: [{ name: 'button.primary.bg', source: 'role', reference: 'нет.роли' }] }),
    )

    expect(resolved.issues.some((issue) => issue.code === 'unknown-role')).toBe(true)
  })

  /** Причина одна, и повторять её по разу на тему — утомлять читателя вдвое. */
  it('расхождение по ссылке объявляется один раз, а не по разу на тему', () => {
    const resolved = resolveTokens(
      set({ components: [{ name: 'button.primary.bg', source: 'role', reference: 'нет.роли' }] }),
    )

    expect(resolved.issues.filter((issue) => issue.name === 'button.primary.bg')).toHaveLength(1)
  })

  it('повтор имени внутри набора — расхождение, а не перекрытие', () => {
    const resolved = resolveTokens(
      set({
        primitives: [
          { name: 'color.white', category: 'color', value: '#FFFFFF' },
          { name: 'color.white', category: 'color', value: '#EEEEEE' },
        ],
      }),
    )

    expect(resolved.issues.some((issue) => issue.code === 'duplicate-name')).toBe(true)
  })

  it.each(['Color.White', 'color..white', 'color white', ''])(
    'недопустимое имя «%s» — расхождение',
    (name) => {
      const resolved = resolveTokens(
        set({ primitives: [{ name, category: 'color', value: '#FFFFFF' }] }),
      )

      expect(resolved.issues.some((issue) => issue.code === 'invalid-name')).toBe(true)
    },
  )

  it('здоровый набор не даёт расхождений', () => {
    expect(resolveTokens(set()).issues).toEqual([])
  })
})

describe('наследование наборов', () => {
  /**
   * Сайт, меняющий один акцент, не обязан переобъявлять всю палитру: иначе
   * копии немедленно разошлись бы.
   */
  it('ближний перекрывает дальнего по имени, остальное наследуется', () => {
    const brand = set()
    const site: TokenSet = {
      primitives: [{ name: 'color.white', category: 'color', value: '#FDFDFD' }],
      roles: [],
      components: [],
    }

    const merged = mergeTokenSets([brand, site])
    const resolved = resolveTokens(merged)

    expect(resolved.byTheme.light['color.white']).toBe('#FDFDFD')
    expect(resolved.byTheme.light['color.ink']).toBe('#111111')
    expect(resolved.byTheme.light['card.radius']).toBe('8px')
  })

  it('порядок значим: последний в списке выигрывает', () => {
    const first: TokenSet = {
      primitives: [{ name: 'color.a', category: 'color', value: '#111111' }],
      roles: [],
      components: [],
    }
    const second: TokenSet = {
      primitives: [{ name: 'color.a', category: 'color', value: '#222222' }],
      roles: [],
      components: [],
    }

    expect(mergeTokenSets([first, second]).primitives[0]?.value).toBe('#222222')
  })

  it('пустой список даёт пустой набор', () => {
    expect(mergeTokenSets([])).toEqual({ primitives: [], roles: [], components: [] })
  })
})

describe('пары контраста', () => {
  it('перечень непустой и покрывает основной текст', () => {
    expect(
      REQUIRED_CONTRAST_PAIRS.some(
        (pair) => pair.foreground === 'text.primary' && pair.background === 'surface.base',
      ),
    ).toBe(true)
  })

  /** Тёмная тема обычно и подводит: её собирают позже и внимания ей меньше. */
  it('пары собираются для обеих тем', () => {
    const pairs = collectContrastPairs(resolveTokens(set()))

    expect(pairs.some((pair) => pair.role.includes('light'))).toBe(true)
    expect(pairs.some((pair) => pair.role.includes('dark'))).toBe(true)
  })

  it('пары с необъявленными ролями пропускаются молча', () => {
    const pairs = collectContrastPairs(resolveTokens(set()))

    /** В наборе объявлены только surface.base и text.primary. */
    expect(pairs.every((pair) => pair.foreground !== '' && pair.background !== '')).toBe(true)
    expect(pairs.length).toBeLessThan(REQUIRED_CONTRAST_PAIRS.length * 2)
  })

  it('в описании пары видно, что именно чинить', () => {
    const pairs = collectContrastPairs(resolveTokens(set()))

    expect(pairs[0]?.role).toContain('text.primary')
    expect(pairs[0]?.role).toContain('surface.base')
  })
})

describe('экспорт', () => {
  it('имя токена превращается в переменную CSS', () => {
    expect(cssVariableName('button.primary.bg')).toBe('--bkc-button-primary-bg')
  })

  /**
   * Значение приходит от человека: точка с запятой в нём разорвала бы правило
   * и позволила дописать своё.
   */
  it('опасные символы в значении вырезаются', () => {
    expect(sanitizeCssValue('#fff; } body { display:none')).not.toContain(';')
    expect(sanitizeCssValue('#fff; } body { display:none')).not.toContain('}')
  })

  it('обе темы попадают в CSS', () => {
    const css = toCssCustomProperties(resolveTokens(set()))

    expect(css).toContain(':root {')
    expect(css).toContain('[data-theme="dark"]')
    expect(css).toContain('--bkc-surface-base: #FFFFFF;')
  })

  /**
   * Только медиазапроса недостаточно — переключатель темы перестал бы
   * работать; только атрибута — тёмная не включилась бы у того, кто выбрал её
   * в системе.
   */
  it('тёмная тема выводится и по атрибуту, и по системной настройке', () => {
    const css = toCssCustomProperties(resolveTokens(set()))

    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toContain(':root:not([data-theme="light"])')
  })

  it('JSON содержит обе темы и версию формата', () => {
    const json = toTokenJson(resolveTokens(set()))

    expect(json.schemaVersion).toBe('tokens-v1')
    expect(json.themes.light['surface.base']).toBe('#FFFFFF')
    expect(json.themes.dark['surface.base']).toBe('#111111')
  })

  /** Без сортировки один и тот же набор даёт разные байты, и ETag врёт. */
  it('порядок ключей устойчив', () => {
    const first = JSON.stringify(toTokenJson(resolveTokens(set())))
    const second = JSON.stringify(toTokenJson(resolveTokens(set())))

    expect(first).toBe(second)
    expect(Object.keys(toTokenJson(resolveTokens(set())).themes.light)).toEqual(
      [...Object.keys(toTokenJson(resolveTokens(set())).themes.light)].sort(),
    )
  })

  /** Веб и терминал обязаны показывать один и тот же цвет. */
  it('оба формата собираются из одного набора и не расходятся', () => {
    const resolved = resolveTokens(set())
    const css = toCssCustomProperties(resolved)
    const json = toTokenJson(resolved)

    expect(css).toContain(`--bkc-button-primary-bg: ${json.themes.light['button.primary.bg']};`)
  })
})
