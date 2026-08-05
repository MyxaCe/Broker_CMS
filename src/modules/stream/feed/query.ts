import { afterCursorWhere, decodeCursor } from './cursor'

import type { CursorPosition } from './cursor'
import type { Where } from 'payload'

/**
 * Построение запроса ленты (ТЗ 1.2).
 *
 * Фильтры: категория, тег, автор, инструмент, дата, юрисдикция. Сортировки и
 * `featured`/`pinned`.
 *
 * Условие видимости здесь **не строится**: оно приходит из правила доступа и
 * уходит в SQL само (ADR-0021). Добавлять его сюда значило бы завести второе
 * место, где решается, что видно снаружи, — и первое же расхождение между ними
 * стало бы утечкой.
 */

export const FEED_SORT_FIELD = 'publishAt'

/** Больше — дороже и для базы, и для потребителя. Значение по умолчанию скромное. */
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export class FeedQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedQueryError'
  }
}

export interface FeedFilters {
  readonly siteId: string | number
  /**
   * Язык записей. Обязателен по смыслу, а не по типу: лента без языка
   * смешала бы немецкие и английские материалы в одном списке.
   *
   * Необязателен в типе только ради служебных вызовов вроде планировщика,
   * которым язык безразличен.
   */
  readonly locale?: string | null
  readonly category?: string | null
  readonly tag?: string | null
  readonly author?: string | null
  readonly instrument?: string | null
  readonly jurisdiction?: string | null
  readonly since?: string | null
  readonly until?: string | null
  readonly featured?: boolean | null
}

export interface FeedRequest extends FeedFilters {
  readonly cursor?: string | null
  readonly limit?: number | null
}

/**
 * Порядок задаётся массивом, а не строкой с запятой.
 *
 * Строку с запятой Payload принимает молча и сортирует только по первому полю
 * — то есть порядок при совпадающих датах остаётся произвольным, а курсорная
 * пагинация на этом ломается. Обнаружено прогоном на живой базе.
 */
export const FEED_SORT: readonly string[] = ['-publishAt', '-id']

export interface FeedQuery {
  readonly where: Where
  readonly sort: readonly string[]
  /**
   * На единицу больше запрошенного: лишняя запись нужна, чтобы узнать, есть ли
   * следующая страница, не выполняя отдельный подсчёт. Подсчёт по всей ленте —
   * это полный проход по выборке ради одного булева значения.
   */
  readonly limit: number
  readonly pageSize: number
  readonly position: CursorPosition | null
}

function normalizeLimit(requested: number | null | undefined): number {
  if (requested === null || requested === undefined) {
    return DEFAULT_PAGE_SIZE
  }

  if (!Number.isInteger(requested) || requested < 1) {
    throw new FeedQueryError('Размер страницы — целое число не меньше единицы.')
  }

  /**
   * Превышение обрезается, а не отвергается: потребитель, попросивший тысячу,
   * хочет много и быстро, и отказ он воспримет как поломку. Обрезка даёт ему
   * ответ и при этом не даёт положить базу.
   */
  return Math.min(requested, MAX_PAGE_SIZE)
}

export function buildFeedQuery(request: FeedRequest): FeedQuery {
  const conditions: Where[] = [{ site: { equals: request.siteId } }]

  if (request.locale) {
    conditions.push({ locale: { equals: request.locale } })
  }

  if (request.category) {
    conditions.push({ 'category.slug': { equals: request.category } })
  }

  if (request.tag) {
    conditions.push({ 'tags.slug': { equals: request.tag } })
  }

  if (request.author) {
    conditions.push({ 'authors.slug': { equals: request.author } })
  }

  if (request.instrument) {
    conditions.push({ 'relatedInstruments.symbol': { equals: request.instrument } })
  }

  /**
   * Пустой список юрисдикций у материала означает «во всех», поэтому фильтр
   * обязан пропускать и его. Иначе включение фильтра прячет большую часть
   * ленты, и выглядит это как потеря данных.
   */
  if (request.jurisdiction) {
    conditions.push({
      or: [
        { 'jurisdictions.code': { equals: request.jurisdiction } },
        { 'jurisdictions.code': { exists: false } },
      ],
    })
  }

  if (request.since) {
    if (Number.isNaN(Date.parse(request.since))) {
      throw new FeedQueryError('Начальная дата не разобрана.')
    }

    conditions.push({ [FEED_SORT_FIELD]: { greater_than_equal: request.since } })
  }

  if (request.until) {
    if (Number.isNaN(Date.parse(request.until))) {
      throw new FeedQueryError('Конечная дата не разобрана.')
    }

    conditions.push({ [FEED_SORT_FIELD]: { less_than_equal: request.until } })
  }

  if (request.featured === true) {
    conditions.push({ featured: { equals: true } })
  }

  const position = decodeCursor(request.cursor)

  if (position !== null) {
    conditions.push(afterCursorWhere(position, { sortField: FEED_SORT_FIELD }) as Where)
  }

  const pageSize = normalizeLimit(request.limit)

  return {
    where: { and: conditions },
    /**
     * Сортировка составная и совпадает с формой курсора. Если бы порядок
     * задавался одним полем, записи с одинаковой отметкой времени шли бы в
     * произвольном порядке — и страница за страницей давала бы то повтор,
     * то пропуск.
     */
    sort: FEED_SORT,
    limit: pageSize + 1,
    pageSize,
    position,
  }
}

/**
 * Закреплённые материалы (ТЗ 1.2: `pinned`).
 *
 * Отдельным запросом, а не сортировкой внутри общего: закреплённое обязано
 * висеть вверху **каждой** страницы независимо от даты, а сортировка
 * действует внутри выборки и на второй странице закреплённого уже не будет.
 *
 * Из этого следует и то, что закреплённое не участвует в курсоре: иначе
 * позиция сдвигалась бы от закрепления, а не от публикации.
 */
export function buildPinnedQuery(
  siteId: string | number,
  locale?: string | null,
): {
  where: Where
  sort: readonly string[]
} {
  const conditions: Where[] = [{ site: { equals: siteId } }, { pinned: { equals: true } }]

  if (locale) {
    conditions.push({ locale: { equals: locale } })
  }

  return { where: { and: conditions }, sort: FEED_SORT }
}
