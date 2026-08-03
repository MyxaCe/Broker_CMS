import { describe, expect, it } from 'vitest'

import {
  BASE_DELAY_MS,
  isExhausted,
  MAX_ATTEMPTS,
  MAX_DELAY_MS,
  nextAttemptAt,
  nextAttemptDelayMs,
} from './backoff'
import { buildEnvelope, buildRoutingKey, CMS_EVENTS, RoutingKeyError } from './envelope'

describe('buildRoutingKey — соглашение платформы', () => {
  it('ключ имеет вид домен.событие.версия', () => {
    expect(buildRoutingKey(CMS_EVENTS.releasePublished)).toBe('cms.release.published.v1')
  })

  it.each([
    [CMS_EVENTS.releaseRolledBack, 'cms.release.rolled_back.v1'],
    [CMS_EVENTS.streamPublished, 'cms.stream.published.v1'],
  ])('строит ключ для %s', (event, expected) => {
    expect(buildRoutingKey(event)).toBe(expected)
  })

  /**
   * Подписка `cms.release.*.v1` должна попадать ровно на события релизов.
   * Лишний уровень в сегменте сломал бы чужие подписки, поэтому версия
   * проверяется по форме.
   */
  it.each(['', '1', 'version1', 'v', 'v1.2'])('отвергает версию "%s"', (version) => {
    expect(() => buildRoutingKey(CMS_EVENTS.releasePublished, version)).toThrow(RoutingKeyError)
  })

  it('принимает следующую мажорную версию', () => {
    expect(buildRoutingKey(CMS_EVENTS.releasePublished, 'v2')).toBe('cms.release.published.v2')
  })
})

describe('buildEnvelope', () => {
  const envelope = buildEnvelope({
    eventId: 'e-1',
    occurredAt: new Date('2026-08-03T10:00:00.000Z'),
    event: CMS_EVENTS.releasePublished,
    payload: { site: 'apex-de', releaseId: '42' },
  })

  it('несёт идентификатор события — на нём идемпотентность потребителя', () => {
    expect(envelope.event_id).toBe('e-1')
  })

  it('время — когда произошло, в ISO', () => {
    expect(envelope.occurred_at).toBe('2026-08-03T10:00:00.000Z')
  })

  it('ключ маршрутизации внутри конверта, а не только в свойствах сообщения', () => {
    expect(envelope.routing_key).toBe('cms.release.published.v1')
  })

  it('тело передаётся как есть', () => {
    expect(envelope.payload).toEqual({ site: 'apex-de', releaseId: '42' })
  })
})

describe('nextAttemptDelayMs — задержка между повторами', () => {
  it('первая задержка — базовая', () => {
    expect(nextAttemptDelayMs(0)).toBe(BASE_DELAY_MS)
  })

  it('растёт вдвое с каждой попыткой', () => {
    expect(nextAttemptDelayMs(1)).toBe(BASE_DELAY_MS * 2)
    expect(nextAttemptDelayMs(2)).toBe(BASE_DELAY_MS * 4)
  })

  it('упирается в потолок и не растёт бесконечно', () => {
    expect(nextAttemptDelayMs(100)).toBe(MAX_DELAY_MS)
  })

  /**
   * Без разброса все накопившиеся события повторяются одновременно и добивают
   * шину ровно в момент, когда она только поднялась.
   */
  it('разброс только увеличивает задержку', () => {
    const base = nextAttemptDelayMs(3)
    expect(nextAttemptDelayMs(3, 0.2)).toBeGreaterThan(base)
    expect(nextAttemptDelayMs(3, -0.5)).toBe(base)
  })

  it.each([-1, 1.5, Number.NaN])('отвергает недопустимое число попыток %s', (attempts) => {
    expect(() => nextAttemptDelayMs(attempts)).toThrow(RangeError)
  })
})

describe('nextAttemptAt', () => {
  it('отсчитывается от переданного времени', () => {
    const now = new Date('2026-08-03T10:00:00.000Z')
    expect(nextAttemptAt(0, now).toISOString()).toBe('2026-08-03T10:00:05.000Z')
  })
})

describe('isExhausted', () => {
  it('до предела попытки продолжаются', () => {
    expect(isExhausted(MAX_ATTEMPTS - 1)).toBe(false)
  })

  /**
   * Бесконечные попытки — это не надёжность, а способ никогда не заметить
   * проблему: очередь растёт, а тревоги нет.
   */
  it('после предела событие становится видимым', () => {
    expect(isExhausted(MAX_ATTEMPTS)).toBe(true)
    expect(isExhausted(MAX_ATTEMPTS + 5)).toBe(true)
  })
})
