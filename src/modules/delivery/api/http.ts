import { randomUUID } from 'node:crypto'

import { handleSiteConfig } from './handler'

import type { DeliveryRequest, DeliverySource } from './handler'

/**
 * Перевод между вебовым запросом и обработчиком доставки.
 *
 * Ни `next`, ни `payload` здесь не упоминаются: слой знает только `Request` и
 * `Response` — то, что есть в самой платформе. Это условие, при котором
 * доставку можно вынести в отдельный сервис, не переписывая её (ТЗ разд. 9).
 */

export function readDeliveryRequest(request: Request, siteSlug: string): DeliveryRequest {
  const url = new URL(request.url)

  return {
    siteSlug,
    authorizationHeader: request.headers.get('authorization'),
    ifNoneMatch: request.headers.get('if-none-match'),
    locale: url.searchParams.get('locale'),
    variant: url.searchParams.get('variant'),
    channel: url.searchParams.get('channel'),
    /**
     * Идентификатор запроса берётся у прокси, если он его проставил, и
     * порождается здесь, если нет. Без него ответ потребителю невозможно
     * сопоставить с нашей записью в журнале — а именно это и требуется, когда
     * разбираются с отказом.
     */
    requestId: request.headers.get('x-request-id') ?? randomUUID(),
    /**
     * Берётся первый адрес из `X-Forwarded-For` — тот, который проставил
     * ближайший к клиенту доверенный прокси. Значение подделываемо, поэтому им
     * ограничиваются только неудачные авторизации (см. `DeliveryRequest`).
     */
    clientIp: firstForwardedFor(request.headers.get('x-forwarded-for')),
  }
}

function firstForwardedFor(header: string | null): string | null {
  if (header === null) {
    return null
  }

  const first = header.split(',')[0]?.trim()

  return first === undefined || first === '' ? null : first
}

export async function respondSiteConfig(
  request: Request,
  siteSlug: string,
  source: DeliverySource,
): Promise<Response> {
  const parsed = readDeliveryRequest(request, siteSlug)
  const result = await handleSiteConfig(parsed, source)

  const headers = new Headers(result.headers)

  if (parsed.requestId !== undefined) {
    headers.set('X-Request-Id', parsed.requestId)
  }

  if (result.body === null) {
    return new Response(null, { status: result.status, headers })
  }

  headers.set('Content-Type', 'application/json; charset=utf-8')

  /**
   * Тело сериализуется здесь, а не собирается по кусочкам: отправляется ровно
   * тот объект, который прошёл схему. Любая правка после проверки означала бы,
   * что проверено не то, что ушло.
   */
  return new Response(JSON.stringify(result.body), { status: result.status, headers })
}
