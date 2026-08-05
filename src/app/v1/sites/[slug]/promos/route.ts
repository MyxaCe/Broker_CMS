import { respondPromoBoard } from '@/modules/delivery'

import { deliverySource } from '../../../delivery-source'

/**
 * Действующие промо (ТЗ 1.1).
 *
 * Не лента: курсора нет, потому что блоков единицы и показываются они все
 * сразу, упорядоченные редакторским приоритетом.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params

  return respondPromoBoard(request, slug, await deliverySource())
}
