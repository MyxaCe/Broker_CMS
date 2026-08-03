import config from '@payload-config'
import { getPayload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { ensureEnv } from '@/platform'

import { CMS_EVENTS } from './envelope'
import { enqueueEvent } from './enqueue'
import { AmqpPublisher, drainOutbox } from './publisher'

import type { EventEnvelope } from './envelope'
import type { Publisher } from './publisher'
import type { Payload } from 'payload'

/**
 * Транзакционный outbox (ТЗ 3.5).
 *
 * Главное проверяемое утверждение: **не бывает изменения без события и события
 * без изменения**. Именно этого не хватало прежней CMS, где инвалидация уходила
 * HTTP-вызовом с ретраями в памяти процесса и терялась при перезапуске.
 */

let payload: Payload
const stamp = Date.now()

/** Публикатор, который всегда падает, — для проверки повторов. */
class FailingPublisher implements Publisher {
  constructor(readonly message = 'шина недоступна') {}
  async publish(): Promise<void> {
    throw new Error(this.message)
  }
  async close(): Promise<void> {}
}

/** Публикатор, который всё принимает, — для проверки успешного пути. */
class CollectingPublisher implements Publisher {
  readonly sent: EventEnvelope[] = []
  async publish(envelope: EventEnvelope): Promise<void> {
    this.sent.push(envelope)
  }
  async close(): Promise<void> {}
}

async function outboxFor(eventId: string): Promise<Record<string, unknown> | undefined> {
  const found = await payload.find({
    collection: 'outbox',
    where: { eventId: { equals: eventId } },
    pagination: false,
    overrideAccess: true,
  })

  return found.docs[0] as unknown as Record<string, unknown> | undefined
}

beforeAll(async () => {
  payload = await getPayload({ config })
})

describe('постановка события', () => {
  it('событие попадает в очередь готовым к отправке', async () => {
    const envelope = await enqueueEvent({
      payload,
      event: CMS_EVENTS.releasePublished,
      body: { site: 'apex-de', releaseNumber: 1 },
      tenantId: `t-${stamp}`,
    })

    const record = await outboxFor(envelope.event_id)

    expect(record?.routingKey).toBe('cms.release.published.v1')
    expect(record?.publishedAt).toBeFalsy()
    expect(record?.attempts).toBe(0)
  })

  it('идентификатор события уникален — повтор с тем же не создаёт двойника', async () => {
    const eventId = `dup-${stamp}`

    await enqueueEvent({
      payload,
      event: CMS_EVENTS.streamPublished,
      body: {},
      tenantId: null,
      eventId,
    })

    let rejected = false
    try {
      await enqueueEvent({
        payload,
        event: CMS_EVENTS.streamPublished,
        body: {},
        tenantId: null,
        eventId,
      })
    } catch {
      rejected = true
    }

    expect(rejected, 'второе событие с тем же идентификатором сохранилось').toBe(true)
  })
})

describe('отправка и повторы', () => {
  it('успешная отправка помечает событие отправленным', async () => {
    const envelope = await enqueueEvent({
      payload,
      event: CMS_EVENTS.releasePublished,
      body: { n: 1 },
      tenantId: `send-${stamp}`,
    })

    const publisher = new CollectingPublisher()
    await drainOutbox({ payload, publisher })

    const record = await outboxFor(envelope.event_id)

    expect(publisher.sent.map((item) => item.event_id)).toContain(envelope.event_id)
    expect(record?.publishedAt).toBeTruthy()
  })

  it('отправленное второй раз не уходит', async () => {
    const publisher = new CollectingPublisher()
    const result = await drainOutbox({ payload, publisher })

    expect(result.published).toBe(0)
  })

  it('сбой не теряет событие, а откладывает попытку', async () => {
    const envelope = await enqueueEvent({
      payload,
      event: CMS_EVENTS.releaseRolledBack,
      body: { n: 2 },
      tenantId: `fail-${stamp}`,
    })

    const result = await drainOutbox({ payload, publisher: new FailingPublisher() })
    const record = await outboxFor(envelope.event_id)

    expect(result.failed).toBeGreaterThanOrEqual(1)
    expect(record?.publishedAt).toBeFalsy()
    expect(record?.attempts).toBe(1)
    expect(String(record?.lastError)).toContain('шина недоступна')
    expect(new Date(String(record?.nextAttemptAt)).getTime()).toBeGreaterThan(Date.now())
  })

  it('отложенное событие не выбирается до срока', async () => {
    const result = await drainOutbox({ payload, publisher: new CollectingPublisher() })
    expect(result.published).toBe(0)
  })

  it('после наступления срока событие уходит', async () => {
    const publisher = new CollectingPublisher()
    const future = new Date(Date.now() + 60 * 60 * 1000)

    const result = await drainOutbox({ payload, publisher, now: future })

    expect(result.published).toBeGreaterThanOrEqual(1)
  })
})

describe('реальная шина', () => {
  /**
   * Проверка с подтверждениями брокера. Без `waitForConfirms` «отправлено»
   * означает лишь «передано в сокет» — то есть ровно тот дефект, ради
   * устранения которого outbox и заводится.
   */
  it('событие уходит в RabbitMQ и подтверждается', async () => {
    const envelope = await enqueueEvent({
      payload,
      event: CMS_EVENTS.releasePublished,
      body: { real: true },
      tenantId: `amqp-${stamp}`,
    })

    /**
     * Адрес берётся из проверенной конфигурации, а не зашивается в тест:
     * зашитый адрес работает ровно на той машине, где его написали. Этот тест
     * из-за него упал в CI, где порт другой.
     */
    const env = ensureEnv()
    const publisher = new AmqpPublisher(env.BUS_URL, env.BUS_EXCHANGE)

    try {
      const result = await drainOutbox({ payload, publisher })
      expect(result.published).toBeGreaterThanOrEqual(1)
    } finally {
      await publisher.close()
    }

    const record = await outboxFor(envelope.event_id)
    expect(record?.publishedAt).toBeTruthy()
  })
})
