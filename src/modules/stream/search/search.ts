import { sql } from '@payloadcms/db-postgres'

import { toArticleFeedItem } from '../feed/article-item'
import { mapFeed } from '../feed/mapper'
import { toVideoFeedItem } from '../feed/video-item'
import { earliestTransition } from '../visibility'

import { searchConfigFor } from './text-index'

import type { ArticleFeedItem } from '../feed/article-item'
import type { VideoFeedItem } from '../feed/video-item'
import type { Payload } from 'payload'

/**
 * Полнотекстовый поиск по потоку (ТЗ 1.2).
 *
 * Устроен в два шага, и это главное решение здесь:
 *
 *  1. **SQL находит и ранжирует** — только идентификаторы, ничего больше;
 *  2. **Payload отдаёт записи** обычным чтением с `overrideAccess: false`.
 *
 * Второй шаг не оптимизация, а безопасность. Прямой SQL обходит правила
 * доступа целиком: ни черновики, ни снятые с публикации им не отсеиваются.
 * Условие видимости пришлось бы повторить в запросе руками — то есть завести
 * второе место, где решается, что видно снаружи, а [[BUG-005]] случился ровно
 * из-за такого расхождения.
 *
 * Здесь SQL решает **только** «что похоже на запрос»; «что видно» решает та же
 * единственная машинерия, что и в лентах.
 */

export class SearchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchError'
  }
}

export const MIN_QUERY_LENGTH = 2
export const MAX_QUERY_LENGTH = 200
export const DEFAULT_SEARCH_LIMIT = 20
export const MAX_SEARCH_LIMIT = 50

export type SearchKind = 'article' | 'video'

export interface SearchHit {
  readonly kind: SearchKind
  readonly rank: number
  readonly item: ArticleFeedItem | VideoFeedItem
}

export interface SearchResult {
  readonly hits: readonly SearchHit[]
  readonly excluded: readonly { readonly id: string; readonly reason: string }[]
  /**
   * Ближайший момент, когда выдача изменится сама собой.
   *
   * Считается по тем же правилам, что и у лент: результат поиска состоит из
   * видимых записей, а видимость меняется по времени. Без этого ограничения
   * кеш поиска пережил бы снятие материала с публикации (ADR-0021).
   */
  readonly nextTransitionAt: string | null
}

/**
 * Нормализует поисковый запрос.
 *
 * Слишком короткий отвергается: по одной букве находится всё, и такой ответ
 * бесполезен обеим сторонам. Слишком длинный — тоже: это не запрос человека,
 * а попытка нагрузить разбор.
 */
export function normalizeQuery(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new SearchError('Поисковый запрос не задан.')
  }

  const query = raw.trim().replace(/\s+/gu, ' ')

  if (query.length < MIN_QUERY_LENGTH) {
    throw new SearchError(`Запрос короче ${MIN_QUERY_LENGTH} символов.`)
  }

  if (query.length > MAX_QUERY_LENGTH) {
    throw new SearchError(`Запрос длиннее ${MAX_QUERY_LENGTH} символов.`)
  }

  return query
}

export function normalizeSearchLimit(requested: number | null | undefined): number {
  if (requested === null || requested === undefined) {
    return DEFAULT_SEARCH_LIMIT
  }

  if (!Number.isInteger(requested) || requested < 1) {
    throw new SearchError('Размер выдачи — целое число не меньше единицы.')
  }

  return Math.min(requested, MAX_SEARCH_LIMIT)
}

type SearchableCollection = 'articles' | 'videos'

interface RankedRow {
  readonly id: string
  readonly rank: number
}

/** Минимальная форма того, чем мы пользуемся у drizzle. */
interface DrizzleLike {
  execute(query: unknown): Promise<{ rows?: unknown[] } | unknown[]>
}

/**
 * Находит идентификаторы, похожие на запрос, и их ранг.
 *
 * `websearch_to_tsquery` вместо `to_tsquery`: он понимает кавычки и `-слово`,
 * то есть привычный человеку синтаксис, и главное — **не бросает** на
 * бессмысленном вводе. `to_tsquery` бросает, и одна скобка в запросе уронила
 * бы ручку.
 *
 * Единственное место в модуле, где мы обращаемся к базе мимо Payload: он не
 * выражает полнотекстовый поиск, а `like` по тексту не даёт ни разбора по
 * языку, ни ранжирования.
 */
async function rankedIds(args: {
  readonly payload: Payload
  readonly table: SearchableCollection
  readonly siteId: string | number
  readonly locale: string
  readonly query: string
  readonly limit: number
}): Promise<RankedRow[]> {
  const config = searchConfigFor(args.locale)
  const database = (args.payload.db as unknown as { drizzle: DrizzleLike }).drizzle

  /**
   * Значения подставляются параметрами, а не склейкой строк. Имя таблицы и
   * конфигурации приходит из закрытых перечней, поэтому подставляется
   * идентификатором и приведением типа.
   */
  const table = args.table === 'articles' ? sql.identifier('articles') : sql.identifier('videos')

  const result = await database.execute(sql`
    SELECT "id", ts_rank("search_vector", websearch_to_tsquery(${config}::regconfig, ${args.query})) AS rank
    FROM ${table}
    WHERE "site_id" = ${args.siteId}
      AND "locale" = ${args.locale}
      AND "search_vector" @@ websearch_to_tsquery(${config}::regconfig, ${args.query})
    ORDER BY rank DESC, "id" DESC
    LIMIT ${args.limit}
  `)

  const rows = (Array.isArray(result) ? result : (result?.rows ?? [])) as Record<string, unknown>[]

  return rows.map((row) => ({ id: String(row.id), rank: Number(row.rank ?? 0) }))
}

export async function searchStream(args: {
  readonly payload: Payload
  readonly siteId: string | number
  readonly locale: string
  readonly query: string
  readonly limit?: number | null
  readonly now?: Date
}): Promise<SearchResult> {
  const query = normalizeQuery(args.query)
  const limit = normalizeSearchLimit(args.limit)
  const now = args.now ?? new Date()

  const [articleRows, videoRows] = await Promise.all([
    rankedIds({ ...args, table: 'articles', query, limit }),
    rankedIds({ ...args, table: 'videos', query, limit }),
  ])

  const [articles, videos] = await Promise.all([
    loadVisible(args.payload, 'articles', articleRows),
    loadVisible(args.payload, 'videos', videoRows),
  ])

  /**
   * Элемент собирается вместе со своим идентификатором: без этого порядок
   * ранжирования восстановить нельзя — исключённые записи сдвигают индексы.
   */
  const mappedArticles = mapFeed(articles, (doc) => ({
    id: String(doc.id),
    item: toArticleFeedItem(doc) as ArticleFeedItem | VideoFeedItem,
  }))

  const mappedVideos = mapFeed(videos, (doc) => ({
    id: String(doc.id),
    item: toVideoFeedItem(doc, now) as ArticleFeedItem | VideoFeedItem,
  }))

  const rankOf = (rows: readonly RankedRow[], id: string): number =>
    rows.find((row) => row.id === id)?.rank ?? 0

  const hits: SearchHit[] = [
    ...mappedArticles.items.map((entry) => ({
      kind: 'article' as const,
      rank: rankOf(articleRows, entry.id),
      item: entry.item,
    })),
    ...mappedVideos.items.map((entry) => ({
      kind: 'video' as const,
      rank: rankOf(videoRows, entry.id),
      item: entry.item,
    })),
  ]

  /**
   * Общий порядок по рангу: материалы и видео перемешиваются по релевантности,
   * а не выводятся двумя блоками. Разделение по типу — задача интерфейса, а
   * выдача обязана отдать самое подходящее первым.
   */
  hits.sort((left, right) => right.rank - left.rank)

  return {
    hits: hits.slice(0, limit),
    excluded: [...mappedArticles.excluded, ...mappedVideos.excluded],
    nextTransitionAt:
      earliestTransition([...articles, ...videos] as never, now)?.toISOString() ?? null,
  }
}

/**
 * Догружает найденные записи **через правила доступа**.
 *
 * Невидимые записи здесь просто не вернутся: SQL нашёл их по тексту, но
 * витрина их не увидит.
 */
async function loadVisible(
  payload: Payload,
  collection: SearchableCollection,
  rows: readonly RankedRow[],
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) {
    return []
  }

  const found = await payload.find({
    collection,
    where: { id: { in: rows.map((row) => row.id) } },
    limit: rows.length,
    pagination: false,
    depth: 1,
    /** То же правило, что и в лентах: видимость решает access, а не запрос. */
    overrideAccess: false,
  })

  return found.docs as unknown as Record<string, unknown>[]
}
