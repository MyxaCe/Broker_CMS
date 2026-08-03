import { describe, expect, it } from 'vitest'

import { runValidation, summarizeReport } from './validation'

import type { Finding, Validator } from './validation'

/**
 * Каркас живёт в `platform`, а не в `delivery`: доменные модули поставляют
 * валидаторы, а импортировать `delivery` им запрещено правилом границ.
 * Первая версия лежала в `delivery` — это поймал линтер.
 */

function validator(name: string, findings: Finding[]): Validator<unknown> {
  return { name, description: `тестовый валидатор ${name}`, run: () => findings }
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    validator: 'test',
    severity: 'blocking',
    code: 'test-code',
    message: 'сообщение',
    ...overrides,
  }
}

describe('runValidation — правило отказа', () => {
  it('пустой набор валидаторов даёт чистый отчёт', () => {
    const report = runValidation([], {})

    expect(report.passed).toBe(true)
    expect(report.findings).toEqual([])
  })

  it('одна блокирующая находка отклоняет сборку', () => {
    const report = runValidation([validator('a', [finding()])], {})

    expect(report.passed).toBe(false)
    expect(report.blocking).toHaveLength(1)
  })

  it('предупреждения сборку не отклоняют', () => {
    const report = runValidation([validator('a', [finding({ severity: 'warning' })])], {})

    expect(report.passed).toBe(true)
    expect(report.warnings).toHaveLength(1)
  })
})

describe('runValidation — прогоняются все проверки', () => {
  it('находки собираются со всех валидаторов, а не до первой', () => {
    const report = runValidation(
      [
        validator('a', [finding({ code: 'a1' })]),
        validator('b', [finding({ code: 'b1' }), finding({ code: 'b2' })]),
      ],
      {},
    )

    expect(report.findings.map((item) => item.code)).toEqual(['a1', 'b1', 'b2'])
  })

  it('в отчёте видно, что отработал каждый валидатор', () => {
    const report = runValidation([validator('a', []), validator('b', [finding()])], {})

    expect(report.byValidator).toEqual({ a: 0, b: 1 })
  })
})

describe('runValidation — сломанная проверка', () => {
  const broken: Validator<unknown> = {
    name: 'сломанный',
    description: 'бросает исключение',
    run: () => {
      throw new Error('внутренняя ошибка')
    },
  }

  /**
   * Самый важный случай: сломанная проверка НЕ должна выглядеть как отсутствие
   * нарушений. Иначе достаточно уронить валидатор, чтобы опубликовать что угодно.
   */
  it('ошибка внутри валидатора отклоняет сборку', () => {
    const report = runValidation([broken], {})

    expect(report.passed).toBe(false)
    expect(report.blocking[0]?.code).toBe('validator-failed')
  })

  it('сообщение объясняет, что результат неизвестен', () => {
    const report = runValidation([broken], {})

    expect(report.blocking[0]?.message).toContain('внутренняя ошибка')
    expect(report.blocking[0]?.message).toContain('результат проверки неизвестен')
  })

  it('падение одного валидатора не мешает остальным отработать', () => {
    const report = runValidation([broken, validator('живой', [finding({ code: 'жив' })])], {})

    expect(report.findings.map((item) => item.code)).toContain('жив')
    expect(report.byValidator['живой']).toBe(1)
  })
})

describe('summarizeReport', () => {
  it('чистый отчёт', () => {
    expect(summarizeReport(runValidation([], {}))).toBe('нарушений нет')
  })

  it('только предупреждения', () => {
    const report = runValidation([validator('a', [finding({ severity: 'warning' })])], {})
    expect(summarizeReport(report)).toBe('предупреждений: 1')
  })

  it('блокирующие и предупреждения', () => {
    const report = runValidation(
      [validator('a', [finding(), finding({ severity: 'warning' })])],
      {},
    )
    expect(summarizeReport(report)).toBe('блокирующих: 1, предупреждений: 1')
  })
})
