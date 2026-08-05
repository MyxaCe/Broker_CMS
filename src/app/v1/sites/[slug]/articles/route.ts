import { respondArticleFeed } from '@/modules/delivery'

import { deliverySource } from '../../../delivery-source'

/**
 * Лента материалов (ТЗ 1.2).
 *
 * Тот же контур, что и у конфигурации сайта: ключ со скоупом, ограничение
 * частоты, валидация схемой перед отправкой. Отличие в сроке жизни ответа —
 * он ограничен ближайшим переходом видимости (ADR-0021).
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params

  return respondArticleFeed(request, slug, await deliverySource())
}
