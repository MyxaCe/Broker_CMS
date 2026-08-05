import { describe, expect, it } from 'vitest'

import { broadcastState, nextBroadcastTransition } from './broadcast'

const NOW = new Date('2026-08-05T12:00:00.000Z')

describe('состояние эфира', () => {
  it('до начала — «скоро»', () => {
    expect(broadcastState({ startsAt: '2026-08-05T13:00:00.000Z' }, NOW)).toBe('upcoming')
  })

  it('между началом и окончанием — «в эфире»', () => {
    expect(
      broadcastState(
        { startsAt: '2026-08-05T11:00:00.000Z', endsAt: '2026-08-05T13:00:00.000Z' },
        NOW,
      ),
    ).toBe('live')
  })

  it('после окончания — «запись»', () => {
    expect(
      broadcastState(
        { startsAt: '2026-08-05T09:00:00.000Z', endsAt: '2026-08-05T10:00:00.000Z' },
        NOW,
      ),
    ).toBe('past')
  })

  /**
   * У прямой трансляции время окончания обычно неизвестно заранее. Обратное
   * умолчание превращало бы начавшийся эфир в запись мгновенно.
   */
  it('начавшийся эфир без окончания считается идущим', () => {
    expect(broadcastState({ startsAt: '2026-08-05T11:00:00.000Z' }, NOW)).toBe('live')
  })

  /**
   * Подавляющая часть видео на сайте брокера — ролики, а не трансляции.
   * Заставлять редактора проставлять им фиктивное время начала значит
   * собирать недостоверные данные ради формы.
   */
  it('видео без времени начала — запись, а не предстоящий эфир', () => {
    expect(broadcastState({}, NOW)).toBe('past')
    expect(broadcastState({ startsAt: null }, NOW)).toBe('past')
  })

  it('испорченное время начала не делает ролик предстоящим', () => {
    expect(broadcastState({ startsAt: 'завтра' }, NOW)).toBe('past')
  })

  it('границы: ровно в начале — уже эфир, ровно в конце — уже запись', () => {
    const moment = NOW.toISOString()

    expect(broadcastState({ startsAt: moment }, NOW)).toBe('live')
    expect(broadcastState({ startsAt: '2026-08-05T11:00:00.000Z', endsAt: moment }, NOW)).toBe(
      'past',
    )
  })

  /** Состояние выводится, а не хранится: то же видео меняет его само со временем. */
  it('одно и то же видео меняет состояние со временем', () => {
    const video = { startsAt: '2026-08-05T12:30:00.000Z', endsAt: '2026-08-05T13:30:00.000Z' }

    expect(broadcastState(video, new Date('2026-08-05T12:00:00.000Z'))).toBe('upcoming')
    expect(broadcastState(video, new Date('2026-08-05T13:00:00.000Z'))).toBe('live')
    expect(broadcastState(video, new Date('2026-08-05T14:00:00.000Z'))).toBe('past')
  })
})

describe('ближайший переход эфира', () => {
  it('до начала — момент начала', () => {
    expect(
      nextBroadcastTransition({ startsAt: '2026-08-05T13:00:00.000Z' }, NOW)?.toISOString(),
    ).toBe('2026-08-05T13:00:00.000Z')
  })

  /** Ответ с идущим эфиром нельзя кешировать дольше, чем до его окончания. */
  it('во время эфира — момент окончания', () => {
    expect(
      nextBroadcastTransition(
        { startsAt: '2026-08-05T11:00:00.000Z', endsAt: '2026-08-05T13:00:00.000Z' },
        NOW,
      )?.toISOString(),
    ).toBe('2026-08-05T13:00:00.000Z')
  })

  it('у записи перехода нет', () => {
    expect(
      nextBroadcastTransition(
        { startsAt: '2026-08-05T09:00:00.000Z', endsAt: '2026-08-05T10:00:00.000Z' },
        NOW,
      ),
    ).toBeNull()
  })

  it('у эфира без окончания перехода нет', () => {
    expect(nextBroadcastTransition({ startsAt: '2026-08-05T11:00:00.000Z' }, NOW)).toBeNull()
  })
})
