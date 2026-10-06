import { respondPublicBrand } from '@/modules/delivery'

import { deliverySource } from '../../../../delivery-source'

/**
 * Публичный бренд сайта — **единственная дверь выдачи без ключа** (Р-039,
 * ADR-0035).
 *
 * Слово `public` стоит в адресе намеренно. Исключение из ADR-0018 должно быть
 * видно в самом пути: по `/v1/public/` его находят поиском, а не чтением
 * кода, — и при обзоре поверхностей оно не теряется среди ресурсов, закрытых
 * ключом.
 *
 * Файл тонкий, как и остальные маршруты: всё поведение в модуле доставки, где
 * оно проверено без поднятого сервера.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params

  return respondPublicBrand(request, slug, await deliverySource())
}
