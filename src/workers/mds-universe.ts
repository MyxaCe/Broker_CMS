import config from '@payload-config'
import { getPayload } from 'payload'

import { syncUniverse } from '@/modules/trading'
import { createLogger, getEnv } from '@/platform'

/**
 * Точка входа снимка вселенной MDS.
 *
 * Запускается `pnpm run worker:mds`.
 *
 * ТЗ 4.2: CMS не обращается к MDS синхронно. Весь трафик к соседу живёт здесь
 * и только здесь — ни админка, ни сборка релиза, ни выдача в MDS не ходят.
 * Иначе лежащий сосед делал бы невозможной правку наших собственных данных.
 */

const TICK_MS = 5 * 60_000

const log = createLogger({ component: 'mds-universe-entry' })
const env = getEnv()
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

log.info({ tickMs: TICK_MS, source: env.MDS_HTTP_URL }, 'Снимок вселенной MDS запущен')

while (!stopping) {
  try {
    const result = await syncUniverse({
      payload,
      baseUrl: env.MDS_HTTP_URL,
      fetchImpl: fetch,
    })

    /**
     * Неудачный снимок логируется предупреждением, а не молча: подавленная
     * диагностика дороже шумной, а «вселенной нет» оборачивается для редактора
     * требованием подтверждать каждый символ — и он должен иметь возможность
     * узнать, почему.
     */
    if (result.outcome === 'fetched') {
      log.info(result, 'Вселенная снята')
    } else {
      log.warn(result, 'Снимок вселенной не состоялся — прежний снимок сохранён')
    }
  } catch (error) {
    log.error({ err: error }, 'Проход снимка не удался')
  }

  await new Promise((resolve) => setTimeout(resolve, TICK_MS))
}

log.info({}, 'Снимок вселенной MDS остановлен')
