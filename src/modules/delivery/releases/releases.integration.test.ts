import { sql } from '@payloadcms/db-postgres'
import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { nextReleaseNumber } from './numbering'

import type { Payload } from 'payload'

/**
 * Релизы и каналы (ТЗ часть 3, разд. 3 «иммутабельность опубликованного»).
 *
 * Ключевое утверждение, которое проверяется здесь: **собранный релиз нельзя
 * изменить ни через приложение, ни напрямую в базе**. Без этого «откатились на
 * релиз 41» перестаёт что-либо значить — если 41 с тех пор мог измениться.
 */

let payload: Payload
let siteId: string

async function rawSql(query: string): Promise<void> {
  const db = payload.db as unknown as {
    drizzle: { execute: (statement: unknown) => Promise<unknown> }
  }
  await db.drizzle.execute(sql.raw(query))
}

async function isDenied(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    await operation()
    return false
  } catch {
    return true
  }
}

async function createRelease(number: number, status: 'building' | 'ready' | 'failed') {
  return payload.create({
    collection: 'releases',
    data: {
      siteId,
      siteSlug: 'apex-de',
      number,
      label: `apex-de #${number}`,
      status,
      snapshot: { pages: [] },
      contentHash: `hash-${number}`,
    } as never,
    overrideAccess: true,
  })
}

beforeAll(async () => {
  payload = await getPayload({ config })
  siteId = `site-${Date.now()}`
})

describe('нумерация релизов', () => {
  it('номера монотонны и свои у каждого сайта', async () => {
    const first = await createRelease(1, 'building')
    const second = await createRelease(2, 'building')

    const existing = await payload.find({
      collection: 'releases',
      where: { siteId: { equals: siteId } },
      pagination: false,
      overrideAccess: true,
    })

    const numbers = existing.docs.map((doc) => Number(doc.number))

    expect(numbers.sort()).toEqual([1, 2])
    expect(nextReleaseNumber(numbers)).toBe(3)
    expect(first.number).toBe(1)
    expect(second.number).toBe(2)
  })
})

describe('пока релиз собирается — его можно править', () => {
  it('правка разрешена в состоянии building', async () => {
    const release = await createRelease(10, 'building')

    const updated = await payload.update({
      collection: 'releases',
      id: release.id,
      data: { contentHash: 'hash-обновлён' } as never,
      overrideAccess: true,
    })

    expect(updated.contentHash).toBe('hash-обновлён')
  })

  it('несобранный релиз можно удалить напрямую — правило точное, а не «всё запрещено»', async () => {
    const release = await createRelease(11, 'building')

    await rawSql(`DELETE FROM releases WHERE id = ${Number(release.id)}`)

    expect(
      await isDenied(() =>
        payload.findByID({ collection: 'releases', id: release.id, overrideAccess: true }),
      ),
    ).toBe(true)
  })
})

describe('собранный релиз неизменяем', () => {
  let readyId: number | string

  beforeAll(async () => {
    const release = await createRelease(20, 'building')

    // Переход в «готов» — момент замораживания.
    const built = await payload.update({
      collection: 'releases',
      id: release.id,
      data: { status: 'ready', builtAt: new Date().toISOString() } as never,
      overrideAccess: true,
    })

    readyId = built.id
  })

  it('правка через приложение отклоняется', async () => {
    expect(
      await isDenied(() =>
        payload.update({
          collection: 'releases',
          id: readyId,
          data: { contentHash: 'подделка' } as never,
          overrideAccess: true,
        }),
      ),
    ).toBe(true)
  })

  it('UPDATE напрямую в базе отклоняется триггером', async () => {
    expect(
      await isDenied(() =>
        rawSql(`UPDATE releases SET content_hash = 'подделка' WHERE id = ${Number(readyId)}`),
      ),
    ).toBe(true)
  })

  it('DELETE напрямую в базе отклоняется триггером', async () => {
    expect(await isDenied(() => rawSql(`DELETE FROM releases WHERE id = ${Number(readyId)}`))).toBe(
      true,
    )
  })

  it('удаление через приложение запрещено правилом доступа', async () => {
    expect(
      await isDenied(() =>
        payload.delete({ collection: 'releases', id: readyId, overrideAccess: false }),
      ),
    ).toBe(true)
  })

  it('после всех попыток релиз не изменился', async () => {
    const release = await payload.findByID({
      collection: 'releases',
      id: readyId,
      overrideAccess: true,
    })

    expect(release.contentHash).toBe('hash-20')
    expect(release.status).toBe('ready')
  })

  it('проваленная сборка тоже замораживается — причина отказа не переписывается', async () => {
    const release = await createRelease(21, 'building')

    await payload.update({
      collection: 'releases',
      id: release.id,
      data: {
        status: 'failed',
        validationReport: { errors: ['страница без риск-предупреждения'] },
      } as never,
      overrideAccess: true,
    })

    expect(
      await isDenied(() =>
        rawSql(`UPDATE releases SET validation_report = '{}' WHERE id = ${Number(release.id)}`),
      ),
    ).toBe(true)
  })
})

describe('откат — это переключение канала', () => {
  it('канал переключается между релизами, релизы при этом не трогаются', async () => {
    const first = await createRelease(30, 'building')
    const second = await createRelease(31, 'building')

    for (const release of [first, second]) {
      await payload.update({
        collection: 'releases',
        id: release.id,
        data: { status: 'ready' } as never,
        overrideAccess: true,
      })
    }

    const channel = await payload.create({
      collection: 'channels',
      data: {
        siteId,
        siteSlug: 'apex-de',
        name: 'live',
        label: 'apex-de live',
        releaseId: String(second.id),
        releaseNumber: 31,
        switchedAt: new Date().toISOString(),
      } as never,
      overrideAccess: true,
    })

    expect(channel.releaseNumber).toBe(31)

    // Откат: указатель переводится на предыдущий релиз.
    const rolledBack = await payload.update({
      collection: 'channels',
      id: channel.id,
      data: {
        releaseId: String(first.id),
        releaseNumber: 30,
        switchedAt: new Date().toISOString(),
      } as never,
      overrideAccess: true,
    })

    expect(rolledBack.releaseNumber).toBe(30)

    // Оба релиза на месте и неизменны.
    const releases = await payload.find({
      collection: 'releases',
      where: { and: [{ siteId: { equals: siteId } }, { number: { in: [30, 31] } }] },
      pagination: false,
      overrideAccess: true,
    })

    expect(releases.docs).toHaveLength(2)
    expect(releases.docs.every((doc) => doc.status === 'ready')).toBe(true)
  })

  it('переключение канала попадает в журнал аудита', async () => {
    const events = await payload.find({
      collection: 'audit-events',
      where: {
        and: [{ targetCollection: { equals: 'channels' } }, { tenantId: { equals: siteId } }],
      },
      pagination: false,
      overrideAccess: true,
      sort: 'createdAt',
    })

    /**
     * История публикаций и откатов восстанавливается из журнала — отдельной
     * таблицы для неё не заводили намеренно (ADR-0015).
     */
    expect(events.docs.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(events.docs.at(-1)?.changes)).toContain('releaseNumber')
  })
})
