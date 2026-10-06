import { auditHooks } from '../audit/record'
import { normalizeRelationId } from '../shared/relation'

import {
  BRAND_ASSET_LABELS,
  BRAND_ASSET_SLOTS,
  BRAND_COLOR_PATTERN,
  MAX_DEMO_START_BALANCE_CENTS,
} from './brand'

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
function inheritableScalar(
  name: string,
  label: string,
  description: string,
  validate?: (value: unknown) => true | string,
): Field {
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
      {
        name: 'value',
        type: 'text',
        label: 'Значение',
        admin: { description },
        ...(validate ? { validate } : {}),
      },
    ],
  }
}

/**
 * Наследуемая ссылка на медиатеку.
 *
 * Та же форма `{ mode, value }`, что у скаляров, и по той же причине: «беру
 * логотип бренда», «у меня свой» и «отвязался» — три разных решения
 * редактора, и в журнале аудита они обязаны выглядеть по-разному. Хранить
 * вместо режима «пусто значит наследую» нельзя: тогда сайт, у которого
 * логотипа нет сознательно, неотличим от сайта, которому его не завели.
 */
function inheritableMedia(name: string, label: string, description: string): Field {
  return {
    name,
    type: 'group',
    label,
    admin: { description },
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
      {
        name: 'value',
        type: 'upload',
        relationTo: 'media',
        label: 'Файл',
        admin: {
          description:
            'Выбирается из медиатеки. Альтернативный текст берётся из карточки файла — отдельно здесь не задаётся, иначе один и тот же логотип описывался бы по-разному на каждом сайте.',
        },
      },
    ],
  }
}

/**
 * Наследуемый числовой слой.
 *
 * Отдельно от `inheritableScalar`, потому что текстовое поле приняло бы
 * строку «NaN»: она разбирается как число успешно, а приведение к целому
 * даёт ноль. Ноль здесь становится стартовым балансом демо-счёта, то есть
 * правдоподобным значением на месте отказа.
 */
function inheritableNumber(
  name: string,
  label: string,
  description: string,
  bounds: { readonly min: number; readonly max: number },
): Field {
  return {
    name,
    type: 'group',
    label,
    admin: { description },
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
      {
        name: 'value',
        type: 'number',
        label: 'Значение',
        min: bounds.min,
        max: bounds.max,
        validate: (value: unknown) => {
          if (value === null || value === undefined) {
            return true
          }

          if (typeof value !== 'number' || !Number.isInteger(value)) {
            return 'Целое число без дробной части.'
          }

          if (value < bounds.min || value > bounds.max) {
            return `Ожидается значение от ${bounds.min} до ${bounds.max}.`
          }

          return true
        },
      },
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

const HTTPS_URL = /^https:\/\/[^\s/]+/

/**
 * Подсказка у слота. Для логотипа и фавикона она называет цену их отсутствия:
 * витрина берёт оба из ответа `brand` legacy сегодня, и переезд контура без
 * них — регресс, а не недостающее удобство (Р-014).
 */
const BRAND_ASSET_HINTS: Readonly<Record<(typeof BRAND_ASSET_SLOTS)[number], string>> = {
  logoLight:
    'Витрина берёт логотип отсюда. Без него переезд контура на v2 отнимет у неё картинку, которую legacy отдаёт сегодня (Р-014).',
  logoDark: 'Для тёмной темы. Отсутствует — витрина не подменяет его светлым, а не рисует ничего.',
  logoMono: 'Одноцветный вариант: печать, водяные знаки, факсимиле.',
  logoMark: 'Знак без надписи: фавикон-исходник, аватар, мобильная шапка.',
  favicon:
    'Витрина берёт фавикон отсюда. Без него переезд контура на v2 — регресс по тому же счёту, что и логотип (Р-014).',
  emailLogo:
    'Для писем: там нет ни тёмной темы, ни SVG, поэтому вариант отдельный, а не вычисляемый из логотипа.',
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
      /**
       * Публичный адрес сайта (ТЗ 5.4).
       *
       * В карточке тенанта, а не в переменной окружения: сайтов двадцать, и
       * глобальная переменная выражает адрес ровно одного из них. Нужен там,
       * где ответ содержит ссылки наружу — в RSS, картах сайта, предпросмотре.
       */
      name: 'publicUrl',
      type: 'text',
      label: 'Публичный адрес',
      validate: (value: unknown) => {
        if (value === null || value === undefined || value === '') {
          return true
        }

        if (typeof value !== 'string' || !/^https:\/\/[^\s/]+/.test(value)) {
          return 'Адрес по https, например https://apex.de'
        }

        return true
      },
      admin: {
        description:
          'Например https://apex.de. Без него лента RSS и карта сайта не собираются: ссылкам некуда вести.',
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

    /**
     * Стартовый демо-баланс (ТЗ часть 4, Р-027).
     *
     * Вынесен в M3 раньше своей части намеренно: legacy отдаёт его рядом с
     * инструментами, и переезд контура на v2 без этого поля отнял бы у
     * кабинета величину, которой тот пользуется сегодня. Причина записана
     * здесь, чтобы поле не выглядело случайно забредшим из другого этапа и
     * его не «прибрали» при наведении порядка.
     */
    inheritableNumber(
      'demoStartBalanceCents',
      'Стартовый баланс демо-счёта, центы',
      'В центах, целым числом: 1000000 — это 10 000 единиц валюты. Не задан ни здесь, ни выше по цепочке — выдача отдаёт null, и кабинет обязан отказать, а не подставить своё число.',
      { min: 0, max: MAX_DEMO_START_BALANCE_CENTS },
    ),

    /**
     * Брендовые ассеты слоя А (ТЗ 2.1, DEBT-014).
     *
     * Лежат в карточке тенанта, а не отдельной коллекцией: у них ровно один
     * владелец на каждом уровне цепочки, и наследование логотипа бренда
     * сайтом — то самое поведение, ради которого цепочка и существует.
     */
    ...BRAND_ASSET_SLOTS.map((slot) =>
      inheritableMedia(slot, BRAND_ASSET_LABELS[slot], BRAND_ASSET_HINTS[slot]),
    ),

    inheritableScalar(
      'primaryColor',
      'Фирменный цвет',
      'Hex вида #d4a437. Отдаётся витрине в том же виде, в каком его отдаёт legacy. Полная палитра живёт в дизайн-токенах — это поле их не заменяет.',
      (value: unknown) => {
        if (value === null || value === undefined || value === '') {
          return true
        }

        return typeof value === 'string' && BRAND_COLOR_PATTERN.test(value)
          ? true
          : 'Ожидается hex-цвет вида #d4a437 — ровно шесть знаков, как отдаёт legacy.'
      },
    ),

    {
      name: 'socials',
      type: 'group',
      label: 'Социальные сети',
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
          label: 'Ссылки',
          admin: {
            description:
              'Название сети и ссылка. Регион и сайт переопределяют пункт бренда по названию, а не добавляют второй пункт с тем же именем.',
          },
          fields: [
            { name: 'name', type: 'text', required: true, label: 'Сеть' },
            {
              name: 'url',
              type: 'text',
              required: true,
              label: 'Ссылка',
              validate: (value: unknown) =>
                typeof value === 'string' && HTTPS_URL.test(value)
                  ? true
                  : 'Ссылка по https, например https://t.me/apexcapital',
            },
          ],
        },
      ],
    },
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
