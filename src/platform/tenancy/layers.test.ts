import { describe, expect, it } from 'vitest'

import {
  readCollectionLayer,
  readScalarLayer,
  resolveTenantSettings,
  validateResolvedSettings,
} from './layers'

import type { TenantLayerSource } from './layers'
import type { TenantNode } from './types'

const BRAND: TenantNode = { id: 'apex', slug: 'apex', kind: 'brand', parentId: null }
const REGION: TenantNode = { id: 'eu', slug: 'apex-eu', kind: 'region', parentId: 'apex' }
const SITE: TenantNode = { id: 'de', slug: 'apex-de', kind: 'site', parentId: 'eu' }

function chain(
  brand: Record<string, unknown> = {},
  region: Record<string, unknown> = {},
  site: Record<string, unknown> = {},
): TenantLayerSource[] {
  return [
    { node: BRAND, data: brand },
    { node: REGION, data: region },
    { node: SITE, data: site },
  ]
}

describe('readScalarLayer', () => {
  it('пустая группа — не задано', () => {
    expect(readScalarLayer(undefined)).toEqual({ state: 'unset' })
    expect(readScalarLayer({})).toEqual({ state: 'unset' })
  })

  it('режим inherit — не задано, даже если значение лежит рядом', () => {
    expect(readScalarLayer({ mode: 'inherit', value: 'de-bafin' })).toEqual({ state: 'unset' })
  })

  it('override со значением', () => {
    expect(readScalarLayer({ mode: 'override', value: 'de-bafin' })).toEqual({
      state: 'override',
      value: 'de-bafin',
    })
  })

  it('fork со значением', () => {
    expect(readScalarLayer({ mode: 'fork', value: 'at-fma' })).toEqual({
      state: 'fork',
      value: 'at-fma',
    })
  })

  it('обрезает пробелы', () => {
    expect(readScalarLayer({ mode: 'override', value: '  de-bafin  ' })).toEqual({
      state: 'override',
      value: 'de-bafin',
    })
  })

  it('режим без значения не перекрывает родителя пустотой', () => {
    expect(readScalarLayer({ mode: 'override', value: '   ' })).toEqual({ state: 'unset' })
    expect(readScalarLayer({ mode: 'fork' })).toEqual({ state: 'unset' })
  })

  it('неизвестный режим — не задано', () => {
    expect(readScalarLayer({ mode: 'что-то', value: 'x' })).toEqual({ state: 'unset' })
  })
})

describe('readCollectionLayer', () => {
  it('режим inherit — не задано', () => {
    expect(readCollectionLayer({ mode: 'inherit', items: [{ code: 'de' }] })).toEqual({
      state: 'unset',
    })
  })

  it('extend собирает коды', () => {
    const layer = readCollectionLayer({ mode: 'extend', items: [{ code: 'de' }, { code: 'en' }] })
    expect(layer.state).toBe('extend')
    if (layer.state === 'unset') return
    expect([...layer.items.keys()]).toEqual(['de', 'en'])
  })

  it('пустой список при явном режиме сохраняется — это осмысленное состояние', () => {
    const layer = readCollectionLayer({ mode: 'fork', items: [] })
    expect(layer.state).toBe('fork')
  })

  it('отбрасывает мусор в списке', () => {
    const layer = readCollectionLayer({
      mode: 'extend',
      items: [{ code: 'de' }, {}, { code: '  ' }, null, { code: ' en ' }],
    })
    if (layer.state === 'unset') return
    expect([...layer.items.keys()]).toEqual(['de', 'en'])
  })
})

describe('resolveTenantSettings — наследование по цепочке', () => {
  it('юрисдикция приходит от региона, если сайт её не задал', () => {
    const settings = resolveTenantSettings(
      chain({}, { jurisdiction: { mode: 'override', value: 'eu-mifid' } }, {}),
    )

    expect(settings.jurisdiction.value).toBe('eu-mifid')
    expect(settings.jurisdiction.provenance).toBe('inherited')
    expect(settings.jurisdiction.sourceTenantId).toBe('eu')
  })

  it('сайт переопределяет юрисдикцию региона', () => {
    const settings = resolveTenantSettings(
      chain(
        {},
        { jurisdiction: { mode: 'override', value: 'eu-mifid' } },
        { jurisdiction: { mode: 'override', value: 'de-bafin' } },
      ),
    )

    expect(settings.jurisdiction.value).toBe('de-bafin')
    expect(settings.jurisdiction.provenance).toBe('overridden')
    expect(settings.jurisdiction.inheritedValue).toBe('eu-mifid')
  })

  it('локали накапливаются по цепочке', () => {
    const settings = resolveTenantSettings(
      chain(
        { availableLocales: { mode: 'extend', items: [{ code: 'en' }] } },
        { availableLocales: { mode: 'extend', items: [{ code: 'de' }] } },
        { availableLocales: { mode: 'extend', items: [{ code: 'fr' }] } },
      ),
    )

    expect(settings.availableLocales.entries.map((entry) => entry.value)).toEqual([
      'de',
      'en',
      'fr',
    ])
  })

  it('форк локалей на сайте отбрасывает унаследованные', () => {
    const settings = resolveTenantSettings(
      chain(
        { availableLocales: { mode: 'extend', items: [{ code: 'en' }, { code: 'de' }] } },
        {},
        { availableLocales: { mode: 'fork', items: [{ code: 'ru' }] } },
      ),
    )

    expect(settings.availableLocales.entries.map((entry) => entry.value)).toEqual(['ru'])
    expect(settings.availableLocales.forkedAtTenantId).toBe('de')
  })
})

describe('validateResolvedSettings', () => {
  const valid = () =>
    resolveTenantSettings(
      chain(
        {},
        {
          jurisdiction: { mode: 'override', value: 'eu-mifid' },
          availableLocales: { mode: 'extend', items: [{ code: 'de' }, { code: 'en' }] },
          defaultLocale: { mode: 'override', value: 'de' },
        },
        {},
      ),
    )

  it('бренд и регион не проверяются — наружу они не отдаются', () => {
    expect(validateResolvedSettings('brand', resolveTenantSettings(chain()))).toEqual([])
    expect(validateResolvedSettings('region', resolveTenantSettings(chain()))).toEqual([])
  })

  it('сайт с полностью унаследованными настройками валиден', () => {
    expect(validateResolvedSettings('site', valid())).toEqual([])
  })

  it('сайт без юрисдикции где-либо в цепочке отвергается', () => {
    const settings = resolveTenantSettings(
      chain(
        {},
        {
          availableLocales: { mode: 'extend', items: [{ code: 'de' }] },
          defaultLocale: { mode: 'override', value: 'de' },
        },
        {},
      ),
    )

    expect(validateResolvedSettings('site', settings).join()).toMatch(
      /jurisdiction: не задана ни у сайта, ни выше/,
    )
  })

  it('сайт без локалей отвергается', () => {
    const settings = resolveTenantSettings(
      chain({}, { jurisdiction: { mode: 'override', value: 'eu-mifid' } }, {}),
    )

    expect(validateResolvedSettings('site', settings).join()).toMatch(/availableLocales/)
  })

  it('локаль по умолчанию обязана входить в разрешённые', () => {
    const settings = resolveTenantSettings(
      chain(
        {},
        {
          jurisdiction: { mode: 'override', value: 'eu-mifid' },
          availableLocales: { mode: 'extend', items: [{ code: 'de' }] },
        },
        { defaultLocale: { mode: 'override', value: 'fr' } },
      ),
    )

    expect(validateResolvedSettings('site', settings).join()).toMatch(
      /defaultLocale: "fr" отсутствует среди разрешённых/,
    )
  })

  it('форк локалей на сайте учитывается при проверке локали по умолчанию', () => {
    const settings = resolveTenantSettings(
      chain(
        {},
        {
          jurisdiction: { mode: 'override', value: 'eu-mifid' },
          availableLocales: { mode: 'extend', items: [{ code: 'de' }] },
          defaultLocale: { mode: 'override', value: 'de' },
        },
        { availableLocales: { mode: 'fork', items: [{ code: 'ru' }] } },
      ),
    )

    expect(validateResolvedSettings('site', settings).join()).toMatch(/defaultLocale: "de"/)
  })
})
