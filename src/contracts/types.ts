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
    /**
     * Разрешённые инструменты — символами, не числовыми id (Р-024).
     *
     * Поле **обязательное и присутствует всегда**. Это и есть исполнение
     * Р-025: пустой массив означает «ничего не разрешено», и отличить его от
     * «CMS не ответила» потребитель может без договорённостей — во втором
     * случае ответа нет вовсе.
     *
     * Необязательным поле не делается намеренно: наше же правило «потребитель
     * парсит мягко» превратило бы забытое поле в `null`, а `null` у витрины
     * сегодня означает «граница снята».
     */
    readonly instruments: readonly string[]
    /**
     * Стартовый баланс демо-счёта в центах (Р-027).
     *
     * `null` означает «не задан ни на сайте, ни выше по цепочке». Это отказ,
     * а не ноль: ноль — правдоподобный баланс, по нему не идут разбираться.
     * Legacy на этом месте подставляет миллион центов умолчанием, и мы
     * сознательно не повторяем этого — умолчание выдало бы за решение
     * владельца то, чего он не выбирал.
     */
    readonly demoStartBalanceCents: number | null
  }
  /**
   * Брендовые ассеты (ТЗ 2.1, DEBT-014).
   *
   * Объект присутствует всегда, его слоты — `null`, когда ассет не задан.
   * Форма картинки повторяет ответ `brand` legacy: витрина берёт логотип и
   * фавикон оттуда сегодня, и переезд обязан быть для неё сменой адреса
   * (Р-014).
   */
  readonly brand: BrandResponse
}

export interface BrandImageResponse {
  readonly url: string
  readonly width: number
  readonly height: number
  readonly alt: string
  readonly mimeType: string
}

export interface BrandResponse {
  readonly logoLight: BrandImageResponse | null
  readonly logoDark: BrandImageResponse | null
  readonly logoMono: BrandImageResponse | null
  readonly logoMark: BrandImageResponse | null
  readonly favicon: BrandImageResponse | null
  readonly emailLogo: BrandImageResponse | null
  readonly primaryColor: string | null
  readonly socials: readonly { readonly name: string; readonly url: string }[]
}

export interface NavItemResponse {
  readonly label: string
  /** `null` — заголовок раздела: сам никуда не ведёт, но группирует вложенные. */
  readonly url: string | null
  readonly openInNewTab: boolean
  readonly children: readonly NavItemResponse[]
}

export interface GlobalAreaResponse {
  readonly blocks: readonly { readonly type: string }[]
  readonly riskWarning: {
    readonly text: string
    readonly lossPercentage: number | null
  } | null
  readonly jurisdictions: readonly string[]
}

export interface BootstrapResponse {
  readonly contract: typeof CONTRACT_VERSION
  readonly site: { readonly slug: string }
  readonly release: {
    readonly number: number
    readonly builtAt: string
  }
  readonly resolution: {
    readonly locale: string
    readonly jurisdiction: string
    readonly variant: string
  }
  /** Тема → имя токена → значение. */
  readonly theme: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** Размещение → дерево пунктов. */
  readonly navigation: Readonly<Record<string, readonly NavItemResponse[]>>
  /** Тип области → её содержимое. */
  readonly globalAreas: Readonly<Record<string, GlobalAreaResponse>>
  /**
   * Ключ дисклеймера → его текст на разрешённой локали (Р-028).
   *
   * Инвариант контракта: ключ, перечисленный у страницы в манифесте,
   * **гарантированно присутствует** здесь. Его отсутствие — нарушение
   * контракта, а не «текста нет»: пустое место на месте регуляторного
   * предупреждения выглядит выполненным требованием и им не является.
   */
  readonly disclaimers: Readonly<Record<string, string>>
}

/**
 * Дисклеймеры страницы: ключи при блоках, из которых выведены (Р-028).
 *
 * Раскладку выбирает витрина. Данные лишь позволяют поставить текст рядом с
 * источником: связь «этот дисклеймер про этот калькулятор» может быть
 * требованием регулятора, а не вкусом.
 */
export interface PageDisclaimersResponse {
  readonly page: readonly string[]
  readonly blocks: readonly {
    readonly path: string
    readonly type: string
    readonly keys: readonly string[]
  }[]
}

export interface HreflangAlternateResponse {
  readonly locale: string
  readonly href: string
}

export interface ManifestPageResponse {
  readonly path: string
  readonly title: string
  readonly updatedAt: string
  readonly noindex: boolean
  readonly canonical: string | null
  readonly description: string | null
  readonly ogImage: string | null
  readonly twitterSite: string | null
  readonly alternates: readonly HreflangAlternateResponse[]
  readonly jsonLd: readonly Readonly<Record<string, unknown>>[]
  readonly disclaimers: PageDisclaimersResponse
}

export interface PageManifestResponse {
  readonly contract: typeof CONTRACT_VERSION
  readonly site: { readonly slug: string }
  readonly release: {
    readonly number: number
    readonly builtAt: string
  }
  readonly resolution: {
    readonly locale: string
    readonly jurisdiction: string
    readonly variant: string
  }
  readonly pages: readonly ManifestPageResponse[]
  readonly redirects: readonly {
    readonly from: string
    readonly to: string
    readonly status: 301 | 302 | 410
    readonly locale?: string | null
  }[]
  readonly robots: {
    readonly allowIndexing: boolean
    readonly disallow: readonly string[]
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

export interface VideoFeedItemResponse {
  readonly slug: string
  readonly title: string
  readonly description: string | null
  readonly publishedAt: string
  readonly provider: string
  readonly externalId: string | null
  readonly fileUrl: string | null
  readonly poster: { readonly url: string; readonly alt: string } | null
  readonly broadcast: {
    readonly state: 'upcoming' | 'live' | 'past'
    readonly startsAt: string | null
    readonly endsAt: string | null
  }
  readonly speakers: readonly FeedItemReference[]
  readonly tags: readonly string[]
}

export interface VideoFeedResponse {
  readonly contract: typeof CONTRACT_VERSION
  readonly site: { readonly slug: string }
  readonly resolution: {
    readonly locale: string
    readonly jurisdiction: string
    readonly variant: string
  }
  readonly items: readonly VideoFeedItemResponse[]
  readonly page: {
    readonly size: number
    readonly nextCursor?: string
    readonly excluded: number
  }
}

export interface PromoItemResponse {
  readonly slug: string
  readonly title: string
  readonly badge: string | null
  readonly description: string | null
  readonly terms: string
  readonly cta: { readonly label: string; readonly href: string } | null
  readonly image: { readonly url: string; readonly alt: string } | null
  readonly jurisdictions: readonly string[]
  readonly priority: number
  readonly featured: boolean
}

export interface PromoBoardResponse {
  readonly contract: typeof CONTRACT_VERSION
  readonly site: { readonly slug: string }
  readonly resolution: {
    readonly locale: string
    readonly jurisdiction: string
    readonly variant: string
  }
  readonly items: readonly PromoItemResponse[]
  readonly excluded: number
}

export interface SearchHitResponse {
  readonly kind: 'article' | 'video'
  readonly slug: string
  readonly title: string
  readonly excerpt: string | null
  readonly publishedAt: string
  readonly category: FeedItemReference | null
  readonly cover: { readonly url: string; readonly alt: string } | null
}

export interface SearchResponse {
  readonly contract: typeof CONTRACT_VERSION
  readonly site: { readonly slug: string }
  readonly resolution: {
    readonly locale: string
    readonly jurisdiction: string
    readonly variant: string
  }
  readonly query: string
  readonly hits: readonly SearchHitResponse[]
  readonly excluded: number
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
