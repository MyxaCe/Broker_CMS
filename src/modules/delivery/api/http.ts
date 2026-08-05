import { randomUUID } from 'node:crypto'

import {
  handleArticleFeed,
  handlePromoBoard,
  handleSyndication,
  handleVideoFeed,
} from './feed-handler'

import type { SyndicationFormat } from './syndication'
import { handleSiteConfig } from './handler'

import type { FeedDeliveryRequest } from './feed-handler'
import type { DeliveryRequest, DeliveryResponse, DeliverySource } from './handler'

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

/**
 * Читает параметры ленты поверх общих.
 *
 * Числовой параметр разбирается строго: `limit=много` — это ошибка запроса, а
 * не повод молча взять умолчание. Тихая подмена непонятого параметра прячет
 * опечатку потребителя до того момента, когда он начнёт считать записи.
 */
export function readFeedRequest(request: Request, siteSlug: string): FeedDeliveryRequest {
  const url = new URL(request.url)
  const parameter = (name: string) => url.searchParams.get(name)
  const limit = parameter('limit')

  return {
    ...readDeliveryRequest(request, siteSlug),
    cursor: parameter('cursor'),
    limit: limit === null ? null : Number.parseInt(limit, 10),
    category: parameter('category'),
    tag: parameter('tag'),
    author: parameter('author'),
    instrument: parameter('instrument'),
    jurisdiction: parameter('jurisdiction'),
    since: parameter('since'),
    until: parameter('until'),
    /** Отсутствие параметра и `featured=false` — разное: второе не сужает выборку. */
    featured: parameter('featured') === 'true' ? true : null,
  }
}

export async function respondArticleFeed(
  request: Request,
  siteSlug: string,
  source: DeliverySource,
): Promise<Response> {
  const parsed = readFeedRequest(request, siteSlug)

  return finish(parsed.requestId, await handleArticleFeed(parsed, source))
}

export async function respondVideoFeed(
  request: Request,
  siteSlug: string,
  source: DeliverySource,
): Promise<Response> {
  const parsed = readFeedRequest(request, siteSlug)

  return finish(parsed.requestId, await handleVideoFeed(parsed, source))
}

export async function respondSyndication(
  request: Request,
  siteSlug: string,
  source: DeliverySource,
  format: SyndicationFormat,
): Promise<Response> {
  const parsed = readFeedRequest(request, siteSlug)

  return finish(parsed.requestId, await handleSyndication(parsed, source, format))
}

export async function respondPromoBoard(
  request: Request,
  siteSlug: string,
  source: DeliverySource,
): Promise<Response> {
  const parsed = readFeedRequest(request, siteSlug)

  return finish(parsed.requestId, await handlePromoBoard(parsed, source))
}

export async function respondSiteConfig(
  request: Request,
  siteSlug: string,
  source: DeliverySource,
): Promise<Response> {
  const parsed = readDeliveryRequest(request, siteSlug)

  return finish(parsed.requestId, await handleSiteConfig(parsed, source))
}

/**
 * Превращает решение обработчика в вебовый ответ.
 *
 * Один путь на все ресурсы: разные пути означали бы, что заголовок или код
 * можно случайно потерять в одном из них.
 */
function finish(requestId: string | undefined, result: DeliveryResponse): Response {
  const headers = new Headers(result.headers)

  if (requestId !== undefined) {
    headers.set('X-Request-Id', requestId)
  }

  /** Готовое тело в ином формате — отправляется как есть, ничего не досочиняя. */
  if (result.text !== undefined) {
    return new Response(result.text, { status: result.status, headers })
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
