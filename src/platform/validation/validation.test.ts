import { describe, expect, it } from 'vitest'

import { runValidation, summarizeReport } from './validation'

import type { Coverage, Finding, Validator } from './validation'

/**
 * Каркас живёт в `platform`, а не в `delivery`: доменные модули поставляют
 * валидаторы, а импортировать `delivery` им запрещено правилом границ.
 * Первая версия лежала в `delivery` — это поймал линтер.
 */

function validator(name: string, findings: Finding[], coverage?: Coverage): Validator<unknown> {
  return {
    name,
    description: `тестовый валидатор ${name}`,
    run: () => findings,
    coverage: () => coverage ?? { kind: 'checked', examined: 1 },
  }
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

const broken: Validator<unknown> = {
  name: 'сломанный',
  description: 'бросает исключение',
  run: () => {
    throw new Error('внутренняя ошибка')
  },
  coverage: () => ({ kind: 'checked', examined: 1 }),
}

describe('runValidation — сломанная проверка', () => {
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

/**
 * Ради этого блока каркас и переделан.
 *
 * Стоп-словарь месяц отдавал «нарушений нет», не получив ни одного текста:
 * сборка не заполняла поле, валидатор исправно обходил пустой список, отчёт
 * получался чистым (DEBT-013). Пустой вход обязан быть отличим от пройденной
 * проверки — иначе отчёт релиза утверждает то, чего не проверяли.
 */
describe('runValidation — охват проверки', () => {
  it('непереданный материал отклоняет сборку, а не проходит', () => {
    const report = runValidation(
      [validator('стоп-словарь', [], { kind: 'missing', reason: 'тексты не собраны' })],
      {},
    )

    expect(report.passed).toBe(false)
    expect(report.blocking.map((item) => item.code)).toEqual(['check-not-executed'])
  })

  it('сообщение говорит, что результат неизвестен, а не что нарушений нет', () => {
    const report = runValidation(
      [validator('стоп-словарь', [], { kind: 'missing', reason: 'тексты не собраны' })],
      {},
    )

    expect(report.blocking[0]?.message).toContain('тексты не собраны')
    expect(report.blocking[0]?.message).toContain('не «нарушений нет»')
  })

  /**
   * Обратная сторона того же правила: сайт без единой страницы обязан
   * собираться. Иначе первое, что сделает редактор нового сайта, — упрётся
   * в отказ и научится обходить гейт.
   */
  it('честно пустой материал сборку не отклоняет', () => {
    const report = runValidation(
      [validator('стоп-словарь', [], { kind: 'empty', reason: 'на сайте нет текстов' })],
      {},
    )

    expect(report.passed).toBe(true)
    expect(report.coverage['стоп-словарь']).toEqual({
      kind: 'empty',
      reason: 'на сайте нет текстов',
    })
  })

  it('охват виден в отчёте по каждому валидатору', () => {
    const report = runValidation(
      [validator('a', [], { kind: 'checked', examined: 42 }), validator('b', [])],
      {},
    )

    expect(report.coverage).toEqual({
      a: { kind: 'checked', examined: 42 },
      b: { kind: 'checked', examined: 1 },
    })
  })

  /**
   * Ноль находок у проверки, осмотревшей сорок два текста, и ноль находок у
   * проверки, не получившей ни одного, — одно и то же число. Именно поэтому
   * `byValidator` не годился на роль доказательства, что проверка работала.
   */
  it('число находок не отличает осмотренное от неполученного, а охват отличает', () => {
    const report = runValidation(
      [
        validator('осмотрел', [], { kind: 'checked', examined: 42 }),
        validator('не получил', [], { kind: 'missing', reason: 'материал не передан' }),
      ],
      {},
    )

    expect(report.byValidator['осмотрел']).toBe(0)
    expect(report.coverage['осмотрел']).toEqual({ kind: 'checked', examined: 42 })
    expect(report.coverage['не получил']?.kind).toBe('missing')
  })

  it('упавший валидатор считается не выполнившимся, а не осмотревшим', () => {
    const report = runValidation([broken], {})

    expect(report.coverage['сломанный']?.kind).toBe('missing')
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

  /** Резюме читают вместо отчёта, поэтому «не выполнено» обязано быть в нём. */
  it('не выполнившаяся проверка не даёт резюме «нарушений нет»', () => {
    const report = runValidation(
      [validator('стоп-словарь', [], { kind: 'missing', reason: 'тексты не собраны' })],
      {},
    )

    expect(summarizeReport(report)).toContain('не выполнено проверок: 1')
    expect(summarizeReport(report)).toContain('стоп-словарь')
  })

  it('блокирующие и предупреждения', () => {
    const report = runValidation(
      [validator('a', [finding(), finding({ severity: 'warning' })])],
      {},
    )
    expect(summarizeReport(report)).toBe('блокирующих: 1, предупреждений: 1')
  })
})
