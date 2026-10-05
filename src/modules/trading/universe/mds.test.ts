import { describe, expect, it } from 'vitest'

import { fetchUniverse, parseQuotedSymbols, parseUniverse } from './mds'

import type { FetchLike } from './mds'

/**
 * Поддельный MDS: отказ, от которого мы защищаемся, подаётся источником, а не
 * воспроизводится чтением кода. Починка, проверенная только чтением, не
 * проверена.
 */
function mds(
  responses: Record<string, { status?: number; body?: unknown; throws?: string }>,
): FetchLike {
  return async (url) => {
    const path = new URL(url).pathname
    const planned = responses[path]

    if (planned === undefined || planned.throws !== undefined) {
      throw new Error(planned?.throws ?? `нет плана ответа для ${path}`)
    }

    const status = planned.status ?? 200

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => planned.body,
    }
  }
}

const BASE = 'http://mds.local'

describe('разбор вселенной', () => {
  it('отличает «items нет» от «items пуст»', () => {
    expect(parseUniverse({}).reason).toBe('в ответе MDS нет массива items')
    expect(parseUniverse({ items: [] }).entries).toEqual([])
    expect(parseUniverse({ items: [] }).reason).toBeNull()
  })

  it('пропускает записи без символа и считает их', () => {
    const parsed = parseUniverse({ items: [{ symbol: 'BTCUSD' }, {}, { symbol: 'btcusd' }] })

    expect(parsed.entries.map((entry) => entry.symbol)).toEqual(['BTCUSD'])
    expect(parsed.reason).toContain('2 записей')
  })
})

describe('разбор котировок', () => {
  it('ответ не по контракту даёт null, а не пустое множество', () => {
    // Пустое множество означало бы «ни у кого нет цены». Известно другое:
    // «источник ничего не сказал».
    expect(parseQuotedSymbols({})).toBeNull()
    expect(parseQuotedSymbols(null)).toBeNull()
    expect(parseQuotedSymbols({ items: [] })?.size).toBe(0)
  })

  it('не считает котируемым символ с нечисловой ценой', () => {
    // "NaN" разбирается как число успешно, а дальше по дороге становится
    // нулём — ценой ноль, уходящей в выдачу как настоящая.
    const quoted = parseQuotedSymbols({
      items: [
        { symbol: 'BTCUSD', price: 100 },
        { symbol: 'ETHUSD', price: Number.NaN },
        { symbol: 'LTCUSD', price: Number.POSITIVE_INFINITY },
        { symbol: 'XRPUSD', price: '1.5' },
      ],
    })

    expect([...(quoted ?? [])]).toEqual(['BTCUSD'])
  })

  it('цена ноль — это цена, а не отсутствие цены', () => {
    expect(parseQuotedSymbols({ items: [{ symbol: 'ZEROUSD', price: 0 }] })?.has('ZEROUSD')).toBe(
      true,
    )
  })
})

describe('снятие вселенной', () => {
  it('недоступный MDS не даёт пустой вселенной', () => {
    return expect(
      fetchUniverse({
        baseUrl: BASE,
        fetchImpl: mds({ '/v1/instruments': { throws: 'ECONNREFUSED' } }),
      }),
    ).resolves.toMatchObject({ outcome: 'unreachable', entries: [], quoted: null })
  })

  it('ответ не по контракту отличается от недоступности', () => {
    return expect(
      fetchUniverse({
        baseUrl: BASE,
        fetchImpl: mds({ '/v1/instruments': { body: { ok: true } } }),
      }),
    ).resolves.toMatchObject({ outcome: 'malformed' })
  })

  it('HTTP 503 — это недоступность, а не пустая вселенная', () => {
    return expect(
      fetchUniverse({
        baseUrl: BASE,
        fetchImpl: mds({ '/v1/instruments': { status: 503, body: {} } }),
      }),
    ).resolves.toMatchObject({ outcome: 'unreachable', entries: [] })
  })

  it('размечает котируемость по второму запросу', async () => {
    const result = await fetchUniverse({
      baseUrl: BASE,
      fetchImpl: mds({
        '/v1/instruments': { body: { items: [{ symbol: 'BTCUSD' }, { symbol: 'XAUUSD' }] } },
        '/v1/quotes': { body: { items: [{ symbol: 'BTCUSD', price: 100 }] } },
      }),
    })

    expect(result.outcome).toBe('fetched')
    expect(result.quoted).toBe(1)
    expect(result.entries.map((entry) => [entry.symbol, entry.quoted])).toEqual([
      ['BTCUSD', true],
      ['XAUUSD', false],
    ])
  })

  it('вселенная есть, котировок нет — котируемость неизвестна, а не ложна', async () => {
    const result = await fetchUniverse({
      baseUrl: BASE,
      fetchImpl: mds({
        '/v1/instruments': { body: { items: [{ symbol: 'BTCUSD' }] } },
        '/v1/quotes': { throws: 'timeout' },
      }),
    })

    expect(result.outcome).toBe('fetched')
    expect(result.quoted).toBeNull()
    expect(result.reason).toContain('котируемость не определена')
  })

  it('пустая вселенная — это знание, и оно не исход «недоступен»', async () => {
    const result = await fetchUniverse({
      baseUrl: BASE,
      fetchImpl: mds({
        '/v1/instruments': { body: { items: [] } },
        '/v1/quotes': { body: { items: [] } },
      }),
    })

    expect(result).toMatchObject({ outcome: 'fetched', quoted: 0 })
    expect(result.entries).toEqual([])
  })
})
