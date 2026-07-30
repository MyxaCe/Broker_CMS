/**
 * Журнал аудита (ТЗ 5.2, разд. 3 «доказуемость»).
 *
 * Задача журнала — отвечать на вопрос «кто, что и когда сделал» на любой момент
 * прошлого. Из этого следуют два свойства, определяющие модель:
 *
 *  1. Записи только добавляются. Защита стоит на уровне БД, а не приложения:
 *     журнал, который можно поправить, доказательством не является.
 *  2. Действующее лицо сохраняется значениями, а не ссылкой. Ссылка показала бы
 *     роль, которая у человека СЕЙЧАС, а не ту, с которой он действовал тогда.
 */

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'login',
  'login-failed',
  'access-denied',
  'publish',
  'rollback',
  'approve',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
  login: 'Вход',
  'login-failed': 'Неудачный вход',
  'access-denied': 'Отказ в доступе',
  publish: 'Публикация',
  rollback: 'Откат',
  approve: 'Согласование',
}

export interface AuditActor {
  readonly id: string | null
  readonly email: string | null
  readonly role: string | null
}

export interface AuditEventInput {
  readonly action: AuditAction
  readonly targetCollection: string
  readonly targetId: string | null
  /** Идентификатор и название тенанта хранятся значениями, а не связью. */
  readonly tenantId: string | null
  readonly tenantSlug: string | null
  readonly actor: AuditActor
  readonly summary: string
  readonly changes: readonly unknown[]
  readonly requestId: string | null
}
