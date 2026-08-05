import { auditHooks } from '@/platform'

import { createStreamReadAccess, createStreamWriteAccess, streamDeleteAccess } from '../access'
import { localeField } from '../locale-field'
import {
  localeConsistencyHook,
  publishingFields,
  searchTextField,
  searchTextHook,
  siteField,
} from '../publishing-fields'
import { siteOf } from '../shared/site-of'

import type { CollectionConfig } from 'payload'

/**
 * Видео и трансляции (ТЗ 1.1).
 *
 * Статуса эфира здесь нет **как поля**: он вычисляется из времени в момент
 * ответа (ТЗ 1.2). Хранимый статус пришлось бы обновлять по расписанию, то
 * есть завести механизм, который умеет разойтись со временем.
 */

export const VIDEO_PROVIDERS = ['youtube', 'vimeo', 'self-hosted'] as const

export type VideoProvider = (typeof VIDEO_PROVIDERS)[number]

export const Videos: CollectionConfig = {
  slug: 'videos',

  access: {
    read: createStreamReadAccess({ siteField: 'site' }),
    create: createStreamWriteAccess({ siteField: 'site' }),
    update: createStreamWriteAccess({ siteField: 'site' }),
    delete: streamDeleteAccess,
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'site', 'provider', 'startsAt', 'status'],
    group: 'Поток',
    description:
      'Состояние эфира («скоро», «в эфире», «запись») вычисляется из времени и не хранится: ручное поле гарантированно протухнет.',
  },

  fields: [
    { name: 'title', type: 'text', required: true, label: 'Название' },
    {
      name: 'slug',
      type: 'text',
      required: true,
      index: true,
      label: 'Машинное имя',
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
          return 'Только строчные латинские буквы, цифры и дефис между ними.'
        }

        return true
      },
    },
    siteField,
    localeField,
    { name: 'description', type: 'textarea', label: 'Описание' },

    {
      name: 'provider',
      type: 'select',
      required: true,
      label: 'Источник',
      defaultValue: 'youtube',
      options: [
        { value: 'youtube', label: 'YouTube' },
        { value: 'vimeo', label: 'Vimeo' },
        { value: 'self-hosted', label: 'Собственное хранилище' },
      ] satisfies { value: VideoProvider; label: string }[],
    },
    {
      name: 'externalId',
      type: 'text',
      label: 'Идентификатор у источника',
      admin: {
        description: 'Для YouTube и Vimeo. Для собственного хранилища заполняется файл ниже.',
        condition: (data) => data?.provider !== 'self-hosted',
      },
    },
    {
      name: 'media',
      type: 'upload',
      relationTo: 'media',
      label: 'Файл',
      admin: { condition: (data) => data?.provider === 'self-hosted' },
    },
    { name: 'poster', type: 'upload', relationTo: 'media', label: 'Обложка' },

    {
      name: 'startsAt',
      type: 'date',
      index: true,
      label: 'Начало эфира',
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description:
          'Пусто — это ролик, а не трансляция: он сразу считается записью. Проставлять фиктивное время ради формы не нужно.',
      },
    },
    {
      name: 'endsAt',
      type: 'date',
      label: 'Окончание эфира',
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description:
          'Пусто у начавшегося эфира означает «идёт»: у прямой трансляции время окончания обычно неизвестно заранее.',
      },
    },

    {
      name: 'speakers',
      type: 'relationship',
      relationTo: 'authors',
      hasMany: true,
      index: true,
      label: 'Спикеры',
    },
    {
      name: 'tags',
      type: 'relationship',
      relationTo: 'tags',
      hasMany: true,
      index: true,
      label: 'Теги',
    },

    ...publishingFields,
    searchTextField,
  ],

  hooks: {
    beforeChange: [searchTextHook],

    /**
     * Источник и идентификатор обязаны быть согласованы: ролик YouTube без
     * идентификатора — это пустой проигрыватель на витрине, и увидит его
     * читатель, а не редактор.
     */
    beforeValidate: [
      localeConsistencyHook,
      ({ data }) => {
        if (!data) return data

        const provider = data.provider
        const hasExternal = typeof data.externalId === 'string' && data.externalId.trim() !== ''
        const hasMedia = data.media !== null && data.media !== undefined

        if (provider === 'self-hosted' && !hasMedia) {
          throw new Error('Для собственного хранилища нужен файл.')
        }

        if (provider !== 'self-hosted' && !hasExternal) {
          throw new Error('Укажите идентификатор ролика у источника.')
        }

        return data
      },
    ],

    afterChange: [auditHooks({ tenantOf: siteOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: siteOf }).afterDelete],
  },
}
