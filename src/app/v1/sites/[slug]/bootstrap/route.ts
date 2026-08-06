import { respondBootstrap } from '@/modules/delivery'

import { deliverySource } from '../../../delivery-source'

/**
 * Стартовый набор сайта (ТЗ разд. 3).
 *
 * Файл намеренно тонкий: всё поведение — в модуле доставки, где оно проверено
 * без поднятого сервера. Здесь только связывание с окружением фреймворка.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params

  return respondBootstrap(request, slug, await deliverySource())
}
