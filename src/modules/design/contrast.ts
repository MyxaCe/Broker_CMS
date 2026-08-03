/**
 * Проверка контраста цветовых ролей по WCAG 2.1 (ТЗ 2.1).
 *
 * Требование ТЗ жёсткое: контраст ниже AA отклоняет сборку релиза. Поэтому
 * расчёт здесь — не приблизительный «на глаз», а формула стандарта, и она
 * покрыта тестами на эталонных значениях.
 */

export class ColorParseError extends Error {
  constructor(value: string) {
    super(`Не удалось разобрать цвет: "${value}". Ожидается #RGB или #RRGGBB.`)
    this.name = 'ColorParseError'
  }
}

/** Пороги AA: обычный текст, крупный текст и нетекстовые элементы. */
export const AA_NORMAL_TEXT = 4.5
export const AA_LARGE_TEXT = 3
export const AA_NON_TEXT = 3

interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

export function parseColor(value: string): Rgb {
  const hex = value.trim().replace(/^#/, '')

  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
    throw new ColorParseError(value)
  }

  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

/**
 * Линеаризация канала sRGB.
 *
 * Порог и показатель степени взяты из стандарта, а не подобраны: значения
 * 0.03928 и 2.4 определены в WCAG 2.1. Округлять их «для простоты» нельзя —
 * граничные пары начнут проходить или не проходить произвольно.
 */
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(color: string): number {
  const { r, g, b } = parseColor(color)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)

  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)

  return (lighter + 0.05) / (darker + 0.05)
}

export type ContrastUsage = 'text' | 'large-text' | 'non-text'

export function requiredRatio(usage: ContrastUsage): number {
  switch (usage) {
    case 'text':
      return AA_NORMAL_TEXT
    case 'large-text':
      return AA_LARGE_TEXT
    case 'non-text':
      return AA_NON_TEXT
  }
}

/**
 * Проходит ли пара порог AA.
 *
 * Сравнение с округлением до сотых — так же, как это делают инструменты
 * проверки доступности. Без округления пара с отношением 4.4999 из-за
 * представления чисел с плавающей точкой отклонялась бы, хотя по стандарту
 * она на границе.
 */
export function meetsAA(ratio: number, usage: ContrastUsage): boolean {
  return Math.round(ratio * 100) / 100 >= requiredRatio(usage)
}
