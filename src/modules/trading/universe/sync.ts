import { buildUniverseSnapshot } from '../allow-list/universe'

import { fetchUniverse } from './mds'

import type { UniverseEntry, UniverseState } from '../allow-list/universe'
import type { FetchLike } from './mds'
import type { Payload } from 'payload'

/**
 * Снятие снимка вселенной и его чтение.
 *
 * Запись — только отсюда и только из воркера. Чтение — отовсюду, но из базы,
 * а не из MDS.
 */

export interface SyncResult {
  readonly outcome: 'fetched' | 'unreachable' | 'malformed'
  readonly instruments: number | null
  readonly quoted: number | null
  readonly reason: string | null
}

/**
 * Снимает вселенную и переписывает локальный снимок.
 *
 * Неудачный снимок **не стирает** предыдущий. Стереть его значило бы
 * превратить недоступность MDS в «ничего не котируется» — и получить
 * мгновенное требование подтверждать каждый символ, включая те, что
 * котировались минуту назад. Вместо этого в журнал ложится запись с исходом,
 * и возраст снимка виден редактору.
 */
export async function syncUniverse(args: {
  readonly payload: Payload
  readonly baseUrl: string
  readonly fetchImpl: FetchLike
  readonly now?: () => Date
}): Promise<SyncResult> {
  const now = args.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const result = await fetchUniverse({ baseUrl: args.baseUrl, fetchImpl: args.fetchImpl })

  if (result.outcome === 'fetched') {
    await writeSnapshot(args.payload, result.entries, startedAt)
  }

  await args.payload.create({
    collection: 'mds-universe-syncs',
    overrideAccess: true,
    data: {
      startedAt,
      finishedAt: now().toISOString(),
      outcome: result.outcome,
      instruments: result.outcome === 'fetched' ? result.entries.length : null,
      quoted: result.quoted,
      reason: result.reason,
      source: args.baseUrl,
    } as never,
  })

  return {
    outcome: result.outcome,
    instruments: result.outcome === 'fetched' ? result.entries.length : null,
    quoted: result.quoted,
    reason: result.reason,
  }
}

/**
 * Переписывает снимок под новую вселенную.
 *
 * Исчезнувшие символы удаляются: снимок обязан быть снимком, а не объединением
 * всего, что когда-либо котировалось. Символ, выпавший из MDS, но оставшийся в
 * снимке, выглядел бы в интерфейсе разрешённым к включению без пометки.
 */
async function writeSnapshot(
  payload: Payload,
  entries: readonly UniverseEntry[],
  syncedAt: string,
): Promise<void> {
  const existing = await payload.find({
    collection: 'mds-instruments',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  const bySymbol = new Map(
    existing.docs.map((doc) => [String((doc as { symbol?: unknown }).symbol ?? ''), doc.id]),
  )

  for (const entry of entries) {
    const id = bySymbol.get(entry.symbol)
    const data = { ...entry, syncedAt } as never

    if (id === undefined) {
      await payload.create({ collection: 'mds-instruments', overrideAccess: true, data })
    } else {
      await payload.update({ collection: 'mds-instruments', id, overrideAccess: true, data })
      bySymbol.delete(entry.symbol)
    }
  }

  for (const id of bySymbol.values()) {
    await payload.delete({ collection: 'mds-instruments', id, overrideAccess: true })
  }
}

/**
 * Читает состояние знания о вселенной.
 *
 * `null` возвращается в двух случаях, и оба означают одно и то же — «проверить
 * нечем»: журнал снимков пуст (не снимали ни разу) или последний успешный
 * снимок отсутствует. Пустой снимок при этом `null` **не** является: ноль
 * инструментов, подтверждённый успешным снимком, — это знание.
 */
export async function readUniverse(payload: Payload): Promise<UniverseState> {
  const lastFetched = await payload.find({
    collection: 'mds-universe-syncs',
    where: { outcome: { equals: 'fetched' } },
    sort: '-startedAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  const sync = lastFetched.docs[0] as
    { startedAt?: unknown; instruments?: unknown; quoted?: unknown } | undefined

  if (sync === undefined) {
    return null
  }

  const instruments = await payload.find({
    collection: 'mds-instruments',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  const entries: UniverseEntry[] = instruments.docs.map((doc) => {
    const raw = doc as unknown as Record<string, unknown>
    return {
      symbol: String(raw.symbol ?? ''),
      name: typeof raw.name === 'string' ? raw.name : null,
      group: typeof raw.group === 'string' ? raw.group : null,
      category: typeof raw.category === 'string' ? raw.category : null,
      provider: typeof raw.provider === 'string' ? raw.provider : null,
      quoted: raw.quoted === true,
    }
  })

  return buildUniverseSnapshot({
    takenAt: typeof sync.startedAt === 'string' ? sync.startedAt : new Date(0).toISOString(),
    entries,
    quoted: typeof sync.quoted === 'number' ? sync.quoted : null,
  })
}
