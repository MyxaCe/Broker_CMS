import { auditHooks, createTenantAccess, crossTenantOnly } from '@/platform'

import { validateNavTree } from './tree'

import type { CollectionConfig } from 'payload'

/**
 * Меню (ТЗ 2.2).
 *
 * Одна запись — одно меню сайта на одном языке: главное, подвал, боковое.
 * Дерево хранится полем JSON по той же причине, что и блоки страницы: оно
 * редактируется и публикуется целиком.
 */

export const NAV_PLACEMENTS = ['primary', 'footer', 'utility', 'mobile', 'legal'] as const

export type NavPlacement = (typeof NAV_PLACEMENTS)[number]

export const NAV_PLACEMENT_LABELS: Record<NavPlacement, string> = {
  primary: 'Главное меню',
  footer: 'Меню подвала',
  utility: 'Служебное меню',
  mobile: 'Мобильное меню',
  legal: 'Правовые ссылки',
}

export const Navigations: CollectionConfig = {
  slug: 'navigations',

  access: {
    read: createTenantAccess({ field: 'owner' }),
    create: createTenantAccess({ field: 'owner' }),
    update: createTenantAccess({ field: 'owner' }),
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'placement', 'locale', 'owner', 'isActive'],
    group: 'Страницы',
    description:
      'Дерево пунктов, а не список адресов. Пункт ссылается на страницу — удалённая страница видна как расхождение, а не как 404.',
  },

  fields: [
    { name: 'title', type: 'text', required: true, label: 'Название' },
    {
      name: 'placement',
      type: 'select',
      required: true,
      index: true,
      label: 'Размещение',
      options: NAV_PLACEMENTS.map((value) => ({ value, label: NAV_PLACEMENT_LABELS[value] })),
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'tenants',
      required: true,
      index: true,
      label: 'Владелец',
      admin: {
        description:
          'Бренд, регион или сайт. Меню бренда действует на всех его сайтах, пока сайт не объявит своё того же размещения и языка.',
      },
    },
    {
      name: 'locale',
      type: 'text',
      required: true,
      index: true,
      label: 'Язык',
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(value)) {
          return 'Код языка вида en или en-GB.'
        }

        return true
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      label: 'Действует',
    },

    {
      name: 'items',
      type: 'json',
      label: 'Пункты',
      admin: {
        description:
          'Дерево: подпись, назначение (страница, внешний адрес, заголовок раздела), вложенные пункты.',
      },
    },
  ],

  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (!data) return data

        /**
         * Форма дерева проверяется при сохранении, целостность ссылок — при
         * сборке релиза. Разделение намеренное: при сохранении список страниц
         * ещё меняется — редактор вправе собрать меню раньше страниц, — а вот
         * пункт без подписи неправилен в любой момент.
         */
        const issues = validateNavTree(data.items, { knownPages: new Set() })

        if (issues.length > 0) {
          throw new Error(
            `Меню не сохранено: ${issues.map((issue) => `${issue.path} — ${issue.message}`).join('; ')}`,
          )
        }

        return data
      },
    ],

    afterChange: [auditHooks({ tenantOf: ownerOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: ownerOf }).afterDelete],
  },
}

function ownerOf(doc: Record<string, unknown>): { id: string | null; slug: string | null } {
  const owner = doc.owner

  if (owner !== null && typeof owner === 'object' && 'id' in owner) {
    const record = owner as Record<string, unknown>

    return {
      id: record.id === undefined || record.id === null ? null : String(record.id),
      slug: typeof record.slug === 'string' ? record.slug : null,
    }
  }

  return { id: owner === undefined || owner === null ? null : String(owner), slug: null }
}
