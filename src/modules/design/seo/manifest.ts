import { findRedirectIssues, normalizePath } from '../pages/path'
import { pickNearest } from '../structure/inherit'

import { absolute, buildJsonLd } from './jsonld'

import type { JsonLdKind } from './jsonld'
import type {
  HreflangAlternate,
  ManifestPage,
  RedirectRecord,
  RoutingFinding,
  RoutingSnapshot,
  SeoProfileRecord,
} from './types'

/**
 * Сборка слоя В: карта сайта, hreflang, редиректы, robots (ТЗ 2.3).
 *
 * Функция чистая. Cамые дорогие ошибки здесь — не падения, а **тихо неверные
 * данные**: канонический адрес, указывающий не туда, или hreflang на страницу,
 * которой нет. Такое ловится только тестами, а тесты возможны только без базы.
 */

export interface ManifestPageInput {
  readonly id: string
  readonly siteId: string
  readonly path: string
  readonly title: string
  readonly locale: string
  readonly updatedAt: string
  readonly blocks: unknown
  readonly jsonLdKind: JsonLdKind
  /**
   * Ключ перевода: одна и та же страница в de/fr/ru несёт один ключ (ТЗ 2.3 —
   * «связывается явно»). Совпадение путей для этого не годится: у немецкой и
   * французской версии пути разные, ради того они и разные.
   */
  readonly translationKey: string | null
  readonly seo: {
    readonly title: string | null
    readonly description: string | null
    readonly canonical: string | null
    readonly ogImage: string | null
    readonly noindex: boolean
  }
}

export interface ManifestSiteInput {
  readonly id: string
  readonly locale: string
  readonly publicUrl: string | null
}

export interface ComposeRoutingArgs {
  /** Цепочка от корня к листу: `[brandId, regionId, siteId]`. */
  readonly chainIds: readonly string[]
  readonly siteId: string
  readonly siteUrl: string | null
  readonly locales: readonly string[]
  readonly pages: readonly ManifestPageInput[]
  readonly profiles: readonly SeoProfileRecord[]
  readonly redirects: readonly RedirectRecord[]
  /**
   * Страницы **других** сайтов, участвующие в графе hreflang, и адреса их
   * сайтов. Родственные сайты бренда — это и есть «между сайтами» из ТЗ.
   */
  readonly siblingPages: readonly ManifestPageInput[]
  readonly siblingSites: readonly ManifestSiteInput[]
}

export function composeRouting(args: ComposeRoutingArgs): RoutingSnapshot {
  const findings: RoutingFinding[] = []
  const profiles = resolveProfiles(args)
  const pages: ManifestPage[] = []

  const own = args.pages.filter((page) => page.siteId === args.siteId)
  const titlesByLocale = titleIndex(own)
  const alternates = alternateIndex(args, findings)

  for (const page of [...own].sort(byLocaleThenPath)) {
    const profile = profiles.get(page.locale) ?? null
    const path = normalizePath(page.path)

    if (page.seo.canonical !== null && !/^https:\/\//.test(page.seo.canonical)) {
      /**
       * Относительный канонический адрес — частая и дорогая ошибка: поисковик
       * трактует его от корня своего представления о сайте, и страница
       * склеивается не с той, с которой хотели.
       */
      findings.push({
        code: 'canonical-not-absolute',
        message: `Канонический адрес «${page.seo.canonical}» не абсолютный: нужен полный адрес по https.`,
        location: `${page.locale}${path}`,
        severity: 'blocking',
      })
    }

    pages.push({
      locale: page.locale,
      path,
      /**
       * Заголовок документа — с применённым шаблоном бренда. Разворачивать
       * `%s | Apex` у потребителя значило бы, что вкладка браузера расходится
       * с тем, что видит поисковик, — по числу потребителей.
       */
      title: pageTitle(page, profile),
      updatedAt: page.updatedAt,
      noindex: page.seo.noindex,
      canonical: page.seo.canonical ?? absolute(args.siteUrl, path),
      description: page.seo.description ?? profile?.defaultDescription ?? null,
      ogImage: page.seo.ogImage ?? profile?.defaultOgImage ?? null,
      twitterSite: profile?.twitterSite ?? null,
      alternates: alternates.get(page.id) ?? [],
      jsonLd: buildJsonLd({
        path,
        /**
         * В разметку идёт **чистый** заголовок: «О компании — Apex» в крошке
         * или в заголовке статьи — это заголовок вкладки, попавший не туда.
         */
        title: page.seo.title ?? page.title,
        blocks: page.blocks,
        kind: page.jsonLdKind,
        updatedAt: page.updatedAt,
        siteUrl: args.siteUrl,
        profile,
        titlesByPath: titlesByLocale.get(page.locale) ?? new Map(),
      }),
    })
  }

  return {
    pages,
    redirects: collectRedirects(args, findings),
    robots: robotsOf(profiles, args.locales),
    findings,
  }
}

/**
 * Заголовок для разметки: шаблон бренда применяется здесь, а не у потребителя.
 *
 * Иначе `%s | Apex` пришлось бы разворачивать каждому потребителю, и вкладка
 * браузера расходилась бы с тем, что видит поисковик.
 */
function pageTitle(page: ManifestPageInput, profile: SeoProfileRecord | null): string {
  const own = page.seo.title ?? page.title
  const template = profile?.titleTemplate ?? null

  return template === null || !template.includes('%s') ? own : template.replace('%s', own)
}

function resolveProfiles(args: ComposeRoutingArgs): Map<string, SeoProfileRecord> {
  const resolved = new Map<string, SeoProfileRecord>()

  for (const locale of args.locales) {
    const picked = pickNearest({
      chainIds: args.chainIds,
      items: args.profiles.filter((profile) => profile.locale === locale),
      keyOf: () => 'seo',
      ownerOf: (profile) => profile.ownerId,
      isActive: (profile) => profile.isActive,
    })

    const entry = picked.get('seo')

    if (entry !== undefined) {
      resolved.set(locale, entry.item)
    }
  }

  return resolved
}

/**
 * Индекс «путь → заголовок» по локалям — для крошек.
 *
 * Строится один раз на весь манифест: иначе каждая страница искала бы предков
 * перебором, и на сайте в тысячу страниц это стало бы квадратом.
 */
function titleIndex(pages: readonly ManifestPageInput[]): Map<string, Map<string, string>> {
  const index = new Map<string, Map<string, string>>()

  for (const page of pages) {
    const byPath = index.get(page.locale) ?? new Map<string, string>()
    byPath.set(normalizePath(page.path), page.title)
    index.set(page.locale, byPath)
  }

  return index
}

/**
 * Граф hreflang.
 *
 * Связываются страницы с одним ключом перевода — и внутри сайта, и на
 * родственных сайтах бренда. Сайт без публичного адреса из графа выпадает:
 * относительная ссылка в hreflang не значит ничего.
 */
function alternateIndex(
  args: ComposeRoutingArgs,
  findings: RoutingFinding[],
): Map<string, HreflangAlternate[]> {
  const urlBySite = new Map<string, string | null>([[args.siteId, args.siteUrl]])

  for (const site of args.siblingSites) {
    urlBySite.set(site.id, site.publicUrl)
  }

  const groups = new Map<string, ManifestPageInput[]>()

  for (const page of [...args.pages, ...args.siblingPages]) {
    const key = page.translationKey

    if (key === null || key === '') {
      continue
    }

    const group = groups.get(key) ?? []
    group.push(page)
    groups.set(key, group)
  }

  const result = new Map<string, HreflangAlternate[]>()

  for (const [key, group] of groups) {
    const byLocale = new Map<string, ManifestPageInput[]>()

    for (const page of group) {
      byLocale.set(page.locale, [...(byLocale.get(page.locale) ?? []), page])
    }

    for (const [locale, pages] of byLocale) {
      if (pages.length > 1) {
        /**
         * Две страницы одного языка с одним ключом перевода — это выбор без
         * правила: какая из них окажется в hreflang, зависело бы от порядка
         * чтения. Молчать нельзя, угадывать тоже.
         */
        findings.push({
          code: 'hreflang-ambiguous',
          message: `Ключ перевода «${key}» встречается дважды на языке ${locale}: ${pages
            .map((page) => normalizePath(page.path))
            .join(', ')}.`,
          location: key,
          severity: 'blocking',
        })
      }
    }

    const links: { page: ManifestPageInput; href: string }[] = []

    for (const page of group) {
      const siteUrl = urlBySite.get(page.siteId) ?? null
      const href = absolute(siteUrl, page.path)

      if (href === null) {
        findings.push({
          code: 'hreflang-no-public-url',
          message: `Страница «${normalizePath(page.path)}» не попадёт в hreflang: у её сайта не заполнен публичный адрес.`,
          location: `${key}/${page.locale}`,
          severity: 'warning',
        })
        continue
      }

      links.push({ page, href })
    }

    for (const page of group) {
      if (page.siteId !== args.siteId) {
        continue
      }

      result.set(
        page.id,
        links
          .map((link) => ({ locale: link.page.locale, href: link.href }))
          .sort((left, right) => left.locale.localeCompare(right.locale)),
      )
    }
  }

  return result
}

/**
 * Редиректы: заведённые руками и выведенные из истории путей.
 *
 * Проверка циклов — на всём наборе сразу: правило, безобидное по одному,
 * замыкает цепочку в паре с другим, и увидеть это можно только вместе.
 */
function collectRedirects(
  args: ComposeRoutingArgs,
  findings: RoutingFinding[],
): RoutingSnapshot['redirects'] {
  const active = args.redirects.filter((rule) => rule.isActive)
  const seen = new Set<string>()
  const unique: RedirectRecord[] = []

  for (const rule of active) {
    const key = `${rule.locale ?? '*'}${normalizePath(rule.from)}`

    if (seen.has(key)) {
      /**
       * Два правила с одного адреса — тоже выбор без правила. Побеждает
       * заведённое руками: правило из истории путей появляется автоматически,
       * и перекрывать им осознанное решение редактора нельзя.
       */
      findings.push({
        code: 'redirect-duplicate',
        message: `Для адреса «${normalizePath(rule.from)}» задано больше одного перенаправления.`,
        location: normalizePath(rule.from),
        severity: rule.derived ? 'warning' : 'blocking',
      })
      continue
    }

    seen.add(key)
    unique.push(rule)
  }

  for (const issue of findRedirectIssues(
    unique.map((rule) => ({ from: rule.from, to: rule.to, status: rule.status })),
  )) {
    findings.push({
      code: `redirect-${issue.code}`,
      message: issue.message,
      location: issue.from,
      /**
       * Цикл блокирует: браузер, попавший в него, не открывает страницу вовсе.
       * Ссылка на несуществующий адрес — предупреждение: она может вести на
       * страницу, которую только собираются завести.
       */
      severity: issue.code === 'cycle' || issue.code === 'self' ? 'blocking' : 'warning',
    })
  }

  return unique
    .map((rule) => ({
      from: normalizePath(rule.from),
      to: rule.status === 410 ? '' : normalizePath(rule.to),
      status: rule.status,
      locale: rule.locale,
    }))
    .sort((left, right) => left.from.localeCompare(right.from))
}

/**
 * Директивы robots.
 *
 * Индексация разрешена, только если её разрешает **каждый** разрешённый
 * профиль: язык, закрытый от индексации, обычно закрыт по регуляторной
 * причине, и открывать его из-за настройки соседнего языка нельзя.
 */
function robotsOf(
  profiles: ReadonlyMap<string, SeoProfileRecord>,
  locales: readonly string[],
): RoutingSnapshot['robots'] {
  const found = locales.flatMap((locale) => {
    const profile = profiles.get(locale)

    return profile === undefined ? [] : [profile]
  })

  if (found.length === 0) {
    return { allowIndexing: false, disallow: [] }
  }

  const disallow = new Set<string>()

  for (const profile of found) {
    for (const path of profile.disallowPaths) {
      disallow.add(normalizePath(path))
    }
  }

  return {
    allowIndexing: found.every((profile) => profile.allowIndexing),
    disallow: [...disallow].sort(),
  }
}

function byLocaleThenPath(left: ManifestPageInput, right: ManifestPageInput): number {
  return (
    left.locale.localeCompare(right.locale) ||
    normalizePath(left.path).localeCompare(normalizePath(right.path))
  )
}
