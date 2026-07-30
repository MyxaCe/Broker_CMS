import { isCrossTenantRole } from './roles'

import type { Role } from './roles'

/**
 * Правила целостности учётной записи. Чистая функция — тестируется без БД.
 */

export interface UserDraft {
  readonly role: Role
  readonly tenantIds: readonly string[]
}

export function validateUserDraft(draft: UserDraft): string[] {
  const issues: string[] = []

  /**
   * Учётная запись без привязки не получает доступа ни к чему
   * (см. `resolveTenantAccess`). Сохранять её в таком виде можно, но это
   * почти всегда означает забытое поле, а не намерение: человек заведён,
   * логин работает, а данных не видно, и причина неочевидна.
   *
   * Поэтому привязка обязательна для всех ролей, кроме кросс-тенантных,
   * которым она не нужна по определению.
   */
  if (!isCrossTenantRole(draft.role) && draft.tenantIds.length === 0) {
    issues.push(
      `tenants: обязательна хотя бы одна привязка для роли "${draft.role}" — без неё учётная запись не увидит ни одного тенанта`,
    )
  }

  /**
   * Кросс-тенантная роль работает поверх всех тенантов, и привязка на неё не
   * влияет. Оставленная привязка вводит в заблуждение: кажется, что права
   * ограничены перечисленными сайтами, хотя это не так.
   */
  if (isCrossTenantRole(draft.role) && draft.tenantIds.length > 0) {
    issues.push(
      `tenants: роль "${draft.role}" действует поверх всех тенантов — привязка не ограничивает её и должна быть пустой, иначе права выглядят уже, чем они есть`,
    )
  }

  const duplicates = draft.tenantIds.filter((id, index) => draft.tenantIds.indexOf(id) !== index)

  if (duplicates.length > 0) {
    issues.push(`tenants: привязка повторяется — ${[...new Set(duplicates)].join(', ')}`)
  }

  return issues
}
