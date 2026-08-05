import config from '@payload-config'
import { getPayload } from 'payload'

import { createPayloadSource, RedisRateLimiter, respondArticleFeed } from '@/modules/delivery'
import { ensureEnv } from '@/platform'

/**
 * Лента материалов (ТЗ 1.2).
 *
 * Тот же контур, что и у конфигурации сайта: ключ со скоупом, ограничение
 * частоты, валидация схемой перед отправкой. Отличие в сроке жизни ответа —
 * он ограничен ближайшим переходом видимости (ADR-0021).
 */

export const dynamic = 'force-dynamic'

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

  return respondArticleFeed(request, slug, source)
}
