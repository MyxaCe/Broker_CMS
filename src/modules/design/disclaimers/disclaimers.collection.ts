import { auditHooks, createTenantAccess, crossTenantOnly } from '@/platform'

import { BLOCK_DISCLAIMERS } from '../compliance/rules'

import type { CollectionConfig } from 'payload'

/**
 * Тексты дисклеймеров (ТЗ 2.4, Р-028, ADR-0032).
 *
 * Отдельная коллекция, а не поле страницы: один и тот же текст относится к
 * десяткам страниц, и хранение его при странице означало бы двадцать копий
 * регуляторного текста и двадцать мест, где его забудут поправить.
 *
 * Наследуется по цепочке `brand → region → site` тем же правилом, что
 * секции и глобальные области: побеждает ближайший к сайту владелец. У
 * бренда лежит общая формулировка, у сайта — страновая, если регулятор
 * требует своей.
 *
 * **Ключи здесь не выбираются из головы.** Перечень закрыт и совпадает с
 * правилом движка: какой блок какой дисклеймер требует, решает
 * `BLOCK_DISCLAIMERS`, а не редактор. Свободное поле ключа означало бы
 * опечатку, после которой гейт сообщает «текста нет», а текст есть — под
 * соседним именем.
 */

/** Ключи, которые вообще может потребовать движок. Выводятся из правила. */
export const DISCLAIMER_KEYS = [...new Set(Object.values(BLOCK_DISCLAIMERS))].sort()

export const DISCLAIMER_KEY_LABELS: Readonly<Record<string, string>> = {
  'disclaimer.calculator': 'Калькулятор: результат расчёта не является офертой',
  'disclaimer.trading-conditions': 'Торговые условия: значения могут меняться',
  'disclaimer.market-data': 'Рыночные данные: задержка и источник котировок',
}

export const Disclaimers: CollectionConfig = {
  slug: 'disclaimers',

  access: {
    read: createTenantAccess({ field: 'owner' }),
    create: createTenantAccess({ field: 'owner' }),
    update: createTenantAccess({ field: 'owner' }),
    /**
     * Удаление — кросс-тенантной роли. Удалённый текст означает, что релиз
     * перестанет собираться на всех страницах, где нужен его ключ; это не та
     * операция, которую делают между делом.
     */
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'key',
    defaultColumns: ['key', 'locale', 'owner', 'jurisdiction', 'isActive'],
    group: 'Комплаенс',
    description:
      'Тексты дисклеймеров. Ключ выбирается из закрытого перечня: какому блоку какой дисклеймер нужен, решает движок. Релиз со страницей, которой нужен дисклеймер без текста, не собирается.',
  },

  fields: [
    {
      name: 'key',
      type: 'select',
      required: true,
      index: true,
      label: 'Ключ',
      options: DISCLAIMER_KEYS.map((value) => ({
        value,
        label: DISCLAIMER_KEY_LABELS[value] ?? value,
      })),
      admin: {
        description:
          'Перечень закрыт и выведен из правила движка. Нового ключа в списке нет до тех пор, пока его не потребует тип блока.',
      },
    },
    {
      name: 'locale',
      type: 'text',
      required: true,
      index: true,
      label: 'Локаль',
      admin: {
        description:
          'Код локали, например de. Текст нужен на каждой локали сайта: дисклеймер, существующий только по-английски, на немецкой версии не прочитают.',
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
        description:
          'Текст бренда действует на всех его сайтах. Сайт переопределяет его своим — если формулировку требует его регулятор.',
      },
    },
    {
      name: 'jurisdiction',
      type: 'text',
      label: 'Юрисдикция',
      admin: {
        description:
          'Справочно: чьё требование исполняет эта формулировка. На отбор не влияет — отбор идёт по цепочке владельцев, а юрисдикция у сайта одна.',
      },
    },
    {
      name: 'text',
      type: 'textarea',
      required: true,
      label: 'Текст',
      validate: (value: unknown) =>
        typeof value === 'string' && value.trim() !== ''
          ? true
          : 'Пустой дисклеймер выглядит на витрине выполненным требованием и им не является.',
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      index: true,
      label: 'Действует',
      admin: {
        description:
          'Выключенный текст сайта НЕ откатывает к тексту бренда: он оставляет пустое место, и релиз перестаёт собираться. Тихая подмена регуляторного текста хуже отказа.',
      },
    },
  ],

  hooks: {
    afterChange: [auditHooks({ tenantOf: ownerOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: ownerOf }).afterDelete],
  },
}

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
