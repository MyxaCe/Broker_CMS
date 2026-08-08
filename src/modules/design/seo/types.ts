/**
 * Маршрутизация и SEO (ТЗ 2.3).
 *
 * Слой В целиком разрешается при сборке релиза и замерзает в снапшоте — по той
 * же причине, что структура и токены (ADR-0026): карта сайта, отданная вчера,
 * не должна расходиться с тем, что вчера же было опубликовано.
 */

/** Коды состояния перенаправления, разрешённые редактору. */
export const REDIRECT_STATUSES = [301, 302, 410] as const

export type RedirectStatus = (typeof REDIRECT_STATUSES)[number]

export const REDIRECT_STATUS_LABELS: Record<RedirectStatus, string> = {
  301: '301 — навсегда',
  302: '302 — временно',
  410: '410 — удалено навсегда',
}

export interface RedirectRecord {
  readonly from: string
  /** У `410` цели нет: страница удалена, вести некуда. */
  readonly to: string
  readonly status: RedirectStatus
  readonly locale: string | null
  readonly isActive: boolean
  /** Правило пришло из истории путей страницы, а не заведено руками. */
  readonly derived: boolean
}

/**
 * Умолчания SEO уровня бренда, региона или сайта (ТЗ 2.3).
 *
 * Наследуются по той же цепочке и тем же правилом, что секции и области:
 * побеждает ближайший владелец. Заводить их полем тенанта значило бы смешать
 * настройки, без которых сайт не существует (юрисдикция, локали), с теми, без
 * которых он всего лишь хуже выглядит в выдаче поиска.
 */
export interface SeoProfileRecord {
  readonly ownerId: string
  readonly locale: string
  readonly isActive: boolean
  /** Шаблон заголовка: `%s` заменяется заголовком страницы. */
  readonly titleTemplate: string | null
  readonly defaultDescription: string | null
  readonly defaultOgImage: string | null
  readonly twitterSite: string | null
  readonly organization: {
    readonly name: string
    readonly legalName: string | null
    readonly logo: string | null
    readonly sameAs: readonly string[]
  } | null
  /**
   * Разрешена ли индексация сайта целиком. Снятый флаг перекрывает настройки
   * отдельных страниц: у витрины на стенде не должно быть способа попасть в
   * поиск из-за одной страницы, где галочку забыли.
   */
  readonly allowIndexing: boolean
  readonly disallowPaths: readonly string[]
}

export interface HreflangAlternate {
  readonly locale: string
  readonly href: string
}

/** Готовый узел JSON-LD. Форма зависит от типа и проверяется схемой контракта. */
export type JsonLdNode = Readonly<Record<string, unknown>>

export interface ManifestPage {
  readonly locale: string
  readonly path: string
  readonly title: string
  readonly updatedAt: string
  readonly noindex: boolean
  readonly canonical: string | null
  readonly description: string | null
  readonly ogImage: string | null
  readonly twitterSite: string | null
  readonly alternates: readonly HreflangAlternate[]
  readonly jsonLd: readonly JsonLdNode[]
}

export interface RoutingFinding {
  readonly code: string
  readonly message: string
  readonly location: string
  readonly severity: 'blocking' | 'warning'
}

export interface RoutingSnapshot {
  readonly pages: readonly ManifestPage[]
  readonly redirects: readonly {
    readonly from: string
    readonly to: string
    readonly status: RedirectStatus
    readonly locale: string | null
  }[]
  readonly robots: {
    readonly allowIndexing: boolean
    readonly disallow: readonly string[]
  }
  readonly findings: readonly RoutingFinding[]
}

export const EMPTY_ROUTING: RoutingSnapshot = {
  pages: [],
  redirects: [],
  /**
   * Умолчание — **запрет** индексации: релиз, собранный до появления слоя В,
   * не должен молча разрешать поисковикам обход. Ошибиться здесь в сторону
   * закрытости дешевле: закрытый сайт открывают правкой, открытый по ошибке
   * убирают из индекса месяцами.
   */
  robots: { allowIndexing: false, disallow: [] },
  findings: [],
}
