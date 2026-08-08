import { auditHooks, createTenantAccess, crossTenantOnly } from '@/platform'

import { normalizePath, PATH_PATTERN } from '../pages/path'

import { REDIRECT_STATUS_LABELS, REDIRECT_STATUSES } from './types'

import type { CollectionConfig } from 'payload'

/**
 * Коллекция перенаправлений (ТЗ 2.3).
 *
 * Отдельно от истории путей страницы: история заполняется движком при
 * переименовании, а здесь живут решения редактора — «этот раздел переехал»,
 * «эта акция закончилась». Смешивать их значило бы позволить правку того, что
 * система записала как факт.
 *
 * Циклы проверяются на сборке релиза, а не при сохранении: правило замыкает
 * цепочку в паре с другим, и увидеть это можно только на всём наборе сразу.
 */
export const Redirects: CollectionConfig = {
  slug: 'redirects',

  access: {
    read: createTenantAccess({ field: 'site' }),
    create: createTenantAccess({ field: 'site' }),
    update: createTenantAccess({ field: 'site' }),
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'from',
    defaultColumns: ['from', 'to', 'status', 'locale', 'site', 'isActive'],
    group: 'Страницы',
    description:
      'Куда вести старые адреса. 410 — для удалённого навсегда: он говорит поисковику убрать страницу, а 404 оставляет её в индексе месяцами.',
  },

  fields: [
    {
      name: 'from',
      type: 'text',
      required: true,
      index: true,
      label: 'Откуда',
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !PATH_PATTERN.test(normalizePath(value))) {
          return 'Путь начинается с косой черты: /old-page.'
        }

        return true
      },
    },
    {
      name: 'to',
      type: 'text',
      label: 'Куда',
      validate: (value: unknown, { siblingData }: { siblingData?: unknown }) => {
        const data = (siblingData ?? {}) as Record<string, unknown>

        /** У 410 цели нет по смыслу: «удалено навсегда» — это не переход. */
        if (Number(data.status) === 410) {
          return true
        }

        if (typeof value !== 'string' || !PATH_PATTERN.test(normalizePath(value))) {
          return 'Путь начинается с косой черты: /new-page.'
        }

        return true
      },
      admin: { condition: (_, siblingData) => Number(siblingData?.status) !== 410 },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: '301',
      label: 'Код',
      options: REDIRECT_STATUSES.map((value) => ({
        value: String(value),
        label: REDIRECT_STATUS_LABELS[value],
      })),
      admin: {
        description:
          '301 — переехало навсегда, вес страницы передаётся. 302 — временно, вес остаётся у старого адреса.',
      },
    },
    {
      name: 'site',
      type: 'relationship',
      relationTo: 'tenants',
      required: true,
      index: true,
      label: 'Сайт',
    },
    {
      name: 'locale',
      type: 'text',
      label: 'Язык',
      admin: {
        description: 'Пусто — правило действует на всех языках сайта.',
      },
      validate: (value: unknown) => {
        if (value === null || value === undefined || value === '') {
          return true
        }

        if (typeof value !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(value)) {
          return 'Код языка вида en или en-GB.'
        }

        return true
      },
    },
    { name: 'isActive', type: 'checkbox', required: true, defaultValue: true, label: 'Действует' },
    {
      name: 'note',
      type: 'text',
      label: 'Причина',
      admin: {
        description:
          'Зачем заведено. Через год без этой строки правило невозможно ни подтвердить, ни снять.',
      },
    },
  ],

  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (!data) return data

        if (typeof data.from === 'string') {
          data.from = normalizePath(data.from)
        }

        if (typeof data.to === 'string' && data.to !== '') {
          data.to = normalizePath(data.to)
        }

        return data
      },
    ],

    afterChange: [auditHooks({ tenantOf: siteOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: siteOf }).afterDelete],
  },
}

function siteOf(doc: Record<string, unknown>): { id: string | null; slug: string | null } {
  const site = doc.site

  if (site !== null && typeof site === 'object' && 'id' in site) {
    const record = site as Record<string, unknown>

    return {
      id: record.id === undefined || record.id === null ? null : String(record.id),
      slug: typeof record.slug === 'string' ? record.slug : null,
    }
  }

  return { id: site === undefined || site === null ? null : String(site), slug: null }
}
