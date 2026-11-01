import { auditHooks } from '../audit/record'
import { crossTenantOnly } from '../tenancy/payload-access'

import { CLIENT_CATEGORIES, CLIENT_CATEGORY_LABELS, DEFAULT_JURISDICTION_CODE } from './profile'

import type { ClientCategory } from './profile'
import type { Access, CollectionConfig } from 'payload'

/**
 * Профили юрисдикций — именованная сущность, где живут регуляторные числа
 * (CMS-24, Р-237).
 *
 * Коллекция общая, а не тенантная: юрисдикция — не данные одного сайта, а
 * общий для площадки регуляторный набор, к которому сайты привязываются кодом
 * (`settings.jurisdiction`). Изоляции тенантов тут нечего защищать, по той же
 * причине, что у снимка вселенной MDS.
 *
 * Чтение — любой аутентифицированной роли (это справочник, на него опираются
 * видимость, дисклеймеры и торговая часть). Правка — только кросс-тенантной
 * роли: регуляторные пороги меняет комплаенс, а не редактор отдельного сайта, и
 * каждое изменение попадает в журнал аудита (событие без тенанта видно
 * кросс-тенантным ролям).
 *
 * Конкретные числа других юрисдикций здесь НЕ заведены: поля-границы
 * (`marginCloseOutPercent`, `maxLeverage`, `dataResidency`) необязательны и
 * пусты до решения владельца/deploy. Пустое поле — «не задано», отличимое от
 * нуля; нуль у порога законен и отказом не является.
 */

const readForAuthenticated: Access = ({ req }) => Boolean(req.user)

/** Событие о профиле ни к какому тенанту не относится: он общий для площадки. */
function noTenant(): { id: string | null; slug: string | null } {
  return { id: null, slug: null }
}

export const JurisdictionProfiles: CollectionConfig = {
  slug: 'jurisdiction-profiles',

  access: {
    read: readForAuthenticated,
    create: crossTenantOnly,
    update: crossTenantOnly,
    delete: crossTenantOnly,
  },

  admin: {
    useAsTitle: 'name',
    defaultColumns: ['code', 'name', 'isDefault', 'negativeBalanceProtection'],
    group: 'Комплаенс',
    description:
      'Регуляторный профиль юрисдикции: деление клиентов, защита от отрицательного баланса, пороги риск-контроля, плечо, размещение данных. Профиль по умолчанию — Сейшелы. Площадки привязываются к профилю кодом юрисдикции.',
  },

  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      label: 'Код юрисдикции',
      admin: {
        description: `Совпадает с кодом юрисдикции площадки (например ${DEFAULT_JURISDICTION_CODE} — Сейшелы). По нему профиль подбирается к сайту. После первой привязки не меняется: смена кода — это другая юрисдикция, а не переименование.`,
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Название',
      admin: { description: 'Человекочитаемое название, например «Сейшелы».' },
    },
    {
      name: 'isDefault',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      label: 'Профиль по умолчанию',
      admin: {
        description:
          'Ровно один профиль площадки — по умолчанию; сегодня это Сейшелы. На нём открывается площадка, пока юрисдикция сайта не выбрана явно.',
      },
    },
    {
      name: 'clientCategories',
      type: 'select',
      hasMany: true,
      required: true,
      label: 'Категории клиентов',
      defaultValue: [...CLIENT_CATEGORIES],
      options: CLIENT_CATEGORIES.map((value) => ({
        value,
        label: CLIENT_CATEGORY_LABELS[value as ClientCategory],
      })),
      admin: {
        description:
          'Какие категории клиентов существуют в этой юрисдикции (Р-236). Категория конкретного счёта — его собственный атрибут в торговой части, не здесь.',
      },
    },
    {
      name: 'negativeBalanceProtection',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      label: 'Защита от отрицательного баланса',
      admin: {
        description:
          'Видимый флаг, а не вшитое поведение (Р-226, Р-281). На Сейшелах не обязательна — включена по нашему выбору. Выключение здесь — осознанное регуляторное решение, а не умолчание.',
      },
    },
    {
      name: 'marginCallPercent',
      type: 'number',
      min: 0,
      max: 1000,
      defaultValue: 100,
      label: 'Уровень маржин-колла, %',
      admin: {
        description:
          'Предупреждение клиенту об уровне маржи (Р-226, Р-456). Рабочий дефолт — 100 %. Уточняется юристом без релиза. Пусто — «не задано в профиле», это не ноль.',
      },
    },
    {
      name: 'marginCloseOutPercent',
      type: 'number',
      min: 0,
      max: 1000,
      defaultValue: 50,
      label: 'Порог закрытия по марже (стоп-аут), %',
      admin: {
        description:
          'Порог принудительного закрытия позиций (Р-226, Р-456). Рабочий дефолт — 50 %. Уточняется юристом без релиза. Пусто — «не задано в профиле», это не ноль: ноль у порога — законное значение.',
      },
    },
    {
      name: 'maxLeverage',
      type: 'number',
      min: 1,
      max: 1000,
      defaultValue: 100,
      label: 'Потолок плеча',
      admin: {
        description:
          'Верхняя граница плеча юрисдикции (Р-237, Р-456, TRM-53). Рабочий дефолт — 100 (1:100). Это ПОТОЛОК: стартовые плечи портфелей (Standard/Pro/ENC Prime) живут в site-platform (WEB-44) и профилем не отменяются. Уточняется юристом без релиза. Пусто — «не задан».',
      },
    },
    {
      name: 'dataResidency',
      type: 'textarea',
      label: 'Размещение данных',
      admin: {
        description:
          'Что где можно хранить — регуляторные ограничения на размещение данных. Остаётся заглушкой (Р-456): содержимое даёт юрист позже, без релиза. Пусто — «не задано».',
      },
    },
    {
      name: 'regulator',
      type: 'text',
      label: 'Регулятор',
      admin: {
        description: 'Чьё требование исполняет профиль. Справочно, на отбор не влияет.',
      },
    },
  ],

  hooks: {
    afterChange: [auditHooks({ tenantOf: noTenant }).afterChange],
    afterDelete: [auditHooks({ tenantOf: noTenant }).afterDelete],
  },
}
