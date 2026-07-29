import { describe, expect, it } from 'vitest'

import { buildChain, collectSubtree, TenantChainError } from './chain'

import type { TenantNode } from './types'

function tenants(...nodes: TenantNode[]): ReadonlyMap<string, TenantNode> {
  return new Map(nodes.map((node) => [node.id, node]))
}

const brand: TenantNode = { id: 'apex', slug: 'apex', kind: 'brand', parentId: null }
const region: TenantNode = { id: 'eu', slug: 'apex-eu', kind: 'region', parentId: 'apex' }
const site: TenantNode = { id: 'de', slug: 'apex-de', kind: 'site', parentId: 'eu' }

describe('buildChain — корректные цепочки', () => {
  it('строит brand → region → site от корня к листу', () => {
    const chain = buildChain(tenants(brand, region, site), 'de')
    expect(chain.map((node) => node.slug)).toEqual(['apex', 'apex-eu', 'apex-de'])
  })

  it('допускает сайт напрямую под брендом', () => {
    const soloSite: TenantNode = { id: 'ru', slug: 'apex-ru', kind: 'site', parentId: 'apex' }
    const chain = buildChain(tenants(brand, soloSite), 'ru')
    expect(chain.map((node) => node.kind)).toEqual(['brand', 'site'])
  })

  it('цепочка из одного бренда валидна', () => {
    expect(buildChain(tenants(brand), 'apex')).toHaveLength(1)
  })
})

describe('buildChain — отказы', () => {
  it('отвергает цикл', () => {
    const looped = tenants(
      { id: 'a', slug: 'a', kind: 'brand', parentId: 'b' },
      { id: 'b', slug: 'b', kind: 'region', parentId: 'a' },
    )
    expect(() => buildChain(looped, 'a')).toThrow(TenantChainError)
    expect(() => buildChain(looped, 'a')).toThrow(/Цикл/)
  })

  it('отвергает ссылку на несуществующий тенант', () => {
    expect(() => buildChain(tenants(site), 'de')).toThrow(/не найден/)
  })

  it('отвергает цепочку глубже трёх уровней', () => {
    const deep = tenants(
      brand,
      region,
      { id: 'sub', slug: 'sub', kind: 'region', parentId: 'eu' },
      { id: 'leaf', slug: 'leaf', kind: 'site', parentId: 'sub' },
    )
    expect(() => buildChain(deep, 'leaf')).toThrow(/Глубина/)
  })

  it('требует бренд в корне', () => {
    const headless = tenants({ id: 'eu', slug: 'apex-eu', kind: 'region', parentId: null })
    expect(() => buildChain(headless, 'eu')).toThrow(/Корнем цепочки обязан быть бренд/)
  })

  it('требует у корня отсутствие родителя', () => {
    const orphanRoot = tenants(
      { id: 'apex', slug: 'apex', kind: 'brand', parentId: 'ghost' },
      { id: 'ghost', slug: 'ghost', kind: 'brand', parentId: null },
    )
    expect(() => buildChain(orphanRoot, 'apex')).toThrow(TenantChainError)
  })

  it('запрещает регион под регионом', () => {
    const nested = tenants(brand, region, {
      id: 'sub',
      slug: 'sub',
      kind: 'region',
      parentId: 'eu',
    })
    // Форма нарушена: регион не может наследоваться от региона.
    expect(() => buildChain(nested, 'sub')).toThrow(/Недопустимый родитель/)
  })

  it('запрещает потомков у сайта', () => {
    // Цепочка ровно из трёх звеньев: проверка формы должна сработать раньше,
    // чем ограничение глубины, иначе редактор получит неточную причину.
    const belowSite = tenants(
      brand,
      { id: 'ru', slug: 'apex-ru', kind: 'site', parentId: 'apex' },
      { id: 'child', slug: 'child', kind: 'site', parentId: 'ru' },
    )
    expect(() => buildChain(belowSite, 'child')).toThrow(/Сайт не может иметь потомков/)
  })

  it('запрещает регион под сайтом', () => {
    const regionUnderSite = tenants(
      brand,
      { id: 'ru', slug: 'apex-ru', kind: 'site', parentId: 'apex' },
      { id: 'sub', slug: 'sub', kind: 'region', parentId: 'ru' },
    )
    expect(() => buildChain(regionUnderSite, 'sub')).toThrow(/Сайт не может иметь потомков/)
  })

  it('запрещает бренд не в корне', () => {
    const twoBrands = tenants(brand, {
      id: 'sub-brand',
      slug: 'sub-brand',
      kind: 'brand',
      parentId: 'apex',
    })
    expect(() => buildChain(twoBrands, 'sub-brand')).toThrow(/Недопустимый родитель/)
  })
})

describe('collectSubtree', () => {
  const all = tenants(brand, region, site, {
    id: 'at',
    slug: 'apex-at',
    kind: 'site',
    parentId: 'eu',
  })

  it('от бренда разворачивается во всё поддерево', () => {
    expect(collectSubtree(all, ['apex']).sort()).toEqual(['apex', 'at', 'de', 'eu'])
  })

  it('от региона — только его сайты', () => {
    expect(collectSubtree(all, ['eu']).sort()).toEqual(['at', 'de', 'eu'])
  })

  it('от листа — только он сам', () => {
    expect(collectSubtree(all, ['de'])).toEqual(['de'])
  })

  it('игнорирует несуществующие идентификаторы', () => {
    expect(collectSubtree(all, ['нет-такого'])).toEqual([])
  })

  it('не дублирует при пересекающихся корнях', () => {
    expect(collectSubtree(all, ['apex', 'eu', 'de']).sort()).toEqual(['apex', 'at', 'de', 'eu'])
  })
})
