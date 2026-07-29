import { isCrossTenantRole } from '../auth/roles'

import { collectSubtree } from './chain'

import type { AccessDecision, Actor, TenantNode } from './types'

/**
 * Изоляция тенантов как ПРАВИЛО ДОСТУПА, а не фильтр интерфейса (ТЗ разд. 3).
 *
 * Разница принципиальная. Фильтр интерфейса прячет чужие данные из списка, но
 * оставляет их доступными по прямому запросу. Правило доступа возвращает
 * ограничение, которое подставляется в саму выборку: чужих данных не
 * существует ни в списке, ни по идентификатору, ни через API.
 *
 * Поэтому здесь возвращается не «показывать/не показывать», а перечень
 * тенантов для условия запроса.
 */

/**
 * Базовое решение по действующему лицу, без разворачивания поддерева.
 *
 * Fail-closed на каждом шаге: отсутствие условия означает отказ, а не пропуск.
 */
export function resolveTenantAccess(actor: Actor): AccessDecision {
  if (!actor.isActive) {
    return { kind: 'deny' }
  }

  if (isCrossTenantRole(actor.role)) {
    return { kind: 'allow-all' }
  }

  /**
   * Пустая привязка означает «ничего не видит», а НЕ «видит всё».
   *
   * Это самая дорогая ошибка в подобных системах: пустой список фильтров
   * естественно читается как «фильтров нет», и учётная запись без привязки
   * молча получает доступ ко всем тенантам. Здесь она получает отказ.
   */
  if (actor.tenantIds.length === 0) {
    return { kind: 'deny' }
  }

  return { kind: 'allow-tenants', tenantIds: [...actor.tenantIds] }
}

/**
 * Разворачивает привязку в полное поддерево: привязка к бренду даёт доступ к
 * его регионам и сайтам.
 *
 * Иначе администратору бренда пришлось бы перечислять сайты вручную и
 * дописывать список при каждом запуске нового — то есть доступ раздавался бы
 * по факту забывчивости.
 */
export function expandTenantScope(
  decision: AccessDecision,
  nodes: ReadonlyMap<string, TenantNode>,
): AccessDecision {
  if (decision.kind !== 'allow-tenants') {
    return decision
  }

  const expanded = collectSubtree(nodes, decision.tenantIds)

  /**
   * Привязка, не разрешившаяся ни в один существующий тенант (сайт удалён,
   * идентификатор устарел), — это не «доступ ко всему», а отсутствие доступа.
   */
  if (expanded.length === 0) {
    return { kind: 'deny' }
  }

  return { kind: 'allow-tenants', tenantIds: expanded }
}

/** Итоговое правило доступа: решение по роли плюс разворачивание поддерева. */
export function resolveEffectiveAccess(
  actor: Actor,
  nodes: ReadonlyMap<string, TenantNode>,
): AccessDecision {
  return expandTenantScope(resolveTenantAccess(actor), nodes)
}

export function canAccessTenant(decision: AccessDecision, tenantId: string): boolean {
  switch (decision.kind) {
    case 'allow-all':
      return true
    case 'allow-tenants':
      return decision.tenantIds.includes(tenantId)
    case 'deny':
      return false
  }
}
