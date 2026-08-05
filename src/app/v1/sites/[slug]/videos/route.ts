import { respondVideoFeed } from '@/modules/delivery'

import { deliverySource } from '../../../delivery-source'

/**
 * Лента видео и трансляций (ТЗ 1.1, 1.2).
 *
 * У видео два источника самопроизвольных изменений — видимость и состояние
 * эфира, — поэтому срок жизни ответа ограничен ближайшим из них.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params

  return respondVideoFeed(request, slug, await deliverySource())
}
