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

/**
 * Коды ошибок. Причины отказа авторизации схлопнуты в один код намеренно:
 * снаружи «ключа нет» и «прав не хватает» обязаны быть неразличимы.
 */
export const ERROR_CODES = ['unauthorized', 'not-found', 'bad-request', 'internal'] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ErrorResponse {
  readonly contract: typeof CONTRACT_VERSION
  readonly error: {
    readonly code: ErrorCode
    readonly message: string
    readonly requestId?: string
  }
}
