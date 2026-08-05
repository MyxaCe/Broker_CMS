/**
 * Типы внешнего контракта.
 *
 * Пишутся руками рядом со схемами и удерживаются в согласии с ними тестом,
 * а не выводятся из схем автоматически. Причина в направлении: канон — схема,
 * и типы обязаны следовать за ней. Автовывод дал бы обратное — типы стали бы
 * удобными, а схема подстраивалась бы под них.
 *
 * Расхождение ловится не на глаз: тест собирает эталонный ответ по этим типам
 * и прогоняет его через схему.
 */

export const CONTRACT_VERSION = 'v1' as const

export interface SiteConfigResponse {
  readonly contract: typeof CONTRACT_VERSION
  readonly site: {
    readonly slug: string
  }
  readonly release: {
    readonly number: number
    readonly builtAt: string
  }
  readonly resolution: {
    readonly locale: string
    readonly jurisdiction: string
    readonly variant: string
  }
  readonly settings: {
    readonly defaultLocale: string
    readonly availableLocales: readonly string[]
    readonly jurisdiction: string
  }
}

export interface FeedItemReference {
  readonly slug: string
  readonly title: string
}

export interface ArticleFeedItemResponse {
  readonly slug: string
  readonly title: string
  readonly excerpt: string | null
  readonly publishedAt: string
  readonly readingMinutes: number
  readonly category: FeedItemReference | null
  readonly tags: readonly string[]
  readonly authors: readonly FeedItemReference[]
  readonly cover: { readonly url: string; readonly alt: string } | null
  readonly instruments: readonly string[]
  readonly featured: boolean
  readonly pinned: boolean
}

export interface ArticleFeedResponse {
  readonly contract: typeof CONTRACT_VERSION
  readonly site: { readonly slug: string }
  readonly resolution: {
    readonly locale: string
    readonly jurisdiction: string
    readonly variant: string
  }
  readonly pinned?: readonly ArticleFeedItemResponse[]
  readonly items: readonly ArticleFeedItemResponse[]
  readonly page: {
    readonly size: number
    readonly nextCursor?: string
    readonly excluded: number
  }
}

/**
 * Коды ошибок. Причины отказа авторизации схлопнуты в один код намеренно:
 * снаружи «ключа нет» и «прав не хватает» обязаны быть неразличимы.
 */
export const ERROR_CODES = [
  'unauthorized',
  'not-found',
  'bad-request',
  'rate-limited',
  'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ErrorResponse {
  readonly contract: typeof CONTRACT_VERSION
  readonly error: {
    readonly code: ErrorCode
    readonly message: string
    readonly requestId?: string
  }
}
