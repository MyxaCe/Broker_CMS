import { extractText } from '../articles/reading-time'

/**
 * Подготовка текста для полнотекстового поиска (ТЗ 1.2).
 *
 * Поиск идёт по отдельному полю, а не по исходным полям записи, по трём
 * причинам:
 *
 *  · тело материала — структура редактора, а не текст: доставать из неё слова
 *    в SQL невозможно;
 *  · индекс строится по одному выражению, а не по четырём разным;
 *  · вес полей задаётся при сборке, а не при каждом запросе.
 */

/**
 * Конфигурации разбора Postgres по языку.
 *
 * Именно ради этого локаль и появилась у записи ([[ADR-0022]]): без языка
 * Postgres разбирает текст по правилам конфигурации по умолчанию, и русское
 * «ставки» не находится по запросу «ставка».
 *
 * Перечень закрытый и соответствует установленным в Postgres словарям.
 * Неизвестный язык получает `simple` — разбор без стемминга: слова находятся
 * только целиком. Это хуже, чем правильный словарь, но лучше, чем разбор
 * чужого языка: он даёт не «меньше находок», а неверные.
 */
export const TEXT_SEARCH_CONFIG: Record<string, string> = {
  en: 'english',
  de: 'german',
  ru: 'russian',
  fr: 'french',
  es: 'spanish',
  it: 'italian',
  pt: 'portuguese',
  nl: 'dutch',
  pl: 'simple',
  tr: 'turkish',
}

export const FALLBACK_SEARCH_CONFIG = 'simple'

/**
 * Конфигурация разбора для языка.
 *
 * Язык вида `en-GB` сводится к базовому: словари в Postgres заведены по языку,
 * а не по региону, и `english` одинаково подходит британскому и американскому.
 */
export function searchConfigFor(locale: unknown): string {
  if (typeof locale !== 'string' || locale === '') {
    return FALLBACK_SEARCH_CONFIG
  }

  const base = locale.split('-')[0]?.toLowerCase() ?? ''

  return TEXT_SEARCH_CONFIG[base] ?? FALLBACK_SEARCH_CONFIG
}

/**
 * Сводит поля записи в один текст для индекса.
 *
 * Заголовок повторяется трижды намеренно: это самый значимый сигнал, а
 * встроенного механизма весов у нас нет — ранжирование считает Postgres по
 * частоте. Повтор — грубый, но честный способ сказать «это важнее»; настоящие
 * веса (`setweight`) появятся, если простого ранжирования окажется мало.
 */
export function buildSearchText(record: {
  readonly title?: unknown
  readonly excerpt?: unknown
  readonly description?: unknown
  readonly body?: unknown
}): string {
  const parts: string[] = []

  const title = typeof record.title === 'string' ? record.title.trim() : ''

  if (title !== '') {
    parts.push(title, title, title)
  }

  for (const field of [record.excerpt, record.description]) {
    if (typeof field === 'string' && field.trim() !== '') {
      parts.push(field.trim())
    }
  }

  const body = extractText(record.body).trim()

  if (body !== '') {
    parts.push(body)
  }

  return parts.join(' ').replace(/\s+/gu, ' ').trim()
}

/**
 * Ограничение длины индексируемого текста.
 *
 * Postgres отказывается строить `tsvector` длиннее мегабайта, и падение
 * приходило бы при сохранении записи — то есть редактор терял бы работу из-за
 * длины текста. Обрезка на подходе к пределу оставляет поиск работающим, а
 * материал сохраняемым.
 */
export const MAX_SEARCH_TEXT_LENGTH = 500_000

export function truncateSearchText(text: string): string {
  return text.length <= MAX_SEARCH_TEXT_LENGTH ? text : text.slice(0, MAX_SEARCH_TEXT_LENGTH)
}
