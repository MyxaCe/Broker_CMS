import { createLogger } from '@/platform'

import { drainOutbox } from './publisher'

import type { Publisher } from './publisher'
import type { Payload } from 'payload'

/**
 * Процесс, вывозящий события из outbox в шину (ТЗ 3.5).
 *
 * Без него outbox — это таблица, в которую пишут и из которой никто не читает.
 * Транзакционная запись события гарантирует, что оно **не потеряется**, но не
 * то, что оно кем-то будет отправлено; отправку выполняет отдельный процесс.
 *
 * Отдельный — намеренно: публикация не должна влиять на латентность выдачи, а
 * её перезапуск не должен обрывать обслуживание запросов.
 */

export interface PublishWorkerOptions {
  readonly payload: Payload
  readonly publisher: Publisher
  /** Пауза между проходами, когда отправлять нечего. */
  readonly idleDelayMs?: number
  /** Сколько событий берётся за проход. */
  readonly batchSize?: number
  /** Останавливает цикл. Проверяется между проходами. */
  readonly shouldStop?: () => boolean
  readonly sleep?: (ms: number) => Promise<void>
  /** Подменяется в тестах, чтобы прогон не писал в общий вывод. */
  readonly log?: WorkerLog
}

/** Ровно то, чем воркер пользуется. Полный интерфейс pino здесь ни к чему. */
export interface WorkerLog {
  info(fields: Record<string, unknown>, message: string): void
  error(fields: Record<string, unknown>, message: string): void
}

export interface PublishWorkerResult {
  readonly passes: number
  readonly published: number
  readonly failed: number
  readonly exhausted: number
}

const DEFAULT_IDLE_DELAY_MS = 1_000
const DEFAULT_BATCH_SIZE = 100

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function runPublishWorker(
  options: PublishWorkerOptions,
): Promise<PublishWorkerResult> {
  const log = options.log ?? createLogger({ component: 'outbox-publisher' })
  const idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const sleep = options.sleep ?? defaultSleep
  const shouldStop = options.shouldStop ?? (() => false)

  const totals = { passes: 0, published: 0, failed: 0, exhausted: 0 }

  while (!shouldStop()) {
    let drained

    try {
      drained = await drainOutbox({
        payload: options.payload,
        publisher: options.publisher,
        limit: batchSize,
      })
    } catch (error) {
      /**
       * Проход мог не состояться целиком — например, БД недоступна. Цикл не
       * прерывается: процесс, умирающий от временной недоступности хранилища,
       * перестаёт вывозить очередь ровно тогда, когда она начинает расти.
       */
      log.error({ err: error }, 'Проход по outbox не удался')
      await sleep(idleDelayMs)
      continue
    }

    totals.passes += 1
    totals.published += drained.published
    totals.failed += drained.failed
    totals.exhausted += drained.exhausted

    if (drained.published > 0 || drained.failed > 0) {
      log.info({ ...drained }, 'Проход по outbox завершён')
    }

    if (drained.exhausted > 0) {
      /**
       * Исчерпавшее попытки событие — это не «шумная ошибка», а факт: обещание
       * доставки нарушено. Оно обязано быть видимым отдельно от обычных сбоев,
       * потому что само уже не исправится.
       */
      log.error(
        { exhausted: drained.exhausted },
        'События исчерпали попытки и остались неотправленными',
      )
    }

    /**
     * Пауза только тогда, когда отправлять было нечего. Иначе накопившаяся
     * очередь вывозилась бы со скоростью «пачка в секунду» — то есть тем
     * медленнее, чем хуже дела.
     */
    if (drained.published === 0 && drained.failed === 0) {
      await sleep(idleDelayMs)
    }
  }

  return totals
}
