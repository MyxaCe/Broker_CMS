import { CONTRACT_VERSION, SCHEMA_IDS, validateOutgoing } from '@/contracts'

import { DEFAULT_VARIANT } from '../cache-key'

import { DeliveryAssemblyError, resolveLocale } from './site-config'

import type { ReleaseFacts, SiteConfigRequest } from './site-config'
import type { ReleaseSnapshot } from '../releases/snapshot'
import type { PageManifestResponse } from '@/contracts'

/**
 * Манифест путей (ТЗ разд. 3: `pages?locale=` — «для sitemap/SSG»).
 *
 * Страницы отдаются одного языка: карта сайта строится по языкам, и смешивать
 * их в одном ответе означало бы заставить потребителя разбирать их обратно.
 *
 * Редиректы и директивы robots отдаются **целиком**, независимо от языка: они
 * применяются в middleware, где языка ещё нет — запрос к нему только идёт.
 */
export function buildPageManifestResponse(args: {
  readonly snapshot: ReleaseSnapshot
  readonly release: ReleaseFacts
  readonly request?: SiteConfigRequest
}): PageManifestResponse {
  const { snapshot, release } = args
  const locale = resolveLocale(snapshot, args.request?.locale)
  const jurisdiction = snapshot.settings.jurisdiction.value

  if (jurisdiction === null) {
    throw new DeliveryAssemblyError('В снапшоте релиза нет юрисдикции — ответ был бы неполным.')
  }

  const payload = {
    contract: CONTRACT_VERSION,
    site: { slug: snapshot.site.slug },
    release: { number: release.number, builtAt: release.builtAt },
    resolution: {
      locale,
      jurisdiction,
      variant: args.request?.variant ?? DEFAULT_VARIANT,
    },
    pages: snapshot.routing.pages
      .filter((page) => page.locale === locale)
      .map((page) => ({
        path: page.path,
        title: page.title,
        updatedAt: page.updatedAt,
        noindex: page.noindex,
        canonical: page.canonical,
        description: page.description,
        ogImage: page.ogImage,
        twitterSite: page.twitterSite,
        alternates: page.alternates,
        jsonLd: page.jsonLd,
      })),
    redirects: snapshot.routing.redirects,
    robots: snapshot.routing.robots,
  }

  return validateOutgoing<PageManifestResponse>(SCHEMA_IDS.pageManifest, payload)
}
