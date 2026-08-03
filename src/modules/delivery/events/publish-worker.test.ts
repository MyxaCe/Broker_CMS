import { describe, expect, it, vi } from 'vitest'

import { runPublishWorker } from './publish-worker'

import type * as PublisherModule from './publisher'
import type { Payload } from 'payload'

/**
 * Цикл публикатора. Сам `drainOutbox` проверяется на живой базе и настоящей
 * шине; здесь проверяется то, что вокруг него: остановка, паузы и поведение
 * при отказе прохода.
 */

function payloadStub(): Payload {
  return {} as Payload
}

/**
 * Подменяет один проход. `drainOutbox` вызывается изнутри воркера, поэтому
 * подменяется на уровне модуля.
 */
vi.mock('./publisher', async (importOriginal) => {
  const actual = await importOriginal<typeof PublisherModule>()

  return { ...actual, drainOutbox: vi.fn() }
})

const { drainOutbox } = await import('./publisher')
const drain = vi.mocked(drainOutbox)

const publisher = { publish: async () => undefined, close: async () => undefined }

/** Молчаливый журнал: прогон тестов не должен писать в общий вывод. */
const log = { info: () => undefined, error: () => undefined }

function empty() {
  return { published: 0, failed: 0, exhausted: 0 }
}

describe('цикл публикатора', () => {
  it('останавливается по требованию между проходами', async () => {
    drain.mockResolvedValue(empty())
    let passes = 0

    const result = await runPublishWorker({
      payload: payloadStub(),
      publisher,
      log,
      sleep: async () => undefined,
      shouldStop: () => {
        passes += 1
        return passes > 3
      },
    })

    expect(result.passes).toBe(3)
  })

  /**
   * Пауза после непустого прохода означала бы, что очередь вывозится тем
   * медленнее, чем она длиннее — то есть ровно наоборот к нужному.
   */
  it('не делает паузу, пока есть что отправлять', async () => {
    drain.mockResolvedValue({ published: 5, failed: 0, exhausted: 0 })
    const sleep = vi.fn(async () => undefined)
    let passes = 0

    await runPublishWorker({
      payload: payloadStub(),
      publisher,
      log,
      sleep,
      shouldStop: () => {
        passes += 1
        return passes > 2
      },
    })

    expect(sleep).not.toHaveBeenCalled()
  })

  it('делает паузу, когда отправлять нечего', async () => {
    drain.mockResolvedValue(empty())
    const sleep = vi.fn(async () => undefined)
    let passes = 0

    await runPublishWorker({
      payload: payloadStub(),
      publisher,
      log,
      idleDelayMs: 777,
      sleep,
      shouldStop: () => {
        passes += 1
        return passes > 2
      },
    })

    expect(sleep).toHaveBeenCalledWith(777)
  })

  /**
   * Процесс, умирающий от временной недоступности хранилища, перестаёт вывозить
   * очередь ровно тогда, когда она начинает расти.
   */
  it('переживает отказ прохода и продолжает', async () => {
    drain
      .mockRejectedValueOnce(new Error('БД недоступна'))
      .mockResolvedValue({ published: 1, failed: 0, exhausted: 0 })

    let passes = 0

    const result = await runPublishWorker({
      payload: payloadStub(),
      publisher,
      log,
      sleep: async () => undefined,
      shouldStop: () => {
        passes += 1
        return passes > 3
      },
    })

    /** Первый проход провалился и в счёт не пошёл, два следующих — прошли. */
    expect(result.published).toBe(2)
  })

  it('суммирует итоги проходов', async () => {
    drain.mockResolvedValue({ published: 2, failed: 1, exhausted: 1 })
    let passes = 0

    const result = await runPublishWorker({
      payload: payloadStub(),
      publisher,
      log,
      sleep: async () => undefined,
      shouldStop: () => {
        passes += 1
        return passes > 2
      },
    })

    expect(result).toEqual({ passes: 2, published: 4, failed: 2, exhausted: 2 })
  })
})
