import { auditHooks } from '../audit/record'
import { createTenantAccess, isCrossTenantActor } from '../tenancy/payload-access'

import { checkUpload, describeRejection, MAX_UPLOAD_BYTES } from './upload-rules'

import type { CollectionConfig } from 'payload'

/**
 * Медиатека (ТЗ 5.3).
 *
 * Сейчас закрыта опасная часть — что можно загрузить и с каким описанием.
 * Удобства DAM (варианты, фокальная точка, папки, карта использования) идут
 * отдельно: они не влияют на безопасность, а их отсутствие видно сразу и
 * никого не подставляет.
 */
export const Media: CollectionConfig = {
  slug: 'media',

  access: {
    /**
     * Файлы читают все: ссылка на изображение и так уходит в выдачу. Скрывать
     * карточку файла, раздавая сам файл, — иллюзия защиты.
     */
    read: () => true,
    create: createTenantAccess({ field: 'owner' }),
    update: createTenantAccess({ field: 'owner' }),
    /**
     * Удаление — только кросс-тенантной роли, и до появления карты
     * использования («где применяется») это ещё и осознанно неудобно: удаление
     * файла, на который кто-то ссылается, ломает страницу молча.
     */
    delete: ({ req }) => isCrossTenantActor(req.user),
  },

  upload: {
    /**
     * Ограничение дублируется здесь и в правилах: это разные рубежи. Payload
     * отсекает по размеру до чтения тела, наша проверка — по содержимому
     * заявленных полей.
     */
    filesRequiredOnCreate: true,
    mimeTypes: ['image/*', 'application/pdf'],
  },

  admin: {
    useAsTitle: 'alt',
    defaultColumns: ['alt', 'filename', 'mimeType', 'owner'],
    group: 'Медиа',
    description:
      'Альтернативный текст обязателен: без него материал не пройдёт сборку релиза. Это требование доступности, а не формальность.',
  },

  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      label: 'Альтернативный текст',
      admin: {
        description:
          'Что изображено — словами. Читается вслух скринридером и показывается, когда картинка не загрузилась.',
      },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || value.trim().length < 3) {
          return 'Опишите изображение хотя бы несколькими словами.'
        }

        return true
      },
    },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'tenants',
      required: true,
      index: true,
      label: 'Владелец',
      admin: {
        description: 'Файл бренда доступен всем его сайтам — так же, как категории.',
      },
    },
    {
      name: 'credit',
      type: 'text',
      label: 'Источник',
      admin: {
        description:
          'Автор или агентство. Требуется по условиям фотобанков и служит доказательством права на использование.',
      },
    },
    {
      name: 'caption',
      type: 'text',
      label: 'Подпись',
      admin: { description: 'Видимая подпись под изображением. В отличие от alt — необязательна.' },
    },
  ],

  hooks: {
    beforeValidate: [
      ({ data, req }) => {
        if (!data) {
          return data
        }

        const file = req.file

        if (!file) {
          /** Правка карточки без замены файла — проверять нечего. */
          return data
        }

        const rejection = checkUpload({
          mimeType: file.mimetype,
          bytes: file.size,
          filename: file.name,
          /**
           * SVG исполняет скрипты, поэтому право на его загрузку — это по сути
           * право выполнить код в интерфейсе. Оно у той же роли, что и остальные
           * полномочия поверх тенантов.
           */
          mayUploadSvg: isCrossTenantActor(req.user),
        })

        if (rejection !== null) {
          throw new Error(describeRejection(rejection))
        }

        return data
      },
    ],

    afterChange: [auditHooks({ tenantOf: ownerOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: ownerOf }).afterDelete],
  },
}

export const MEDIA_SIZE_LIMIT_BYTES = MAX_UPLOAD_BYTES

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
