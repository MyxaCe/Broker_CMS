import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND, EMPTY_DISCLAIMERS } from '@/modules/design'
import { runValidation } from '@/platform'

import { composeSnapshot } from './snapshot'
import { RELEASE_VALIDATORS } from './validators'

import type { FieldResolution, TenantBrand, TenantNode, TenantSettings } from '@/platform'

/**
 * Набор валидаторов релиза целиком — против состояния, в котором сборка
 * оказалась на самом деле.
 *
 * Проверка написана по следу DEBT-013 и BUG-010: валидаторы были на
 * месте, тесты у них были свои и зелёные, а до сборки данные не доходили.
 * Поэтому здесь проверяется не валидатор, а **связка** — снапшот в том виде,
 * в каком его собирает `buildRelease`.
 *
 * Ломать вход надо той же причиной, от которой защищаемся: не выдуманным
 * «пустым списком», а именно незаполненным полем — так, как это и было.
 */

const SITE: TenantNode = { id: 'de', slug: 'apex-de', kind: 'site', parentId: 'eu' }

/** Разрешение «значения нет ни на одном слое» — для полей, которые тест не трогает. */
function unset<T>(): FieldResolution<T> {
  return {
    value: undefined,
    provenance: 'unset',
    sourceTenantId: null,
    inheritedValue: undefined,
    inheritedFromTenantId: null,
  }
}

function brandLayers(): TenantBrand {
  return {
    assets: {
      logoLight: unset<string>(),
      logoDark: unset<string>(),
      logoMono: unset<string>(),
      logoMark: unset<string>(),
      favicon: unset<string>(),
      emailLogo: unset<string>(),
    },
    primaryColor: unset<string>(),
    socials: { entries: [], forkedAtTenantId: null },
  }
}

function settings(): TenantSettings {
  return {
    jurisdiction: {
      value: 'de-bafin',
      provenance: 'inherited',
      sourceTenantId: 'eu',
      inheritedValue: 'de-bafin',
      inheritedFromTenantId: null,
    },
    defaultLocale: {
      value: 'de',
      provenance: 'overridden',
      sourceTenantId: 'de',
      inheritedValue: undefined,
      inheritedFromTenantId: null,
    },
    availableLocales: {
      entries: [{ key: 'de', value: 'de', provenance: 'overridden', sourceTenantId: 'de' }],
      forkedAtTenantId: null,
    },
    demoStartBalanceCents: {
      value: 1_000_000,
      provenance: 'overridden',
      sourceTenantId: 'de',
      inheritedValue: undefined,
      inheritedFromTenantId: null,
    },
    brand: brandLayers(),
  }
}

/** Снапшот сайта, у которого всё собрано честно и нарушать нечему. */
function cleanContent() {
  return {
    texts: [],
    brand: EMPTY_BRAND,
    disclaimers: EMPTY_DISCLAIMERS,
    instruments: { symbols: [], configured: false, confirmedUnquoted: [] },
    examined: { tokens: 12, structureNodes: 2, routedPages: 1, compliancePages: 1 },
  }
}

describe('RELEASE_VALIDATORS — гейт не отдаёт чистый отчёт, не выполнившись', () => {
  it('несобранные тексты отклоняют сборку', () => {
    const snapshot = composeSnapshot(SITE, settings(), { ...cleanContent(), texts: null })

    const report = runValidation(RELEASE_VALIDATORS, snapshot)

    expect(report.passed).toBe(false)
    expect(report.blocking.map((finding) => finding.code)).toContain('check-not-executed')
    expect(report.coverage['forbidden-claims']?.kind).toBe('missing')
  })

  /**
   * Ровно то состояние, в котором сборка прожила месяц: поле не заполнялось,
   * находок не было, отчёт получался чистым. Теперь оно обязано быть красным.
   */
  it('до правки такой снапшот давал «нарушений нет» — теперь не даёт', () => {
    const before = runValidation(
      RELEASE_VALIDATORS,
      composeSnapshot(SITE, settings(), { ...cleanContent(), texts: null }),
    )

    expect(before.findings.filter((finding) => finding.validator === 'forbidden-claims')).toEqual([
      expect.objectContaining({ code: 'check-not-executed', severity: 'blocking' }),
    ])
  })

  it.each([
    ['tokens', 'token-graph'],
    ['structureNodes', 'structure'],
    ['routedPages', 'routing'],
    ['compliancePages', 'compliance'],
  ])('несобранный материал «%s» отклоняет проверку «%s»', (field, validator) => {
    const snapshot = composeSnapshot(SITE, settings(), {
      ...cleanContent(),
      examined: { ...cleanContent().examined, [field]: null },
    })

    const report = runValidation(RELEASE_VALIDATORS, snapshot)

    expect(report.passed).toBe(false)
    expect(report.coverage[validator]?.kind).toBe('missing')
  })

  /**
   * Обратная сторона: новый сайт без страниц обязан собираться. Гейт, который
   * не даёт опубликовать пустой сайт, учит редактора обходить гейт.
   */
  it('сайт без страниц и текстов собирается', () => {
    const snapshot = composeSnapshot(SITE, settings(), {
      texts: [],
      brand: EMPTY_BRAND,
      disclaimers: EMPTY_DISCLAIMERS,
      instruments: { symbols: [], configured: false, confirmedUnquoted: [] },
      examined: { tokens: 12, structureNodes: 0, routedPages: 0, compliancePages: 0 },
    })

    const report = runValidation(RELEASE_VALIDATORS, snapshot)

    expect(report.passed).toBe(true)
    expect(report.coverage['forbidden-claims']?.kind).toBe('empty')
  })

  it('обещание доходности в собранных текстах блокирует сборку', () => {
    const snapshot = composeSnapshot(SITE, settings(), {
      ...cleanContent(),
      texts: [
        {
          location: 'страница /about (de) · blocks[0].title',
          contentClass: 'marketing',
          text: 'Гарантированная доходность 30% годовых',
        },
      ],
    })

    const report = runValidation(RELEASE_VALIDATORS, snapshot)

    expect(report.passed).toBe(false)
    expect(report.blocking.map((finding) => finding.code)).toContain('forbidden-claim')
    expect(report.coverage['forbidden-claims']).toEqual({ kind: 'checked', examined: 1 })
  })
})
