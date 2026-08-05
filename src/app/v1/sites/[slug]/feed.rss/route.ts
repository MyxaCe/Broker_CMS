import { respondSyndication } from '@/modules/delivery'

import { deliverySource } from '../../../delivery-source'

/**
 * Лента материалов в RSS (ТЗ 1.2).
 *
 * Формат — часть пути, а не параметр запроса: так ссылка привычна читалкам и
 * не теряет формат при копировании без строки запроса.
 *
 * Отдельный файл на формат, а не динамический сегмент: в файловом роутинге
 * Next динамический сегмент занимает **весь** сегмент пути, и папка вида
 * `feed.[format]` считается литеральной — маршрут просто не срабатывает.
 * Обнаружено живым прогоном, а не тестами ([[BUG-006]]).
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params

  return respondSyndication(request, slug, await deliverySource(), 'rss')
}
