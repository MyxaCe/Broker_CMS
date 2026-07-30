import { toActor } from '../auth/actor'
import { isCrossTenantRole } from '../auth/roles'
import { normalizeRelationId } from '../shared/relation'

import { resolveEffectiveAccess } from './access'

import type { AccessDecision, TenantNode } from './types'
import type { Access, FieldAccess, PayloadRequest, Where } from 'payload'

/**
 * Подключение правил изоляции к коллекциям Payload.
 *
 * Здесь чистая логика из `access.ts` превращается в условие выборки. Именно
 * это делает изоляцию правилом доступа, а не фильтром интерфейса (ТЗ разд. 3):
 * ограничение уходит в запрос к БД, поэтому чужих данных не существует ни в
 * списке, ни по прямому идентификатору, ни через API.
 */

/** Поле коллекции, по которому она принадлежит тенанту. */
export interface TenantAccessOptions {
  /**
   * `id` — для самой коллекции тенантов;
   * `tenants` / `site` — для коллекций, ссылающихся на тенанта.
   */
  readonly field: string
}

export function decisionToWhere(decision: AccessDecision, field: string): boolean | Where {
  switch (decision.kind) {
    case 'deny':
      return false
    case 'allow-all':
      return true
    case 'allow-tenants':
      return { [field]: { in: [...decision.tenantIds] } }
  }
}

/**
 * Читает карту тенантов для разворачивания поддерева.
 *
 * `overrideAccess: true` здесь обязателен и не является послаблением: без него
 * проверка доступа к коллекции тенантов вызвала бы сама себя и ушла в
 * бесконечную рекурсию. Результат этого запроса наружу не отдаётся — он
 * используется только для вычисления ограничения.
 */
async function loadTenantNodes(req: PayloadRequest): Promise<ReadonlyMap<string, TenantNode>> {
  const result = await req.payload.find({
    collection: 'tenants',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })

  const nodes = new Map<string, TenantNode>()

  for (const doc of result.docs) {
    const record = doc as unknown as Record<string, unknown>
    const id = normalizeRelationId(record.id)
    const kind = record.kind

    if (id === null || (kind !== 'brand' && kind !== 'region' && kind !== 'site')) {
      continue
    }

    nodes.set(id, {
      id,
      slug: typeof record.slug === 'string' ? record.slug : '',
      kind,
      parentId: normalizeRelationId(record.parent),
    })
  }

  return nodes
}

/**
 * Правило доступа для коллекции, принадлежащей тенанту.
 *
 * Fail-closed по всей цепочке: нет пользователя — отказ; неизвестная роль —
 * отказ; пустая или устаревшая привязка — отказ.
 */
export function createTenantAccess(options: TenantAccessOptions): Access {
  return async ({ req }) => {
    const actor = toActor(req.user)

    if (actor === null) {
      return false
    }

    const nodes = await loadTenantNodes(req)
    const decision = resolveEffectiveAccess(actor, nodes)

    return decisionToWhere(decision, options.field)
  }
}

/**
 * Действует ли пользователь поверх всех тенантов.
 *
 * Проверка активности идёт до проверки роли: отключённый администратор бренда
 * не должен сохранять полномочия.
 */
export function isCrossTenantActor(user: unknown): boolean {
  const actor = toActor(user)
  return actor !== null && actor.isActive && isCrossTenantRole(actor.role)
}

/**
 * Операции, доступные только кросс-тенантной роли: создание и удаление
 * тенантов, заведение учётных записей.
 *
 * Ограничение выборки здесь неприменимо — у создания нет области видимости,
 * поэтому ответ строго булев.
 */
export const crossTenantOnly: Access = ({ req }) => isCrossTenantActor(req.user)

/** То же правило на уровне отдельного поля. */
export const crossTenantOnlyField: FieldAccess = ({ req }) => isCrossTenantActor(req.user)

/**
 * Изменение учётной записи: кросс-тенантная роль правит любую, остальные —
 * только свою собственную.
 *
 * Без исключения для себя человек не смог бы сменить даже собственный пароль.
 * При этом поля, определяющие полномочия — роль, активность, привязка —
 * закрыты отдельным правилом на уровне поля: иначе правка своей же карточки
 * стала бы способом повысить себе права.
 */
export const crossTenantOrSelf: Access = ({ req }) => {
  if (isCrossTenantActor(req.user)) {
    return true
  }

  const actor = toActor(req.user)

  if (actor === null || !actor.isActive) {
    return false
  }

  return { id: { equals: actor.id } }
}
