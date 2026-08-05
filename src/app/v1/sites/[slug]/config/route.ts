import { respondSiteConfig } from '@/modules/delivery'

import { deliverySource } from '../../../delivery-source'

/**
 * Единственная публичная дверь наружу (ТЗ разд. 3, ADR-0009).
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

  return respondSiteConfig(request, slug, await deliverySource())
}
