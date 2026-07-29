/**
 * Модуль `delivery` — часть 3 ТЗ: плоскость доставки.
 * Единственная дверь наружу: версионированный API, релизы и каналы, кеш и
 * инвалидация, события через outbox, ключи и скоупы.
 *
 * Сквозной слой: читает публичные интерфейсы `stream`, `design`, `trading` и
 * `@/platform`. Обратной зависимости нет — это условие, при котором delivery
 * позже выделяется в отдельный сервис без переписывания.
 *
 * Ответ доставки — функция от кортежа разрешённых измерений (ADR-0003):
 *   (site, releaseId, locale, jurisdiction, variant) → ответ
 * Все пять участвуют в ключе кеша и в ETag с этапа M1; до M5 `jurisdiction`
 * берётся из карточки тенанта, а `variant` всегда `default`.
 *
 * Наполняется на этапе M1.
 */

/** Измерения, от которых зависит ответ доставки. Порядок значим: он задаёт ключ кеша. */
export const RESOLUTION_AXES = ['site', 'releaseId', 'locale', 'jurisdiction', 'variant'] as const

export type ResolutionAxis = (typeof RESOLUTION_AXES)[number]

export const MODULE_NAME = 'delivery' as const
