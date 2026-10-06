import { describe, expect, it } from 'vitest'

import { applyDraft, buildPalettePreview } from './preview'

import type { TokenDraft } from './preview'
import type { TokenSet } from './types'

/**
 * Живой предпросмотр палитры (ТЗ 2.1, [[DEBT-011]]).
 *
 * Набор подобран так, чтобы его было чем сломать: правка одного примитива
 * обязана доехать до роли и до токена компонента, а контраст обязан и
 * проходить, и не проходить — иначе проверка зелёная при любой формуле.
 */

function set(): TokenSet {
  return {
    primitives: [
      { name: 'color.white', category: 'color', value: '#FFFFFF' },
      { name: 'color.ink', category: 'color', value: '#111111' },
      { name: 'color.gold', category: 'color', value: '#8A6D1F' },
      { name: 'radius.md', category: 'radius', value: '8px' },
    ],
    roles: [
      { name: 'surface.base', group: 'surface', light: 'color.white', dark: 'color.ink' },
      { name: 'text.primary', group: 'text', light: 'color.ink', dark: 'color.white' },
      { name: 'accent.default', group: 'accent', light: 'color.gold', dark: 'color.gold' },
      { name: 'text.inverse', group: 'text', light: 'color.white', dark: 'color.white' },
      /** Нетекстовые пары: у них порог ниже, и без них проверка порогов слепа. */
      { name: 'border.default', group: 'border', light: 'color.ink', dark: 'color.white' },
      { name: 'market.up', group: 'market', light: 'color.ink', dark: 'color.white' },
    ],
    components: [
      { name: 'button.primary.bg', source: 'role', reference: 'accent.default' },
      { name: 'card.radius', source: 'primitive', reference: 'radius.md' },
    ],
  }
}

const EDIT_GOLD: TokenDraft = {
  level: 'primitive',
  value: { name: 'color.gold', category: 'color', value: '#C9A227' },
}

describe('правка подставляется в набор как значение ближнего узла', () => {
  it('перекрывает сохранённое по имени', () => {
    const next = applyDraft(set(), EDIT_GOLD)

    expect(next.primitives.find((item) => item.name === 'color.gold')?.value).toBe('#C9A227')
    expect(next.primitives).toHaveLength(4)
  })

  it('новое имя добавляется, а не теряется', () => {
    const next = applyDraft(set(), {
      level: 'primitive',
      value: { name: 'color.sky', category: 'color', value: '#0088CC' },
    })

    expect(next.primitives).toHaveLength(5)
  })

  it('без правки набор тот же', () => {
    expect(applyDraft(set(), null)).toEqual(set())
  })
})

describe('что именно задевает правка', () => {
  it('правка примитива доезжает до роли и до токена компонента', () => {
    const preview = buildPalettePreview({ saved: set(), draft: EDIT_GOLD })

    const names = preview.swatches.filter((swatch) => swatch.changed).map((swatch) => swatch.name)

    expect(names).toEqual(['accent.default', 'button.primary.bg', 'color.gold'])
    expect(preview.affected).toBe(3)
  })

  it('это и есть смысл трёх уровней: один примитив — три токена', () => {
    /**
     * Тест-растяжка. Если кто-то разрешит компоненту ссылаться на примитив
     * напрямую в обход роли, число перестанет сходиться — и станет видно,
     * что смена акцента больше не меняет кнопки разом.
     */
    const preview = buildPalettePreview({ saved: set(), draft: EDIT_GOLD })

    expect(preview.affected).toBeGreaterThan(1)
  })

  it('правка, ничего не меняющая, не задевает ничего', () => {
    const preview = buildPalettePreview({
      saved: set(),
      draft: {
        level: 'primitive',
        value: { name: 'color.gold', category: 'color', value: '#8A6D1F' },
      },
    })

    expect(preview.affected).toBe(0)
  })

  it('правимый токен помечен отдельно от задетых', () => {
    const preview = buildPalettePreview({ saved: set(), draft: EDIT_GOLD })

    expect(preview.swatches.filter((swatch) => swatch.edited).map((item) => item.name)).toEqual([
      'color.gold',
    ])
  })
})

describe('состав палитры', () => {
  it('нецветовой примитив в образцы не попадает', () => {
    const preview = buildPalettePreview({ saved: set(), draft: null })

    expect(preview.swatches.map((swatch) => swatch.name)).not.toContain('radius.md')
  })

  it('нецветовой токен компонента — тоже', () => {
    const preview = buildPalettePreview({ saved: set(), draft: null })

    expect(preview.swatches.map((swatch) => swatch.name)).not.toContain('card.radius')
  })

  it('роли показываются обе темы', () => {
    const preview = buildPalettePreview({ saved: set(), draft: null })
    const surface = preview.swatches.find((swatch) => swatch.name === 'surface.base')

    expect(surface?.light).toBe('#FFFFFF')
    expect(surface?.dark).toBe('#111111')
  })
})

describe('контраст считается до сохранения', () => {
  it('исправная палитра пар не ломает', () => {
    const preview = buildPalettePreview({ saved: set(), draft: null })

    expect(preview.broken).toEqual([])
    expect(preview.contrast.length).toBeGreaterThan(0)
  })

  it('правка, уронившая пару ниже AA, видна до сохранения', () => {
    /** Жёлтый по белому: обычное «чуть светлее», которое проходит на глаз. */
    const preview = buildPalettePreview({
      saved: set(),
      draft: {
        level: 'primitive',
        value: { name: 'color.gold', category: 'color', value: '#F3D77A' },
      },
    })

    const names = preview.broken.map((row) => row.label)

    expect(names.some((label) => label.includes('text.inverse на accent.default'))).toBe(true)
  })

  it('пара, не проходившая и до правки, в сломанные не попадает', () => {
    /**
     * Иначе список бесполезен ровно там, где палитру чинят: правка одной
     * роли подсветила бы все давние нарушения как свои.
     */
    const broken: TokenSet = {
      ...set(),
      primitives: set().primitives.map((item) =>
        item.name === 'color.gold' ? { ...item, value: '#F3D77A' } : item,
      ),
    }

    const preview = buildPalettePreview({
      saved: broken,
      draft: {
        level: 'primitive',
        value: { name: 'color.ink', category: 'color', value: '#000000' },
      },
    })

    expect(preview.broken).toEqual([])
    expect(preview.contrast.some((row) => !row.passes)).toBe(true)
  })

  it('у каждой пары назван требуемый порог, а не только вердикт', () => {
    const preview = buildPalettePreview({ saved: set(), draft: null })

    expect(preview.contrast.every((row) => row.required > 0)).toBe(true)
    expect(preview.contrast.some((row) => row.usage === 'non-text')).toBe(true)
  })

  it('обе темы проверяются, а не только светлая', () => {
    const preview = buildPalettePreview({ saved: set(), draft: null })

    expect(preview.contrast.some((row) => row.label.includes('(light'))).toBe(true)
    expect(preview.contrast.some((row) => row.label.includes('(dark'))).toBe(true)
  })
})

describe('расхождения графа видны в предпросмотре', () => {
  it('ссылка на несуществующий примитив названа', () => {
    const preview = buildPalettePreview({
      saved: set(),
      draft: {
        level: 'role',
        value: { name: 'accent.default', group: 'accent', light: 'color.нет', dark: 'color.gold' },
      },
    })

    expect(preview.issues.some((issue) => issue.code === 'unknown-primitive')).toBe(true)
  })

  it('битая ссылка не роняет предпросмотр', () => {
    expect(() =>
      buildPalettePreview({
        saved: set(),
        draft: {
          level: 'component',
          value: { name: 'button.primary.bg', source: 'role', reference: 'нет.такой' },
        },
      }),
    ).not.toThrow()
  })
})
