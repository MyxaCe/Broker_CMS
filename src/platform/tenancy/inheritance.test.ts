import { describe, expect, it } from 'vitest'

import {
  canRevertToInherited,
  resolveCollection,
  resolveField,
  revertLeavesEmpty,
} from './inheritance'

import type { CollectionLayerState, LayerState, TenantNode } from './types'

const CHAIN: TenantNode[] = [
  { id: 'apex', slug: 'apex', kind: 'brand', parentId: null },
  { id: 'eu', slug: 'apex-eu', kind: 'region', parentId: 'apex' },
  { id: 'de', slug: 'apex-de', kind: 'site', parentId: 'eu' },
]

function layers<T>(entries: Record<string, LayerState<T>>): ReadonlyMap<string, LayerState<T>> {
  return new Map(Object.entries(entries))
}

describe('resolveField — источник значения', () => {
  it('пустая цепочка даёт unset', () => {
    expect(resolveField([], layers({})).provenance).toBe('unset')
  })

  it('ни один слой не задал значение — unset', () => {
    const result = resolveField(CHAIN, layers<string>({}))
    expect(result).toMatchObject({ value: undefined, provenance: 'unset', sourceTenantId: null })
  })

  it('значение только на бренде — наследуется до сайта', () => {
    const result = resolveField(CHAIN, layers({ apex: { state: 'override', value: '#0b5' } }))
    expect(result).toMatchObject({
      value: '#0b5',
      provenance: 'inherited',
      sourceTenantId: 'apex',
    })
  })

  it('ближайший слой побеждает дальний', () => {
    const result = resolveField(
      CHAIN,
      layers({
        apex: { state: 'override', value: 'бренд' },
        eu: { state: 'override', value: 'регион' },
      }),
    )
    expect(result).toMatchObject({ value: 'регион', sourceTenantId: 'eu', provenance: 'inherited' })
  })

  it('значение на листе помечается как overridden', () => {
    const result = resolveField(
      CHAIN,
      layers({
        apex: { state: 'override', value: 'бренд' },
        de: { state: 'override', value: 'сайт' },
      }),
    )
    expect(result).toMatchObject({ value: 'сайт', provenance: 'overridden', sourceTenantId: 'de' })
  })

  it('форк на листе помечается как forked', () => {
    const result = resolveField(CHAIN, layers({ de: { state: 'fork', value: 'своё' } }))
    expect(result.provenance).toBe('forked')
  })

  it('явный unset на листе не перекрывает родителя', () => {
    const result = resolveField(
      CHAIN,
      layers({ eu: { state: 'override', value: 'регион' }, de: { state: 'unset' } }),
    )
    expect(result).toMatchObject({ value: 'регион', provenance: 'inherited' })
  })
})

describe('resolveField — возврат к наследуемому', () => {
  it('показывает, к какому значению вернётся поле', () => {
    const result = resolveField(
      CHAIN,
      layers({
        apex: { state: 'override', value: 'бренд' },
        eu: { state: 'override', value: 'регион' },
        de: { state: 'override', value: 'сайт' },
      }),
    )
    expect(result.inheritedValue).toBe('регион')
    expect(result.inheritedFromTenantId).toBe('eu')
    expect(canRevertToInherited(result)).toBe(true)
  })

  it('возврат недоступен, если лист ничего не задавал', () => {
    const result = resolveField(CHAIN, layers({ apex: { state: 'override', value: 'бренд' } }))
    expect(canRevertToInherited(result)).toBe(false)
  })

  it('предупреждает, что возврат оставит поле пустым', () => {
    const result = resolveField(CHAIN, layers({ de: { state: 'override', value: 'сайт' } }))
    expect(canRevertToInherited(result)).toBe(true)
    expect(revertLeavesEmpty(result)).toBe(true)
  })

  it('возврат к существующему значению пустоты не оставляет', () => {
    const result = resolveField(
      CHAIN,
      layers({
        apex: { state: 'override', value: 'бренд' },
        de: { state: 'override', value: 'сайт' },
      }),
    )
    expect(revertLeavesEmpty(result)).toBe(false)
  })
})

function collectionLayers<T>(
  entries: Record<string, CollectionLayerState<T>>,
): ReadonlyMap<string, CollectionLayerState<T>> {
  return new Map(Object.entries(entries))
}

function items<T>(record: Record<string, T>): ReadonlyMap<string, T> {
  return new Map(Object.entries(record))
}

describe('resolveCollection — накопление по цепочке', () => {
  it('собирает элементы всех слоёв', () => {
    const result = resolveCollection(
      CHAIN,
      collectionLayers({
        apex: { state: 'extend', items: items({ hero: 'бренд-hero' }) },
        de: { state: 'extend', items: items({ faq: 'сайт-faq' }) },
      }),
    )
    expect(result.entries.map((entry) => entry.key)).toEqual(['faq', 'hero'])
    expect(result.forkedAtTenantId).toBeNull()
  })

  it('ближний слой переопределяет ключ дальнего', () => {
    const result = resolveCollection(
      CHAIN,
      collectionLayers({
        apex: { state: 'extend', items: items({ hero: 'бренд' }) },
        de: { state: 'extend', items: items({ hero: 'сайт' }) },
      }),
    )
    expect(result.entries).toEqual([
      { key: 'hero', value: 'сайт', provenance: 'overridden', sourceTenantId: 'de' },
    ])
  })

  it('унаследованные элементы помечаются как inherited', () => {
    const result = resolveCollection(
      CHAIN,
      collectionLayers({ apex: { state: 'extend', items: items({ hero: 'бренд' }) } }),
    )
    expect(result.entries[0]).toMatchObject({ provenance: 'inherited', sourceTenantId: 'apex' })
  })
})

describe('resolveCollection — отвязка', () => {
  it('форк отбрасывает всё, что пришло сверху', () => {
    const result = resolveCollection(
      CHAIN,
      collectionLayers({
        apex: { state: 'extend', items: items({ hero: 'бренд', promo: 'бренд-promo' }) },
        de: { state: 'fork', items: items({ hero: 'только своё' }) },
      }),
    )
    expect(result.entries.map((entry) => entry.key)).toEqual(['hero'])
    expect(result.entries[0]?.value).toBe('только своё')
    expect(result.forkedAtTenantId).toBe('de')
  })

  it('форк в середине цепочки отсекает бренд, но не потомков', () => {
    const result = resolveCollection(
      CHAIN,
      collectionLayers({
        apex: { state: 'extend', items: items({ brandOnly: 'бренд' }) },
        eu: { state: 'fork', items: items({ regional: 'регион' }) },
        de: { state: 'extend', items: items({ local: 'сайт' }) },
      }),
    )
    expect(result.entries.map((entry) => entry.key)).toEqual(['local', 'regional'])
    expect(result.forkedAtTenantId).toBe('eu')
  })

  it('элемент, добавленный на форкнутом слое, помечается forked', () => {
    const result = resolveCollection(
      CHAIN,
      collectionLayers({ de: { state: 'fork', items: items({ hero: 'своё' }) } }),
    )
    expect(result.entries[0]?.provenance).toBe('forked')
  })
})
