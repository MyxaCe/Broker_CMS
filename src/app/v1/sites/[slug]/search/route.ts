import { respondSearch } from '@/modules/delivery'

import { deliverySource } from '../../../delivery-source'

/**
 * Полнотекстовый поиск по потоку (ТЗ 1.2).
 *
 * Запрос передаётся параметром `q`. Ищет в пределах сайта и языка: алгоритм
 * разбора выбирается по языку записи ([[ADR-0022]]), иначе русское «ставки»
 * не находится по запросу «ставка».
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params

  return respondSearch(request, slug, await deliverySource())
}
