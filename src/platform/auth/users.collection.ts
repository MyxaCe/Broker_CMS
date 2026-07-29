import { ROLE_LABELS, ROLES } from './roles'

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
      admin: {
        description:
          'Роль определяет права. Смена роли — событие аудита, а не рядовая правка карточки.',
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      label: 'Активен',
      admin: {
        description:
          'Отзыв доступа выполняется снятием этого флага: учётные записи не удаляются, иначе теряется история аудита.',
      },
    },
  ],
}
