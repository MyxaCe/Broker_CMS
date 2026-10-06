import { CONTRACT_VERSION, ContractViolationError, SCHEMA_IDS, validateOutgoing } from '@/contracts'

import { buildETag, matchesETag } from '../cache-key'

import { errorResponse } from './handler'

import type { DeliveryResponse, DeliverySource } from './handler'
import type { RateLimitRule } from './rate-limit'
import type { ReleaseSnapshot } from '../releases/snapshot'
import type { PublicBrandResponse } from '@/contracts'

/**
 * Публичный ресурс бренда (Р-039, [[ADR-0035]]).
 *
 * **Единственный ресурс выдачи без ключа доставки.** Это исключение из
 * ADR-0018, принятое штабом, и оно существует ровно в тех границах, которые
 * там записаны: только по точному слагу, только поля для отрисовки, жёсткое
 * кеширование, свой предел частоты.
 *
 * Зачем вообще. В legacy `brand?site=` отдаётся без ключа с открытым CORS, и
 * причина названа в самом маршруте: тема терминала грузится браузером, в том
 * числе **до логина**. В v2 каждый ресурс требует ключа, который в браузер
 * класть нельзя, — после переезда такой запрос получил бы `401`. Логотип и
 * фирменный цвет при этом по природе публичны: их видит каждый анонимный
 * посетитель на каждой странице. Охрана, которая ничего не охраняет, но
 * заставляет выдумывать обходные пути в трёх местах, — не охрана.
 *
 * Почему **не** через `openDeliveryRequest`. Общий путь начинается с
 * авторизации, и подмешивать в него ветку «а этому можно без ключа» значит
 * сделать дыру в единственном месте, которое её не должно иметь. Здесь свой
 * путь, короткий и целиком читаемый, и он физически не умеет пропускать
 * ничего, кроме бренда опубликованного релиза.
 */

/**
 * Предел частоты для двери без ключа.
 *
 * Своё ведро и своё правило. Общий с чтением по ключу предел означал бы, что
 * анонимный запрос стоит столько же, сколько запрос потребителя с договором,
 * — и что исчерпать его можно, не имея ключа вовсе.
 *
 * Счёт по адресу источника: ключа, по которому считать, здесь нет. Адрес
 * подделываем, но худшее последствие подделки — что подделавший получит свой
 * собственный счётчик, а не чужой.
 */
export const PUBLIC_BRAND_RULE: RateLimitRule = { limit: 300, windowMs: 60_000 }

/**
 * Сколько ответ живёт в кеше.
 *
 * «Жёсткое кеширование» из Р-039 — это и есть компенсация за снятый ключ:
 * открытая дверь обязана быть дешёвой. `public`, а не `private`, потому что
 * общий кеш здесь ничего не обходит — обходить нечего.
 *
 * Пять минут свежести и час «отдавай старое, пока обновляешь». Цена названа:
 * смена логотипа доезжает до читателя не мгновенно. Для ресурса, который
 * меняется при ребрендинге, это дешевле, чем попадание в базу на каждый
 * анонимный запрос.
 */
export const PUBLIC_BRAND_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600'

/**
 * Слаг проверяется до всего остального.
 *
 * Форма та же, что в схеме ответа. Проверка здесь не ради красоты: дверь без
 * ключа принимает произвольную строку из интернета, и она доходит до запроса
 * в базу. Отсечь негодную форму дешевле, чем обслужить её.
 */
const SITE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_SLUG_LENGTH = 64

export interface PublicBrandRequest {
  readonly siteSlug: string
  readonly ifNoneMatch: string | null
  /**
   * Канал, если потребитель его зачем-то передал. Публичная дверь знает
   * только `live`; просьбу про другой канал она **отклоняет**, а не
   * исполняет молча как `live`. Правдоподобный неверный ответ хуже отказа:
   * иначе кто-то решит, что через эту дверь виден черновик.
   */
  readonly channel: string | null
  readonly requestId?: string
  readonly clientIp?: string | null
}

/**
 * Собирает публичный ответ из снапшота релиза.
 *
 * Берёт **тот же** снапшот, из которого собирается `site-config`. Это и есть
 * причина, по которой Р-039 выбрал публичный ресурс, а не проксирование: два
 * пути доставки одного бренда расходятся, и расхождение видно не нам, а
 * читателю, у которого в терминале одна тема, а на витрине другая.
 */
export function buildPublicBrandResponse(args: {
  readonly snapshot: ReleaseSnapshot
  readonly siteName: string
}): PublicBrandResponse {
  const brand = args.snapshot.brand

  const payload = {
    contract: CONTRACT_VERSION,
    site: { slug: args.snapshot.site.slug, name: args.siteName },
    /**
     * Релизы, собранные до появления бренда, дают пустые слоты, а не
     * отсутствующий объект. Потребитель, парсящий мягко, прочитал бы
     * отсутствие как `undefined` и показал бы битую картинку; пустой слот он
     * обязан обработать по контракту.
     */
    brand: {
      logoLight: brand?.assets.logoLight ?? null,
      logoDark: brand?.assets.logoDark ?? null,
      logoMono: brand?.assets.logoMono ?? null,
      logoMark: brand?.assets.logoMark ?? null,
      favicon: brand?.assets.favicon ?? null,
      emailLogo: brand?.assets.emailLogo ?? null,
      primaryColor: brand?.primaryColor ?? null,
      socials: (brand?.socials ?? []).map((social) => ({ name: social.name, url: social.url })),
    },
  }

  return validateOutgoing<PublicBrandResponse>(SCHEMA_IDS.publicBrand, payload)
}

/**
 * Заголовки публичного ответа.
 *
 * `Access-Control-Allow-Origin: *` — ради того ресурс и существует: его
 * читает браузер с чужого origin. Ровно так же это сделано в legacy.
 *
 * В `Vary` нет `Authorization`: его здесь не бывает, а упоминание заставило
 * бы общий кеш разбивать записи по заголовку, которого никто не шлёт.
 */
function publicHeaders(etag: string): Record<string, string> {
  return {
    ETag: etag,
    'Cache-Control': PUBLIC_BRAND_CACHE_CONTROL,
    'Access-Control-Allow-Origin': '*',
    Vary: 'Accept-Encoding',
  }
}

function bucketOf(request: PublicBrandRequest): string {
  return `public-brand:${request.clientIp ?? 'неизвестный'}`
}

export async function handlePublicBrand(
  request: PublicBrandRequest,
  source: DeliverySource,
): Promise<DeliveryResponse> {
  if (request.channel !== null && request.channel !== 'live') {
    return refuse(
      400,
      'bad-request',
      'Публичный ресурс бренда отдаёт только опубликованный канал.',
      request.requestId,
    )
  }

  if (request.siteSlug.length > MAX_SLUG_LENGTH || !SITE_SLUG_PATTERN.test(request.siteSlug)) {
    return refuse(400, 'bad-request', 'Недопустимый слаг сайта.', request.requestId)
  }

  /**
   * Предел проверяется **до** обращения к базе и закрывает при отказе
   * счётчика.
   *
   * Это осознанное расхождение с чтением по ключу, где отказ ведра чтения
   * пропускает запрос дальше. Там рассуждение такое: уронить выдачу всех
   * сайтов из-за недоступности вспомогательного хранилища — больший ущерб,
   * чем временное отсутствие предела, а дверь всё равно закрыта ключом.
   *
   * Здесь ключа нет. Предел частоты — единственное, чем ограничена дверь, и
   * названо он в Р-039 как условие исключения. Условие, исчезающее при
   * недоступности Redis, — это защита, держащаяся на побочном свойстве
   * чего-то другого; у нас такие уже отваливались молча. Потребитель при
   * этом не остаётся без темы: ответ жёстко кеширован, а витрина и терминал
   * обязаны работать при недоступной CMS.
   */
  let verdict

  try {
    verdict = await source.rateLimiter.consume(bucketOf(request), PUBLIC_BRAND_RULE)
  } catch {
    return tooMany(PUBLIC_BRAND_RULE.windowMs / 1000, request.requestId)
  }

  if (!verdict.allowed) {
    return tooMany(verdict.retryAfterSec, request.requestId)
  }

  const siteId = await source.resolveSiteId(request.siteSlug)

  /**
   * Сайта нет и у сайта нет опубликованного релиза — **один и тот же ответ**.
   *
   * Перечня тенантов публичный ресурс не отдаёт (Р-039), и различать эти два
   * состояния значило бы отдавать его по одному: по разнице ответов видно,
   * какие слаги заведены, но ещё не опубликованы. Остаточный риск назван в
   * ADR-0035: отличить существующий опубликованный сайт от несуществующего
   * по-прежнему можно, и это неустранимо для ресурса, доступного по слагу.
   */
  if (siteId === null) {
    return notFound(request.requestId)
  }

  const release = await source.loadChannelRelease({ siteId, channel: 'live' })

  if (release === null) {
    return notFound(request.requestId)
  }

  const resolution = await source.loadSiteResolution(siteId)

  let body: PublicBrandResponse

  try {
    body = buildPublicBrandResponse({
      snapshot: release.snapshot,
      /**
       * Название берётся из разрешённых настроек сайта, а не из снапшота:
       * в снапшоте его нет. Пустое название — отказ, а не пустая строка в
       * ответе: схема требует непустого, и отдать «бренд без имени» значит
       * заставить потребителя подставлять своё.
       */
      siteName: resolution?.title ?? '',
    })
  } catch (error) {
    if (error instanceof ContractViolationError) {
      /** Подробности расхождения наружу не уходят: они описывают нашу модель. */
      return refuse(500, 'internal', 'Внутренняя ошибка.', request.requestId)
    }

    throw error
  }

  const etag = buildETag(
    {
      site: request.siteSlug,
      releaseId: release.releaseId,
      resource: 'public-brand',
      /**
       * У бренда нет ни локали, ни юрисдикции, ни варианта: он один на сайт.
       * Оси всё равно заполняются — форма ключа общая, и подставить сюда
       * пустую строку значит получить столкновение с другим ресурсом
       * (`buildCacheKey` на пустом измерении и бросает).
       */
      locale: 'none',
      jurisdiction: 'none',
      variant: 'none',
    },
    body,
  )

  const headers = publicHeaders(etag)

  if (matchesETag(request.ifNoneMatch, etag)) {
    return { status: 304, headers, body: null }
  }

  return { status: 200, headers, body }
}

/**
 * Отказ публичной двери.
 *
 * CORS открыт и у отказа тоже: иначе браузер не увидит кода ответа и покажет
 * сетевую ошибку вместо `404` — потребитель будет чинить соединение, а не
 * слаг. Это тот же класс, что «отказ не должен выглядеть правдоподобным
 * значением», только с другой стороны: отказ обязан быть **виден**.
 *
 * Не кешируется: иначе «сайт не найден» переживёт первую публикацию.
 */
function refuse(
  status: number,
  code: 'bad-request' | 'not-found' | 'internal' | 'rate-limited',
  message: string,
  requestId: string | undefined,
  extra: Record<string, string> = {},
): DeliveryResponse {
  const response = errorResponse(status, code, message, requestId)

  return {
    ...response,
    headers: { ...response.headers, 'Access-Control-Allow-Origin': '*', ...extra },
  }
}

function notFound(requestId: string | undefined): DeliveryResponse {
  return refuse(404, 'not-found', 'Сайт не найден.', requestId)
}

function tooMany(retryAfterSec: number, requestId: string | undefined): DeliveryResponse {
  return refuse(429, 'rate-limited', 'Слишком много запросов.', requestId, {
    /** Без `Retry-After` потребитель повторяет вслепую, обычно немедленно. */
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))),
  })
}
