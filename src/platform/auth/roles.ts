/**
 * Роли из ТЗ 5.1. Список закрытый: новая роль — это изменение модели доступа,
 * а не строка в справочнике, поэтому добавляется через ADR.
 */
export const ROLES = [
  'brand-admin',
  'site-admin',
  'editor',
  'author',
  'compliance',
  'translator',
  'viewer',
  'developer',
] as const

export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  'brand-admin': 'Администратор бренда',
  'site-admin': 'Администратор сайта',
  editor: 'Редактор',
  author: 'Автор',
  compliance: 'Комплаенс',
  translator: 'Переводчик',
  viewer: 'Наблюдатель',
  developer: 'Разработчик',
}

/**
 * Роли, действующие поверх всех тенантов. Все остальные обязаны иметь
 * непустую привязку к сайтам — без неё пользователь не видит ничего.
 *
 * Изоляция тенантов — правило доступа, а не фильтр интерфейса (ТЗ разд. 3):
 * значение этой константы влияет на выборку данных, а не на видимость пунктов
 * меню.
 */
export const CROSS_TENANT_ROLES: readonly Role[] = ['brand-admin', 'developer']

export function isCrossTenantRole(role: Role): boolean {
  return CROSS_TENANT_ROLES.includes(role)
}

/**
 * Роль, без которой невозможен аппрув контента классов `legal` и `compliance`
 * («четыре глаза», ТЗ 5.1), а в режиме `unverified` — и торговых условий
 * (ADR-0005).
 */
export const APPROVER_ROLE: Role = 'compliance'
