'use client'

import { useForm, useFormFields } from '@payloadcms/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'

import './universe-picker.css'

/**
 * Выбор инструментов из вселенной MDS (Р-026).
 *
 * Требование владельца: «суть в том, что я могу отключить или подключить
 * любые котировки через наш сервис управления». Значит набор — операция, и
 * выполняться она должна отсюда, а не правкой сида.
 *
 * **Это удобство, а не граница.** Барьер стоит на сервере, в хуке коллекции:
 * клиентский код подставляет кто угодно, и проверка, живущая только здесь,
 * снимается отключённым JavaScript. Отсюда следствие, важное при чтении кода:
 * ничего из проверяемого здесь не является единственной проверкой. Всё, что
 * этот компонент делает, — показывает человеку то, что сервер и так знает,
 * **до** того, как он нажмёт «Сохранить».
 *
 * Источник — наш локальный снимок вселенной, а не живой MDS: CMS не
 * обращается к соседу синхронно (ТЗ 4.2).
 */

const ARRAY_PATH = 'instruments'
const ARRAY_SCHEMA_PATH = 'instrument-access.instruments'
const MAX_RESULTS = 50

interface UniverseRow {
  readonly symbol: string
  readonly name: string | null
  readonly group: string | null
  readonly quoted: boolean
}

interface SyncRow {
  readonly outcome: 'fetched' | 'unreachable' | 'malformed'
  readonly startedAt: string
  readonly instruments: number | null
  readonly quoted: number | null
  readonly reason: string | null
}

/**
 * Что мы знаем о снимке.
 *
 * `unreadable` — отдельное состояние, а не «пустой снимок». Пустой список при
 * недоступном источнике читается как «ничего не котируется», и это худшее
 * прочтение из возможных: оно выглядит как данные.
 */
type Coverage =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'never-synced' }
  | {
      readonly kind: 'snapshot'
      readonly takenAt: string
      readonly instruments: number | null
      readonly quoted: number | null
      readonly lastFailure: SyncRow | null
    }

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: 'include' })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

function docsOf(body: unknown): Record<string, unknown>[] {
  const docs = (body as { docs?: unknown } | null)?.docs
  return Array.isArray(docs) ? (docs as Record<string, unknown>[]) : []
}

function toSync(doc: Record<string, unknown> | undefined): SyncRow | null {
  if (doc === undefined) {
    return null
  }

  const outcome = doc.outcome

  return {
    outcome:
      outcome === 'fetched' || outcome === 'unreachable' || outcome === 'malformed'
        ? outcome
        : 'malformed',
    startedAt: String(doc.startedAt ?? ''),
    instruments: typeof doc.instruments === 'number' ? doc.instruments : null,
    quoted: typeof doc.quoted === 'number' ? doc.quoted : null,
    reason: typeof doc.reason === 'string' ? doc.reason : null,
  }
}

function toUniverseRow(doc: Record<string, unknown>): UniverseRow {
  return {
    symbol: String(doc.symbol ?? ''),
    name: typeof doc.name === 'string' ? doc.name : null,
    group: typeof doc.group === 'string' ? doc.group : null,
    quoted: doc.quoted === true,
  }
}

const OUTCOME_TEXT: Record<SyncRow['outcome'], string> = {
  fetched: 'снимок снят',
  unreachable: 'MDS недоступен',
  malformed: 'MDS ответил не по контракту',
}

function CoverageBanner({ coverage }: { readonly coverage: Coverage }): React.JSX.Element {
  if (coverage.kind === 'loading') {
    return <p className="universe-picker__note">Читаю снимок вселенной…</p>
  }

  if (coverage.kind === 'unreadable') {
    return (
      <p className="universe-picker__note universe-picker__note--alarm">
        Снимок вселенной прочитать не удалось ({coverage.reason}). Пустой список ниже{' '}
        <strong>не означает</strong>, что ничего не котируется: он означает, что мы не знаем.
        Добавить символ по-прежнему можно, но он потребует осознанного включения.
      </p>
    )
  }

  if (coverage.kind === 'never-synced') {
    return (
      <p className="universe-picker__note universe-picker__note--alarm">
        Снимок вселенной MDS ни разу не снимался. Запустите <code>pnpm run worker:mds</code> — до
        этого проверить котируемость нечем, и каждый символ придётся включать осознанно.
      </p>
    )
  }

  const quoted =
    coverage.quoted === null ? 'котируемость не определена' : `с ценой ${coverage.quoted}`

  return (
    <div className="universe-picker__note">
      <span>
        Снимок от {new Date(coverage.takenAt).toLocaleString('ru-RU')}:{' '}
        {coverage.instruments ?? '?'} инструментов, {quoted}.
      </span>
      {coverage.lastFailure === null ? null : (
        <span className="universe-picker__note--alarm">
          {' '}
          Последняя попытка обновить снимок не удалась: {OUTCOME_TEXT[coverage.lastFailure.outcome]}
          {coverage.lastFailure.reason === null ? '' : ` (${coverage.lastFailure.reason})`}. Снимок
          ниже — старый.
        </span>
      )}
    </div>
  )
}

export function UniversePicker(): React.JSX.Element {
  const { addFieldRow } = useForm()

  /** Текущий список символов читается из состояния формы, а не из документа. */
  const selected = useFormFields(([fields]) => {
    const symbols: string[] = []

    for (const [key, field] of Object.entries(fields ?? {})) {
      if (/^instruments\.\d+\.symbol$/.test(key) && typeof field?.value === 'string') {
        symbols.push(field.value.trim().toUpperCase())
      }
    }

    return symbols.join('\u0000')
  })

  const chosen = useMemo(() => new Set(selected === '' ? [] : selected.split('\u0000')), [selected])

  const [coverage, setCoverage] = useState<Coverage>({ kind: 'loading' })
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly UniverseRow[] | null>(null)
  const [searchFailed, setSearchFailed] = useState<string | null>(null)
  const [pending, setPending] = useState<UniverseRow | null>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    let alive = true

    const load = async () => {
      try {
        const [lastAny, lastFetched] = await Promise.all([
          getJson('/api/mds-universe-syncs?limit=1&sort=-startedAt&depth=0'),
          getJson(
            '/api/mds-universe-syncs?limit=1&sort=-startedAt&depth=0&where[outcome][equals]=fetched',
          ),
        ])

        if (!alive) {
          return
        }

        const latest = toSync(docsOf(lastAny)[0])
        const fetched = toSync(docsOf(lastFetched)[0])

        if (fetched === null) {
          setCoverage({ kind: 'never-synced' })
          return
        }

        setCoverage({
          kind: 'snapshot',
          takenAt: fetched.startedAt,
          instruments: fetched.instruments,
          quoted: fetched.quoted,
          lastFailure: latest !== null && latest.outcome !== 'fetched' ? latest : null,
        })
      } catch (error) {
        if (alive) {
          setCoverage({
            kind: 'unreadable',
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    void load()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const term = query.trim().toUpperCase()

    if (term.length < 2) {
      setResults(null)
      setSearchFailed(null)
      return
    }

    let alive = true
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const body = await getJson(
            `/api/mds-instruments?limit=${MAX_RESULTS}&sort=symbol&depth=0&where[symbol][like]=${encodeURIComponent(term)}`,
          )

          if (alive) {
            setResults(docsOf(body).map(toUniverseRow))
            setSearchFailed(null)
          }
        } catch (error) {
          if (alive) {
            setResults(null)
            setSearchFailed(error instanceof Error ? error.message : String(error))
          }
        }
      })()
    }, 250)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query])

  const add = useCallback(
    (row: UniverseRow, confirmed: boolean, why: string) => {
      addFieldRow({
        path: ARRAY_PATH,
        schemaPath: ARRAY_SCHEMA_PATH,
        subFieldState: {
          symbol: { initialValue: row.symbol, valid: true, value: row.symbol },
          confirmedUnquoted: { initialValue: confirmed, valid: true, value: confirmed },
          confirmedReason: { initialValue: why, valid: true, value: why },
        },
      })
    },
    [addFieldRow],
  )

  /**
   * Снимок есть и котировки опрашивались — только тогда «котируется» что-то
   * утверждает. В остальных случаях добавление идёт через подтверждение, и
   * формулировка причины отличается: «нет в MDS» и «не проверено» чинятся
   * по-разному.
   */
  const knowsQuoting = coverage.kind === 'snapshot' && coverage.quoted !== null

  return (
    <div className="universe-picker">
      <h4 className="universe-picker__title">Выбор из вселенной MDS</h4>
      <CoverageBanner coverage={coverage} />

      <input
        className="universe-picker__search"
        type="search"
        value={query}
        placeholder="Символ или название: не короче двух знаков"
        onChange={(event) => {
          setQuery(event.target.value)
        }}
      />

      {searchFailed === null ? null : (
        <p className="universe-picker__note universe-picker__note--alarm">
          Поиск по снимку не удался ({searchFailed}). Это отказ, а не пустой результат.
        </p>
      )}

      {results === null ? null : results.length === 0 ? (
        <p className="universe-picker__note">
          В снимке вселенной такого символа нет. Включить его всё равно можно — ниже, в списке
          инструментов, с отметкой «включаю осознанно» и причиной.
        </p>
      ) : (
        <ul className="universe-picker__list">
          {results.map((row) => {
            const already = chosen.has(row.symbol)
            const safe = knowsQuoting && row.quoted

            return (
              <li key={row.symbol} className="universe-picker__row">
                <span className="universe-picker__symbol">{row.symbol}</span>
                <span className="universe-picker__name">{row.name ?? '—'}</span>
                <span
                  className={
                    safe
                      ? 'universe-picker__badge universe-picker__badge--quoted'
                      : 'universe-picker__badge universe-picker__badge--unquoted'
                  }
                >
                  {!knowsQuoting ? 'не проверено' : row.quoted ? 'котируется' : 'нет цены'}
                </span>
                {already ? (
                  <span className="universe-picker__added">уже в списке</span>
                ) : (
                  <button
                    type="button"
                    className="universe-picker__add"
                    onClick={() => {
                      if (safe) {
                        add(row, false, '')
                      } else {
                        setPending(row)
                        setReason('')
                      }
                    }}
                  >
                    {safe ? 'Добавить' : 'Добавить осознанно…'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {pending === null ? null : (
        <div className="universe-picker__confirm">
          <p>
            <strong>{pending.symbol}</strong>{' '}
            {!knowsQuoting
              ? 'не проверен: снимка котировок нет, и «котируется» про него сказать нечего.'
              : 'есть в MDS, но цены у него на момент снимка не было: страница откроется и останется без котировки.'}{' '}
            Включить можно — но запись будет помечена и причина сохранится рядом с ней.
          </p>
          <input
            className="universe-picker__search"
            type="text"
            value={reason}
            placeholder="Почему включаем: ждём ключ провайдера, инструмент вернётся в понедельник…"
            onChange={(event) => {
              setReason(event.target.value)
            }}
          />
          <div className="universe-picker__actions">
            <button
              type="button"
              className="universe-picker__add"
              disabled={reason.trim().length < 3}
              onClick={() => {
                add(pending, true, reason.trim())
                setPending(null)
                setReason('')
              }}
            >
              Включить осознанно
            </button>
            <button
              type="button"
              className="universe-picker__cancel"
              onClick={() => {
                setPending(null)
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
