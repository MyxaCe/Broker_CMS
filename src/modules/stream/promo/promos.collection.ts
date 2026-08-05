import { auditHooks } from '@/platform'

import { createStreamReadAccess, createStreamWriteAccess, streamDeleteAccess } from '../access'
import { localeField } from '../locale-field'
import { localeConsistencyHook, publishingFields, siteField } from '../publishing-fields'
import { siteOf } from '../shared/site-of'

import type { CollectionConfig } from 'payload'

/**
 * Промо-блоки (ТЗ 1.1).
 *
 * «Промо гаснет само» (ТЗ 1.2) — здесь это не хук и не воркер, а следствие
 * общей модели видимости: время окончания стоит в тех же полях, что у всех
 * сущностей потока, и правило доступа перестаёт его отдавать ровно в срок.
 *
 * > Расхождение с ТЗ по именам полей — осознанное.
 * > ТЗ называет их `activeFrom`/`activeTo`. Здесь используются общие
 * > `publishAt`/`unpublishAt`, потому что правило видимости опирается на эти
 * > имена. Сущность потока, объявившая свои, молча выпала бы из-под правила —
 * > то есть погасшее промо продолжало бы висеть. Смысл полей тот же; отличается
 * > только подпись в интерфейсе.
 */
export const Promos: CollectionConfig = {
  slug: 'promos',

  access: {
    read: createStreamReadAccess({ siteField: 'site' }),
    create: createStreamWriteAccess({ siteField: 'site' }),
    update: createStreamWriteAccess({ siteField: 'site' }),
    delete: streamDeleteAccess,
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'site', 'priority', 'publishAt', 'unpublishAt'],
    group: 'Поток',
    description:
      'Гаснет само по времени окончания — снимать вручную не нужно и не следует: ручное снятие забывают.',
  },

  fields: [
    { name: 'title', type: 'text', required: true, label: 'Заголовок' },
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

    {
      name: 'badge',
      type: 'text',
      label: 'Плашка',
      admin: { description: 'Короткая метка: «Новое», «−50%».' },
    },
    { name: 'description', type: 'textarea', label: 'Описание' },
    {
      name: 'terms',
      type: 'textarea',
      required: true,
      label: 'Условия',
      admin: {
        description:
          'Обязательны: предложение без условий в регулируемом домене — это нарушение, а не недоработка вёрстки.',
      },
    },
    { name: 'image', type: 'upload', relationTo: 'media', label: 'Изображение' },

    { name: 'ctaLabel', type: 'text', label: 'Надпись на кнопке' },
    {
      name: 'ctaHref',
      type: 'text',
      label: 'Адрес кнопки',
      validate: (value: unknown) => {
        if (value === null || value === undefined || value === '') {
          return true
        }

        if (typeof value !== 'string' || !/^(https:\/\/|\/)/.test(value)) {
          return 'Либо адрес по https, либо путь внутри сайта, начинающийся с косой черты.'
        }

        return true
      },
      admin: {
        description: 'Внешний адрес только по https: смешанное содержимое ломает страницу.',
      },
    },

    {
      name: 'jurisdictions',
      type: 'array',
      label: 'Юрисдикции',
      admin: {
        description:
          'Пусто — во всех юрисдикциях сайта. Предложение, недопустимое в юрисдикции, ограничивается здесь.',
      },
      fields: [{ name: 'code', type: 'text', required: true, label: 'Код' }],
    },

    {
      name: 'priority',
      type: 'number',
      required: true,
      defaultValue: 0,
      index: true,
      label: 'Приоритет',
      admin: {
        description: 'Больше — выше. При равенстве побеждает более позднее по времени начала.',
      },
    },
    { name: 'featured', type: 'checkbox', defaultValue: false, label: 'Избранное' },

    ...publishingFields.map((field) =>
      field.type === 'date' && field.name === 'publishAt'
        ? { ...field, label: 'Начало показа' }
        : field.type === 'date' && field.name === 'unpublishAt'
          ? { ...field, label: 'Конец показа' }
          : field,
    ),
  ],

  hooks: {
    beforeValidate: [localeConsistencyHook],

    afterChange: [auditHooks({ tenantOf: siteOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: siteOf }).afterDelete],
  },
}
