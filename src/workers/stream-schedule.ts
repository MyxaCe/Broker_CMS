import config from '@payload-config'
import { getPayload } from 'payload'

import { runScheduleTick } from '@/modules/delivery'
import { createLogger } from '@/platform'

/**
 * Точка входа планировщика переходов потока.
 *
 * Запускается `pnpm run worker:schedule`.
 *
 * Планировщик не влияет на корректность: материал появляется и гаснет сам по
 * времени (ADR-0021). Здесь только объявление переходов в шину, по которому
 * потребители сбрасывают кеш сразу, а не по истечении срока жизни ответа.
 */

const TICK_MS = 30_000

const log = createLogger({ component: 'stream-scheduler-entry' })
const payload = await getPayload({ config })

let stopping = false

function requestStop(signal: string): void {
  if (stopping) {
    return
  }

  stopping = true
  log.info({ signal }, 'Получен сигнал остановки, завершаю текущий проход')
}

process.on('SIGINT', () => {
  requestStop('SIGINT')
})
process.on('SIGTERM', () => {
  requestStop('SIGTERM')
})

/**
 * Начальная граница окна — момент запуска.
 *
 * Переходы, случившиеся, пока планировщик не работал, **не** объявляются
 * задним числом. Событие «материал опубликован» через час после публикации
 * дезинформирует: потребитель сбросит кеш и увидит то же, что видел. Витрина
 * к этому времени уже обновилась сама.
 */
let since = new Date()

log.info({ tickMs: TICK_MS }, 'Планировщик потока запущен')

while (!stopping) {
  try {
    const result = await runScheduleTick({ payload, since })
    since = result.until
  } catch (error) {
    /** Проход мог не состояться целиком. Цикл не прерывается по той же причине,
     * что и у публикатора: процесс, умирающий от временной недоступности базы,
     * перестаёт работать ровно тогда, когда это нужнее всего. */
    log.error({ err: error }, 'Проход планировщика не удался')
  }

  await new Promise((resolve) => setTimeout(resolve, TICK_MS))
}

log.info({}, 'Планировщик потока остановлен')
