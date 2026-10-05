import { describe, expect, it } from 'vitest'

import { allowedSymbols, checkAllowList, requiresConfirmation, standingOf } from './rules'
import { isValidSymbol, normalizeSymbol } from './symbol'
import { buildUniverseSnapshot } from './universe'

import type { UniverseState } from './universe'

const NOW = new Date('2026-10-05T12:00:00.000Z')

/**
 * Вселенная подбирается так, чтобы её было **чем сломать**: котируемый
 * символ, известный без цены и заведомо отсутствующий. Снимок из одних
 * котируемых дал бы зелёный цвет при любой формуле.
 */
function universe(quoted: number | null = 1): UniverseState {
  return buildUniverseSnapshot({
    takenAt: '2026-10-05T11:00:00.000Z',
    entries: [
      {
        symbol: 'BTCUSD',
        name: 'Bitcoin',
        group: 'Крипта',
        category: 'crypto',
        provider: 'binance',
        quoted: true,
      },
      {
        symbol: 'XAUUSD',
        name: 'Золото',
        group: 'Металлы',
        category: 'metal',
        provider: 'twelvedata',
        quoted: false,
      },
    ],
    quoted,
  })
}

describe('символ', () => {
  it('приводит к верхнему регистру и обрезает пробелы', () => {
    expect(normalizeSymbol('  btcusd ')).toBe('BTCUSD')
  })

  it('отвергает пробелы и запятые внутри символа', () => {
    // Запятая разделяет символы в GET /v1/quotes?symbols= — внутри символа
    // она превращает одну запись списка в две.
    expect(isValidSymbol('BTC,ETH')).toBe(false)
    expect(isValidSymbol('BTC USD')).toBe(false)
    expect(isValidSymbol('BTCUSD')).toBe(true)
  })

  it('не запрещает символы, которые MDS реально стримит', () => {
    expect(isValidSymbol('1000SATSUSD')).toBe(true)
    expect(isValidSymbol('BROCCOLI714USD')).toBe(true)
  })
})

describe('положение символа относительно снимка', () => {
  it('котируемый — единственное состояние без подтверждения', () => {
    expect(standingOf('BTCUSD', universe())).toBe('quoted')
    expect(requiresConfirmation('quoted')).toBe(false)
    expect(requiresConfirmation('listed-unquoted')).toBe(true)
    expect(requiresConfirmation('absent')).toBe(true)
    expect(requiresConfirmation('unknown')).toBe(true)
  })

  it('известный без цены отличается от отсутствующего', () => {
    expect(standingOf('XAUUSD', universe())).toBe('listed-unquoted')
    expect(standingOf('EURUSD', universe())).toBe('absent')
  })

  it('отсутствие снимка — это «не знаем», а не «не котируется»', () => {
    expect(standingOf('BTCUSD', null)).toBe('unknown')
  })

  it('снимок без опроса цен ничего не утверждает о котируемости', () => {
    // quoted: null — котировки не спрашивали. Назвать BTCUSD котируемым
    // значило бы выдать «не спрашивали» за «спросили и есть».
    expect(standingOf('BTCUSD', universe(null))).toBe('unknown')
  })
})

describe('проверка списка', () => {
  it('котируемый символ проходит без подтверждения', () => {
    const check = checkAllowList([{ symbol: 'btcusd' }], universe(), NOW)

    expect(check.issues).toEqual([])
    expect(check.rows).toEqual([
      {
        symbol: 'BTCUSD',
        confirmedUnquoted: false,
        confirmedReason: null,
        standingAtSave: 'quoted',
        checkedAt: NOW.toISOString(),
      },
    ])
  })

  it('символ, которого нет в MDS, не сохраняется без подтверждения', () => {
    const check = checkAllowList([{ symbol: 'EURUSD' }], universe(), NOW)

    expect(check.rows).toEqual([])
    expect(check.issues.map((issue) => issue.code)).toEqual(['confirmation-required'])
    expect(check.issues[0]?.message).toContain('никогда не покажет цену')
  })

  it('подтверждённый некотируемый сохраняется и помечается', () => {
    const check = checkAllowList(
      [
        {
          symbol: 'EURUSD',
          confirmedUnquoted: true,
          confirmedReason: 'ключ провайдера ждём к пятнице',
        },
      ],
      universe(),
      NOW,
    )

    expect(check.issues).toEqual([])
    expect(check.rows[0]).toMatchObject({
      symbol: 'EURUSD',
      confirmedUnquoted: true,
      standingAtSave: 'absent',
    })
  })

  it('подтверждение без причины не считается осознанным', () => {
    const check = checkAllowList([{ symbol: 'EURUSD', confirmedUnquoted: true }], universe(), NOW)

    expect(check.issues.map((issue) => issue.code)).toEqual(['confirmation-without-reason'])
  })

  it('причины «а» недостаточно', () => {
    const check = checkAllowList(
      [{ symbol: 'EURUSD', confirmedUnquoted: true, confirmedReason: 'а' }],
      universe(),
      NOW,
    )

    expect(check.issues.map((issue) => issue.code)).toEqual(['confirmation-without-reason'])
  })

  it('недоступность MDS не превращается в разрешение', () => {
    // Отказ соседа не должен открывать границу: без снимка подтверждения
    // требует даже тот символ, который вчера котировался.
    const check = checkAllowList([{ symbol: 'BTCUSD' }], null, NOW)

    expect(check.rows).toEqual([])
    expect(check.issues.map((issue) => issue.code)).toEqual(['confirmation-required'])
    expect(check.issues[0]?.message).toContain('неизвестно')
  })

  it('причина отказа называется разной для разных случаев', () => {
    const absent = checkAllowList([{ symbol: 'EURUSD' }], universe(), NOW).issues[0]?.message ?? ''
    const unquoted =
      checkAllowList([{ symbol: 'XAUUSD' }], universe(), NOW).issues[0]?.message ?? ''
    const unknown = checkAllowList([{ symbol: 'EURUSD' }], null, NOW).issues[0]?.message ?? ''

    expect(new Set([absent, unquoted, unknown]).size).toBe(3)
  })

  it('ловит повтор, пустой и кривой символ', () => {
    const check = checkAllowList(
      [{ symbol: 'BTCUSD' }, { symbol: 'btcusd' }, { symbol: '  ' }, { symbol: 'BTC,ETH' }],
      universe(),
      NOW,
    )

    expect(check.issues.map((issue) => issue.code)).toEqual([
      'duplicate',
      'symbol-empty',
      'symbol-malformed',
    ])
  })

  it('объявляет охват вместе с результатом', () => {
    expect(checkAllowList([], universe(), NOW).coverage).toEqual({
      state: 'snapshot',
      takenAt: '2026-10-05T11:00:00.000Z',
      instruments: 2,
      quoted: 1,
    })

    expect(checkAllowList([], null, NOW).coverage).toEqual({
      state: 'missing',
      takenAt: null,
      instruments: null,
      quoted: null,
    })
  })

  it('пустой вход даёт пустой список, а не «разрешено всё»', () => {
    const check = checkAllowList([], universe(), NOW)

    expect(check.issues).toEqual([])
    expect(allowedSymbols(check.rows)).toEqual([])
  })
})

describe('символы для выдачи', () => {
  it('сортирует и не теряет осознанно включённые', () => {
    const rows = checkAllowList(
      [
        { symbol: 'XAUUSD', confirmedUnquoted: true, confirmedReason: 'временно без цены' },
        { symbol: 'BTCUSD' },
      ],
      universe(),
      NOW,
    ).rows

    expect(allowedSymbols(rows)).toEqual(['BTCUSD', 'XAUUSD'])
  })
})
