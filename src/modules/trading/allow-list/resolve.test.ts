import { describe, expect, it } from 'vitest'

import { EMPTY_ALLOW_LIST, resolveFromDoc } from './resolve'

describe('разрешение списка из карточки', () => {
  it('отсутствие карточки — это «ничего не разрешено», и оно помечено', () => {
    expect(resolveFromDoc(undefined)).toEqual(EMPTY_ALLOW_LIST)
    expect(resolveFromDoc(undefined).configured).toBe(false)
  })

  it('заведённая пустая карточка отличима от незаведённой', () => {
    const resolved = resolveFromDoc({ instruments: [] })

    expect(resolved.symbols).toEqual([])
    expect(resolved.configured).toBe(true)
  })

  it('отдаёт символы отсортированными и без повторов', () => {
    const resolved = resolveFromDoc({
      instruments: [{ symbol: 'XAUUSD' }, { symbol: 'BTCUSD' }, { symbol: 'BTCUSD' }],
    })

    expect(resolved.symbols).toEqual(['BTCUSD', 'XAUUSD'])
  })

  it('осознанно включённые видны отдельно, но из выдачи не выпадают', () => {
    const resolved = resolveFromDoc({
      instruments: [
        { symbol: 'BTCUSD', standingAtSave: 'quoted' },
        { symbol: 'EURUSD', confirmedUnquoted: true, standingAtSave: 'absent' },
      ],
    })

    expect(resolved.symbols).toEqual(['BTCUSD', 'EURUSD'])
    expect(resolved.confirmedUnquoted).toEqual([{ symbol: 'EURUSD', standing: 'absent' }])
  })
})
