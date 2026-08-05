import { normalizeRelationId } from '@/platform'

import { assertLocaleDeclared } from './locale-field'
import { STREAM_STATUS_LABELS, STREAM_STATUSES } from './visibility'

import type { CollectionBeforeValidateHook, Field } from 'payload'

/**
 * Поля публикации, общие для всех сущностей потока (ТЗ 1.2).
 *
 * Вынесены в одно место не ради краткости, а ради того, чтобы правило
 * видимости имело смысл: `publishedWhere` опирается на имена `status`,
 * `publishAt`, `unpublishAt`. Сущность потока, объявившая их по-своему,
 * молча выпала бы из-под правила.
 */

export const siteField: Field = {
  name: 'site',
  type: 'relationship',
  relationTo: 'tenants',
  required: true,
  index: true,
  label: 'Сайт',
  admin: {
    description: 'Материал принадлежит одному сайту. Изоляция тенантов стоит на этом поле.',
  },
}

/**
 * Проверка связи «язык записи объявлен у её сайта».
 *
 * Хук общий для всех сущностей потока: правило одно, и три его копии — это
 * три места, где оно может разойтись.
 */
export const localeConsistencyHook: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  if (!data) return data

  const effective = { ...((originalDoc as Record<string, unknown> | undefined) ?? {}), ...data }

  await assertLocaleDeclared({
    payload: req.payload,
    siteId: normalizeRelationId(effective.site),
    locale: effective.locale,
  })

  return data
}

export const publishingFields: readonly Field[] = [
  {
    name: 'status',
    type: 'select',
    required: true,
    index: true,
    defaultValue: 'draft',
    label: 'Состояние',
    options: STREAM_STATUSES.map((value) => ({ value, label: STREAM_STATUS_LABELS[value] })),
    admin: {
      description:
        'Состояния «запланировано» здесь нет: это следствие пары «опубликовано + дата в будущем», а не отдельное состояние.',
    },
  },
  {
    name: 'publishAt',
    type: 'date',
    index: true,
    label: 'Публикация',
    admin: {
      date: { pickerAppearance: 'dayAndTime' },
      description:
        'Момент появления на витрине. Дата в будущем означает эмбарго: до неё материал невидим снаружи, даже будучи опубликованным.',
    },
  },
  {
    name: 'unpublishAt',
    type: 'date',
    index: true,
    label: 'Снятие',
    admin: {
      date: { pickerAppearance: 'dayAndTime' },
      description: 'Пусто — висит бессрочно. Материал гаснет сам, без чьего-либо участия.',
    },
  },
]
