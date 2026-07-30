import { auditHooks, createTenantAccess, crossTenantOnly } from '@/platform'

import type { CollectionConfig } from 'payload'

/**
 * Канал — указатель на релиз (ТЗ часть 3).
 *
 * Единственная изменяемая часть публикации, и именно поэтому откат занимает
 * секунды: переключается указатель, а не данные. Каждое переключение попадает
 * в журнал аудита, поэтому история публикаций и откатов восстанавливается
 * из него, а не из отдельной таблицы.
 */

export const CHANNEL_NAMES = ['live', 'staging'] as const
export type ChannelName = (typeof CHANNEL_NAMES)[number]

export const Channels: CollectionConfig = {
  slug: 'channels',

  access: {
    read: createTenantAccess({ field: 'siteId' }),
    create: crossTenantOnly,
    update: crossTenantOnly,
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'siteSlug', 'name', 'releaseNumber', 'switchedAt'],
    description: 'Откат — это переключение канала на предыдущий релиз.',
  },

  fields: [
    { name: 'siteId', type: 'text', required: true, index: true, label: 'Сайт (идентификатор)' },
    { name: 'siteSlug', type: 'text', required: true, index: true, label: 'Сайт' },
    {
      name: 'name',
      type: 'select',
      required: true,
      index: true,
      label: 'Канал',
      options: [
        { value: 'live', label: 'Боевой' },
        { value: 'staging', label: 'Предпросмотр' },
      ] satisfies { value: ChannelName; label: string }[],
    },
    { name: 'label', type: 'text', required: true, label: 'Обозначение' },

    /**
     * Ссылка на релиз — тоже значением. Канал переживает всё: релиз, на который
     * он указывал, обязан остаться навсегда (удаление релизов запрещено), но
     * связь тут всё равно не нужна — а её отсутствие снимает вопрос о каскадах.
     */
    { name: 'releaseId', type: 'text', index: true, label: 'Релиз (идентификатор)' },
    { name: 'releaseNumber', type: 'number', label: 'Номер релиза' },

    { name: 'switchedAt', type: 'date', label: 'Переключён' },
    { name: 'switchedById', type: 'text', label: 'Кем переключён (идентификатор)' },
    { name: 'switchedByEmail', type: 'text', label: 'Кем переключён' },
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
