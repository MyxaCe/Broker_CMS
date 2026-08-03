import { createTenantAccess, crossTenantOnly } from '@/platform'

import type { CollectionConfig } from 'payload'

/**
 * Транзакционный outbox (ТЗ 3.5).
 *
 * Событие пишется в **той же транзакции**, что и само изменение. Отсюда
 * гарантия: не бывает изменения без события и события без изменения. Именно
 * этого не хватало прежней CMS, где инвалидация уходила HTTP-вызовом с
 * ретраями в памяти процесса — и терялась при перезапуске.
 *
 * Состав полей повторяет соглашение платформы ([[ADR-0017]]).
 */
export const Outbox: CollectionConfig = {
  slug: 'outbox',

  access: {
    read: createTenantAccess({ field: 'tenantId' }),
    /** Пишут только сервисы, изнутри транзакции. */
    create: () => false,
    /**
     * Изменение разрешено кросс-тенантной роли: это кнопка «повторить» на
     * экране доставки, которую требует ТЗ 3.5. Публикатор ходит с обходом
     * правил доступа.
     */
    update: crossTenantOnly,
    delete: () => false,
  },

  admin: {
    useAsTitle: 'routingKey',
    defaultColumns: ['routingKey', 'occurredAt', 'publishedAt', 'attempts', 'lastError'],
    description:
      'Недоставленное событие видно здесь и повторяется автоматически. Кнопка повтора сбрасывает время следующей попытки.',
  },

  fields: [
    {
      name: 'eventId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      label: 'Идентификатор события',
      admin: {
        description:
          'На нём стоит идемпотентность потребителя: повторная доставка того же события не должна применяться дважды.',
      },
    },
    { name: 'routingKey', type: 'text', required: true, index: true, label: 'Ключ маршрутизации' },
    { name: 'payload', type: 'json', required: true, label: 'Тело' },

    /** Когда событие произошло, а не когда его отправили. */
    { name: 'occurredAt', type: 'date', required: true, index: true, label: 'Произошло' },
    { name: 'publishedAt', type: 'date', index: true, label: 'Отправлено' },

    { name: 'attempts', type: 'number', required: true, defaultValue: 0, label: 'Попыток' },
    {
      name: 'nextAttemptAt',
      type: 'date',
      required: true,
      index: true,
      label: 'Следующая попытка',
    },
    { name: 'lastError', type: 'text', label: 'Последняя ошибка' },

    /**
     * Тенант хранится значением — как и в журнале аудита: событие переживает
     * удаление того, о чём свидетельствует, и внешний ключ здесь только мешал бы.
     */
    { name: 'tenantId', type: 'text', index: true, label: 'Тенант (идентификатор)' },
  ],
}
