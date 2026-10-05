import { normalizeSymbol } from '../allow-list/symbol'

import type { SyncOutcome, UniverseEntry } from '../allow-list/universe'

/**
 * Чтение вселенной MDS.
 *
 * Единственное место, откуда CMS ходит в MDS, и ходит оно только из фонового
 * воркера (ТЗ 4.2). Ни админка, ни сборка релиза, ни выдача сюда не попадают.
 *
 * Разбор строгий по той же причине, по которой строг разбор окружения: ответ
 * соседа, не совпавший с контрактом, обязан быть отказом, а не тихо пустым
 * списком. Пустой список здесь — самое опасное значение: он читается как
 * «ничего не котируется» и в этом виде расходится по трём потребителям.
 */

/** Сколько ждём MDS. Воркер фоновый, но висеть бесконечно он не должен. */
const REQUEST_TIMEOUT_MS = 10_000

export interface UniverseFetch {
  readonly outcome: SyncOutcome
  /** Записи. Непусты только при `fetched`. */
  readonly entries: readonly UniverseEntry[]
  /**
   * Сколько символов имело цену. `null` — котировки не опрашивались или
   * ответ на них не разобрался; тогда `quoted` у записей ничего не утверждает.
   */
  readonly quoted: number | null
  /** Человекочитаемая причина, когда исход не `fetched`. */
  readonly reason: string | null
}

interface RawInstrument {
  readonly symbol?: unknown
  readonly name?: unknown
  readonly group?: unknown
  readonly category?: unknown
  readonly provider?: unknown
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Разбор `GET /v1/instruments`.
 *
 * Отсутствие `items` и `items: []` различаются: первое — ответ не по
 * контракту (`malformed`), второе — вселенная действительно пуста. Склеить их
 * значило бы снова получить отказ, похожий на данные.
 */
export function parseUniverse(body: unknown): {
  readonly entries: readonly UniverseEntry[]
  readonly reason: string | null
} {
  if (body === null || typeof body !== 'object') {
    return { entries: [], reason: 'ответ MDS не является объектом' }
  }

  const items = (body as { items?: unknown }).items

  if (!Array.isArray(items)) {
    return { entries: [], reason: 'в ответе MDS нет массива items' }
  }

  const entries: UniverseEntry[] = []
  const seen = new Set<string>()
  let skipped = 0

  for (const item of items) {
    const raw = (item ?? {}) as RawInstrument
    const symbol = normalizeSymbol(raw.symbol)

    if (symbol === '' || seen.has(symbol)) {
      skipped += 1
      continue
    }

    seen.add(symbol)
    entries.push({
      symbol,
      name: textOf(raw.name),
      group: textOf(raw.group),
      category: textOf(raw.category),
      provider: textOf(raw.provider),
      /** Котируемость приходит из второго запроса; по умолчанию не утверждаем. */
      quoted: false,
    })
  }

  return {
    entries,
    reason: skipped > 0 ? `${skipped} записей без символа или с повтором пропущено` : null,
  }
}

/**
 * Разбор `GET /v1/quotes`.
 *
 * Возвращает `null`, если ответ не по контракту: это «не знаем», и оно обязано
 * отличаться от пустого множества котируемых символов.
 */
export function parseQuotedSymbols(body: unknown): ReadonlySet<string> | null {
  if (body === null || typeof body !== 'object') {
    return null
  }

  const items = (body as { items?: unknown }).items

  if (!Array.isArray(items)) {
    return null
  }

  const quoted = new Set<string>()

  for (const item of items) {
    const raw = (item ?? {}) as { symbol?: unknown; price?: unknown }
    const symbol = normalizeSymbol(raw.symbol)
    const price = typeof raw.price === 'number' ? raw.price : Number.NaN

    /**
     * `Number.isFinite` обязателен: `NaN` и бесконечность разбираются как
     * число успешно, а дальше по дороге превращаются в ноль. Цена ноль,
     * пришедшая из неразобранного значения, — самый дорогой дефект платформы,
     * и здесь она означала бы «котируется» у символа без котировки.
     */
    if (symbol !== '' && Number.isFinite(price)) {
      quoted.add(symbol)
    }
  }

  return quoted
}

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

async function getJson(
  fetchImpl: FetchLike,
  url: string,
): Promise<{ body: unknown; error: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetchImpl(url, { signal: controller.signal })

    if (!response.ok) {
      return { body: null, error: `HTTP ${response.status}` }
    }

    return { body: await response.json(), error: null }
  } catch (error) {
    return { body: null, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Снимает вселенную и отмечает, у кого есть цена.
 *
 * Два запроса, а не один, потому что это два разных вопроса. `/v1/instruments`
 * отвечает «что MDS вообще стримит», `/v1/quotes` — «у чего сейчас есть цена».
 * Ответ на первый без второго дал бы редактору список, в котором котируемое и
 * некотируемое неотличимы, — то есть ровно сегодняшнее положение дел.
 */
export async function fetchUniverse(args: {
  readonly baseUrl: string
  readonly fetchImpl: FetchLike
}): Promise<UniverseFetch> {
  const base = args.baseUrl.replace(/\/+$/, '')
  const universe = await getJson(args.fetchImpl, `${base}/v1/instruments`)

  if (universe.error !== null) {
    return {
      outcome: 'unreachable',
      entries: [],
      quoted: null,
      reason: `GET /v1/instruments: ${universe.error}`,
    }
  }

  const parsed = parseUniverse(universe.body)

  if (!Array.isArray((universe.body as { items?: unknown } | null)?.items)) {
    return {
      outcome: 'malformed',
      entries: [],
      quoted: null,
      reason: `GET /v1/instruments: ${parsed.reason ?? 'ответ не по контракту'}`,
    }
  }

  const quotes = await getJson(args.fetchImpl, `${base}/v1/quotes`)
  const quotedSymbols = quotes.error === null ? parseQuotedSymbols(quotes.body) : null

  if (quotedSymbols === null) {
    /**
     * Вселенную получили, котировки — нет. Это **не** повод объявить всё
     * некотируемым: мы не знаем. Снимок уходит с `quoted: null`, и дальше по
     * цепочке такой символ требует осознанного включения с формулировкой
     * «не проверено», а не «не котируется».
     */
    return {
      outcome: 'fetched',
      entries: parsed.entries,
      quoted: null,
      reason: `GET /v1/quotes: ${quotes.error ?? 'ответ не по контракту'} — котируемость не определена`,
    }
  }

  const entries = parsed.entries.map((entry) => ({
    ...entry,
    quoted: quotedSymbols.has(entry.symbol),
  }))

  return {
    outcome: 'fetched',
    entries,
    quoted: entries.filter((entry) => entry.quoted).length,
    reason: parsed.reason,
  }
}
