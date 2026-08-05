import { auditHooks } from '../audit/record'
import { normalizeRelationId } from '../shared/relation'

import { countDependents, describeDependents } from './dependents'
import { resolveTenantSettings, validateResolvedSettings } from './layers'
import { createTenantAccess, crossTenantOnly } from './payload-access'
import { loadTenantLayers } from './resolve-tenant'
import { validateTenantDraft } from './tenant-rules'

import type { COLLECTION_MODES, SCALAR_MODES } from './layers'
import type { TenantKind } from './types'
import type { CollectionConfig, Field } from 'payload'

/**
 * Тенанты: узлы цепочки наследования `brand → region → site` (ТЗ 3.3).
 *
 * Коллекция намеренно тонкая. Форма цепочки, разрешение наследуемых значений
 * и правила доступа живут в чистых функциях рядом и покрыты тестами; здесь
 * только описание полей и подключение проверок.
 */

/**
 * Наследуемое скалярное поле.
 *
 * Режим — отдельное поле, а не следствие заполненности значения. Разница
 * существенна для аудита: «наследую», «переопределяю» и «отвязываюсь» —
 * разные решения редактора, и по журналу они обязаны различаться (ADR-0010).
 */
function inheritableScalar(name: string, label: string, description: string): Field {
  return {
    name,
    type: 'group',
    label,
    fields: [
      {
        name: 'mode',
        type: 'select',
        required: true,
        defaultValue: 'inherit',
        label: 'Источник',
        options: [
          { value: 'inherit', label: 'Наследуется' },
          { value: 'override', label: 'Переопределено' },
          { value: 'fork', label: 'Отвязано' },
        ] satisfies { value: (typeof SCALAR_MODES)[number]; label: string }[],
      },
      { name: 'value', type: 'text', label: 'Значение', admin: { description } },
    ],
  }
}

function inheritableCollection(name: string, label: string, description: string): Field {
  return {
    name,
    type: 'group',
    label,
    fields: [
      {
        name: 'mode',
        type: 'select',
        required: true,
        defaultValue: 'inherit',
        label: 'Источник',
        options: [
          { value: 'inherit', label: 'Наследуется' },
          { value: 'extend', label: 'Дополняет унаследованное' },
          { value: 'fork', label: 'Отвязано: только своё' },
        ] satisfies { value: (typeof COLLECTION_MODES)[number]; label: string }[],
      },
      {
        name: 'items',
        type: 'array',
        label: 'Значения',
        admin: { description },
        fields: [{ name: 'code', type: 'text', required: true, label: 'Код' }],
      },
    ],
  }
}

/** Событие о тенанте относится к нему самому. */
function tenantSelf(doc: Record<string, unknown>): { id: string | null; slug: string | null } {
  return {
    id: normalizeRelationId(doc.id),
    slug: typeof doc.slug === 'string' ? doc.slug : null,
  }
}

export const Tenants: CollectionConfig = {
  slug: 'tenants',

  /**
   * Чтение ограничено поддеревом привязки — по полю `id` самой коллекции.
   *
   * Изменение структуры цепочки меняет права всех, кто привязан ниже, поэтому
   * создание, правка и удаление доступны только кросс-тенантной роли. Более
   * тонкое разделение — вместе с полной матрицей ролей.
   */
  access: {
    read: createTenantAccess({ field: 'id' }),
    create: crossTenantOnly,
    update: crossTenantOnly,
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'kind'],
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

    inheritableScalar(
      'jurisdiction',
      'Юрисдикция',
      'Определяет обязательные предупреждения, запрещённые продукты и правовой набор. Обязательна для сайта — своя или унаследованная: без неё релиз не собирается.',
    ),
    inheritableCollection(
      'availableLocales',
      'Локали',
      'Языки, на которых существует сайт. Наследуются от бренда и региона; «отвязано» означает, что новые локали сверху сюда больше не приезжают.',
    ),
    inheritableScalar(
      'defaultLocale',
      'Локаль по умолчанию',
      'Обязана входить в перечень разрешённых локалей — с учётом наследования.',
    ),
  ],

  hooks: {
    /** Изменения тенанта относятся к нему самому (ТЗ 5.2). */
    afterChange: [auditHooks({ tenantOf: tenantSelf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: tenantSelf }).afterDelete],

    /**
     * Удаление тенанта, на который что-то ссылается, и так невозможно —
     * обязательная связь не обнуляется. Но без этой проверки человек видит
     * сообщение про нарушенное ограничение вместо причины.
     */
    beforeDelete: [
      async ({ id, req }) => {
        const dependents = await countDependents({ payload: req.payload, tenantId: id, req })

        if (dependents.length > 0) {
          throw new Error(describeDependents(dependents))
        }
      },
    ],

    beforeValidate: [
      async ({ data, originalDoc, req }) => {
        if (!data) return data

        /**
         * Проверяется то состояние, которое пытаются сохранить: при правке
         * Payload передаёт только изменённые поля, поэтому их накладываем на
         * текущий документ.
         */
        const effective: Record<string, unknown> = {
          ...((originalDoc as Record<string, unknown> | undefined) ?? {}),
          ...data,
        }

        const issues = validateTenantDraft({
          kind: (effective.kind as TenantKind | undefined) ?? 'site',
          slug: typeof effective.slug === 'string' ? effective.slug : '',
          parentId: normalizeRelationId(effective.parent),
        })

        /**
         * Правила, зависящие от цепочки, проверяются только если карточка
         * структурно корректна: иначе цепочку не построить, и человек получил
         * бы вместо внятной ошибки сообщение о неверном родителе.
         */
        if (issues.length === 0) {
          const layers = await loadTenantLayers(req.payload, effective)
          const settings = resolveTenantSettings(layers)
          const leafKind = layers.at(-1)?.node.kind ?? 'site'

          issues.push(...validateResolvedSettings(leafKind, settings))
        }

        if (issues.length > 0) {
          /**
           * Fail-closed: некорректная карточка не сохраняется вовсе. Разрешить
           * «черновик» здесь нельзя — на карточку опираются правила доступа,
           * а частично заполненный тенант означает неопределённые права.
           */
          throw new Error(`Карточка тенанта не прошла проверку:\n  - ${issues.join('\n  - ')}`)
        }

        return data
      },
    ],
  },
}
