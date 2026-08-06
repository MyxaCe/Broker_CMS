import { auditHooks, createTenantAccess, crossTenantOnly, isCrossTenantActor } from '@/platform'

import { BLOCK_ALIGNMENTS, BLOCK_THEMES, BLOCK_WIDTHS, PADDING_STEPS } from '../blocks/style'

import { normalizePath, PATH_PATTERN } from './path'

import type { CollectionConfig } from 'payload'

/**
 * Страницы (ТЗ 2.2, 2.3).
 *
 * `page = { path, locale, seo, layoutRef, blocks[], visibility, status }`
 *
 * Дерево блоков хранится полем JSON и проверяется реестром при сохранении и
 * повторно при сборке релиза. Хранить блоки отдельными записями значило бы
 * восстанавливать дерево при каждом чтении и следить за порядком колонками —
 * ради того, что редактируется и публикуется как один документ.
 */
export const Pages: CollectionConfig = {
  slug: 'pages',

  access: {
    read: createTenantAccess({ field: 'site' }),
    create: createTenantAccess({ field: 'site' }),
    update: createTenantAccess({ field: 'site' }),
    /**
     * Удаление — только кросс-тенантной роли: у опубликованной страницы есть
     * входящие ссылки и позиции в поиске, и её исчезновение — событие, а не
     * правка. Обычный путь снятия — состояние «в архиве».
     */
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'path', 'locale', 'site', 'status'],
    group: 'Страницы',
    description:
      'Путь уникален в пределах сайта и языка. Смена пути сохраняет старый в истории — из неё собирается 301.',
  },

  fields: [
    { name: 'title', type: 'text', required: true, label: 'Заголовок' },
    {
      name: 'path',
      type: 'text',
      required: true,
      index: true,
      label: 'Путь',
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !PATH_PATTERN.test(normalizePath(value))) {
          return 'Путь начинается с косой черты: /about, /accounts/pro. Без завершающей черты и без параметров.'
        }

        return true
      },
      admin: {
        description:
          'Начинается с косой черты. После публикации меняется вместе с записью в историю — старый адрес продолжит работать через 301.',
      },
    },
    {
      name: 'locale',
      type: 'text',
      required: true,
      index: true,
      label: 'Язык',
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(value)) {
          return 'Код языка вида en или en-GB.'
        }

        return true
      },
      admin: { description: 'Путь уникален в пределах пары «сайт + язык».' },
    },
    {
      name: 'site',
      type: 'relationship',
      relationTo: 'tenants',
      required: true,
      index: true,
      label: 'Сайт',
    },

    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'draft',
      label: 'Состояние',
      options: [
        { value: 'draft', label: 'Черновик' },
        { value: 'published', label: 'Опубликовано' },
        { value: 'archived', label: 'В архиве' },
      ],
      admin: {
        description:
          'Страница попадает в релиз только опубликованной. Черновик не собирается и не отдаётся.',
      },
    },

    {
      name: 'blocks',
      type: 'json',
      label: 'Блоки',
      admin: {
        description:
          'Дерево блоков. Типы и варианты — из реестра; стиль берёт значения только из токенов.',
      },
    },

    /**
     * Умолчания стиля страницы. Блок с `theme: inherit` берёт тему отсюда, а
     * не из глобальной настройки: страница-лендинг может быть тёмной целиком,
     * оставаясь на светлом сайте.
     */
    {
      name: 'defaults',
      type: 'group',
      label: 'Умолчания страницы',
      fields: [
        {
          name: 'theme',
          type: 'select',
          defaultValue: 'inherit',
          label: 'Тема',
          options: BLOCK_THEMES.map((value) => ({ value, label: value })),
        },
        {
          name: 'width',
          type: 'select',
          defaultValue: 'content',
          label: 'Ширина',
          options: BLOCK_WIDTHS.map((value) => ({ value, label: value })),
        },
        {
          name: 'paddingY',
          type: 'select',
          defaultValue: 'm',
          label: 'Отступ',
          options: PADDING_STEPS.map((value) => ({ value, label: value })),
        },
        {
          name: 'align',
          type: 'select',
          defaultValue: 'start',
          label: 'Выравнивание',
          options: BLOCK_ALIGNMENTS.map((value) => ({ value, label: value })),
        },
      ],
    },

    {
      name: 'seo',
      type: 'group',
      label: 'SEO',
      fields: [
        { name: 'title', type: 'text', label: 'Заголовок' },
        { name: 'description', type: 'textarea', label: 'Описание' },
        {
          name: 'canonical',
          type: 'text',
          label: 'Канонический адрес',
          admin: {
            description:
              'Заполняется, только когда страница дублирует другую. Иначе оставить пустым.',
          },
        },
        { name: 'ogImage', type: 'upload', relationTo: 'media', label: 'Изображение для соцсетей' },
        {
          name: 'noindex',
          type: 'checkbox',
          defaultValue: false,
          label: 'Закрыть от индексации',
        },
      ],
    },

    {
      name: 'jurisdictions',
      type: 'array',
      label: 'Юрисдикции',
      admin: {
        description:
          'Пусто — страница доступна во всех юрисдикциях сайта. Продукт, запрещённый в юрисдикции, ограничивается здесь.',
      },
      fields: [{ name: 'code', type: 'text', required: true, label: 'Код' }],
    },

    /**
     * История путей (ТЗ 2.3: «смена пути → автоматический 301 из истории
     * путей»). Заполняется хуком, а не человеком: запись, которую надо не
     * забыть добавить, забывают.
     */
    {
      name: 'pathHistory',
      type: 'array',
      label: 'История путей',
      admin: {
        readOnly: true,
        description: 'Заполняется автоматически при смене пути. Из неё собираются редиректы 301.',
      },
      fields: [
        { name: 'path', type: 'text', required: true, label: 'Прежний путь' },
        { name: 'changedAt', type: 'date', label: 'Когда сменён' },
      ],
    },
  ],

  hooks: {
    beforeValidate: [
      ({ data, originalDoc, req }) => {
        if (!data) return data

        if (typeof data.path === 'string') {
          data.path = normalizePath(data.path)
        }

        /**
         * Прежний путь дописывается в историю при каждой смене. Без этого
         * старый адрес перестаёт работать молча — а он уже в поисковой выдаче
         * и в чужих ссылках.
         */
        const previous = (originalDoc as Record<string, unknown> | undefined)?.path

        if (
          typeof previous === 'string' &&
          previous !== '' &&
          typeof data.path === 'string' &&
          data.path !== previous
        ) {
          const history = Array.isArray(data.pathHistory)
            ? [...(data.pathHistory as Record<string, unknown>[])]
            : Array.isArray((originalDoc as Record<string, unknown> | undefined)?.pathHistory)
              ? [
                  ...((originalDoc as Record<string, unknown>).pathHistory as Record<
                    string,
                    unknown
                  >[]),
                ]
              : []

          if (!history.some((entry) => entry.path === previous)) {
            history.push({ path: previous, changedAt: new Date().toISOString() })
          }

          data.pathHistory = history
        }

        /**
         * Блок с произвольной разметкой доступен только кросс-тенантной роли.
         * Проверка стоит на сохранении, а не только на сборке: иначе редактор
         * узнал бы об отказе через день, при публикации.
         */
        if (!isCrossTenantActor(req.user) && containsRestricted(data.blocks)) {
          throw new Error(
            'Блок «Произвольный код» доступен только разработчику: произвольная разметка на витрине требует отдельных полномочий.',
          )
        }

        return data
      },
    ],

    afterChange: [auditHooks({ tenantOf: siteOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: siteOf }).afterDelete],
  },
}

/**
 * Ищет блоки с ограниченным доступом по всему дереву.
 *
 * Обход, а не проверка верхнего уровня: вложенный блок — такой же блок, и
 * спрятать его в колонке было бы простейшим обходом правила.
 */
function containsRestricted(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) {
    return false
  }

  return blocks.some((node) => {
    if (node === null || typeof node !== 'object') {
      return false
    }

    const record = node as Record<string, unknown>

    if (record.type === 'raw-embed') {
      return true
    }

    const slots = record.slots

    if (slots === null || typeof slots !== 'object') {
      return false
    }

    return Object.values(slots as Record<string, unknown>).some((children) =>
      containsRestricted(children),
    )
  })
}

function siteOf(doc: Record<string, unknown>): { id: string | null; slug: string | null } {
  const site = doc.site

  if (site !== null && typeof site === 'object' && 'id' in site) {
    const record = site as Record<string, unknown>

    return {
      id: record.id === undefined || record.id === null ? null : String(record.id),
      slug: typeof record.slug === 'string' ? record.slug : null,
    }
  }

  return { id: site === undefined || site === null ? null : String(site), slug: null }
}
