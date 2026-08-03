import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { switchChannel } from './publish'

import type { Payload, PayloadRequest } from 'payload'

/**
 * Публикация, откат и транзакционность события (ТЗ часть 3, 3.5).
 *
 * Ключевое утверждение: **переключение канала и событие о нём происходят
 * атомарно**. Не бывает публикации, о которой никто не узнал, и события о
 * публикации, которой не было.
 */

let payload: Payload
const stamp = Date.now()
const siteId = `pub-site-${stamp}`
const siteSlug = `apex-pub-${stamp}`

async function channelOf(name: string): Promise<Record<string, unknown> | undefined> {
  const found = await payload.find({
    collection: 'channels',
    where: { and: [{ siteId: { equals: siteId } }, { name: { equals: name } }] },
    pagination: false,
    overrideAccess: true,
  })

  return found.docs[0] as unknown as Record<string, unknown> | undefined
}

async function eventsForSite(): Promise<Record<string, unknown>[]> {
  const found = await payload.find({
    collection: 'outbox',
    where: { tenantId: { equals: siteId } },
    pagination: false,
    overrideAccess: true,
    sort: 'occurredAt',
  })

  return found.docs as unknown as Record<string, unknown>[]
}

beforeAll(async () => {
  payload = await getPayload({ config })
})

describe('публикация', () => {
  it('канал начинает указывать на релиз, событие поставлено в очередь', async () => {
    const result = await switchChannel({
      payload,
      siteId,
      siteSlug,
      channel: 'live',
      releaseId: '100',
      releaseNumber: 1,
      intent: 'publish',
    })

    const channel = await channelOf('live')
    const events = await eventsForSite()

    expect(channel?.releaseNumber).toBe(1)
    expect(result.previousReleaseId).toBeNull()
    expect(events.map((event) => event.routingKey)).toContain('cms.release.published.v1')
  })

  it('событие несёт метки для сброса кеша у потребителя', async () => {
    const events = await eventsForSite()
    const body = events.at(-1)?.payload as Record<string, unknown>

    expect(body.changedTags).toEqual([`site:${siteSlug}`])
  })
})

describe('откат', () => {
  it('канал возвращается на предыдущий релиз', async () => {
    await switchChannel({
      payload,
      siteId,
      siteSlug,
      channel: 'live',
      releaseId: '101',
      releaseNumber: 2,
      intent: 'publish',
    })

    const result = await switchChannel({
      payload,
      siteId,
      siteSlug,
      channel: 'live',
      releaseId: '100',
      releaseNumber: 1,
      intent: 'rollback',
    })

    expect(result.previousReleaseNumber).toBe(2)
    expect((await channelOf('live'))?.releaseNumber).toBe(1)
  })

  /**
   * Откат и публикация — одно действие, но в журнале они обязаны различаться:
   * иначе «вернулись назад» и «выпустили новое» неотличимы.
   */
  it('откат отличается от публикации ключом события', async () => {
    const events = await eventsForSite()
    expect(events.at(-1)?.routingKey).toBe('cms.release.rolled_back.v1')
  })
})

describe('атомарность: событие и переключение неразделимы', () => {
  /**
   * Самая важная проверка модуля. Прежняя CMS теряла события при перезапуске,
   * потому что отправка жила отдельно от изменения. Здесь они в одной
   * транзакции — и откат транзакции обязан убрать оба следа.
   */
  it('откат транзакции не оставляет ни переключения, ни события', async () => {
    const before = await channelOf('staging')
    const eventsBefore = (await eventsForSite()).length

    const transactionID = await payload.db.beginTransaction()
    expect(transactionID, 'база не поддерживает транзакции — проверка бессмысленна').toBeTruthy()

    const req = { transactionID } as unknown as PayloadRequest

    await switchChannel({
      payload,
      siteId,
      siteSlug,
      channel: 'staging',
      releaseId: '999',
      releaseNumber: 99,
      intent: 'publish',
      req,
    })

    await payload.db.rollbackTransaction(transactionID!)

    expect(await channelOf('staging'), 'канал сохранился после отката').toEqual(before)
    expect((await eventsForSite()).length, 'событие пережило откат').toBe(eventsBefore)
  })

  it('успешная транзакция оставляет оба следа', async () => {
    const eventsBefore = (await eventsForSite()).length

    const transactionID = await payload.db.beginTransaction()
    const req = { transactionID } as unknown as PayloadRequest

    await switchChannel({
      payload,
      siteId,
      siteSlug,
      channel: 'staging',
      releaseId: '200',
      releaseNumber: 5,
      intent: 'publish',
      req,
    })

    await payload.db.commitTransaction(transactionID!)

    expect((await channelOf('staging'))?.releaseNumber).toBe(5)
    expect((await eventsForSite()).length).toBe(eventsBefore + 1)
  })
})
