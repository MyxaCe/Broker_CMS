import { loadArticleFeed, loadPromoBoard, loadVideoFeed } from '@/modules/stream'
import { resolveTenantById } from '@/platform'

import { verifyDeliveryKey } from '../keys/issue'

import type { DeliverySource, ResolvedRelease } from './handler'
import type { RateLimiter } from './rate-limit'
import type { ReleaseSnapshot } from '../releases/snapshot'
import type { Payload } from 'payload'

/**
 * Источник данных доставки поверх Payload.
 *
 * Отделён от обработчика намеренно: здесь только обращения к базе, и вся
 * логика отказов проверяется без неё. Ошибиться тут можно ровно в одном —
 * прочитать больше, чем следует, — поэтому чтения точечные и с `depth: 0`.
 */
export function createPayloadSource(args: {
  readonly payload: Payload
  readonly pepper: string
  readonly rateLimiter: RateLimiter
}): DeliverySource {
  const { payload, pepper } = args

  return {
    rateLimiter: args.rateLimiter,

    async resolveSiteId(siteSlug) {
      const found = await payload.find({
        collection: 'tenants',
        where: { slug: { equals: siteSlug }, kind: { equals: 'site' } },
        limit: 1,
        pagination: false,
        depth: 0,
        overrideAccess: true,
      })

      const site = found.docs[0]
      return site ? String(site.id) : null
    },

    async authorize({ authorizationHeader, siteId, requiredScope }) {
      return verifyDeliveryKey({ payload, pepper, authorizationHeader, requiredScope, siteId })
    },

    async loadSiteResolution(siteId) {
      const settings = await resolveTenantById(payload, siteId)

      const site = await payload.findByID({
        collection: 'tenants',
        id: siteId,
        depth: 0,
        overrideAccess: true,
        disableErrors: true,
      })

      return {
        defaultLocale: settings.defaultLocale.value ?? null,
        availableLocales: settings.availableLocales.entries.map((entry) => entry.value),
        jurisdiction: settings.jurisdiction.value ?? null,
        publicUrl:
          typeof site?.publicUrl === 'string' && site.publicUrl !== '' ? site.publicUrl : null,
        title: typeof site?.name === 'string' && site.name !== '' ? site.name : null,
      }
    },

    async loadArticles({ siteId, request }) {
      return loadArticleFeed({ payload, request: { siteId, ...request } })
    },

    async loadVideos({ siteId, request }) {
      return loadVideoFeed({ payload, request: { siteId, ...request } })
    },

    async loadPromos({ siteId, locale, jurisdiction }) {
      return loadPromoBoard({ payload, siteId, locale, jurisdiction })
    },

    async loadChannelRelease({ siteId, channel }) {
      const channels = await payload.find({
        collection: 'channels',
        where: { siteId: { equals: siteId }, name: { equals: channel } },
        limit: 1,
        pagination: false,
        depth: 0,
        overrideAccess: true,
      })

      const releaseId = channels.docs[0]?.releaseId

      if (typeof releaseId !== 'string' || releaseId === '') {
        return null
      }

      const release = await payload.findByID({
        collection: 'releases',
        id: releaseId,
        depth: 0,
        overrideAccess: true,
        disableErrors: true,
      })

      /**
       * Проверка состояния обязательна, хотя канал переключается только на
       * готовый релиз: канал и релиз — разные записи, и «указатель на то, что
       * не собралось» обязан оставаться невозможным на обеих сторонах.
       */
      if (release === null || release.status !== 'ready') {
        return null
      }

      const snapshot = release.snapshot as ReleaseSnapshot | null | undefined
      const builtAt = release.builtAt

      if (
        snapshot === null ||
        snapshot === undefined ||
        typeof release.number !== 'number' ||
        typeof builtAt !== 'string'
      ) {
        return null
      }

      return {
        siteId,
        releaseId: String(release.id),
        number: release.number,
        builtAt: new Date(builtAt).toISOString(),
        snapshot,
      } satisfies ResolvedRelease
    },
  }
}
