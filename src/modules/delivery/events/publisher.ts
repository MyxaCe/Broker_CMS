import amqplib from 'amqplib'

import { isExhausted, nextAttemptAt } from './backoff'

import type { EventEnvelope } from './envelope'
import type { ChannelModel, ConfirmChannel } from 'amqplib'
import type { Payload } from 'payload'

/**
 * Публикатор событий из outbox в шину платформы (ТЗ 3.5).
 *
 * Работает отдельным процессом от выдачи: публикация не должна влиять на
 * латентность ответов, а её перезапуск — обрывать обслуживание запросов.
 */

export interface Publisher {
  publish(envelope: EventEnvelope): Promise<void>
  close(): Promise<void>
}

/**
 * Публикация с подтверждениями брокера.
 *
 * `waitForConfirms` обязателен: без него «отправлено» означает лишь «передано
 * в сокет», и событие теряется при разрыве соединения. Это ровно тот дефект,
 * ради устранения которого outbox и заводится — было бы странно повторить его
 * на последнем шаге.
 */
export class AmqpPublisher implements Publisher {
  private connection: ChannelModel | null = null
  private channel: ConfirmChannel | null = null

  constructor(
    private readonly url: string,
    private readonly exchange: string,
  ) {}

  private async ensureChannel(): Promise<ConfirmChannel> {
    if (this.channel) {
      return this.channel
    }

    this.connection = await amqplib.connect(this.url)

    this.connection.on('close', () => {
      this.connection = null
      this.channel = null
    })

    this.channel = await this.connection.createConfirmChannel()

    /**
     * Обменник объявляется, а не предполагается: сервис должен подниматься на
     * чистом контуре. `durable` — потому что переживать перезапуск брокера
     * обязаны и обменник, и сообщения.
     */
    await this.channel.assertExchange(this.exchange, 'topic', { durable: true })

    return this.channel
  }

  async publish(envelope: EventEnvelope): Promise<void> {
    const channel = await this.ensureChannel()

    channel.publish(this.exchange, envelope.routing_key, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: 'application/json',
      messageId: envelope.event_id,
      timestamp: Math.floor(Date.parse(envelope.occurred_at) / 1000),
    })

    await channel.waitForConfirms()
  }

  async close(): Promise<void> {
    await this.channel?.close().catch(() => undefined)
    await this.connection?.close().catch(() => undefined)
    this.channel = null
    this.connection = null
  }
}

export interface DrainResult {
  readonly published: number
  readonly failed: number
  readonly exhausted: number
}

/**
 * Отправляет накопившиеся события.
 *
 * Выбираются только неотправленные и только те, чьё время попытки наступило —
 * для этого в БД стоит частичный индекс. Полный перебор таблицы недопустим:
 * она растёт вместе с историей и никогда не очищается.
 */
export async function drainOutbox(args: {
  readonly payload: Payload
  readonly publisher: Publisher
  readonly now?: Date
  readonly limit?: number
}): Promise<DrainResult> {
  const now = args.now ?? new Date()
  const limit = args.limit ?? 100

  const pending = await args.payload.find({
    collection: 'outbox',
    where: {
      and: [
        { publishedAt: { exists: false } },
        { nextAttemptAt: { less_than_equal: now.toISOString() } },
      ],
    },
    sort: 'occurredAt',
    limit,
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  let published = 0
  let failed = 0
  let exhausted = 0

  for (const doc of pending.docs) {
    const record = doc as unknown as Record<string, unknown>

    const envelope: EventEnvelope = {
      event_id: String(record.eventId),
      occurred_at: String(record.occurredAt),
      routing_key: String(record.routingKey),
      payload: (record.payload ?? {}) as Record<string, unknown>,
    }

    try {
      await args.publisher.publish(envelope)

      await args.payload.update({
        collection: 'outbox',
        id: doc.id,
        overrideAccess: true,
        data: { publishedAt: now.toISOString(), lastError: null } as never,
      })

      published += 1
    } catch (error) {
      const attempts = Number(record.attempts ?? 0) + 1
      const message = error instanceof Error ? error.message : String(error)

      if (isExhausted(attempts)) {
        exhausted += 1
      }

      failed += 1

      /**
       * Исчерпанное событие остаётся неотправленным и с отметкой об ошибке:
       * оно не удаляется и не «дотравливается» тихо. Экран доставки показывает
       * его редактору, а кнопка повтора сбрасывает время следующей попытки.
       */
      await args.payload.update({
        collection: 'outbox',
        id: doc.id,
        overrideAccess: true,
        data: {
          attempts,
          lastError: message.slice(0, 500),
          nextAttemptAt: nextAttemptAt(attempts, now, Math.random() * 0.2).toISOString(),
        } as never,
      })
    }
  }

  return { published, failed, exhausted }
}
