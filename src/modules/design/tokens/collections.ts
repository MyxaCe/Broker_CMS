import { auditHooks, createTenantAccess, crossTenantOnly } from '@/platform'

import { parseColor } from '../contrast'

import {
  PRIMITIVE_CATEGORIES,
  PRIMITIVE_CATEGORY_LABELS,
  ROLE_GROUP_LABELS,
  ROLE_GROUPS,
  TOKEN_NAME_PATTERN,
} from './types'

import type { PrimitiveCategory, RoleGroup, TokenSource } from './types'
import type { CollectionConfig, Field } from 'payload'

/**
 * Коллекции дизайн-токенов (ТЗ 2.1).
 *
 * Три коллекции, а не одна с полем «уровень»: у уровней разные поля. У роли
 * два значения — по одному на тему; у примитива одно; у токена компонента —
 * ссылка, которая может вести в разные коллекции. Одна таблица на всех
 * означала бы половину полей пустыми в каждой строке и проверки вида «если
 * уровень такой, то это поле обязательно» — то есть схему, выраженную в коде.
 */

/**
 * Владелец токена — узел дерева тенантов.
 *
 * Как и у таксономий: палитра бренда действует на всех его сайтах, а сайт
 * переопределяет отдельные значения, а не весь набор.
 */
const ownerField: Field = {
  name: 'owner',
  type: 'relationship',
  relationTo: 'tenants',
  required: true,
  index: true,
  label: 'Владелец',
  admin: {
    description:
      'Бренд, регион или сайт. Набор сайта складывается из наборов предков: ближний перекрывает дальний по имени токена.',
  },
}

const nameField: Field = {
  name: 'name',
  type: 'text',
  required: true,
  index: true,
  label: 'Имя',
  validate: (value: unknown) => {
    if (typeof value !== 'string' || !TOKEN_NAME_PATTERN.test(value)) {
      return 'Строчные сегменты через точку: color.gold.500, text.primary, button.primary.bg.'
    }

    return true
  },
  admin: {
    description: 'Точки разделяют уровни. Имя — часть контракта: по нему токен ищут в коде.',
  },
}

/**
 * Примитивы (ТЗ 2.1, слой А, верхний уровень).
 *
 * Сырые значения без смысла: `color.gold.500` — это просто цвет, и он ничего
 * не говорит о том, где применяется. Смысл появляется уровнем ниже.
 */
export const DesignPrimitives: CollectionConfig = {
  slug: 'design-primitives',

  access: {
    /** Токены читают все: они и так уходят в выдачу как переменные CSS. */
    read: () => true,
    create: createTenantAccess({ field: 'owner' }),
    update: createTenantAccess({ field: 'owner' }),
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'category', 'value', 'owner'],
    group: 'Дизайн',
    description:
      'Сырые значения: цвета, отступы, размеры. Применение задаётся семантическими ролями, а не здесь.',
  },

  fields: [
    nameField,
    {
      name: 'category',
      type: 'select',
      required: true,
      index: true,
      label: 'Категория',
      options: PRIMITIVE_CATEGORIES.map((value) => ({
        value,
        label: PRIMITIVE_CATEGORY_LABELS[value],
      })) satisfies { value: PrimitiveCategory; label: string }[],
    },
    {
      name: 'value',
      type: 'text',
      required: true,
      label: 'Значение',
      admin: {
        description: 'Цвет в #RRGGBB, размер с единицами: 16px, 1.125rem, 200ms.',
      },
      validate: (value: unknown, { siblingData }: { siblingData?: Record<string, unknown> }) => {
        if (typeof value !== 'string' || value.trim() === '') {
          return 'Значение обязательно.'
        }

        /**
         * Цвет проверяется разбором, а не на глаз: непонятое значение дальше
         * молча провалит проверку контраста, и причина будет неочевидной.
         */
        if (siblingData?.category === 'color') {
          try {
            parseColor(value)
          } catch {
            return 'Цвет в формате #RGB или #RRGGBB.'
          }
        }

        return true
      },
    },
    ownerField,
    {
      name: 'description',
      type: 'text',
      label: 'Пояснение',
      admin: { description: 'Например: основной жёлтый бренда. Видно дизайнеру при выборе.' },
    },
  ],

  hooks: {
    afterChange: [auditHooks({ tenantOf: ownerOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: ownerOf }).afterDelete],
  },
}

/**
 * Семантические роли (ТЗ 2.1, слой А, средний уровень).
 *
 * Здесь появляется смысл и здесь же — обе темы. Тема живёт **только** на этом
 * уровне: примитив одинаков всегда, токен компонента ссылается на роль и
 * получает нужное значение автоматически.
 */
export const DesignRoles: CollectionConfig = {
  slug: 'design-roles',

  access: {
    read: () => true,
    create: createTenantAccess({ field: 'owner' }),
    update: createTenantAccess({ field: 'owner' }),
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'group', 'light', 'dark', 'owner'],
    group: 'Дизайн',
    description:
      'Смысловой слой: surface, text, border, accent, state, market. Обе темы обязательны — тёмная не «когда-нибудь потом».',
  },

  fields: [
    nameField,
    {
      name: 'group',
      type: 'select',
      required: true,
      index: true,
      label: 'Группа',
      options: ROLE_GROUPS.map((value) => ({
        value,
        label: ROLE_GROUP_LABELS[value],
      })) satisfies { value: RoleGroup; label: string }[],
    },
    {
      name: 'light',
      type: 'text',
      required: true,
      label: 'Светлая тема — примитив',
      admin: { description: 'Имя примитива, например color.gray.900.' },
    },
    {
      name: 'dark',
      type: 'text',
      required: true,
      label: 'Тёмная тема — примитив',
      admin: {
        description:
          'Обязательна. Тёмная тема, собранная наспех, — это непройденный контраст, заметный не всем.',
      },
    },
    ownerField,
  ],

  hooks: {
    afterChange: [auditHooks({ tenantOf: ownerOf }).afterChange],
    afterDelete: [auditHooks({ tenantOf: ownerOf }).afterDelete],
  },
}

/**
 * Токены компонентов (ТЗ 2.1, слой А, нижний уровень).
 *
 * Применение роли к конкретному месту интерфейса. Тем здесь нет: роль уже
 * знает, чем она отличается в тёмной теме.
 */
export const DesignComponentTokens: CollectionConfig = {
  slug: 'design-component-tokens',

  access: {
    read: () => true,
    create: createTenantAccess({ field: 'owner' }),
    update: createTenantAccess({ field: 'owner' }),
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'source', 'reference', 'owner'],
    group: 'Дизайн',
    description:
      'button.primary.bg, card.radius, chart.candleUp. Цвета берутся из ролей, размеры — прямо из примитивов.',
  },

  fields: [
    nameField,
    {
      name: 'source',
      type: 'select',
      required: true,
      defaultValue: 'role',
      label: 'Источник',
      options: [
        { value: 'role', label: 'Семантическая роль (цвета)' },
        { value: 'primitive', label: 'Примитив (размеры, тени, длительности)' },
      ] satisfies { value: TokenSource; label: string }[],
      admin: {
        description:
          'Цвет всегда через роль: тогда смена акцента меняет все кнопки разом, а не по одной.',
      },
    },
    {
      name: 'reference',
      type: 'text',
      required: true,
      label: 'Ссылка',
      admin: { description: 'Имя роли либо примитива — в зависимости от источника.' },
    },
    ownerField,
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
