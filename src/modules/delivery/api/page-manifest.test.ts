import { describe, expect, it } from 'vitest'

import { checkAgainstSchema, SCHEMA_IDS } from '@/contracts'
import { EMPTY_STRUCTURE } from '@/modules/design'

import { handlePageManifest } from './handler'
import { buildPageManifestResponse } from './page-manifest'
import { DeliveryAssemblyError } from './site-config'
import { stubDeliverySource } from './source.fixture'

import type { DeliveryRequest, DeliverySource, ResolvedRelease } from './handler'
import type { ReleaseSnapshot } from '../releases/snapshot'

const SNAPSHOT: ReleaseSnapshot = {
  schemaVersion: 'snapshot-v1',
  site: { id: '10', slug: 'apex-de', kind: 'site' },
  settings: {
    jurisdiction: { value: 'eu-mifid', source: '2' },
    defaultLocale: { value: 'de', source: '2' },
    availableLocales: ['de', 'en'],
  },
  colorPairs: [],
  texts: [],
  tokenIssues: [],
  tokens: {},
  complianceFindings: [],
  structure: EMPTY_STRUCTURE,
  routing: {
    pages: [
      {
        locale: 'de',
        path: '/',
        title: 'Startseite — Apex',
        updatedAt: '2026-08-06T10:00:00.000Z',
        noindex: false,
        canonical: 'https://apex.de/',
        description: 'Broker',
        ogImage: 'https://cdn.test/og.png',
        twitterSite: '@apex',
        alternates: [
          { locale: 'de', href: 'https://apex.de/' },
          { locale: 'en', href: 'https://apex.com/' },
        ],
        jsonLd: [{ '@context': 'https://schema.org', '@type': 'Organization', name: 'Apex' }],
      },
      {
        locale: 'en',
        path: '/about',
        title: 'About',
        updatedAt: '2026-08-06T10:00:00.000Z',
        noindex: true,
        canonical: null,
        description: null,
        ogImage: null,
        twitterSite: null,
        alternates: [],
        jsonLd: [],
      },
    ],
    redirects: [
      { from: '/alt', to: '/neu', status: 301, locale: 'de' },
      { from: '/weg', to: '', status: 410, locale: null },
    ],
    robots: { allowIndexing: true, disallow: ['/preview'] },
    findings: [],
  },
}

const RELEASE: ResolvedRelease = {
  siteId: '10',
  releaseId: '77',
  number: 42,
  builtAt: '2026-08-06T10:00:00.000Z',
  snapshot: SNAPSHOT,
}

function source(overrides: Partial<DeliverySource> = {}): DeliverySource {
  return stubDeliverySource({
    resolveSiteId: async (slug) => (slug === 'apex-de' ? '10' : null),
    authorize: async () => ({ kind: 'allow', keyId: 'abc', siteIds: ['10'] }),
    loadChannelRelease: async () => RELEASE,
    ...overrides,
  })
}

function request(overrides: Partial<DeliveryRequest> = {}): DeliveryRequest {
  return {
    siteSlug: 'apex-de',
    authorizationHeader: 'Bearer bkc_abcdef1234567890_секрет-достаточной-длины',
    ifNoneMatch: null,
    locale: null,
    variant: null,
    channel: null,
    requestId: 'req-1',
    ...overrides,
  }
}

describe('сборка манифеста', () => {
  it('ответ соответствует схеме контракта', () => {
    const body = buildPageManifestResponse({ snapshot: SNAPSHOT, release: RELEASE })

    expect(checkAgainstSchema(SCHEMA_IDS.pageManifest, body).issues).toEqual([])
  })

  /** Карта сайта строится по языкам; смешанный ответ пришлось бы разбирать обратно. */
  it('страницы отдаются только запрошенного языка', () => {
    const german = buildPageManifestResponse({ snapshot: SNAPSHOT, release: RELEASE })
    const english = buildPageManifestResponse({
      snapshot: SNAPSHOT,
      release: RELEASE,
      request: { locale: 'en' },
    })

    expect(german.pages.map((page) => page.path)).toEqual(['/'])
    expect(english.pages.map((page) => page.path)).toEqual(['/about'])
  })

  /**
   * Редиректы и robots применяются в middleware, где языка ещё нет: запрос к
   * нему только идёт.
   */
  it('редиректы и robots не зависят от языка', () => {
    const english = buildPageManifestResponse({
      snapshot: SNAPSHOT,
      release: RELEASE,
      request: { locale: 'en' },
    })

    expect(english.redirects).toHaveLength(2)
    expect(english.robots).toEqual({ allowIndexing: true, disallow: ['/preview'] })
  })

  it('ссылки hreflang доезжают до ответа', () => {
    const body = buildPageManifestResponse({ snapshot: SNAPSHOT, release: RELEASE })

    expect(body.pages[0]?.alternates).toEqual([
      { locale: 'de', href: 'https://apex.de/' },
      { locale: 'en', href: 'https://apex.com/' },
    ])
  })

  it('разметка отдаётся как есть', () => {
    const body = buildPageManifestResponse({ snapshot: SNAPSHOT, release: RELEASE })

    expect(body.pages[0]?.jsonLd[0]).toMatchObject({ '@type': 'Organization', name: 'Apex' })
  })

  it('неизвестная локаль — отказ, а не тихая подмена', () => {
    expect(() =>
      buildPageManifestResponse({
        snapshot: SNAPSHOT,
        release: RELEASE,
        request: { locale: 'fr' },
      }),
    ).toThrow(DeliveryAssemblyError)
  })

  /** Релизы, собранные до появления слоя В, обязаны отдаваться. */
  it('снапшот без слоя В отдаётся пустым манифестом с запретом индексации', () => {
    const body = buildPageManifestResponse({
      snapshot: {
        ...SNAPSHOT,
        routing: {
          pages: [],
          redirects: [],
          robots: { allowIndexing: false, disallow: [] },
          findings: [],
        },
      },
      release: RELEASE,
    })

    expect(body.pages).toEqual([])
    expect(body.robots.allowIndexing).toBe(false)
  })
})

describe('дверь наружу', () => {
  it('без ключа — 401', async () => {
    const result = await handlePageManifest(
      request({ authorizationHeader: null }),
      source({ authorize: async () => ({ kind: 'deny', reason: 'missing-header' }) }),
    )

    expect(result.status).toBe(401)
  })

  it('повторный запрос с ETag даёт 304', async () => {
    const first = await handlePageManifest(request(), source())
    const second = await handlePageManifest(request({ ifNoneMatch: first.headers.ETag! }), source())

    expect(first.status).toBe(200)
    expect(second.status).toBe(304)
  })

  /** Общий ключ означал бы, что манифест и стартовый набор вытесняют друг друга. */
  it('ключ кеша отличает манифест от прочих ресурсов', async () => {
    const result = await handlePageManifest(request(), source())

    expect(result.cacheKey).toContain('page-manifest')
  })
})
