import { auditHooks } from '@/platform'

import { createStreamWriteAccess, streamDeleteAccess } from '../access'

import { ownerOf } from './categories.collection'
import { descriptionField, ownerField, slugField, titleField } from './shared-fields'

import type { CollectionConfig } from 'payload'

/**
 * Теги (ТЗ 1.1).
 *
 * В отличие от категории, тегов у записи много и они не задают раздела. Тег
 * существует ради подборки: «всё про инфляцию» поперёк категорий.
 */
export const Tags: CollectionConfig = {
  slug: 'tags',

  access: {
    read: () => true,
    create: createStreamWriteAccess({ siteField: 'owner' }),
    update: createStreamWriteAccess({ siteField: 'owner' }),
    delete: streamDeleteAccess,
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'owner'],
    group: 'Поток',
    description: 'Сквозная подборка. Тегов у записи может быть много, раздела они не задают.',
  },

  fields: [titleField, slugField, ownerField, descriptionField],

  hooks: {
    afterChange: [auditHooks({ tenantOf: ownerOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: ownerOf }).afterDelete],
  },
}
