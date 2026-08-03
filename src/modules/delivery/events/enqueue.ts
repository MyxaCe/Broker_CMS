import { randomUUID } from 'node:crypto'

import { buildEnvelope } from './envelope'

import type { CmsEventName, EventEnvelope } from './envelope'
import type { Payload, PayloadRequest } from 'payload'

/**
 * Постановка события в outbox.
 *
 * `req` передаётся обязательно, когда событие сопровождает изменение: только
 * так запись попадает в **ту же транзакцию**. Без этого возможен разрыв —
 * изменение откатилось, а событие о нём ушло, или наоборот.
 */
export interface EnqueueArgs {
  readonly payload: Payload
  readonly event: CmsEventName
  readonly body: Record<string, unknown>
  readonly tenantId: string | null
  /** Транзакция изменения. Отсутствует только у событий, не связанных с записью. */
  readonly req?: PayloadRequest
  /** Для повторяемых тестов и для идемпотентной повторной постановки. */
  readonly eventId?: string
  readonly occurredAt?: Date
}

export async function enqueueEvent(args: EnqueueArgs): Promise<EventEnvelope> {
  const occurredAt = args.occurredAt ?? new Date()

  const envelope = buildEnvelope({
    eventId: args.eventId ?? randomUUID(),
    occurredAt,
    event: args.event,
    payload: args.body,
  })

  await args.payload.create({
    collection: 'outbox',
    overrideAccess: true,
    ...(args.req ? { req: args.req } : {}),
    data: {
      eventId: envelope.event_id,
      routingKey: envelope.routing_key,
      payload: envelope.payload,
      occurredAt: envelope.occurred_at,
      attempts: 0,
      /**
       * Первая попытка — немедленно: задержка нужна только между повторами,
       * а не перед первой отправкой.
       */
      nextAttemptAt: occurredAt.toISOString(),
      tenantId: args.tenantId,
    } as never,
  })

  return envelope
}
