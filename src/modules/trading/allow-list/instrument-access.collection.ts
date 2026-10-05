import { ValidationError } from 'payload'

import { auditHooks, createTenantAccess, crossTenantOnly } from '@/platform'

import { readUniverse } from '../universe/sync'

import { checkAllowList, STANDING_LABELS, STANDINGS } from './rules'

import type { Standing } from './rules'
import type { CollectionConfig } from 'payload'

/**
 * Доступ сайта к инструментам (Р-026).
 *
 * Отдельная коллекция, а не поле карточки тенанта, по двум причинам.
 *
 * Первая — техническая и жёсткая: `tenants` живёт в `platform`, а `platform`
 * по правилу границ не знает о модулях. Проверка «котируется ли символ»
 * опирается на снимок вселенной MDS, то есть на торговый модуль.
 *
 * Вторая — содержательная. Список разрешённых инструментов **не наследуется**
 * по цепочке `brand → region → site`, и это решение, а не упущение. Режим
 * «дополняет унаследованное» означал бы, что добавление инструмента на уровне
 * бренда молча разрешает его во всех юрисдикциях ниже. Список существует ровно
 * затем, чтобы юрисдикции различались; наследование с дополнением отменяет его
 * смысл, а тихое расширение прав на регуляторной границе — худший из наших
 * классов дефектов. Понадобится общий набор — он заводится копией с видимым
 * автором, а не вычисляется.
 */

/**
 * Пустой список означает «ничего не разрешено» (Р-025).
 *
 * Здесь это не код, а обещание: коллекция не содержит ни одного места, где
 * пустота превращалась бы в «разрешено всё». Записано рядом с данными, потому
 * что именно в этом месте следующий читающий захочет «починить» неудобство.
 */

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

export const InstrumentAccess: CollectionConfig = {
  slug: 'instrument-access',

  access: {
    read: createTenantAccess({ field: 'site' }),
    create: createTenantAccess({ field: 'site' }),
    update: createTenantAccess({ field: 'site' }),
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'siteSlug',
    defaultColumns: ['siteSlug', 'instrumentCount', 'updatedAt'],
    group: 'Торговля',
    description:
      'Что сайту разрешено котировать и торговать. Пустой список означает «ничего не разрешено», а не «разрешено всё»: граница fail-closed у всех потребителей (Р-025).',
  },

  fields: [
    {
      name: 'site',
      type: 'relationship',
      relationTo: 'tenants',
      required: true,
      unique: true,
      index: true,
      label: 'Сайт',
      admin: { description: 'Один список на сайт. Наследования по цепочке тенантов нет.' },
    },
    {
      /** Денормализованный slug: он нужен в заголовке списка и в журнале аудита. */
      name: 'siteSlug',
      type: 'text',
      index: true,
      label: 'Идентификатор сайта',
      admin: { readOnly: true },
    },
    {
      name: 'universePicker',
      type: 'ui',
      label: 'Выбор из вселенной MDS',
      admin: {
        components: {
          Field: '@/modules/trading/admin/UniversePicker#UniversePicker',
        },
      },
    },
    {
      name: 'instruments',
      type: 'array',
      label: 'Разрешённые инструменты',
      labels: { singular: 'Инструмент', plural: 'Инструменты' },
      admin: {
        description:
          'Символы, а не числовые id (Р-024): числовая нумерация — внутренняя деталь терминала, и сопоставление делает он у себя.',
      },
      fields: [
        {
          name: 'symbol',
          type: 'text',
          required: true,
          label: 'Символ',
          admin: { description: 'Например BTCUSD. Приводится к верхнему регистру при сохранении.' },
        },
        {
          name: 'confirmedUnquoted',
          type: 'checkbox',
          defaultValue: false,
          label: 'Включаю осознанно, хотя котировки сейчас нет',
          admin: {
            description:
              'Нужна, когда символа нет в снимке вселенной MDS, у него не было цены или снимка нет вовсе. Без неё такой символ не сохранится.',
          },
        },
        {
          name: 'confirmedReason',
          type: 'text',
          label: 'Почему включаем',
          admin: {
            condition: (_, siblingData) => siblingData?.confirmedUnquoted === true,
            description:
              'Через полгода это единственное, по чему решение можно подтвердить или снять.',
          },
        },
        {
          name: 'standingAtSave',
          type: 'select',
          label: 'Чем символ был при сохранении',
          options: STANDINGS.map((value) => ({ value, label: STANDING_LABELS[value] })) satisfies {
            value: Standing
            label: string
          }[],
          admin: {
            readOnly: true,
            description:
              'Пометка, поставленная системой. Она про момент сохранения, а не про сейчас: вселенная меняется, запись — нет.',
          },
        },
        {
          name: 'checkedAt',
          type: 'date',
          label: 'Когда проверено',
          admin: { readOnly: true },
        },
      ],
    },
    {
      name: 'instrumentCount',
      type: 'number',
      label: 'Сколько разрешено',
      admin: {
        readOnly: true,
        description: 'Ноль — не ошибка заполнения, а «ничего не разрешено».',
      },
    },
  ],

  hooks: {
    /**
     * Барьер стоит здесь, на сервере, а не в интерфейсе.
     *
     * Удобный выбор из вселенной — это удобство; граница не может стоять на
     * том, что подставляет клиент. Проверка выполняется на любом пути записи:
     * из админки, из скрипта сида, из локального API. Снять её, не тронув этот
     * файл, невозможно — именно так проверяется, что защита не держится на
     * соседнем слое.
     */
    beforeValidate: [
      async ({ data, req, originalDoc }) => {
        if (!data) {
          return data
        }

        const incoming = Array.isArray(data.instruments)
          ? (data.instruments as Record<string, unknown>[])
          : []

        const universe = await readUniverse(req.payload)
        const check = checkAllowList(incoming, universe, new Date())

        if (check.issues.length > 0) {
          /**
           * Охват называется первой строкой и до перечня находок: резюме
           * читают вместо отчёта, и «проверять было нечем» обязано дойти
           * раньше, чем список символов.
           */
          const coverage =
            check.coverage.state === 'missing'
              ? 'Снимок вселенной MDS не получен — котируемость проверить нечем.'
              : `Проверено по снимку вселенной от ${check.coverage.takenAt} (${check.coverage.instruments} инструментов, с ценой ${check.coverage.quoted ?? 'неизвестно'}).`

          throw new ValidationError({
            collection: 'instrument-access',
            errors: [
              {
                path: 'instruments',
                message: `${coverage}\n${check.issues.map((issue) => issue.message).join('\n')}`,
              },
            ],
            req,
          })
        }

        data.instruments = check.rows.map((row) => ({ ...row }))
        data.instrumentCount = check.rows.length

        const site = data.site ?? (originalDoc as { site?: unknown } | undefined)?.site

        if (site !== undefined && site !== null) {
          const tenant = await req.payload.findByID({
            collection: 'tenants',
            id: typeof site === 'object' ? String((site as { id: unknown }).id) : String(site),
            depth: 0,
            overrideAccess: true,
          })

          data.siteSlug = typeof tenant.slug === 'string' ? tenant.slug : null
        }

        return data
      },
    ],

    afterChange: [auditHooks({ tenantOf: siteOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: siteOf }).afterDelete],
  },
}
