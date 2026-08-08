import { describe, expect, it } from 'vitest'

import { checkAgainstSchema, SCHEMA_IDS } from '@/contracts'
import { EMPTY_ROUTING } from '@/modules/design'

import { buildBootstrapResponse } from './bootstrap'
import { handleBootstrap } from './handler'
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
  tokens: {
    light: { 'color.surface': '#ffffff' },
    dark: { 'color.surface': '#101010' },
  },
  complianceFindings: [],
  structure: {
    navigation: [
      {
        locale: 'de',
        placement: 'primary',
        items: [
          { label: 'Konten', url: '/konten', openInNewTab: false, children: [] },
          {
            label: 'Handel',
            url: null,
            openInNewTab: false,
            children: [{ label: 'CFD', url: '/cfd', openInNewTab: false, children: [] }],
          },
        ],
      },
      {
        locale: 'en',
        placement: 'primary',
        items: [{ label: 'Accounts', url: '/accounts', openInNewTab: false, children: [] }],
      },
    ],
    globalAreas: [
      {
        locale: 'de',
        kind: 'risk-warning',
        blocks: [],
        riskWarning: { text: 'CFD sind риск.', lossPercentage: 74 },
        jurisdictions: [],
      },
      {
        locale: 'de',
        kind: 'footer',
        blocks: [{ type: 'rich-text', props: { text: 'Impressum' } }],
        riskWarning: null,
        jurisdictions: ['eu-mifid'],
      },
      {
        locale: 'en',
        kind: 'footer',
        blocks: [{ type: 'rich-text', props: { text: 'Legal' } }],
        riskWarning: null,
        jurisdictions: [],
      },
    ],
    findings: [],
  },
  routing: EMPTY_ROUTING,
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
    authorize: async ({ siteId }) =>
      siteId === '10'
        ? { kind: 'allow', keyId: 'abc', siteIds: ['10'] }
        : { kind: 'deny', reason: 'site-not-allowed' },
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

describe('сборка стартового набора', () => {
  it('ответ соответствует схеме контракта', () => {
    const body = buildBootstrapResponse({ snapshot: SNAPSHOT, release: RELEASE })

    expect(checkAgainstSchema(SCHEMA_IDS.bootstrap, body).issues).toEqual([])
  })

  it('токены обеих тем приезжают целиком', () => {
    const body = buildBootstrapResponse({ snapshot: SNAPSHOT, release: RELEASE })

    expect(body.theme).toEqual(SNAPSHOT.tokens)
  })

  /**
   * Меню и области — одноязычные. Отдать чужой язык значило бы показать
   * немецкую шапку над английской страницей.
   */
  it('отдаётся только запрошенный язык', () => {
    const body = buildBootstrapResponse({
      snapshot: SNAPSHOT,
      release: RELEASE,
      request: { locale: 'en' },
    })

    expect(body.navigation.primary).toEqual([
      { label: 'Accounts', url: '/accounts', openInNewTab: false, children: [] },
    ])
    expect(Object.keys(body.globalAreas)).toEqual(['footer'])
  })

  it('вложенные пункты меню сохраняют дерево', () => {
    const body = buildBootstrapResponse({ snapshot: SNAPSHOT, release: RELEASE })

    expect(body.navigation.primary?.[1]?.children).toEqual([
      { label: 'CFD', url: '/cfd', openInNewTab: false, children: [] },
    ])
  })

  /**
   * Полоса риска отдаётся отдельным полем, а не блоком: потребитель обязан
   * уметь показать её даже там, где остального оформления нет.
   */
  it('риск-предупреждение отдаётся отдельным полем', () => {
    const body = buildBootstrapResponse({ snapshot: SNAPSHOT, release: RELEASE })

    expect(body.globalAreas['risk-warning']?.riskWarning).toEqual({
      text: 'CFD sind риск.',
      lossPercentage: 74,
    })
  })

  it('неизвестная локаль — отказ, а не тихая подмена', () => {
    expect(() =>
      buildBootstrapResponse({ snapshot: SNAPSHOT, release: RELEASE, request: { locale: 'fr' } }),
    ).toThrow(DeliveryAssemblyError)
  })

  /** Релизы, собранные до появления структуры, обязаны отдаваться, а не падать. */
  it('снапшот без структуры отдаётся пустыми меню и областями', () => {
    const body = buildBootstrapResponse({
      snapshot: { ...SNAPSHOT, structure: { navigation: [], globalAreas: [], findings: [] } },
      release: RELEASE,
    })

    expect(body.navigation).toEqual({})
    expect(body.globalAreas).toEqual({})
  })
})

describe('дверь наружу', () => {
  it('без ключа — 401', async () => {
    const result = await handleBootstrap(
      request({ authorizationHeader: null }),
      source({ authorize: async () => ({ kind: 'deny', reason: 'missing-header' }) }),
    )

    expect(result.status).toBe(401)
  })

  it('повторный запрос с ETag даёт 304', async () => {
    const first = await handleBootstrap(request(), source())
    const second = await handleBootstrap(request({ ifNoneMatch: first.headers.ETag! }), source())

    expect(first.status).toBe(200)
    expect(second.status).toBe(304)
    expect(second.body).toBeNull()
  })

  /**
   * Ключ кеша обязан различать ресурсы: общий ключ означал бы, что стартовый
   * набор и конфигурация сайта вытесняют друг друга в кеше.
   */
  it('ключ кеша отличается от ключа конфигурации сайта', async () => {
    const bootstrap = await handleBootstrap(request(), source())

    expect(bootstrap.cacheKey).toContain('bootstrap')
  })

  it('сайт без публикаций — 404', async () => {
    const result = await handleBootstrap(
      request(),
      source({ loadChannelRelease: async () => null }),
    )

    expect(result.status).toBe(404)
  })
})
