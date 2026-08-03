import config from '@payload-config'
import { getPayload } from 'payload'

import { createPayloadSource, RedisRateLimiter, respondSiteConfig } from '@/modules/delivery'
import { ensureEnv } from '@/platform'

/**
 * Единственная публичная дверь наружу (ТЗ разд. 3, ADR-0009).
 *
 * Файл намеренно тонкий: всё поведение — в модуле доставки, где оно проверено
 * без поднятого сервера. Здесь только связывание с окружением фреймворка.
 */

export const dynamic = 'force-dynamic'

/**
 * Соединение с Redis переживает запросы: подключаться заново на каждый вызов
 * значило бы платить за это на самой горячей ручке сервиса.
 */
let limiter: RedisRateLimiter | null = null

function rateLimiter(url: string): RedisRateLimiter {
  limiter ??= new RedisRateLimiter({ url })

  return limiter
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params
  const env = ensureEnv()
  const payload = await getPayload({ config })

  const source = createPayloadSource({
    payload,
    pepper: env.DELIVERY_KEY_PEPPER,
    rateLimiter: rateLimiter(env.REDIS_URL),
  })

  return respondSiteConfig(request, slug, source)
}
