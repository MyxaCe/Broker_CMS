/**
 * Статус эфира (ТЗ 1.2).
 *
 * «Ручное поле live/upcoming/past гарантированно протухнет» — поэтому статус
 * выводится из времени в момент ответа и в базе не хранится. Разойтись со
 * временем он не может: его там нет.
 */

export const BROADCAST_STATES = ['upcoming', 'live', 'past'] as const

export type BroadcastState = (typeof BROADCAST_STATES)[number]

export const BROADCAST_LABELS: Record<BroadcastState, string> = {
  upcoming: 'Скоро',
  live: 'В эфире',
  past: 'Запись',
}

export interface Broadcast {
  readonly startsAt?: unknown
  readonly endsAt?: unknown
}

function toTime(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime()
  }

  if (typeof value !== 'string' || value === '') {
    return null
  }

  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Состояние эфира.
 *
 * Запись без времени начала считается **записью**, а не предстоящим эфиром:
 * подавляющая часть видео на сайте брокера — это ролики, а не трансляции, и
 * заставлять редактора проставлять им фиктивное время начала значит собирать
 * недостоверные данные ради формы.
 */
export function broadcastState(video: Broadcast, now: Date): BroadcastState {
  const startsAt = toTime(video.startsAt)

  if (startsAt === null) {
    return 'past'
  }

  const moment = now.getTime()

  if (moment < startsAt) {
    return 'upcoming'
  }

  const endsAt = toTime(video.endsAt)

  /**
   * Эфир без времени окончания считается идущим. Обратное умолчание означало
   * бы, что начавшаяся трансляция мгновенно превращается в запись — а именно
   * времени окончания у прямого эфира обычно и не знают заранее.
   */
  if (endsAt === null || moment < endsAt) {
    return 'live'
  }

  return 'past'
}

/**
 * Ближайший момент, когда состояние эфира изменится само собой.
 *
 * Нужен ровно затем же, зачем переходы видимости: ответ с идущим эфиром
 * нельзя кешировать дольше, чем до его окончания.
 */
export function nextBroadcastTransition(video: Broadcast, now: Date): Date | null {
  const moment = now.getTime()
  const startsAt = toTime(video.startsAt)

  if (startsAt !== null && startsAt > moment) {
    return new Date(startsAt)
  }

  const endsAt = toTime(video.endsAt)

  if (endsAt !== null && endsAt > moment) {
    return new Date(endsAt)
  }

  return null
}
