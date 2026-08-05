import config from '@payload-config'
import { getPayload } from 'payload'

import { createPayloadSource, RedisRateLimiter } from '@/modules/delivery'
import { ensureEnv } from '@/platform'

import type { DeliverySource } from '@/modules/delivery'

/**
 * Сборка источника доставки для маршрутов.
 *
 * Общая на все ресурсы: иначе каждый новый маршрут повторял бы подключение
 * ограничителя, и достаточно одного забытого, чтобы дверь оказалась без
 * предела частоты.
 *
 * Файл не является маршрутом: в файловом роутинге Next маршрут создаёт только
 * `route.ts` или `page.tsx`.
 */

/**
 * Соединение с Redis переживает запросы и общее для всех маршрутов:
 * подключаться заново на каждый вызов значило бы платить за это на самых
 * горячих ручках сервиса.
 */
let limiter: RedisRateLimiter | null = null

export async function deliverySource(): Promise<DeliverySource> {
  const env = ensureEnv()
  const payload = await getPayload({ config })

  limiter ??= new RedisRateLimiter({ url: env.REDIS_URL })

  return createPayloadSource({
    payload,
    pepper: env.DELIVERY_KEY_PEPPER,
    rateLimiter: limiter,
  })
}
