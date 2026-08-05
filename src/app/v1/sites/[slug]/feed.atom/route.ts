import { respondSyndication } from '@/modules/delivery'

import { deliverySource } from '../../../delivery-source'

/**
 * Лента материалов в Atom (ТЗ 1.2).
 *
 * Отдельный файл на формат — по той же причине, что и у RSS: динамический
 * сегмент занимает весь сегмент пути, поэтому `feed.[format]` не работает.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params

  return respondSyndication(request, slug, await deliverySource(), 'atom')
}
