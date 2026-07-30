import { normalizeRelationId } from '../shared/relation'

import { createTenantAccess, crossTenantOnly } from './payload-access'
import { validateTenantDraft } from './tenant-rules'

import type { TenantDraft } from './tenant-rules'
import type { TenantKind } from './types'
import type { CollectionConfig } from 'payload'

/**
 * Тенанты: узлы цепочки наследования `brand → region → site` (ТЗ 3.3).
 *
 * Коллекция намеренно тонкая. Вся логика — форма цепочки, разрешение
 * наследуемых значений, правила доступа — живёт в чистых функциях рядом и
 * покрыта тестами. Здесь только описание полей и подключение проверок.
 */
export const Tenants: CollectionConfig = {
  slug: 'tenants',

  /**
   * Чтение ограничено поддеревом привязки — по полю `id` самой коллекции.
   *
   * Изменение структуры цепочки (уровень, родитель) меняет права всех, кто
   * привязан ниже, поэтому создание, правка и удаление тенантов доступны
   * только кросс-тенантной роли. Более тонкое разделение — вместе с полной
   * матрицей ролей; сейчас строгая граница безопаснее.
   */
  access: {
    read: createTenantAccess({ field: 'id' }),
    create: crossTenantOnly,
    update: crossTenantOnly,
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'kind', 'jurisdiction'],
  },

  fields: [
    { name: 'name', type: 'text', required: true, label: 'Название' },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      label: 'Идентификатор',
      admin: {
        description:
          'Попадает в URL и в ключ кеша выдачи. После первой публикации не меняется: смена slug — это новый тенант, а не переименование.',
      },
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      index: true,
      label: 'Уровень',
      options: [
        { value: 'brand', label: 'Бренд (корень)' },
        { value: 'region', label: 'Регион' },
        { value: 'site', label: 'Сайт' },
      ] satisfies { value: TenantKind; label: string }[],
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'tenants',
      index: true,
      label: 'Родитель',
      admin: {
        description: 'Пусто только у бренда. Сайт наследуется от региона или напрямую от бренда.',
      },
    },
    {
      name: 'jurisdiction',
      type: 'text',
      index: true,
      label: 'Юрисдикция',
      admin: {
        description:
          'Обязательна для сайта: определяет обязательные предупреждения, запрещённые продукты и правовой набор. Без неё релиз не собирается.',
      },
    },
    {
      name: 'locales',
      type: 'array',
      label: 'Локали',
      fields: [{ name: 'code', type: 'text', required: true, label: 'Код' }],
    },
    {
      name: 'defaultLocale',
      type: 'text',
      label: 'Локаль по умолчанию',
      admin: { description: 'Обязана входить в список локалей тенанта.' },
    },
  ],

  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (!data) return data

        const issues = validateTenantDraft(toDraft(data))

        if (issues.length > 0) {
          /**
           * Fail-closed: некорректная карточка тенанта не сохраняется вовсе.
           * Разрешить сохранение «черновиком» здесь нельзя — на карточку
           * опираются правила доступа, а частично заполненный тенант означает
           * неопределённые права.
           */
          throw new Error(`Карточка тенанта не прошла проверку:\n  - ${issues.join('\n  - ')}`)
        }

        return data
      },
    ],
  },
}

function toDraft(data: Record<string, unknown>): TenantDraft {
  const rawLocales = Array.isArray(data.locales) ? data.locales : []

  return {
    kind: (data.kind as TenantKind | undefined) ?? 'site',
    slug: typeof data.slug === 'string' ? data.slug : '',
    parentId: normalizeRelationId(data.parent),
    jurisdiction: typeof data.jurisdiction === 'string' ? data.jurisdiction : null,
    locales: rawLocales
      .map((entry) =>
        entry !== null && typeof entry === 'object' && 'code' in entry
          ? String((entry as { code: unknown }).code)
          : '',
      )
      .filter((code) => code !== ''),
    defaultLocale: typeof data.defaultLocale === 'string' ? data.defaultLocale : null,
  }
}
