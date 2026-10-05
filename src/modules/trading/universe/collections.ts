import { SYNC_OUTCOME_LABELS, SYNC_OUTCOMES } from '../allow-list/universe'

import type { SyncOutcome } from '../allow-list/universe'
import type { CollectionConfig } from 'payload'

/**
 * Локальный снимок вселенной MDS.
 *
 * Пишется только фоновым воркером (ТЗ 4.2). Руками не правится ни одной ролью:
 * это не наши данные, а копия чужих, и правка здесь означала бы, что в
 * интерфейсе котируется то, чего MDS не котирует, — то самое, от чего вся
 * работа и затевалась (Р-026).
 */

const readForAuthenticated: CollectionConfig['access'] = {
  read: ({ req }) => Boolean(req.user),
  create: () => false,
  update: () => false,
  delete: () => false,
}

export const MdsInstruments: CollectionConfig = {
  slug: 'mds-instruments',

  /**
   * Снимок общий, а не тенантный: вселенная MDS одна на платформу. Изоляция
   * тенантов здесь нечего защищать — список того, что котируется в мире, не
   * является данными ни одного сайта.
   */
  access: readForAuthenticated,

  admin: {
    useAsTitle: 'symbol',
    defaultColumns: ['symbol', 'name', 'group', 'quoted', 'syncedAt'],
    group: 'Торговля',
    description:
      'Копия вселенной MDS, снятая фоновым воркером. Только чтение: это не наши данные. Пустая коллекция НЕ означает «ничего не котируется» — проверьте журнал снимков рядом.',
  },

  fields: [
    { name: 'symbol', type: 'text', required: true, unique: true, index: true, label: 'Символ' },
    { name: 'name', type: 'text', label: 'Название' },
    { name: 'group', type: 'text', index: true, label: 'Группа' },
    { name: 'category', type: 'text', index: true, label: 'Категория' },
    { name: 'provider', type: 'text', index: true, label: 'Провайдер' },
    {
      name: 'quoted',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      index: true,
      label: 'Была цена на момент снимка',
      admin: {
        description:
          'Утверждение имеет силу, только если у снимка опрашивались котировки. Когда не опрашивались, в журнале снимков стоит «котируемость не определена», и этот флаг не значит ничего.',
      },
    },
    { name: 'syncedAt', type: 'date', required: true, index: true, label: 'Снято' },
  ],
}

/**
 * Журнал снимков.
 *
 * Существует ровно затем, чтобы отличить «вселенная пуста» от «вселенную не
 * получили». Без него пустая коллекция инструментов — отказ, выглядящий как
 * данные, и прочитан он будет как «котировок нет».
 */
export const MdsUniverseSyncs: CollectionConfig = {
  slug: 'mds-universe-syncs',

  access: readForAuthenticated,

  admin: {
    useAsTitle: 'startedAt',
    defaultColumns: ['startedAt', 'outcome', 'instruments', 'quoted', 'reason'],
    group: 'Торговля',
    description:
      'Чем кончилась каждая попытка снять вселенную MDS. Последняя запись — то, на что опирается выбор инструментов в карточке доступа.',
  },

  fields: [
    { name: 'startedAt', type: 'date', required: true, index: true, label: 'Начато' },
    { name: 'finishedAt', type: 'date', required: true, label: 'Закончено' },
    {
      name: 'outcome',
      type: 'select',
      required: true,
      index: true,
      label: 'Исход',
      options: SYNC_OUTCOMES.map((value) => ({
        value,
        label: SYNC_OUTCOME_LABELS[value],
      })) satisfies { value: SyncOutcome; label: string }[],
    },
    {
      name: 'instruments',
      type: 'number',
      label: 'Инструментов',
      admin: {
        description:
          'Пусто — снимок не состоялся. Ноль — состоялся, и вселенная действительно пуста.',
      },
    },
    {
      name: 'quoted',
      type: 'number',
      label: 'С ценой',
      admin: {
        description:
          'Пусто — котировки не опрашивались или ответ не разобрался: котируемость неизвестна, а не равна нулю.',
      },
    },
    { name: 'reason', type: 'text', label: 'Причина' },
    { name: 'source', type: 'text', label: 'Источник', admin: { description: 'Адрес MDS.' } },
  ],
}
