import { auditHooks, crossTenantOnly } from '@/platform'

import { DELIVERY_SCOPES, SCOPE_LABELS } from './scopes'

import type { DeliveryScope } from './scopes'
import type { CollectionConfig } from 'payload'

/**
 * Ключи доставки (ТЗ разд. 6).
 *
 * В базе нет ни одного ключа в открытом виде — только отпечаток секрета.
 * Показать ключ можно ровно один раз, в момент выдачи; после этого он
 * невосстановим, и «посмотреть забытый ключ» невозможно by design.
 */
export const DeliveryKeys: CollectionConfig = {
  slug: 'delivery-keys',

  /**
   * Ключи целиком в ведении кросс-тенантной роли: выдача ключа — это выдача
   * доступа к данным сайта, и решение о ней не должно приниматься внутри
   * самого сайта.
   */
  access: {
    read: crossTenantOnly,
    create: crossTenantOnly,
    update: crossTenantOnly,
    delete: () => false,
  },

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'keyId', 'isActive', 'expiresAt'],
    description:
      'Секрет ключа показывается один раз при выдаче и нигде не хранится. Потерянный ключ не восстанавливается — выпускается новый, старый отзывается.',
  },

  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Назначение',
      admin: { description: 'Кто именно ходит этим ключом: сайт, кабинет, терминал.' },
    },
    {
      name: 'keyId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      label: 'Идентификатор ключа',
      admin: {
        readOnly: true,
        description: 'Открытая часть: по ней находится запись. Секретом не является.',
      },
    },
    {
      name: 'secretHash',
      type: 'text',
      required: true,
      label: 'Отпечаток секрета',
      /**
       * Наружу не отдаётся никогда — даже кросс-тенантной роли. Отпечаток
       * бесполезен без «перца», но незачем давать и его: утечка отпечатков
       * сокращает работу подбора ровно на один шаг.
       */
      access: { read: () => false, update: () => false },
      admin: { hidden: true },
    },
    {
      name: 'scopes',
      type: 'select',
      hasMany: true,
      required: true,
      label: 'Права',
      options: DELIVERY_SCOPES.map((value) => ({ value, label: SCOPE_LABELS[value] })),
      admin: {
        description:
          'Утёкший ключ одного потребителя не должен открывать данные другого — поэтому прав выдаётся ровно столько, сколько нужно.',
      },
    },
    {
      name: 'sites',
      type: 'relationship',
      relationTo: 'tenants',
      hasMany: true,
      index: true,
      label: 'Сайты',
      admin: {
        description:
          'Пустая привязка означает, что ключ не открывает ничего. Это отказ, а не доступ ко всему.',
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      label: 'Действует',
      admin: { description: 'Отзыв ключа — снятие этого флага; запись остаётся для аудита.' },
    },
    {
      name: 'expiresAt',
      type: 'date',
      label: 'Действителен до',
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Пусто — бессрочно. Для ключей подрядчиков срок стоит задавать всегда.',
      },
    },
    { name: 'lastUsedAt', type: 'date', label: 'Последнее использование' },
  ],

  hooks: {
    afterChange: [auditHooks({ tenantOf: () => ({ id: null, slug: null }) }).afterChange],
    afterDelete: [auditHooks({ tenantOf: () => ({ id: null, slug: null }) }).afterDelete],
  },
}

export type { DeliveryScope }
