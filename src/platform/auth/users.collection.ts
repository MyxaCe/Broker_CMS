import { auditHooks, markSecretChanged, recordLogin, recordLogout } from '../audit/record'
import { normalizeRelationIds } from '../shared/relation'
import {
  createTenantAccess,
  crossTenantOnly,
  crossTenantOnlyField,
  crossTenantOrSelf,
} from '../tenancy/payload-access'

import { ROLE_LABELS, ROLES } from './roles'
import { validateUserDraft } from './user-rules'

import type { Role } from './roles'
import type { CollectionConfig } from 'payload'

/**
 * Учётные записи сотрудников.
 *
 * ТЗ разд. 13 запрещает создание учётных записей с предопределёнными паролями,
 * поэтому сидов с паролем здесь не будет ни сейчас, ни потом: первый
 * администратор заводится через экран первичной настройки Payload, остальные —
 * приглашением.
 */
export const Users: CollectionConfig = {
  slug: 'users',

  auth: {
    // ТЗ разд. 6: перебор пароля должен упираться в блокировку, а не в лимит
    // на стороне прокси, которого может не оказаться.
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    tokenExpiration: 8 * 60 * 60,
    depth: 0,
    // Ключи доставки живут отдельно и имеют свои скоупы: учётная запись
    // человека не должна превращаться в ключ доступа к API.
    useAPIKey: false,
  },

  /**
   * Заведение и удаление учётных записей — только кросс-тенантная роль.
   * Это строже, чем требует ТЗ 5.1, где администратор сайта управляет своими
   * редакторами. Направление выбрано осознанно: расширять права позже дешевле
   * и безопаснее, чем обнаружить, что они были шире, чем предполагалось.
   */
  access: {
    read: createTenantAccess({ field: 'tenants' }),
    create: crossTenantOnly,
    update: crossTenantOrSelf,
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'fullName', 'role'],
  },

  fields: [
    {
      name: 'fullName',
      type: 'text',
      required: true,
      label: 'Имя и фамилия',
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      label: 'Роль',
      options: ROLES.map((value) => ({ value, label: ROLE_LABELS[value] })),
      /**
       * Роль правит только кросс-тенантная роль. Иначе редактор, правя
       * собственную карточку, повысил бы себе права.
       */
      access: { update: crossTenantOnlyField },
      admin: {
        description:
          'Роль определяет права. Смена роли — событие аудита, а не рядовая правка карточки.',
      },
    },
    {
      name: 'tenants',
      type: 'relationship',
      relationTo: 'tenants',
      hasMany: true,
      index: true,
      label: 'Привязка к тенантам',
      access: { update: crossTenantOnlyField },
      admin: {
        description:
          'Определяет, какие данные видит человек. Привязка к бренду или региону распространяется на всё поддерево. Пустая привязка означает, что не видно ничего.',
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      label: 'Активен',
      access: { update: crossTenantOnlyField },
      admin: {
        description:
          'Отзыв доступа выполняется снятием этого флага: учётные записи не удаляются, иначе теряется история аудита.',
      },
    },
  ],

  hooks: {
    /**
     * События по учётным записям не привязаны к тенанту: человек может быть
     * привязан к нескольким, и «размазать» действие по ним значило бы показать
     * его тем, кого оно не касается. Такие записи видят кросс-тенантные роли.
     */
    afterChange: [auditHooks({ tenantOf: () => ({ id: null, slug: null }) }).afterChange],
    afterDelete: [auditHooks({ tenantOf: () => ({ id: null, slug: null }) }).afterDelete],

    /**
     * Пароль не доходит до `afterChange`: Payload не возвращает его в документе,
     * поэтому его смена выглядит как отсутствие изменений. Отметка ставится
     * здесь — там, где значение ещё видно, — и попадает в событие изменения.
     * Само значение при этом никуда не записывается.
     */
    beforeChange: [
      ({ context, data, operation }) => {
        if (operation === 'update' && typeof data.password === 'string' && data.password !== '') {
          markSecretChanged(context as Record<string, unknown>, 'password')
        }

        return data
      },
    ],

    afterLogin: [
      async ({ collection, req, user }) => {
        await recordLogin({ req, user, collectionSlug: collection.slug })
      },
    ],

    afterLogout: [
      async ({ collection, req }) => {
        await recordLogout({ req, collectionSlug: collection.slug })
      },
    ],

    beforeValidate: [
      ({ data }) => {
        if (!data) return data

        const role = data.role
        if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) {
          // Обязательность и допустимые значения роли проверяет сама схема поля.
          return data
        }

        const issues = validateUserDraft({
          role: role as Role,
          tenantIds: normalizeRelationIds(data.tenants),
        })

        if (issues.length > 0) {
          throw new Error(`Учётная запись не прошла проверку:\n  - ${issues.join('\n  - ')}`)
        }

        return data
      },
    ],
  },
}
