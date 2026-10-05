import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Payload } from 'payload'

/**
 * Барьер включения инструмента — на живой базе (Р-026).
 *
 * Тест на чистую функцию уже есть рядом и успокаивает сильнее, чем имеет
 * право: он проверяет правило, а не путь «форма → хук → база». Дефект
 * стоп-словаря прожил месяц при зелёных тестах на валидатор ровно потому, что
 * цепочку целиком не проверял никто.
 *
 * Здесь проверяется цепочка: запись идёт через локальное API Payload — то
 * есть мимо интерфейса, — и обязана быть отвергнута сервером. Если бы
 * проверка жила в React-компоненте, все эти тесты были бы зелёными при
 * полностью снятой защите.
 */

let payload: Payload
let quotedSiteId: number | string
let barrenSiteId: number | string

const stamp = Date.now()

async function makeSite(slug: string): Promise<number | string> {
  const site = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: slug,
      slug,
      kind: 'brand',
      jurisdiction: { mode: 'override', value: 'eu-mifid' },
      availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
      defaultLocale: { mode: 'override', value: 'en' },
    } as never,
  })

  return site.id
}

/** Текст отказа целиком: по нему проверяется, что названа верная причина. */
async function refusalOf(siteId: number | string, instruments: unknown[]): Promise<string> {
  try {
    await payload.create({
      collection: 'instrument-access',
      overrideAccess: true,
      data: { site: siteId, instruments } as never,
    })
  } catch (error) {
    return error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : String(error)
  }

  throw new Error('ожидался отказ, но запись прошла')
}

beforeAll(async () => {
  payload = await getPayload({ config })

  /** Чистое состояние: прошлый прогон мог оставить снимок вселенной. */
  for (const collection of [
    'instrument-access',
    'mds-instruments',
    'mds-universe-syncs',
  ] as const) {
    await payload.delete({
      collection,
      where: { id: { exists: true } },
      overrideAccess: true,
    })
  }

  quotedSiteId = await makeSite(`alw-a-${stamp}`)
  barrenSiteId = await makeSite(`alw-b-${stamp}`)
}, 120_000)

describe('снимка вселенной нет', () => {
  it('включение требует подтверждения, и причина названа «не проверено»', async () => {
    const message = await refusalOf(barrenSiteId, [{ symbol: 'BTCUSD' }])

    expect(message).toContain('Снимок вселенной MDS не получен')
    // Отказ соседа не превращается в разрешение, но и не врёт про «не котируется».
    expect(message).toContain('неизвестно')
  })

  it('пустой список сохраняется и означает «ничего не разрешено»', async () => {
    const doc = await payload.create({
      collection: 'instrument-access',
      overrideAccess: true,
      data: { site: barrenSiteId, instruments: [] } as never,
    })

    expect(doc.instruments).toEqual([])
    expect(doc.instrumentCount).toBe(0)
  })
})

describe('снимок вселенной снят', () => {
  beforeAll(async () => {
    const syncedAt = new Date().toISOString()

    await payload.create({
      collection: 'mds-instruments',
      overrideAccess: true,
      data: { symbol: 'BTCUSD', name: 'Bitcoin', quoted: true, syncedAt } as never,
    })

    await payload.create({
      collection: 'mds-instruments',
      overrideAccess: true,
      data: { symbol: 'XAUUSD', name: 'Золото', quoted: false, syncedAt } as never,
    })

    await payload.create({
      collection: 'mds-universe-syncs',
      overrideAccess: true,
      data: {
        startedAt: syncedAt,
        finishedAt: syncedAt,
        outcome: 'fetched',
        instruments: 2,
        quoted: 1,
        source: 'http://mds.test',
      } as never,
    })
  }, 120_000)

  it('котируемый символ сохраняется без подтверждения и помечается как котируемый', async () => {
    const doc = await payload.create({
      collection: 'instrument-access',
      overrideAccess: true,
      data: { site: quotedSiteId, instruments: [{ symbol: 'btcusd' }] } as never,
    })

    expect(doc.instruments).toMatchObject([
      { symbol: 'BTCUSD', confirmedUnquoted: false, standingAtSave: 'quoted' },
    ])
    expect(doc.instrumentCount).toBe(1)
    /** Денормализованный slug нужен журналу аудита и заголовку списка. */
    expect(doc.siteSlug).toBe(`alw-a-${stamp}`)
  })

  it('символа нет в MDS — запись отклоняется с этой причиной', async () => {
    const message = await refusalOf(quotedSiteId, [{ symbol: 'EURUSD' }])

    expect(message).toContain('не котирует вовсе')
    expect(message).toContain('Проверено по снимку вселенной')
  })

  it('есть в MDS, но без цены — другая причина, тоже отказ', async () => {
    const message = await refusalOf(quotedSiteId, [{ symbol: 'XAUUSD' }])

    expect(message).toContain('цены у него на момент снимка не было')
  })

  it('подтверждение без причины не проходит', async () => {
    const message = await refusalOf(quotedSiteId, [{ symbol: 'EURUSD', confirmedUnquoted: true }])

    expect(message).toContain('только с галочкой')
  })

  it('осознанное включение проходит и остаётся помеченным в базе', async () => {
    const updated = await payload.update({
      collection: 'instrument-access',
      where: { site: { equals: quotedSiteId } },
      overrideAccess: true,
      data: {
        instruments: [
          { symbol: 'BTCUSD' },
          {
            symbol: 'EURUSD',
            confirmedUnquoted: true,
            confirmedReason: 'ключ платного провайдера ждём к пятнице',
          },
        ],
      } as never,
    })

    const doc = updated.docs[0] as { instruments?: unknown[] } | undefined
    const rows = (doc?.instruments ?? []) as Record<string, unknown>[]

    expect(rows.map((row) => row.symbol)).toEqual(['BTCUSD', 'EURUSD'])
    expect(rows[1]).toMatchObject({
      confirmedUnquoted: true,
      standingAtSave: 'absent',
      confirmedReason: 'ключ платного провайдера ждём к пятнице',
    })
    /** Пометка проставлена системой, а не редактором: он её не вводил. */
    expect(typeof rows[1]?.checkedAt).toBe('string')
  })
})
