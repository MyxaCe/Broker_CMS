import { describe, expect, it } from 'vitest'

import {
  canAccessTenant,
  expandTenantScope,
  resolveEffectiveAccess,
  resolveTenantAccess,
} from './access'

import type { Actor, Role, TenantNode } from './types'

const NODES: ReadonlyMap<string, TenantNode> = new Map(
  (
    [
      { id: 'apex', slug: 'apex', kind: 'brand', parentId: null },
      { id: 'eu', slug: 'apex-eu', kind: 'region', parentId: 'apex' },
      { id: 'de', slug: 'apex-de', kind: 'site', parentId: 'eu' },
      { id: 'at', slug: 'apex-at', kind: 'site', parentId: 'eu' },
      { id: 'ru', slug: 'apex-ru', kind: 'site', parentId: 'apex' },
    ] satisfies TenantNode[]
  ).map((node) => [node.id, node]),
)

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 'user-1',
    role: 'editor',
    isActive: true,
    tenantIds: ['de'],
    ...overrides,
  }
}

describe('resolveTenantAccess — fail-closed', () => {
  it('отключённая учётная запись не получает ничего', () => {
    expect(resolveTenantAccess(actor({ isActive: false }))).toEqual({ kind: 'deny' })
  })

  it('отключённая кросс-тенантная роль тоже не получает ничего', () => {
    expect(resolveTenantAccess(actor({ role: 'brand-admin', isActive: false }))).toEqual({
      kind: 'deny',
    })
  })

  it('ПУСТАЯ привязка означает отказ, а не доступ ко всему', () => {
    expect(resolveTenantAccess(actor({ tenantIds: [] }))).toEqual({ kind: 'deny' })
  })
})

describe('resolveTenantAccess — роли', () => {
  it('администратор бренда работает поверх всех тенантов', () => {
    expect(resolveTenantAccess(actor({ role: 'brand-admin', tenantIds: [] }))).toEqual({
      kind: 'allow-all',
    })
  })

  it('разработчик работает поверх всех тенантов', () => {
    expect(resolveTenantAccess(actor({ role: 'developer', tenantIds: [] }))).toEqual({
      kind: 'allow-all',
    })
  })

  it.each(['editor', 'author', 'compliance', 'translator', 'viewer', 'site-admin'] as const)(
    'роль %s ограничена своей привязкой',
    (role: Role) => {
      expect(resolveTenantAccess(actor({ role, tenantIds: ['de'] }))).toEqual({
        kind: 'allow-tenants',
        tenantIds: ['de'],
      })
    },
  )
})

describe('expandTenantScope — поддерево', () => {
  it('привязка к бренду разворачивается во все его сайты', () => {
    const decision = expandTenantScope({ kind: 'allow-tenants', tenantIds: ['apex'] }, NODES)
    expect(decision.kind).toBe('allow-tenants')
    if (decision.kind !== 'allow-tenants') return
    expect([...decision.tenantIds].sort()).toEqual(['apex', 'at', 'de', 'eu', 'ru'])
  })

  it('привязка к региону не даёт доступа к сайту вне его', () => {
    const decision = expandTenantScope({ kind: 'allow-tenants', tenantIds: ['eu'] }, NODES)
    expect(canAccessTenant(decision, 'de')).toBe(true)
    expect(canAccessTenant(decision, 'ru')).toBe(false)
  })

  it('устаревшая привязка к удалённому тенанту даёт отказ, а не доступ ко всему', () => {
    expect(expandTenantScope({ kind: 'allow-tenants', tenantIds: ['удалён'] }, NODES)).toEqual({
      kind: 'deny',
    })
  })

  it('решения deny и allow-all не изменяются', () => {
    expect(expandTenantScope({ kind: 'deny' }, NODES)).toEqual({ kind: 'deny' })
    expect(expandTenantScope({ kind: 'allow-all' }, NODES)).toEqual({ kind: 'allow-all' })
  })
})

describe('resolveEffectiveAccess — изоляция тенантов', () => {
  it('редактор сайта A технически не может прочитать данные сайта B', () => {
    const decision = resolveEffectiveAccess(actor({ tenantIds: ['de'] }), NODES)
    expect(canAccessTenant(decision, 'de')).toBe(true)
    expect(canAccessTenant(decision, 'at')).toBe(false)
    expect(canAccessTenant(decision, 'ru')).toBe(false)
    expect(canAccessTenant(decision, 'apex')).toBe(false)
  })

  it('администратор бренда видит любой тенант', () => {
    const decision = resolveEffectiveAccess(actor({ role: 'brand-admin' }), NODES)
    expect(canAccessTenant(decision, 'ru')).toBe(true)
  })

  it('отключённый администратор бренда не видит ничего', () => {
    const decision = resolveEffectiveAccess(actor({ role: 'brand-admin', isActive: false }), NODES)
    expect(canAccessTenant(decision, 'apex')).toBe(false)
  })

  it('доступ к несуществующему тенанту не выдаётся никому, кроме кросс-тенантных ролей', () => {
    const scoped = resolveEffectiveAccess(actor(), NODES)
    expect(canAccessTenant(scoped, 'нет-такого')).toBe(false)
  })
})
