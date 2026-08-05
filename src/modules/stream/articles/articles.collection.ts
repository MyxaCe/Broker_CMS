import { auditHooks } from '@/platform'

import { createStreamReadAccess, createStreamWriteAccess, streamDeleteAccess } from '../access'
import { localeField } from '../locale-field'
import { localeConsistencyHook, publishingFields, siteField } from '../publishing-fields'
import { siteOf } from '../shared/site-of'
import { STREAM_STATUS_LABELS } from '../visibility'

import { estimateReadingMinutes } from './reading-time'

import type { CollectionConfig } from 'payload'

/**
 * Новости и аналитика (ТЗ 1.1).
 *
 * Главная сущность потока: публикуется вне релизов, живёт по времени, подаётся
 * лентой (ADR-0021).
 */
export const Articles: CollectionConfig = {
  slug: 'articles',

  access: {
    /** Черновик невидим снаружи по построению — условие уходит в SQL. */
    read: createStreamReadAccess({ siteField: 'site' }),
    create: createStreamWriteAccess({ siteField: 'site' }),
    update: createStreamWriteAccess({ siteField: 'site' }),
    delete: streamDeleteAccess,
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'site', 'status', 'publishAt', 'category'],
    group: 'Поток',
    description:
      'Публикуется мгновенно по наступлении даты — сборка релиза не требуется. Снять с витрины можно датой окончания или архивом; удаление оставлено только разработчику.',
  },

  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Заголовок',
    },
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
      admin: { description: 'Попадает в адрес материала. После публикации менять нельзя.' },
    },
    siteField,
    localeField,
    {
      name: 'excerpt',
      type: 'textarea',
      label: 'Анонс',
      admin: {
        description:
          'Показывается в ленте и в выдаче поисковых систем. Без него лента выглядит пустой.',
      },
    },
    {
      name: 'body',
      type: 'richText',
      label: 'Текст',
    },
    {
      name: 'cover',
      type: 'upload',
      relationTo: 'media',
      label: 'Обложка',
    },

    // --- таксономии ---
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      index: true,
      label: 'Категория',
      admin: { description: 'Ровно одна: она задаёт раздел и адрес.' },
    },
    {
      name: 'tags',
      type: 'relationship',
      relationTo: 'tags',
      hasMany: true,
      index: true,
      label: 'Теги',
    },
    {
      name: 'authors',
      type: 'relationship',
      relationTo: 'authors',
      hasMany: true,
      index: true,
      label: 'Авторы',
    },
    {
      name: 'source',
      type: 'text',
      label: 'Источник',
      admin: { description: 'Откуда взят материал, если он не оригинальный.' },
    },

    ...publishingFields,

    {
      name: 'readingMinutes',
      type: 'number',
      label: 'Время чтения, мин',
      admin: {
        readOnly: true,
        description: 'Вычисляется из текста при сохранении. Правится только через правку текста.',
      },
    },

    /**
     * Символы MDS хранятся строками, а не связью: инструменты живут в торговом
     * ядре, а не у нас (ADR-0004). Связь означала бы, что мы держим их копию и
     * обязаны её синхронизировать.
     */
    {
      name: 'relatedInstruments',
      type: 'array',
      label: 'Связанные инструменты',
      admin: {
        description:
          'Символы MDS. Терминал показывает материал в карточке инструмента. Символ, которого нет в снапшоте MDS, наружу не отдаётся.',
      },
      fields: [{ name: 'symbol', type: 'text', required: true, label: 'Символ' }],
    },
    {
      name: 'jurisdictions',
      type: 'array',
      label: 'Юрисдикции',
      admin: {
        description:
          'Пусто — материал доступен во всех юрисдикциях сайта. Механизм разграничения появится на M5; поле заполняется уже сейчас.',
      },
      fields: [{ name: 'code', type: 'text', required: true, label: 'Код' }],
    },

    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      label: 'Избранное',
    },
    {
      name: 'pinned',
      type: 'checkbox',
      defaultValue: false,
      label: 'Закреплено',
      admin: { description: 'Держится вверху ленты независимо от даты.' },
    },
  ],

  hooks: {
    beforeValidate: [localeConsistencyHook],

    beforeChange: [
      ({ data }) => {
        /**
         * Время чтения вычисляется, а не вводится: введённое руками разойдётся
         * с текстом при первой же правке и будет врать тем увереннее, чем
         * дольше живёт материал.
         */
        data.readingMinutes = estimateReadingMinutes(data.body)

        return data
      },
    ],

    afterChange: [auditHooks({ tenantOf: siteOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: siteOf }).afterDelete],
  },
}

export const ARTICLE_STATUS_LABELS = STREAM_STATUS_LABELS
