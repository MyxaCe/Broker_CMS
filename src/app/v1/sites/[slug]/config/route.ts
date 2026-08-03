import config from '@payload-config'
import { getPayload } from 'payload'

import { createPayloadSource, respondSiteConfig } from '@/modules/delivery'
import { ensureEnv } from '@/platform'

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
  const payload = await getPayload({ config })
  const source = createPayloadSource({ payload, pepper: ensureEnv().DELIVERY_KEY_PEPPER })

  return respondSiteConfig(request, slug, source)
}
