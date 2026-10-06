import { describe, expect, it } from 'vitest'

import { composeDisclaimers } from './compose'
import { DISCLAIMER_KEYS } from './disclaimers.collection'
import { disclaimersValidator } from './validator'

import type { ComposeDisclaimersArgs } from './compose'

/**
 * Дисклеймеры продукта (ТЗ 2.4, Р-028, BUG-010).
 *
 * Проверяется не «функция возвращает ключи», а **инвариант контракта**: ключ,
 * перечисленный у страницы, гарантированно присутствует в карте текстов.
 * Именно он делает правило исполнимым и позволяет включить его блокирующим —
 * до него правило было написано и не вызывалось ниоткуда.
 */

const CALC_PAGE = {
  path: '/rechner',
  locale: 'de',
  blocks: [
    { type: 'hero', props: {} },
    { type: 'calculator', props: {} },
  ],
}

function args(overrides: Partial<ComposeDisclaimersArgs> = {}): ComposeDisclaimersArgs {
  return { pages: [], areas: [], texts: [], ...overrides }
}

describe('перечень ключей', () => {
  /**
   * Ключи в форме редактора выведены из правила движка, а не набраны руками.
   * Свободное поле означало бы опечатку, после которой гейт сообщает «текста
   * нет», а текст есть — под соседним именем.
   */
  it('совпадает с тем, что может потребовать движок', () => {
    expect(DISCLAIMER_KEYS).toEqual([
      'disclaimer.calculator',
      'disclaimer.market-data',
      'disclaimer.trading-conditions',
    ])
  })
})

describe('вывод ключей из состава блоков', () => {
  it('ключ привязан к блоку, из которого выведен, а не к странице', () => {
    const snapshot = composeDisclaimers(
      args({
        pages: [CALC_PAGE],
        texts: [{ key: 'disclaimer.calculator', locale: 'de', text: 'Не является офертой.' }],
      }),
    )

    expect(snapshot.pages[0]?.blocks).toEqual([
      { path: 'blocks[1]', type: 'calculator', keys: ['disclaimer.calculator'] },
    ])
    expect(snapshot.pages[0]?.page).toEqual([])
  })

  /**
   * Правило, действующее только на верхнем уровне, обходится переносом блока
   * в колонку. Обход вложенности здесь общий с комплаенс-гейтом — отдельный
   * разошёлся бы с ним незаметно.
   */
  it('находит блок во вложенном слоте', () => {
    const snapshot = composeDisclaimers(
      args({
        pages: [
          {
            path: '/p',
            locale: 'de',
            blocks: [{ type: 'columns', slots: { left: [{ type: 'calculator' }] } }],
          },
        ],
        texts: [{ key: 'disclaimer.calculator', locale: 'de', text: 'Текст.' }],
      }),
    )

    expect(snapshot.pages[0]?.blocks.map((block) => block.path)).toEqual([
      'blocks[0].slots.left[0]',
    ])
  })

  /**
   * Тикер в шапке показывается на каждой странице, и блока для него на самой
   * странице нет. Такой ключ относится к странице целиком — это и есть
   * разделение, которого требует правка штаба к Р-028.
   */
  it('блок глобальной области даёт ключ страницы, а не блока', () => {
    const snapshot = composeDisclaimers(
      args({
        pages: [{ path: '/', locale: 'de', blocks: [] }],
        areas: [{ kind: 'header', locale: 'de', blocks: [{ type: 'quote-ticker' }] }],
        texts: [{ key: 'disclaimer.market-data', locale: 'de', text: 'Данные с задержкой.' }],
      }),
    )

    expect(snapshot.pages[0]?.page).toEqual(['disclaimer.market-data'])
    expect(snapshot.pages[0]?.blocks).toEqual([])
  })

  it('область чужой локали на страницу не влияет', () => {
    const snapshot = composeDisclaimers(
      args({
        pages: [{ path: '/', locale: 'de', blocks: [] }],
        areas: [{ kind: 'header', locale: 'en', blocks: [{ type: 'quote-ticker' }] }],
      }),
    )

    expect(snapshot.pages[0]?.page).toEqual([])
  })

  it('неизвестный тип блока ключа не даёт', () => {
    const snapshot = composeDisclaimers(
      args({ pages: [{ path: '/', locale: 'de', blocks: [{ type: 'calculator-2000' }] }] }),
    )

    expect(snapshot.pages[0]?.blocks).toEqual([])
    expect(snapshot.findings).toEqual([])
  })

  /**
   * Случаи, переехавшие сюда вместе с удалением `requiredDisclaimers`
   * (плоский список на страницу, отвергнутый правкой штаба к Р-028).
   * Проверяемое поведение то же, форма результата — другая.
   */
  it('два блока одного семейства требуют один дисклеймер, но каждый назван', () => {
    const snapshot = composeDisclaimers(
      args({
        pages: [
          {
            path: '/p',
            locale: 'de',
            blocks: [{ type: 'pricing-grid' }, { type: 'account-types' }],
          },
        ],
        texts: [{ key: 'disclaimer.trading-conditions', locale: 'de', text: 'Условия меняются.' }],
      }),
    )

    expect(snapshot.pages[0]?.blocks).toEqual([
      { path: 'blocks[0]', type: 'pricing-grid', keys: ['disclaimer.trading-conditions'] },
      { path: 'blocks[1]', type: 'account-types', keys: ['disclaimer.trading-conditions'] },
    ])

    /** Требование одно: ключ дедуплицируется при сверке с текстами. */
    expect(snapshot.examinedRequirements).toBe(1)
    expect(snapshot.findings).toEqual([])
  })

  it('блок без правила дисклеймера не требует', () => {
    const snapshot = composeDisclaimers(
      args({ pages: [{ path: '/p', locale: 'de', blocks: [{ type: 'quote' }] }] }),
    )

    expect(snapshot.pages[0]?.blocks).toEqual([])
    expect(snapshot.examinedRequirements).toBe(0)
  })

  it('разные семейства дают разные ключи', () => {
    const snapshot = composeDisclaimers(
      args({
        pages: [
          {
            path: '/p',
            locale: 'de',
            blocks: [{ type: 'quote-ticker' }, { type: 'calculator' }],
          },
        ],
        texts: [
          { key: 'disclaimer.market-data', locale: 'de', text: 'Данные с задержкой.' },
          { key: 'disclaimer.calculator', locale: 'de', text: 'Не оферта.' },
        ],
      }),
    )

    expect(snapshot.pages[0]?.blocks.flatMap((block) => block.keys)).toEqual([
      'disclaimer.market-data',
      'disclaimer.calculator',
    ])
    expect(snapshot.examinedRequirements).toBe(2)
  })
})

describe('инвариант «ключ есть — текст есть»', () => {
  it('страница с калькулятором собирается, когда текст есть', () => {
    const snapshot = composeDisclaimers(
      args({
        pages: [CALC_PAGE],
        texts: [{ key: 'disclaimer.calculator', locale: 'de', text: 'Не является офертой.' }],
      }),
    )

    expect(snapshot.findings).toEqual([])
    expect(snapshot.texts.de?.['disclaimer.calculator']).toBe('Не является офертой.')
    expect(snapshot.examinedRequirements).toBe(1)
  })

  it('и не собирается, когда текста нет', () => {
    const snapshot = composeDisclaimers(args({ pages: [CALC_PAGE] }))

    expect(snapshot.findings.map((finding) => finding.code)).toEqual(['disclaimer-text-missing'])
    expect(snapshot.examinedRequirements).toBe(1)
  })

  /**
   * Текст на английском не закрывает требование на немецкой странице: его
   * там просто не прочитают. Тот же довод, по которому риск-предупреждение
   * проверяется на каждую локаль.
   */
  it('текст чужой локали требование не закрывает', () => {
    const snapshot = composeDisclaimers(
      args({
        pages: [CALC_PAGE],
        texts: [{ key: 'disclaimer.calculator', locale: 'en', text: 'Not an offer.' }],
      }),
    )

    expect(snapshot.findings.map((finding) => finding.code)).toEqual(['disclaimer-text-missing'])
  })

  /**
   * Пустой текст — худший из трёх исходов: он проходит и беглый взгляд
   * редактора в списке коллекции, и любую проверку «запись есть». На витрине
   * это пустое место, выглядящее выполненным требованием.
   */
  it('пустой текст не считается текстом и даёт две находки', () => {
    const snapshot = composeDisclaimers(
      args({
        pages: [CALC_PAGE],
        texts: [{ key: 'disclaimer.calculator', locale: 'de', text: '   ' }],
      }),
    )

    expect(snapshot.findings.map((finding) => finding.code).sort()).toEqual([
      'disclaimer-text-empty',
      'disclaimer-text-missing',
    ])
    expect(snapshot.texts.de?.['disclaimer.calculator']).toBeUndefined()
  })
})

describe('disclaimersValidator', () => {
  it('несобранные дисклеймеры отклоняют сборку, а не проходят молча', () => {
    expect(disclaimersValidator.coverage({ disclaimers: null })).toEqual({
      kind: 'missing',
      reason: 'сборка не передала дисклеймеры',
    })
    expect(disclaimersValidator.run({ disclaimers: null })).toHaveLength(1)
  })

  /**
   * Сайт без калькуляторов и таблиц — «проверять было нечего», а не
   * «нарушений нет». Разница здесь регуляторная: по первому отчёту видно,
   * что правило отработало вхолостую, по второму — что всё в порядке.
   */
  it('сайт без требующих блоков даёт «нечего было проверять»', () => {
    const snapshot = composeDisclaimers(args({ pages: [{ path: '/', locale: 'de', blocks: [] }] }))

    expect(disclaimersValidator.coverage({ disclaimers: snapshot })).toEqual({
      kind: 'empty',
      reason: 'ни одна страница сайта не содержит блоков, требующих дисклеймера',
    })
    expect(disclaimersValidator.run({ disclaimers: snapshot })).toEqual([])
  })

  it('находка о недостающем тексте блокирует, а не предупреждает', () => {
    const snapshot = composeDisclaimers(args({ pages: [CALC_PAGE] }))
    const findings = disclaimersValidator.run({ disclaimers: snapshot })

    expect(findings.map((finding) => finding.severity)).toEqual(['blocking'])
    expect(disclaimersValidator.coverage({ disclaimers: snapshot })).toEqual({
      kind: 'checked',
      examined: 1,
    })
  })
})
