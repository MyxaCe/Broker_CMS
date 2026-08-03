import config from '@payload-config'
import { getPayload } from 'payload'

import { AmqpPublisher, runPublishWorker } from '@/modules/delivery'
import { createLogger, ensureEnv } from '@/platform'

/**
 * Точка входа публикатора событий.
 *
 * Запускается `pnpm run worker:outbox` — отдельным процессом от приложения.
 *
 * Файл намеренно тонкий: вся работа в модуле доставки, где она проверена. Здесь
 * только соединение с окружением и корректное завершение.
 */

const log = createLogger({ component: 'outbox-publisher-entry' })
const env = ensureEnv()

const payload = await getPayload({ config })
const publisher = new AmqpPublisher(env.BUS_URL, env.BUS_EXCHANGE)

let stopping = false

/**
 * Остановка кооперативная: текущий проход доводится до конца. Обрыв посреди
 * прохода оставил бы событие отправленным в шину, но не отмеченным в таблице —
 * то есть при следующем запуске оно ушло бы повторно.
 *
 * Идемпотентность потребителя по `event_id` это переживёт, но полагаться на неё
 * там, где можно просто не создавать дубликат, — плохая сделка.
 */
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

log.info({ exchange: env.BUS_EXCHANGE }, 'Публикатор запущен')

try {
  const totals = await runPublishWorker({
    payload,
    publisher,
    shouldStop: () => stopping,
  })

  log.info(totals, 'Публикатор остановлен')
} finally {
  await publisher.close()
}
