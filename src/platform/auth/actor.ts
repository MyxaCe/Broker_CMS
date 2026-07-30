import { normalizeRelationIds } from '../shared/relation'

import { ROLES } from './roles'

import type { Role } from './roles'
import type { Actor } from '../tenancy/types'

/**
 * Превращает пользователя Payload в действующее лицо для правил доступа.
 *
 * Возвращает `null` вместо «пустого» действующего лица: неаутентифицированный
 * или испорченный пользователь не должен получать объект, который где-то ниже
 * по коду примут за валидный с пустыми правами. Отсутствие — это `null`,
 * и обрабатывается оно отказом.
 */
export function toActor(user: unknown): Actor | null {
  if (user === null || typeof user !== 'object') {
    return null
  }

  const record = user as Record<string, unknown>

  const id =
    typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : null
  if (id === null || id === '') {
    return null
  }

  /**
   * Неизвестная роль — отказ, а не «роль по умолчанию».
   * Значение могло остаться от удалённой роли или прийти из мигрированных
   * данных; в обоих случаях права по нему определить нельзя.
   */
  const role = record.role
  if (typeof role !== 'string' || !isKnownRole(role)) {
    return null
  }

  /**
   * Отсутствие флага активности трактуется как неактивность.
   * Обратное означало бы, что запись, не прошедшая миграцию, получает доступ.
   */
  const isActive = record.isActive === true

  return {
    id,
    role,
    isActive,
    tenantIds: normalizeRelationIds(record.tenants),
  }
}

function isKnownRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}
