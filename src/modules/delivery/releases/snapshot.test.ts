import { describe, expect, it } from 'vitest'

import { contentHash } from '../cache-key'

import { composeSnapshot, SNAPSHOT_SCHEMA_VERSION } from './snapshot'
import { siteReadinessValidator } from './validators'

import type { TenantNode, TenantSettings } from '@/platform'

const SITE: TenantNode = { id: 'de', slug: 'apex-de', kind: 'site', parentId: 'eu' }

function settings(overrides: Partial<TenantSettings> = {}): TenantSettings {
  return {
    jurisdiction: {
      value: 'de-bafin',
      provenance: 'inherited',
      sourceTenantId: 'eu',
      inheritedValue: 'de-bafin',
      inheritedFromTenantId: 'eu',
    },
    defaultLocale: {
      value: 'de',
      provenance: 'overridden',
      sourceTenantId: 'de',
      inheritedValue: undefined,
      inheritedFromTenantId: null,
    },
    availableLocales: {
      entries: [
        { key: 'en', value: 'en', provenance: 'inherited', sourceTenantId: 'apex' },
        { key: 'de', value: 'de', provenance: 'inherited', sourceTenantId: 'eu' },
      ],
      forkedAtTenantId: null,
    },
    ...overrides,
  }
}

/**
 * Содержимое снапшота, собранное честно: тексты собраны и их нет.
 *
 * Отдельный хелпер нужен потому, что `texts` больше не имеет умолчания —
 * пропустить поле нельзя, и это ровно то, ради чего оно сделано обязательным.
 */
function content(
  overrides: Partial<Parameters<typeof composeSnapshot>[2]> = {},
): Parameters<typeof composeSnapshot>[2] {
  return { texts: [], ...overrides }
}

describe('composeSnapshot', () => {
  it('переносит разрешённые значения вместе с источником', () => {
    const snapshot = composeSnapshot(SITE, settings(), content())

    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION)
    expect(snapshot.site).toEqual({ id: 'de', slug: 'apex-de', kind: 'site' })
    expect(snapshot.settings.jurisdiction).toEqual({ value: 'de-bafin', source: 'eu' })
  })

  it('локали отсортированы — порядок накопления по цепочке не влияет на отпечаток', () => {
    const snapshot = composeSnapshot(SITE, settings(), content())
    expect(snapshot.settings.availableLocales).toEqual(['de', 'en'])
  })

  it('детерминирована: одинаковый вход даёт одинаковый отпечаток', () => {
    expect(contentHash(composeSnapshot(SITE, settings(), content()))).toBe(
      contentHash(composeSnapshot(SITE, settings(), content())),
    )
  })

  it('отсутствующее значение становится null, а не пропадает', () => {
    const snapshot = composeSnapshot(
      SITE,
      settings({
        jurisdiction: {
          value: undefined,
          provenance: 'unset',
          sourceTenantId: null,
          inheritedValue: undefined,
          inheritedFromTenantId: null,
        },
      }),
      content(),
    )

    expect(snapshot.settings.jurisdiction).toEqual({ value: null, source: null })
  })
})

describe('siteReadinessValidator', () => {
  it('готовый сайт не даёт находок', () => {
    expect(siteReadinessValidator.run(composeSnapshot(SITE, settings(), content()))).toEqual([])
  })

  it('релиз собирается только для сайта', () => {
    const brand: TenantNode = { id: 'apex', slug: 'apex', kind: 'brand', parentId: null }
    const findings = siteReadinessValidator.run(composeSnapshot(brand, settings(), content()))

    expect(findings.map((finding) => finding.code)).toEqual(['not-a-site'])
  })

  it('отсутствие юрисдикции блокирует', () => {
    const snapshot = composeSnapshot(
      SITE,
      settings({
        jurisdiction: {
          value: undefined,
          provenance: 'unset',
          sourceTenantId: null,
          inheritedValue: undefined,
          inheritedFromTenantId: null,
        },
      }),
      content(),
    )

    expect(siteReadinessValidator.run(snapshot).map((finding) => finding.code)).toContain(
      'jurisdiction-missing',
    )
  })

  it('локаль по умолчанию вне разрешённых блокирует', () => {
    const snapshot = composeSnapshot(
      SITE,
      settings({
        defaultLocale: {
          value: 'fr',
          provenance: 'overridden',
          sourceTenantId: 'de',
          inheritedValue: undefined,
          inheritedFromTenantId: null,
        },
      }),
      content(),
    )

    const findings = siteReadinessValidator.run(snapshot)

    expect(findings.map((finding) => finding.code)).toContain('default-locale-not-available')
    expect(findings[0]?.message).toContain('de, en')
  })

  it('сообщает обо всех нарушениях разом, а не о первом', () => {
    const empty: TenantSettings = {
      jurisdiction: {
        value: undefined,
        provenance: 'unset',
        sourceTenantId: null,
        inheritedValue: undefined,
        inheritedFromTenantId: null,
      },
      defaultLocale: {
        value: undefined,
        provenance: 'unset',
        sourceTenantId: null,
        inheritedValue: undefined,
        inheritedFromTenantId: null,
      },
      availableLocales: { entries: [], forkedAtTenantId: null },
    }

    expect(siteReadinessValidator.run(composeSnapshot(SITE, empty, content()))).toHaveLength(3)
  })
})
