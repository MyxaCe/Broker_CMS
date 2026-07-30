import { auditHooks, createTenantAccess, crossTenantOnly } from '@/platform'

import type { CollectionConfig } from 'payload'

/**
 * Релиз — иммутабельный пронумерованный снапшот структуры сайта (ТЗ часть 3).
 *
 * Публикацией управляет не релиз, а канал: релиз только собирается. Это
 * разделение и делает откат мгновенным — переключается указатель, а не данные.
 */

export const RELEASE_STATUSES = ['building', 'ready', 'failed'] as const
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number]

export const Releases: CollectionConfig = {
  slug: 'releases',

  access: {
    read: createTenantAccess({ field: 'siteId' }),
    create: crossTenantOnly,
    update: crossTenantOnly,
    delete: () => false,
  },

  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'siteSlug', 'status', 'builtAt'],
    description:
      'Собранный релиз неизменяем: правки после сборки невозможны ни через интерфейс, ни напрямую в базе. Откат выполняется переключением канала.',
  },

  fields: [
    /**
     * Сайт хранится значениями, а не связью — по той же причине, что и в
     * журнале аудита (ADR-0014): внешний ключ означает, что удаление сайта
     * изменит запись. Релизы — это история публикаций, которую ТЗ требует
     * хранить 7 лет; она обязана пережить удаление того, о чём свидетельствует.
     */
    { name: 'siteId', type: 'text', required: true, index: true, label: 'Сайт (идентификатор)' },
    { name: 'siteSlug', type: 'text', required: true, index: true, label: 'Сайт' },

    {
      name: 'number',
      type: 'number',
      required: true,
      index: true,
      label: 'Номер',
      admin: {
        description:
          'Свой у каждого сайта, монотонный. Выданный номер не выдаётся повторно — даже если сборка провалилась.',
      },
    },
    {
      name: 'label',
      type: 'text',
      required: true,
      label: 'Обозначение',
      admin: { description: 'Например, apex-de #42 — то, чем оперируют в переписке.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'building',
      label: 'Состояние',
      options: [
        { value: 'building', label: 'Собирается' },
        { value: 'ready', label: 'Готов' },
        { value: 'failed', label: 'Сборка провалена' },
      ] satisfies { value: ReleaseStatus; label: string }[],
      admin: {
        description:
          'Правки возможны только пока релиз собирается. После перехода в «готов» или «провален» запись замораживается на уровне базы.',
      },
    },

    {
      name: 'snapshot',
      type: 'json',
      label: 'Снапшот',
      admin: { description: 'Полное состояние структуры сайта на момент сборки.' },
    },
    {
      name: 'contentHash',
      type: 'text',
      index: true,
      label: 'Отпечаток содержимого',
      admin: { description: 'Участвует в ETag выдачи; устойчив к порядку полей.' },
    },
    {
      name: 'validationReport',
      type: 'json',
      label: 'Отчёт валидации',
      admin: {
        description:
          'Почему сборка прошла или была отклонена. Хранится и у проваленных релизов — иначе причина отказа теряется.',
      },
    },

    { name: 'builtAt', type: 'date', label: 'Собран' },
    { name: 'builtById', type: 'text', label: 'Кем собран (идентификатор)' },
    { name: 'builtByEmail', type: 'text', label: 'Кем собран' },
  ],

  hooks: {
    afterChange: [auditHooks({ tenantOf: siteOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: siteOf }).afterDelete],
  },
}

function siteOf(doc: Record<string, unknown>): { id: string | null; slug: string | null } {
  return {
    id: typeof doc.siteId === 'string' ? doc.siteId : null,
    slug: typeof doc.siteSlug === 'string' ? doc.siteSlug : null,
  }
}
