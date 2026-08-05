import type { Where } from 'payload'

/**
 * Видимость записи потока (ТЗ 1.2, 1.3).
 *
 * Здесь только чистая логика: что считается видимым и как это выражается
 * условием выборки. Подключение к коллекциям — в `access.ts`.
 *
 * Ключевое свойство: видимость это **пара** «состояние + время», а не одно
 * состояние. Запись с состоянием «опубликовано» и датой публикации в будущем
 * — такой же черновик, как и явный черновик, и не должна быть видна ни секунды
 * раньше срока.
 */

/**
 * Состояния записи. Закрытый перечень.
 *
 * «Запланировано» здесь нет намеренно: это не состояние, а следствие пары
 * «опубликовано + дата в будущем». Отдельное состояние пришлось бы менять
 * по расписанию — то есть заводить механизм, который умеет разойтись со
 * временем. Ровно та же причина, по которой у эфира нет хранимого статуса.
 */
export const STREAM_STATUSES = ['draft', 'published', 'archived'] as const

export type StreamStatus = (typeof STREAM_STATUSES)[number]

export const STREAM_STATUS_LABELS: Record<StreamStatus, string> = {
  draft: 'Черновик',
  published: 'Опубликовано',
  archived: 'В архиве',
}

/** Что редактор видит в списке — выводится, а не хранится. */
export const VISIBILITY_STATES = ['draft', 'scheduled', 'live', 'expired', 'archived'] as const

export type VisibilityState = (typeof VISIBILITY_STATES)[number]

export interface Publishable {
  readonly status?: unknown
  readonly publishAt?: unknown
  readonly unpublishAt?: unknown
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value !== 'string' || value === '') {
    return null
  }

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Условие выборки видимого.
 *
 * Уходит в SQL и потому не может быть забыто, обойдено или сломано
 * рефакторингом прикладного кода (ADR-0021).
 *
 * Отсутствующая дата публикации трактуется как **невидимо**: у записи без
 * `publishAt` момент публикации не наступал. Обратное умолчание означало бы,
 * что забытое поле открывает запись наружу.
 */
export function publishedWhere(now: Date): Where {
  const moment = now.toISOString()

  return {
    and: [
      { status: { equals: 'published' } },
      { publishAt: { less_than_equal: moment } },
      {
        or: [{ unpublishAt: { exists: false } }, { unpublishAt: { greater_than: moment } }],
      },
    ],
  }
}

/**
 * Та же проверка на отдельной записи.
 *
 * Нужна не вместо условия выборки, а рядом с ним: снапшоты, события и
 * предпросмотр работают с уже прочитанным документом. Расхождение между этими
 * двумя проверками было бы дырой, поэтому они закреплены общим тестом.
 */
export function isVisible(record: Publishable, now: Date): boolean {
  if (record.status !== 'published') {
    return false
  }

  const publishAt = toDate(record.publishAt)

  if (publishAt === null || publishAt.getTime() > now.getTime()) {
    return false
  }

  const unpublishAt = toDate(record.unpublishAt)

  return unpublishAt === null || unpublishAt.getTime() > now.getTime()
}

/** Состояние для редактора: выводится из пары «состояние + время». */
export function visibilityState(record: Publishable, now: Date): VisibilityState {
  if (record.status === 'archived') {
    return 'archived'
  }

  if (record.status !== 'published') {
    return 'draft'
  }

  const publishAt = toDate(record.publishAt)

  if (publishAt === null || publishAt.getTime() > now.getTime()) {
    return 'scheduled'
  }

  const unpublishAt = toDate(record.unpublishAt)

  if (unpublishAt !== null && unpublishAt.getTime() <= now.getTime()) {
    return 'expired'
  }

  return 'live'
}

/**
 * Ближайший момент, в который видимость записи изменится сама собой.
 *
 * От этого зависит срок жизни кеша: ответ ленты меняется без единой записи в
 * базу, и кеш, переживший этот момент, показывает погасшее промо (ADR-0021).
 *
 * `null` означает «сама собой не изменится».
 */
export function nextTransitionAt(record: Publishable, now: Date): Date | null {
  if (record.status !== 'published') {
    return null
  }

  const publishAt = toDate(record.publishAt)
  const unpublishAt = toDate(record.unpublishAt)

  const upcoming = [publishAt, unpublishAt].filter(
    (moment): moment is Date => moment !== null && moment.getTime() > now.getTime(),
  )

  if (upcoming.length === 0) {
    return null
  }

  return upcoming.reduce((earliest, moment) => (moment < earliest ? moment : earliest))
}

/**
 * Ближайший переход по набору записей.
 *
 * Именно это значение ограничивает срок жизни ответа сверху.
 */
export function earliestTransition(records: readonly Publishable[], now: Date): Date | null {
  let earliest: Date | null = null

  for (const record of records) {
    const moment = nextTransitionAt(record, now)

    if (moment !== null && (earliest === null || moment < earliest)) {
      earliest = moment
    }
  }

  return earliest
}
