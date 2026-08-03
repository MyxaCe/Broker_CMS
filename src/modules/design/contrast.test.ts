import { describe, expect, it } from 'vitest'

import {
  AA_LARGE_TEXT,
  AA_NORMAL_TEXT,
  ColorParseError,
  contrastRatio,
  meetsAA,
  parseColor,
  relativeLuminance,
  requiredRatio,
} from './contrast'

describe('parseColor', () => {
  it('разбирает шестизначный вид', () => {
    expect(parseColor('#1b6172')).toEqual({ r: 0x1b, g: 0x61, b: 0x72 })
  })

  it('разбирает трёхзначный вид', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('решётка необязательна, регистр не важен', () => {
    expect(parseColor('AABBCC')).toEqual(parseColor('#aabbcc'))
  })

  it.each(['', '#', '#12', '#12345', 'rgb(0,0,0)', '#gggggg', 'синий'])(
    'отвергает недопустимое значение "%s"',
    (value) => {
      expect(() => parseColor(value)).toThrow(ColorParseError)
    },
  )
})

describe('relativeLuminance — эталонные значения WCAG', () => {
  it('чёрный', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
  })

  it('белый', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })
})

describe('contrastRatio — эталонные пары', () => {
  it('чёрный на белом даёт максимум 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2)
  })

  it('одинаковые цвета дают 1:1', () => {
    expect(contrastRatio('#1b6172', '#1b6172')).toBeCloseTo(1, 5)
  })

  it('порядок цветов не важен', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#000000'), 10)
  })

  /**
   * Классические граничные пары из практики WCAG: #767676 на белом едва
   * проходит AA, #777777 — уже нет. Именно на них ловятся ошибки в формуле:
   * приблизительный расчёт разницы между ними не видит.
   */
  it('#767676 на белом — на грани и проходит', () => {
    const ratio = contrastRatio('#767676', '#ffffff')

    expect(ratio).toBeGreaterThanOrEqual(4.5)
    expect(ratio).toBeLessThan(4.6)
    expect(meetsAA(ratio, 'text')).toBe(true)
  })

  it('#777777 на белом — на грани и НЕ проходит', () => {
    const ratio = contrastRatio('#777777', '#ffffff')

    expect(ratio).toBeLessThan(4.5)
    expect(meetsAA(ratio, 'text')).toBe(false)
  })
})

describe('meetsAA — пороги', () => {
  it('пороги соответствуют стандарту', () => {
    expect(requiredRatio('text')).toBe(AA_NORMAL_TEXT)
    expect(requiredRatio('large-text')).toBe(AA_LARGE_TEXT)
    expect(requiredRatio('non-text')).toBe(3)
  })

  it('крупный текст проходит там, где обычный не проходит', () => {
    const ratio = contrastRatio('#949494', '#ffffff')

    expect(meetsAA(ratio, 'text')).toBe(false)
    expect(meetsAA(ratio, 'large-text')).toBe(true)
  })

  it('ровно пороговое значение проходит', () => {
    expect(meetsAA(4.5, 'text')).toBe(true)
    expect(meetsAA(3, 'large-text')).toBe(true)
  })

  it('чуть ниже порога не проходит', () => {
    expect(meetsAA(4.49, 'text')).toBe(false)
  })
})
