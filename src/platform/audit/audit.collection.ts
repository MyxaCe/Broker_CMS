import { createTenantAccess } from '../tenancy/payload-access'

import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS } from './types'

import type { AuditAction } from './types'
import type { CollectionConfig } from 'payload'

/**
 * Журнал аудита.
 *
 * Записи создаются только изнутри — сервисом `recordAuditEvent`, с обходом
 * правил доступа. Через API журнал доступен исключительно на чтение: событие,
 * которое можно создать снаружи, обесценивает журнал так же, как событие,
 * которое можно удалить.
 *
 * Запрет изменения и удаления продублирован на уровне БД триггером
 * (миграция `audit_append_only`). Правило приложения защищает от ошибки в коде,
 * правило БД — от обхода приложения.
 */
export const AuditEvents: CollectionConfig = {
  slug: 'audit-events',

  access: {
    /**
     * Чтение ограничено привязкой к тенантам. События без тенанта — например,
     * действия над учётными записями — видны только кросс-тенантным ролям.
     */
    read: createTenantAccess({ field: 'tenantId' }),
    create: () => false,
    update: () => false,
    delete: () => false,
  },

  admin: {
    useAsTitle: 'summary',
    defaultColumns: ['occurredAt', 'action', 'targetCollection', 'actorEmail', 'summary'],
    description:
      'Только добавление. Изменение и удаление записей запрещены и на уровне приложения, и на уровне базы данных.',
  },

  fields: [
    {
      name: 'occurredAt',
      type: 'date',
      required: true,
      index: true,
      label: 'Когда',
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'action',
      type: 'select',
      required: true,
      index: true,
      label: 'Действие',
      options: AUDIT_ACTIONS.map((value) => ({ value, label: AUDIT_ACTION_LABELS[value] })),
    },
    { name: 'targetCollection', type: 'text', required: true, index: true, label: 'Коллекция' },
    { name: 'targetId', type: 'text', index: true, label: 'Идентификатор записи' },
    /**
     * Тенант хранится идентификатором и названием, а НЕ связью.
     *
     * Связь означает внешний ключ, а внешний ключ означает, что удаление
     * тенанта изменит запись журнала — при `ON DELETE SET NULL` буквально
     * сотрёт из неё, к чему относилось событие. Журнал, который переписывается
     * при удалении того, о чём он свидетельствует, доказательством не является.
     *
     * Побочно это же снимает конфликт с триггером append-only: каскадное
     * обнуление — обычный UPDATE, и триггер запретил бы его, сделав удаление
     * тенанта невозможным.
     */
    { name: 'tenantId', type: 'text', index: true, label: 'Тенант (идентификатор)' },
    { name: 'tenantSlug', type: 'text', label: 'Тенант' },

    /**
     * Действующее лицо сохраняется значениями, а не ссылкой на учётную запись
     * по той же причине — плюс ссылка показала бы роль, которая у человека
     * сейчас, а не ту, с которой он действовал тогда.
     */
    { name: 'actorId', type: 'text', index: true, label: 'Кто (идентификатор)' },
    { name: 'actorEmail', type: 'text', label: 'Кто (почта)' },
    { name: 'actorRole', type: 'text', label: 'Роль на момент действия' },

    { name: 'summary', type: 'text', required: true, label: 'Кратко' },
    { name: 'changes', type: 'json', label: 'Изменения' },
    { name: 'requestId', type: 'text', index: true, label: 'Идентификатор запроса' },
  ],
}

/** Действия, доступные для записи в журнал. Экспортируется для удобства вызова. */
export type { AuditAction }
