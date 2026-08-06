import { auditHooks, createTenantAccess, crossTenantOnly, isCrossTenantActor } from '@/platform'

import { SECTION_KEY_PATTERN } from './resolve'

import type { CollectionConfig } from 'payload'

/**
 * Переиспользуемые секции (ТЗ 2.2).
 *
 * Ключ — то, чем на секцию ссылается страница. Он живёт дольше названия:
 * название правят, ключ переживает правку, и ссылки не ломаются.
 */
export const Sections: CollectionConfig = {
  slug: 'sections',

  access: {
    read: createTenantAccess({ field: 'owner' }),
    create: createTenantAccess({ field: 'owner' }),
    update: createTenantAccess({ field: 'owner' }),
    /**
     * Удаление — только кросс-тенантной роли: на секцию бренда могут ссылаться
     * страницы двадцати сайтов, и её исчезновение пробивает дыру сразу во всех.
     * Обычный путь снятия — флаг «Действует», который виден в отчёте сборки.
     */
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'key', 'locale', 'owner', 'isActive'],
    group: 'Страницы',
    description:
      'Общий кусок страницы. Секция бренда действует на всех его сайтах, пока сайт не заведёт свою с тем же ключом.',
  },

  fields: [
    { name: 'title', type: 'text', required: true, label: 'Название' },
    {
      name: 'key',
      type: 'text',
      required: true,
      index: true,
      label: 'Ключ',
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !SECTION_KEY_PATTERN.test(value)) {
          return 'Ключ строчными латинскими через дефис: how-to-open-account.'
        }

        return true
      },
      admin: {
        description:
          'Ссылка страницы указывает на ключ, а не на запись: сайт может перекрыть секцию бренда, заведя свою с тем же ключом.',
      },
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'tenants',
      required: true,
      index: true,
      label: 'Владелец',
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
          'Снятие флага оставит ссылки на секцию незаполненными — это будет видно в отчёте сборки релиза.',
      },
    },

    {
      name: 'blocks',
      type: 'json',
      label: 'Блоки',
      admin: { description: 'Дерево блоков — то же, что и на странице.' },
    },
  ],

  hooks: {
    beforeValidate: [
      ({ data, req }) => {
        if (!data) return data

        /** То же правило, что и на странице: произвольная разметка — не редактору. */
        if (!isCrossTenantActor(req.user) && containsRestricted(data.blocks)) {
          throw new Error(
            'Блок «Произвольный код» доступен только разработчику: произвольная разметка на витрине требует отдельных полномочий.',
          )
        }

        return data
      },
    ],

    afterChange: [auditHooks({ tenantOf: ownerOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: ownerOf }).afterDelete],
  },
}

function containsRestricted(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) {
    return false
  }

  return blocks.some((node) => {
    if (node === null || typeof node !== 'object') {
      return false
    }

    const record = node as Record<string, unknown>

    if (record.type === 'raw-embed') {
      return true
    }

    const slots = record.slots

    if (slots === null || typeof slots !== 'object') {
      return false
    }

    return Object.values(slots as Record<string, unknown>).some((children) =>
      containsRestricted(children),
    )
  })
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
