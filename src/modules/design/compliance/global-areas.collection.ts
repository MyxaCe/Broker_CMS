import { auditHooks, createTenantAccess, crossTenantOnly } from '@/platform'

import type { CollectionConfig } from 'payload'

/**
 * Глобальные области (ТЗ 2.2).
 *
 * Шапка, подвал, полоса объявления, cookie-баннер, полоса риск-предупреждения,
 * попапы. То, что живёт вне страницы и показывается на всех.
 *
 * Полоса риск-предупреждения здесь не «ещё одна область»: без неё страница не
 * публикуется в юрисдикциях, где предупреждение обязательно (ТЗ 2.4).
 */

export const GLOBAL_AREA_KINDS = [
  'header',
  'footer',
  'announcement',
  'cookie-banner',
  'risk-warning',
  'popup',
] as const

export type GlobalAreaKind = (typeof GLOBAL_AREA_KINDS)[number]

export const GLOBAL_AREA_LABELS: Record<GlobalAreaKind, string> = {
  header: 'Шапка',
  footer: 'Подвал',
  announcement: 'Полоса объявления',
  'cookie-banner': 'Cookie-баннер',
  'risk-warning': 'Полоса риск-предупреждения',
  popup: 'Попап',
}

export const GlobalAreas: CollectionConfig = {
  slug: 'global-areas',

  access: {
    read: createTenantAccess({ field: 'owner' }),
    create: createTenantAccess({ field: 'owner' }),
    update: createTenantAccess({ field: 'owner' }),
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'kind', 'owner', 'isActive'],
    group: 'Страницы',
    description:
      'Области вне страницы: шапка, подвал, предупреждения. Наследуются по цепочке бренд → регион → сайт.',
  },

  fields: [
    { name: 'title', type: 'text', required: true, label: 'Название' },
    {
      name: 'kind',
      type: 'select',
      required: true,
      index: true,
      label: 'Тип',
      options: GLOBAL_AREA_KINDS.map((value) => ({ value, label: GLOBAL_AREA_LABELS[value] })),
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
          'Бренд, регион или сайт. Область бренда действует на всех его сайтах, пока сайт не объявит свою того же типа.',
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
      admin: {
        description:
          'Снятие флага у полосы риск-предупреждения заблокирует сборку релиза в юрисдикциях, где оно обязательно.',
      },
    },

    {
      name: 'blocks',
      type: 'json',
      label: 'Блоки',
      admin: { description: 'Дерево блоков — то же, что и на странице.' },
    },

    /**
     * Текст предупреждения и доля теряющих счетов — отдельные поля, а не часть
     * дерева блоков.
     *
     * Причина: их проверяет движок. Найти обязательный текст внутри
     * произвольного дерева можно только угадыванием, а угадывать содержимое
     * регуляторного предупреждения нельзя.
     */
    {
      name: 'riskWarning',
      type: 'group',
      label: 'Риск-предупреждение',
      admin: { condition: (data) => data?.kind === 'risk-warning' },
      fields: [
        {
          name: 'text',
          type: 'textarea',
          label: 'Текст предупреждения',
          admin: {
            description:
              'Формулировка регулятора. Проверяется на непустоту при сборке релиза — пустая полоса не считается предупреждением.',
          },
        },
        {
          name: 'lossPercentage',
          type: 'number',
          label: 'Доля теряющих счетов, %',
          min: 0,
          max: 100,
          admin: {
            description:
              'Требуется в ЕС и Великобритании. Число приходит от бэк-офиса и обновляется ежеквартально.',
          },
        },
      ],
    },

    {
      name: 'jurisdictions',
      type: 'array',
      label: 'Юрисдикции',
      admin: { description: 'Пусто — область показывается во всех юрисдикциях сайта.' },
      fields: [{ name: 'code', type: 'text', required: true, label: 'Код' }],
    },
  ],

  hooks: {
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
