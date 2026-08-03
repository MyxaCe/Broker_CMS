import { describe, expect, it } from 'vitest'

import { DEFAULT_FORBIDDEN_PHRASES, findForbiddenPhrases } from './forbidden-claims'

/**
 * Невидимые разделители задаются кодами: символ, вставленный в исходник
 * буквально, невозможно ни увидеть на ревью, ни отличить от обычного пробела.
 */
const NBSP = String.fromCharCode(0x00a0)
const NARROW_NBSP = String.fromCharCode(0x202f)
const ZERO_WIDTH = String.fromCharCode(0x200b)

describe('findForbiddenPhrases — что ловится', () => {
  it('чистый текст не даёт находок', () => {
    expect(findForbiddenPhrases('Торговля на финансовых рынках сопряжена с риском.')).toEqual([])
  })

  it('обещание гарантии находится', () => {
    const matches = findForbiddenPhrases('Гарантированный доход до 30% годовых')

    expect(matches.map((match) => match.phrase)).toContain('гарант')
    expect(matches[0]?.fragment).toContain('гарантированный доход')
  })

  it('находится в любой словоформе — словарь хранит основы', () => {
    for (const text of [
      'доход гарантирован',
      'гарантированная прибыль',
      'мы гарантируем',
      'гарантированные выплаты',
    ]) {
      expect(findForbiddenPhrases(text).length, text).toBeGreaterThan(0)
    }
  })

  it('английские формулировки тоже ловятся', () => {
    expect(findForbiddenPhrases('Risk-free trading with guaranteed returns').length).toBe(2)
  })
})

describe('findForbiddenPhrases — обход оформлением', () => {
  it('регистр не спасает', () => {
    expect(findForbiddenPhrases('БЕЗ РИСКА').length).toBe(1)
  })

  it('буква «ё» не спасает', () => {
    expect(findForbiddenPhrases('надёжный пассивный доход').length).toBe(1)
  })

  it('двойной пробел не спасает', () => {
    expect(findForbiddenPhrases('без  риска').length).toBe(1)
  })

  /**
   * Главные проверки этого набора: перечисленные символы визуально неотличимы
   * от обычного пробела. Без нормализации «без риска» с ними прошло бы мимо
   * словаря, а на странице выглядело бы совершенно обычно.
   */
  it('неразрывный пробел не спасает', () => {
    expect(findForbiddenPhrases(`без${NBSP}риска`).length).toBe(1)
  })

  it('узкий неразрывный пробел не спасает', () => {
    expect(findForbiddenPhrases(`без${NARROW_NBSP}риска`).length).toBe(1)
  })

  it('пробел нулевой ширины внутри слова не спасает', () => {
    expect(findForbiddenPhrases(`гаранти${ZERO_WIDTH}рован`).length).toBe(1)
  })
})

describe('findForbiddenPhrases — фрагмент для редактора', () => {
  it('показывает окружение находки', () => {
    const [match] = findForbiddenPhrases('Наш продукт даёт гарантированный доход каждый месяц')

    expect(match?.fragment).toContain('гарантированный доход')
  })

  it('длинный текст обрезается с многоточием', () => {
    const long = `${'а'.repeat(200)} гарантирован ${'б'.repeat(200)}`
    const [match] = findForbiddenPhrases(long)

    expect(match?.fragment.startsWith('…')).toBe(true)
    expect(match?.fragment.endsWith('…')).toBe(true)
    expect(match?.fragment.length).toBeLessThan(120)
  })
})

describe('findForbiddenPhrases — расширение словаря', () => {
  it('можно передать свой список', () => {
    expect(findForbiddenPhrases('особая формулировка', ['особая формулировка']).length).toBe(1)
  })

  it('переданный список заменяет умолчание', () => {
    expect(findForbiddenPhrases('гарантированный доход', ['другое']).length).toBe(0)
  })

  it('словарь по умолчанию не пуст', () => {
    expect(DEFAULT_FORBIDDEN_PHRASES.length).toBeGreaterThan(10)
  })
})
