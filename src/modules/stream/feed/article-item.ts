import { requireText } from './mapper'

/**
 * Элемент ленты материалов.
 *
 * Форма ответа доставки описывается схемой в `contracts`; здесь — внутреннее
 * представление, из которого доставка его соберёт. Разделение то же, что и с
 * релизами: домен не знает, что его данные кто-то отдаёт наружу.
 */

export interface ArticleFeedItem {
  readonly slug: string
  readonly title: string
  readonly excerpt: string | null
  readonly publishedAt: string
  readonly readingMinutes: number
  readonly category: { readonly slug: string; readonly title: string } | null
  readonly tags: readonly string[]
  readonly authors: readonly { readonly slug: string; readonly title: string }[]
  readonly cover: { readonly url: string; readonly alt: string } | null
  readonly instruments: readonly string[]
  readonly featured: boolean
  readonly pinned: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Разворачивает связь в пару «машинное имя + название».
 *
 * Неразвёрнутая связь (пришёл только идентификатор) — это **не** ошибка
 * записи, а следствие глубины выборки. Возвращается `null`, и запись остаётся
 * в ленте: терять материал из-за настройки запроса нельзя.
 */
function reference(value: unknown): { slug: string; title: string } | null {
  const record = asRecord(value)

  if (record === null) {
    return null
  }

  const slug = optionalText(record.slug)
  const title = optionalText(record.title)

  return slug === null || title === null ? null : { slug, title }
}

/**
 * Собирает элемент ленты. **Бросает** на непригодной записи — и это здесь
 * правильно: `mapFeed` превращает исключение в исключение одной записи, а не
 * в отказ всей ленты (ADR-0021).
 */
export function toArticleFeedItem(doc: Record<string, unknown>): ArticleFeedItem {
  /**
   * Три поля обязательны для витрины: без имени материал недоступен по адресу,
   * без заголовка нечего показать, без даты публикации нельзя выстроить ленту.
   * Всё остальное может отсутствовать без вреда.
   */
  const slug = requireText(doc.slug, 'машинное имя')
  const title = requireText(doc.title, 'заголовок')
  const publishedAt = requireText(doc.publishAt, 'дата публикации')

  const cover = asRecord(doc.cover)
  const coverUrl = cover === null ? null : optionalText(cover.url)
  const coverAlt = cover === null ? null : optionalText(cover.alt)

  return {
    slug,
    title,
    excerpt: optionalText(doc.excerpt),
    publishedAt: new Date(publishedAt).toISOString(),
    readingMinutes: typeof doc.readingMinutes === 'number' ? doc.readingMinutes : 0,
    category: reference(doc.category),
    tags: Array.isArray(doc.tags)
      ? doc.tags.map(reference).flatMap((tag) => (tag === null ? [] : [tag.slug]))
      : [],
    authors: Array.isArray(doc.authors)
      ? doc.authors.flatMap((author) => {
          const resolved = reference(author)
          return resolved === null ? [] : [resolved]
        })
      : [],
    /**
     * Обложка без альтернативного текста не отдаётся вовсе. Картинка без alt
     * — это нарушение доступности на витрине; лучше её отсутствие, чем она
     * же, но недоступная (ТЗ 5.3).
     */
    cover: coverUrl !== null && coverAlt !== null ? { url: coverUrl, alt: coverAlt } : null,
    instruments: Array.isArray(doc.relatedInstruments)
      ? doc.relatedInstruments.flatMap((entry) => {
          const symbol = optionalText(asRecord(entry)?.symbol)
          return symbol === null ? [] : [symbol]
        })
      : [],
    featured: doc.featured === true,
    pinned: doc.pinned === true,
  }
}
