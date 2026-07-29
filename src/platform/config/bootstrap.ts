import { EnvValidationError, initEnv } from './env'

import type { Env } from './env'

/**
 * Точка старта процесса. Вызывается первой, до поднятия HTTP-сервера и до
 * подключения к чему бы то ни было.
 *
 * Fail-closed: при невалидной конфигурации процесс завершается с кодом 1 и
 * читаемым списком проблем — до приёма первого запроса. Никакого «поднимемся
 * и будем отвечать 500»: наполовину сконфигурированный сервис в регулируемом
 * домене хуже недоступного, потому что выглядит работающим.
 */
export function bootstrapEnv(): Env {
  try {
    return initEnv()
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(
        [
          '',
          '  Запуск невозможен: конфигурация окружения неполна или неверна.',
          '',
          ...error.issues.map((issue) => `    · ${issue}`),
          '',
          '  Полный перечень переменных — в .env.example.',
          '',
        ].join('\n') + '\n',
      )
      process.exit(1)
    }
    throw error
  }
}
