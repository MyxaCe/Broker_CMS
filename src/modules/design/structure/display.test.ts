import { describe, expect, it } from 'vitest'

import { composeStructure } from './compose'
import {
  DEFAULT_POPUP_DISPLAY,
  MAX_POPUP_DELAY_SECONDS,
  readHeaderVariant,
  readPopupDisplay,
} from './display'

import type { ComposeStructureArgs, GlobalAreaRecord } from './compose'

/**
 * Правила показа попапа и варианты шапки (ТЗ 2.2, DEBT-015).
 *
 * Проверяется разделение, ради которого всё и заведено: попап без правил
 * показывается сразу и каждому — это поведение, а не отсутствие поведения, и
 * оно обязано быть названо явно.
 */

function area(overrides: Partial<GlobalAreaRecord> = {}): GlobalAreaRecord {
  return {
    kind: 'popup',
    locale: 'ru',
    ownerId: 'site',
    isActive: true,
    blocks: [],
    riskWarning: null,
    jurisdictions: [],
    ...overrides,
  }
}

function compose(areas: readonly GlobalAreaRecord[]) {
  const args: ComposeStructureArgs = {
    chainIds: ['brand', 'site'],
    locales: ['ru'],
    sections: [],
    navigations: [],
    globalAreas: areas,
    pagePaths: new Map([['ru', new Map([['1', '/']])]]),
  }

  return composeStructure(args)
}

describe('readPopupDisplay', () => {
  it('без правил даёт названное умолчание: сразу и каждому', () => {
    expect(readPopupDisplay(undefined)).toEqual(DEFAULT_POPUP_DISPLAY)
    expect(DEFAULT_POPUP_DISPLAY.frequency).toBe('every-visit')
  })

  it('читает заданные условия', () => {
    expect(
      readPopupDisplay({
        delaySeconds: 5,
        scrollPercent: 50,
        onExitIntent: true,
        frequency: 'once-per-day',
      }),
    ).toEqual({
      delaySeconds: 5,
      scrollPercent: 50,
      onExitIntent: true,
      frequency: 'once-per-day',
    })
  })

  /**
   * Ноль и «не задано» — разные настройки. Ноль означает «показать сразу»,
   * `null` — «по этому условию не показывать». Свести их к одному значению
   * значило бы отнять у редактора способ выразить первое.
   */
  it('ноль — это «сразу», а не «не задано»', () => {
    expect(readPopupDisplay({ delaySeconds: 0 }).delaySeconds).toBe(0)
    expect(readPopupDisplay({ delaySeconds: null }).delaySeconds).toBeNull()
  })

  /**
   * Негодное значение становится `null`, а не нулём. Ноль здесь — «показать
   * немедленно», то есть правдоподобное поведение на месте непрочитанной
   * настройки: редактор увидел бы назойливый попап и не понял бы почему.
   */
  it.each([
    ['NaN строкой', 'NaN'],
    ['дробное', 2.5],
    ['отрицательное', -1],
    ['за верхней границей', MAX_POPUP_DELAY_SECONDS + 1],
  ])('негодная задержка (%s) даёт null, а не ноль', (_name, value) => {
    expect(readPopupDisplay({ delaySeconds: value }).delaySeconds).toBeNull()
  })

  it('прокрутка ограничена сотней процентов', () => {
    expect(readPopupDisplay({ scrollPercent: 101 }).scrollPercent).toBeNull()
    expect(readPopupDisplay({ scrollPercent: 100 }).scrollPercent).toBe(100)
  })

  /**
   * Неизвестная частота заменяется на самое **частое** поведение, а не на
   * самое редкое. Ошибку, делающую попап назойливым, заметят и починят;
   * ошибку, которая его прячет, не заметит никто.
   */
  it('неизвестная частота читается как every-visit', () => {
    expect(readPopupDisplay({ frequency: 'раз в неделю' }).frequency).toBe('every-visit')
  })
})

describe('readHeaderVariant', () => {
  it('неизвестный вариант читается как обычный', () => {
    expect(readHeaderVariant('карусель')).toBe('default')
    expect(readHeaderVariant('compact')).toBe('compact')
  })
})

describe('правила показа в снапшоте структуры', () => {
  it('попап уносит правила в снапшот', () => {
    const structure = compose([
      area({ display: { delaySeconds: 10, frequency: 'once-per-session' } }),
    ])

    expect(structure.globalAreas[0]?.display).toEqual({
      delaySeconds: 10,
      scrollPercent: null,
      onExitIntent: false,
      frequency: 'once-per-session',
    })
  })

  /**
   * Поле, способное соврать, хуже отсутствующего. Подвал показывается
   * всегда; правила показа у него означали бы «показывать по условию» — и
   * витрина имела бы полное право их исполнить.
   */
  it('у подвала правил показа нет, даже если их заполнили в карточке', () => {
    const structure = compose([
      area({ kind: 'footer', display: { delaySeconds: 10, frequency: 'once' } }),
    ])

    expect(structure.globalAreas[0]?.display).toBeNull()
  })

  it('вариант значим у шапки и обнуляется у прочих', () => {
    expect(compose([area({ kind: 'header', variant: 'compact' })]).globalAreas[0]?.variant).toBe(
      'compact',
    )
    expect(
      compose([area({ kind: 'popup', variant: 'compact' })]).globalAreas[0]?.variant,
    ).toBeNull()
  })
})
