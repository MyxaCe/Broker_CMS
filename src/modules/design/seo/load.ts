import { collectSubtree, loadTenantChainIds } from '@/platform'

import { composeRouting } from './manifest'
import { REDIRECT_STATUSES } from './types'

import type { ManifestPageInput, ManifestSiteInput } from './manifest'
import type { RedirectRecord, RedirectStatus, RoutingSnapshot, SeoProfileRecord } from './types'
import type { JsonLdKind } from './jsonld'
import type { TenantNode } from '@/platform'
import type { Payload } from 'payload'

/**
 * Чтение слоя В на момент сборки релиза (ТЗ 2.3).
 *
 * Единственное место в сборке, которое читает **за пределами своего сайта**:
 * граф hreflang по определению связывает сайты между собой. Чтение ограничено
 * поддеревом бренда — «между сайтами» в ТЗ означает языковые версии одного
 * бренда, а не чужие бренды платформы.
 */

const READ = { pagination: false, depth: 1, overrideAccess: true } as const

export async function loadRouting(args: {
  readonly payload: Payload
  readonly siteId: string | number
  readonly locales: readonly string[]
}): Promise<RoutingSnapshot> {
  const chainIds = await loadTenantChainIds(args.payload, args.siteId)
  const siteId = String(args.siteId)
  const brandId = chainIds[0] ?? siteId

  const tenants = await args.payload.find({
    collection: 'tenants',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  const nodes = new Map<string, TenantNode>()
  const urlById = new Map<string, string | null>()

  for (const doc of tenants.docs as unknown as Record<string, unknown>[]) {
    const kind = doc.kind

    if (kind !== 'brand' && kind !== 'region' && kind !== 'site') {
      continue
    }

    const id = String(doc.id)

    nodes.set(id, {
      id,
      slug: typeof doc.slug === 'string' ? doc.slug : '',
      kind,
      parentId: relationId(doc.parent) === '' ? null : relationId(doc.parent),
    })

    urlById.set(
      id,
      typeof doc.publicUrl === 'string' && doc.publicUrl !== '' ? doc.publicUrl : null,
    )
  }

  /** Сайты бренда, включая наш: только они участвуют в графе hreflang. */
  const brandSiteIds = collectSubtree(nodes, [brandId]).filter(
    (id) => nodes.get(id)?.kind === 'site',
  )

  const [pagesResult, profilesResult, redirectsResult] = await Promise.all([
    args.payload.find({
      collection: 'pages',
      where: { site: { in: brandSiteIds }, status: { equals: 'published' } },
      ...READ,
    }),
    args.payload.find({
      collection: 'seo-profiles',
      where: { owner: { in: chainIds } },
      ...READ,
    }),
    args.payload.find({
      collection: 'redirects',
      where: { site: { equals: args.siteId } },
      ...READ,
    }),
  ])

  const allPages = (pagesResult.docs as unknown as Record<string, unknown>[]).map(toPageInput)
  const own = allPages.filter((page) => page.siteId === siteId)
  const siblings = allPages.filter((page) => page.siteId !== siteId)

  const siblingSites: ManifestSiteInput[] = brandSiteIds
    .filter((id) => id !== siteId)
    .map((id) => ({ id, locale: '', publicUrl: urlById.get(id) ?? null }))

  return composeRouting({
    chainIds,
    siteId,
    siteUrl: urlById.get(siteId) ?? null,
    locales: args.locales,
    pages: own,
    profiles: (profilesResult.docs as unknown as Record<string, unknown>[]).map(toProfile),
    redirects: [
      ...(redirectsResult.docs as unknown as Record<string, unknown>[]).map(toRedirect),
      ...derivedRedirects(own, pagesResult.docs as unknown as Record<string, unknown>[], siteId),
    ],
    siblingPages: siblings,
    siblingSites,
  })
}

function toPageInput(doc: Record<string, unknown>): ManifestPageInput {
  const seo = (doc.seo ?? {}) as Record<string, unknown>
  const kind = seo.jsonLd

  return {
    id: String(doc.id),
    siteId: relationId(doc.site),
    path: typeof doc.path === 'string' ? doc.path : '',
    title: typeof doc.title === 'string' ? doc.title : '',
    locale: typeof doc.locale === 'string' ? doc.locale : '',
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : new Date(0).toISOString(),
    blocks: doc.blocks,
    jsonLdKind: kind === 'article' || kind === 'none' ? (kind as JsonLdKind) : 'auto',
    translationKey: optionalText(doc.translationKey),
    seo: {
      title: optionalText(seo.title),
      description: optionalText(seo.description),
      canonical: optionalText(seo.canonical),
      ogImage: mediaUrl(seo.ogImage),
      noindex: seo.noindex === true,
    },
  }
}

function toProfile(doc: Record<string, unknown>): SeoProfileRecord {
  const organization = (doc.organization ?? {}) as Record<string, unknown>
  const name = optionalText(organization.name)

  return {
    ownerId: relationId(doc.owner),
    locale: typeof doc.locale === 'string' ? doc.locale : '',
    isActive: doc.isActive === true,
    titleTemplate: optionalText(doc.titleTemplate),
    defaultDescription: optionalText(doc.defaultDescription),
    defaultOgImage: mediaUrl(doc.defaultOgImage),
    twitterSite: optionalText(doc.twitterSite),
    organization:
      name === null
        ? null
        : {
            name,
            legalName: optionalText(organization.legalName),
            logo: mediaUrl(organization.logo),
            sameAs: Array.isArray(organization.sameAs)
              ? (organization.sameAs as Record<string, unknown>[]).flatMap((entry) => {
                  const url = optionalText(entry.url)

                  return url === null ? [] : [url]
                })
              : [],
          },
    allowIndexing: doc.allowIndexing === true,
    disallowPaths: Array.isArray(doc.disallowPaths)
      ? (doc.disallowPaths as Record<string, unknown>[]).flatMap((entry) => {
          const path = optionalText(entry.path)

          return path === null ? [] : [path]
        })
      : [],
  }
}

function toRedirect(doc: Record<string, unknown>): RedirectRecord {
  const status = Number(doc.status)

  return {
    from: typeof doc.from === 'string' ? doc.from : '',
    to: typeof doc.to === 'string' ? doc.to : '',
    status: (REDIRECT_STATUSES as readonly number[]).includes(status)
      ? (status as RedirectStatus)
      : 301,
    locale: optionalText(doc.locale),
    isActive: doc.isActive === true,
    derived: false,
  }
}

/**
 * Правила из истории путей (ТЗ 2.3: «смена пути → автоматический 301»).
 *
 * Выводятся при каждой сборке, а не записываются в коллекцию: запись
 * означала бы два источника истины про один и тот же переезд, и рано или
 * поздно они разошлись бы — обычно после того, как редактор поправил один.
 */
function derivedRedirects(
  own: readonly ManifestPageInput[],
  docs: readonly Record<string, unknown>[],
  siteId: string,
): RedirectRecord[] {
  const currentById = new Map(own.map((page) => [page.id, page]))
  const rules: RedirectRecord[] = []

  for (const doc of docs) {
    if (relationId(doc.site) !== siteId) {
      continue
    }

    const page = currentById.get(String(doc.id))

    if (page === undefined || !Array.isArray(doc.pathHistory)) {
      continue
    }

    for (const entry of doc.pathHistory as Record<string, unknown>[]) {
      const from = optionalText(entry.path)

      if (from === null) {
        continue
      }

      rules.push({
        from,
        to: page.path,
        status: 301,
        locale: page.locale,
        isActive: true,
        derived: true,
      })
    }
  }

  return rules
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Адрес файла. Загрузки читаются с `depth: 1`, поэтому здесь уже документ
 * медиа; идентификатор без документа означает, что файл удалён, — такой
 * ссылке в разметке делать нечего.
 */
function mediaUrl(value: unknown): string | null {
  if (value === null || typeof value !== 'object') {
    return null
  }

  return optionalText((value as Record<string, unknown>).url)
}

function relationId(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id)
  }

  return value === null || value === undefined ? '' : String(value)
}
