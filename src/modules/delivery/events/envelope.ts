/**
 * Конверт события и ключи маршрутизации (ТЗ 3.5, [[ADR-0017]]).
 *
 * Форма повторяет соглашение платформы: обменник `platform.events` общий, и
 * потребитель, читающий `terminal.*`, обязан так же читать `cms.*`.
 */

/** Домен наших событий в общем обменнике. */
export const EVENT_DOMAIN = 'cms'

/**
 * Версия в ключе маршрутизации, а не только в теле.
 *
 * Изменение формы события без смены ключа ломает подписчиков молча. Версия в
 * ключе позволяет какое-то время публиковать обе формы, пока подписчики
 * переезжают.
 */
export const EVENT_VERSION = 'v1'

export const CMS_EVENTS = {
  releasePublished: 'release.published',
  releaseRolledBack: 'release.rolled_back',
  streamPublished: 'stream.published',
} as const

export type CmsEventName = (typeof CMS_EVENTS)[keyof typeof CMS_EVENTS]

export class RoutingKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoutingKeyError'
  }
}

/**
 * `cms.release.published.v1`
 *
 * Точка — разделитель уровней в topic-обменнике: подписка `cms.release.*.v1`
 * должна попадать ровно на события релизов. Поэтому точка внутри сегмента
 * запрещена: она бы создала лишний уровень и сломала чужие подписки.
 */
export function buildRoutingKey(event: CmsEventName, version: string = EVENT_VERSION): string {
  for (const segment of [event, version]) {
    if (segment.trim() === '') {
      throw new RoutingKeyError('Пустой сегмент ключа маршрутизации.')
    }
  }

  if (!/^v\d+$/.test(version)) {
    throw new RoutingKeyError(`Версия должна иметь вид "v1", получено "${version}".`)
  }

  return `${EVENT_DOMAIN}.${event}.${version}`
}

export interface EventEnvelope {
  /** Идемпотентность потребителя стоит на нём. */
  readonly event_id: string
  readonly occurred_at: string
  readonly routing_key: string
  readonly payload: Record<string, unknown>
}

export function buildEnvelope(args: {
  readonly eventId: string
  readonly occurredAt: Date
  readonly event: CmsEventName
  readonly payload: Record<string, unknown>
}): EventEnvelope {
  return {
    event_id: args.eventId,
    occurred_at: args.occurredAt.toISOString(),
    routing_key: buildRoutingKey(args.event),
    payload: args.payload,
  }
}
