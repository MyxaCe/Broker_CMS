import { auditHooks } from '@/platform'

import { createStreamWriteAccess, streamDeleteAccess } from '../access'
import { ownerOf } from '../shared/site-of'

import { ownerField, slugField } from './shared-fields'

import type { CollectionConfig } from 'payload'

/**
 * Авторы (ТЗ 1.1).
 *
 * Заведены не ради подписи под текстом, а ради E-E-A-T: поисковые системы
 * оценивают материалы финансовой тематики по тому, кто их написал и чем
 * подтверждена его компетентность. Поэтому здесь роль, биография и
 * дисклеймер — это содержательные поля, а не украшение карточки.
 */
export const Authors: CollectionConfig = {
  slug: 'authors',

  access: {
    read: () => true,
    create: createStreamWriteAccess({ siteField: 'owner' }),
    update: createStreamWriteAccess({ siteField: 'owner' }),
    delete: streamDeleteAccess,
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'role', 'owner'],
    group: 'Поток',
    description:
      'Карточка автора уходит в разметку страницы. Для финансовой тематики это влияет на ранжирование напрямую.',
  },

  fields: [
    /** Собственное объявление вместо общего: у автора это имя, а не название. */
    { name: 'title', type: 'text', required: true, label: 'Имя и фамилия' },
    slugField,
    ownerField,
    {
      name: 'role',
      type: 'text',
      required: true,
      label: 'Должность',
      admin: {
        description: 'Например: аналитик рынка облигаций. Общие слова здесь работают против нас.',
      },
    },
    {
      name: 'bio',
      type: 'textarea',
      label: 'Биография',
      admin: {
        description: 'Опыт и квалификация: чем подтверждается право этого человека писать о рынке.',
      },
    },
    {
      name: 'photo',
      type: 'upload',
      relationTo: 'media',
      label: 'Фото',
    },
    {
      name: 'links',
      type: 'array',
      label: 'Профили',
      admin: {
        description: 'Внешние подтверждения личности: LinkedIn, публикации, профиль регулятора.',
      },
      fields: [
        {
          name: 'label',
          type: 'text',
          required: true,
          label: 'Название',
        },
        {
          name: 'href',
          type: 'text',
          required: true,
          label: 'Адрес',
          validate: (value: unknown) => {
            if (typeof value !== 'string' || !/^https:\/\//.test(value)) {
              return 'Только адреса по https.'
            }

            return true
          },
        },
      ],
    },
    {
      name: 'disclaimer',
      type: 'textarea',
      label: 'Юридический дисклеймер',
      admin: {
        description:
          'Оговорка о том, что материалы не являются инвестиционной рекомендацией. Требуется регулятором и подставляется в материалы автора.',
      },
    },
  ],

  hooks: {
    afterChange: [auditHooks({ tenantOf: ownerOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: ownerOf }).afterDelete],
  },
}
