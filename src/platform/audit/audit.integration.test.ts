import { sql } from '@payloadcms/db-postgres'
import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Payload } from 'payload'

/**
 * Журнал аудита: доказуемость и неизменяемость (ТЗ 5.2, разд. 3).
 *
 * Проверяется не только то, что события пишутся, но и то, что их **нельзя
 * переписать** — включая попытку в обход приложения, напрямую в базе. Журнал,
 * который можно поправить, доказательством не является, а проверить это
 * утверждение можно только на живой БД.
 */

const PASSWORD = 'audit-integration-password-32ch!'

let payload: Payload
let brandId: number | string

/** Прямое обращение к базе — мимо приложения, как это сделал бы посторонний. */
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

/**
 * Выборка обязательно сужается коллекцией: идентификаторы у разных коллекций
 * свои и совпадают сплошь и рядом. Первая версия этого не делала и притащила
 * события о пользователе в проверку событий о тенанте.
 */
async function eventsFor(
  targetCollection: string,
  targetId: string | number,
): Promise<Record<string, unknown>[]> {
  const result = await payload.find({
    collection: 'audit-events',
    where: {
      and: [
        { targetCollection: { equals: targetCollection } },
        { targetId: { equals: String(targetId) } },
      ],
    },
    pagination: false,
    overrideAccess: true,
    sort: 'createdAt',
  })

  return result.docs as unknown as Record<string, unknown>[]
}

beforeAll(async () => {
  payload = await getPayload({ config })

  const brand = await payload.create({
    collection: 'tenants',
    data: { name: 'Аудит-бренд', slug: `audit-brand-${Date.now()}`, kind: 'brand' } as never,
    overrideAccess: true,
  })

  brandId = brand.id
})

describe('журнал пополняется', () => {
  it('создание тенанта фиксируется', async () => {
    const created = (await eventsFor('tenants', brandId)).filter(
      (event) => event.action === 'create',
    )

    expect(created).toHaveLength(1)
    expect(created[0]?.targetCollection).toBe('tenants')
    expect(created[0]?.tenantSlug).toMatch(/^audit-brand-/)
  })

  it('изменение фиксируется вместе с изменившимся полем', async () => {
    await payload.update({
      collection: 'tenants',
      id: brandId,
      data: { name: 'Аудит-бренд, переименован' } as never,
      overrideAccess: true,
    })

    const updates = (await eventsFor('tenants', brandId)).filter(
      (event) => event.action === 'update',
    )

    expect(updates.length).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(updates.at(-1)?.changes)).toContain('name')
  })

  it('сохранение без изменений не засоряет журнал', async () => {
    const before = (await eventsFor('tenants', brandId)).length

    await payload.update({
      collection: 'tenants',
      id: brandId,
      data: { name: 'Аудит-бренд, переименован' } as never,
      overrideAccess: true,
    })

    expect((await eventsFor('tenants', brandId)).length).toBe(before)
  })
})

describe('секреты и связи не утекают в журнал', () => {
  let userId: number | string
  let dump = ''

  beforeAll(async () => {
    const user = await payload.create({
      collection: 'users',
      data: {
        email: `audit-${Date.now()}@example.test`,
        password: PASSWORD,
        fullName: 'Аудит',
        role: 'developer',
        tenants: [],
        isActive: true,
      } as never,
      overrideAccess: true,
    })

    userId = user.id
    dump = JSON.stringify(await eventsFor('users', userId))
  })

  it('значение пароля не попадает в журнал', () => {
    expect(dump).not.toContain(PASSWORD)
  })

  /**
   * Фиксирует ТЕКУЩЕЕ поведение, а не желаемое: Payload не возвращает пароль
   * в документе, поэтому обобщённый хук его не видит, и смена пароля в журнал
   * не попадает вовсе — [[DEBT-004]].
   *
   * Тест намеренно упадёт, когда пробел закроют: это напоминание обновить его
   * вместе с реализацией, а не молчаливое согласие с пробелом.
   */
  it('смена пароля пока НЕ фиксируется — известный пробел, DEBT-004', () => {
    expect(dump).not.toContain('password')
  })

  it('связанный документ сворачивается до идентификатора, а не копируется целиком', async () => {
    const site = await payload.create({
      collection: 'tenants',
      data: {
        name: 'Проверка связей',
        slug: `audit-rel-${Date.now()}`,
        kind: 'site',
        parent: brandId,
        jurisdiction: { mode: 'override', value: 'xx-test' },
        availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
        defaultLocale: { mode: 'override', value: 'en' },
      } as never,
      overrideAccess: true,
    })

    const events = JSON.stringify(await eventsFor('tenants', site.id))

    /**
     * Название родителя внутри записи означало бы, что в журнал дочернего
     * тенанта скопированы данные вышестоящего — то есть чужие поля видны тому,
     * кого они не касаются.
     */
    expect(events).not.toContain('Аудит-бренд')
    expect(events).toContain('"parent"')
  })
})

describe('журнал неизменяем через приложение', () => {
  it('запись нельзя изменить', async () => {
    const [event] = await eventsFor('tenants', brandId)

    expect(
      await isDenied(() =>
        payload.update({
          collection: 'audit-events',
          id: event!.id as number,
          data: { summary: 'подделка' } as never,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
  })

  it('запись нельзя удалить', async () => {
    const [event] = await eventsFor('tenants', brandId)

    expect(
      await isDenied(() =>
        payload.delete({
          collection: 'audit-events',
          id: event!.id as number,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
  })

  it('событие нельзя создать снаружи', async () => {
    expect(
      await isDenied(() =>
        payload.create({
          collection: 'audit-events',
          data: {
            occurredAt: new Date().toISOString(),
            action: 'approve',
            targetCollection: 'tenants',
            summary: 'подложное согласование',
          } as never,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
  })
})

describe('журнал неизменяем в обход приложения', () => {
  /**
   * Ключевые проверки. Правило приложения защищает от ошибки в коде; эти —
   * от прямого подключения к базе, чужого скрипта и миграции с опечаткой.
   */
  it('UPDATE напрямую в базе отклоняется триггером', async () => {
    expect(await isDenied(() => rawSql(`UPDATE audit_events SET summary = 'подделка'`))).toBe(true)
  })

  it('DELETE напрямую в базе отклоняется триггером', async () => {
    expect(await isDenied(() => rawSql(`DELETE FROM audit_events`))).toBe(true)
  })

  it('TRUNCATE отклоняется триггером', async () => {
    expect(await isDenied(() => rawSql(`TRUNCATE audit_events`))).toBe(true)
  })

  it('после всех попыток записи на месте', async () => {
    const events = await eventsFor('tenants', brandId)

    expect(events.length).toBeGreaterThan(0)
    expect(events.every((event) => event.summary !== 'подделка')).toBe(true)
  })
})

describe('журнал переживает удаление того, о чём свидетельствует', () => {
  it('удаление тенанта не стирает записи о нём', async () => {
    const site = await payload.create({
      collection: 'tenants',
      data: {
        name: 'Временный сайт',
        slug: `audit-temp-${Date.now()}`,
        kind: 'site',
        parent: brandId,
        jurisdiction: { mode: 'override', value: 'xx-test' },
        availableLocales: { mode: 'extend', items: [{ code: 'en' }] },
        defaultLocale: { mode: 'override', value: 'en' },
      } as never,
      overrideAccess: true,
    })

    expect(await eventsFor('tenants', site.id)).not.toHaveLength(0)

    /**
     * Если бы журнал ссылался на тенанта внешним ключом, удаление либо стёрло
     * бы записи каскадом, либо обнулило ссылку — то есть изменило журнал, что
     * запрещено триггером и сделало бы удаление тенанта невозможным.
     */
    await payload.delete({ collection: 'tenants', id: site.id, overrideAccess: true })

    const after = await eventsFor('tenants', site.id)

    expect(after.length).toBeGreaterThanOrEqual(2)
    expect(after.some((event) => event.action === 'delete')).toBe(true)
    expect(after.every((event) => event.tenantId === String(site.id))).toBe(true)
  })
})
