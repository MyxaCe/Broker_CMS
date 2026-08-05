import { describe, expect, it } from 'vitest'

import {
  earliestTransition,
  isVisible,
  nextTransitionAt,
  publishedWhere,
  visibilityState,
} from './visibility'

import type { Publishable } from './visibility'

const NOW = new Date('2026-08-05T12:00:00.000Z')

function record(overrides: Publishable = {}): Publishable {
  return {
    status: 'published',
    publishAt: '2026-08-01T00:00:00.000Z',
    unpublishAt: null,
    ...overrides,
  }
}

describe('видимость записи', () => {
  it('опубликованная запись с наступившей датой видна', () => {
    expect(isVisible(record(), NOW)).toBe(true)
  })

  it.each([
    ['черновик', { status: 'draft' }],
    ['архив', { status: 'archived' }],
    ['дата публикации в будущем', { publishAt: '2026-09-01T00:00:00.000Z' }],
    ['дата снятия прошла', { unpublishAt: '2026-08-04T00:00:00.000Z' }],
  ])('невидима: %s', (_name, overrides) => {
    expect(isVisible(record(overrides), NOW)).toBe(false)
  })

  /**
   * Обратное умолчание означало бы, что забытое поле открывает запись наружу.
   * В регулируемом домене это худший вид умолчания.
   */
  it('запись без даты публикации невидима', () => {
    expect(isVisible(record({ publishAt: null }), NOW)).toBe(false)
    expect(isVisible({ status: 'published' }, NOW)).toBe(false)
  })

  it('испорченная дата не делает запись видимой', () => {
    expect(isVisible(record({ publishAt: 'вчера' }), NOW)).toBe(false)
  })

  /** Ровно в момент публикации запись уже видна, ровно в момент снятия — уже нет. */
  it('границы включаются в пользу однозначности', () => {
    const moment = NOW.toISOString()

    expect(isVisible(record({ publishAt: moment }), NOW)).toBe(true)
    expect(isVisible(record({ unpublishAt: moment }), NOW)).toBe(false)
  })
})

describe('условие выборки и проверка записи согласованы', () => {
  /**
   * Два способа проверить одно и то же — это две возможности разойтись.
   * Здесь закреплено, что условие выборки описывает ровно то же состояние,
   * что и `isVisible`: те же три поля и те же границы.
   */
  it('условие опирается на те же поля и границы', () => {
    const where = publishedWhere(NOW)
    const dump = JSON.stringify(where)

    expect(dump).toContain('"status"')
    expect(dump).toContain('"publishAt"')
    expect(dump).toContain('"unpublishAt"')
    expect(dump).toContain('less_than_equal')
    expect(dump).toContain('greater_than')
    expect(dump).toContain(NOW.toISOString())
  })

  /** Отсутствие даты снятия обязано означать «висит бессрочно», а не «невидимо». */
  it('условие допускает пустую дату снятия', () => {
    expect(JSON.stringify(publishedWhere(NOW))).toContain('exists')
  })
})

describe('состояние для редактора', () => {
  it.each([
    ['live', {}],
    ['draft', { status: 'draft' }],
    ['archived', { status: 'archived' }],
    ['scheduled', { publishAt: '2026-09-01T00:00:00.000Z' }],
    ['expired', { unpublishAt: '2026-08-04T00:00:00.000Z' }],
  ])('%s', (expected, overrides) => {
    expect(visibilityState(record(overrides), NOW)).toBe(expected)
  })

  /** «Запланировано» — вывод из пары «состояние + время», а не хранимое значение. */
  it('запланированное отличается от черновика только временем', () => {
    const scheduled = record({ publishAt: '2026-09-01T00:00:00.000Z' })

    expect(visibilityState(scheduled, NOW)).toBe('scheduled')
    expect(visibilityState(scheduled, new Date('2026-09-02T00:00:00.000Z'))).toBe('live')
  })
})

describe('ближайший переход', () => {
  it('у бессрочно висящей записи перехода нет', () => {
    expect(nextTransitionAt(record(), NOW)).toBeNull()
  })

  it('ожидающая публикации переходит в момент публикации', () => {
    const moment = nextTransitionAt(record({ publishAt: '2026-08-06T00:00:00.000Z' }), NOW)

    expect(moment?.toISOString()).toBe('2026-08-06T00:00:00.000Z')
  })

  it('видимая с датой снятия переходит в момент снятия', () => {
    const moment = nextTransitionAt(record({ unpublishAt: '2026-08-07T00:00:00.000Z' }), NOW)

    expect(moment?.toISOString()).toBe('2026-08-07T00:00:00.000Z')
  })

  it('из двух будущих переходов берётся ближайший', () => {
    const moment = nextTransitionAt(
      record({ publishAt: '2026-08-09T00:00:00.000Z', unpublishAt: '2026-08-07T00:00:00.000Z' }),
      NOW,
    )

    expect(moment?.toISOString()).toBe('2026-08-07T00:00:00.000Z')
  })

  it('у черновика перехода нет: он не станет видимым сам по себе', () => {
    expect(
      nextTransitionAt(record({ status: 'draft', publishAt: '2026-08-06T00:00:00.000Z' }), NOW),
    ).toBeNull()
  })

  /**
   * Это значение ограничивает срок жизни кеша. Ошибка здесь означает, что
   * погасшее промо продолжает висеть — требование «промо гаснет само»
   * перестаёт выполняться (ADR-0021).
   */
  it('по набору записей берётся самый ранний переход', () => {
    const moment = earliestTransition(
      [
        record({ unpublishAt: '2026-08-20T00:00:00.000Z' }),
        record({ unpublishAt: '2026-08-06T10:00:00.000Z' }),
        record(),
      ],
      NOW,
    )

    expect(moment?.toISOString()).toBe('2026-08-06T10:00:00.000Z')
  })

  it('пустой набор перехода не даёт', () => {
    expect(earliestTransition([], NOW)).toBeNull()
  })
})
