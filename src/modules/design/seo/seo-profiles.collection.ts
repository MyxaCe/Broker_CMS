import { auditHooks, createTenantAccess, crossTenantOnly } from '@/platform'

import { PATH_PATTERN, normalizePath } from '../pages/path'

import type { CollectionConfig } from 'payload'

/**
 * Умолчания SEO (ТЗ 2.3: «дефолты на уровне бренда с переопределением на
 * странице»).
 *
 * Отдельная коллекция, а не поля тенанта: карточка тенанта хранит то, без чего
 * сайт не существует — юрисдикцию и локали. Смешивать с ней описание для
 * соцсетей значит требовать одинаковой строгости от вещей разного веса.
 */
export const SeoProfiles: CollectionConfig = {
  slug: 'seo-profiles',

  access: {
    read: createTenantAccess({ field: 'owner' }),
    create: createTenantAccess({ field: 'owner' }),
    update: createTenantAccess({ field: 'owner' }),
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'locale', 'owner', 'allowIndexing', 'isActive'],
    group: 'Страницы',
    description:
      'Умолчания для всех страниц: шаблон заголовка, описание, картинка для соцсетей, реквизиты организации. Наследуются бренд → регион → сайт.',
  },

  fields: [
    { name: 'title', type: 'text', required: true, label: 'Название' },
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
    { name: 'isActive', type: 'checkbox', required: true, defaultValue: true, label: 'Действует' },

    {
      name: 'titleTemplate',
      type: 'text',
      label: 'Шаблон заголовка',
      validate: (value: unknown) => {
        if (value === null || value === undefined || value === '') {
          return true
        }

        if (typeof value !== 'string' || !value.includes('%s')) {
          return 'Шаблон обязан содержать %s — место заголовка страницы. Иначе все страницы получат один заголовок.'
        }

        return true
      },
      admin: { description: 'Например «%s — Apex Broker». %s заменяется заголовком страницы.' },
    },
    {
      name: 'defaultDescription',
      type: 'textarea',
      label: 'Описание по умолчанию',
      admin: { description: 'Используется, когда у страницы своего описания нет.' },
    },
    {
      name: 'defaultOgImage',
      type: 'upload',
      relationTo: 'media',
      label: 'Картинка для соцсетей по умолчанию',
    },
    {
      name: 'twitterSite',
      type: 'text',
      label: 'Аккаунт в X (Twitter)',
      admin: { description: 'В виде @apexbroker.' },
    },

    /**
     * Реквизиты организации — вход шаблона `Organization` (ТЗ 2.3). Живут
     * здесь, а не в коде: у каждого бренда они свои, и это редакторские данные,
     * а не правило движка.
     */
    {
      name: 'organization',
      type: 'group',
      label: 'Организация',
      fields: [
        { name: 'name', type: 'text', label: 'Название' },
        {
          name: 'legalName',
          type: 'text',
          label: 'Юридическое наименование',
          admin: { description: 'Как в реестре регулятора, если отличается от бренда.' },
        },
        { name: 'logo', type: 'upload', relationTo: 'media', label: 'Логотип' },
        {
          name: 'sameAs',
          type: 'array',
          label: 'Профили в других местах',
          admin: { description: 'Соцсети, реестр регулятора. Полные адреса по https.' },
          fields: [{ name: 'url', type: 'text', required: true, label: 'Адрес' }],
        },
      ],
    },

    {
      name: 'allowIndexing',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      label: 'Разрешить индексацию',
      admin: {
        description:
          'Снято по умолчанию. Сайт на стенде, случайно открытый поисковикам, убирается из индекса месяцами — а закрытый открывается одной галочкой.',
      },
    },
    {
      name: 'disallowPaths',
      type: 'array',
      label: 'Закрытые разделы',
      admin: { description: 'Пути, которые не должны обходиться: /preview, /internal.' },
      fields: [
        {
          name: 'path',
          type: 'text',
          required: true,
          label: 'Путь',
          validate: (value: unknown) => {
            if (typeof value !== 'string' || !PATH_PATTERN.test(normalizePath(value))) {
              return 'Путь начинается с косой черты: /preview.'
            }

            return true
          },
        },
      ],
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
