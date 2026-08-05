import { auditHooks } from '@/platform'

import { createStreamWriteAccess, streamDeleteAccess } from '../access'
import { ownerOf } from '../shared/site-of'

import { descriptionField, ownerField, slugField, titleField } from './shared-fields'

import type { CollectionConfig } from 'payload'

/**
 * Категории (ТЗ 1.1).
 *
 * У записи ровно одна категория — это то, чем категория отличается от тега.
 * Разделение не косметическое: категория задаёт раздел и адрес, тег — только
 * подборку. Слив их в одну сущность превращает навигацию в теговое облако.
 */
export const Categories: CollectionConfig = {
  slug: 'categories',

  access: {
    /**
     * Читают все, включая доставку: категория — справочник, а не контент.
     * Скрывать её нечего, а без чтения невозможно собрать ни одну ленту.
     */
    read: () => true,
    create: createStreamWriteAccess({ siteField: 'owner' }),
    update: createStreamWriteAccess({ siteField: 'owner' }),
    delete: streamDeleteAccess,
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'owner'],
    group: 'Поток',
    description:
      'Раздел, в котором живёт материал. У записи она одна. Категория бренда доступна всем его сайтам.',
  },

  fields: [
    titleField,
    slugField,
    ownerField,
    descriptionField,
    {
      name: 'order',
      type: 'number',
      defaultValue: 0,
      label: 'Порядок',
      admin: {
        description: 'Меньше — выше в списках. Одинаковые значения сортируются по названию.',
      },
    },
  ],

  hooks: {
    afterChange: [auditHooks({ tenantOf: ownerOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: ownerOf }).afterDelete],
  },
}
