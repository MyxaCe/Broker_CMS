import { resolveTenantById } from '@/platform'

import type { Field } from 'payload'

/**
 * Локаль записи потока (ТЗ 1.2, решение заказчика от 2026-08-05).
 *
 * Материалы на разных языках — **самостоятельные записи**, а не переводы полей
 * одного документа. Это отражает существо новостного потока: региональная
 * повестка везде своя, у немецкой новости своё время публикации, свой автор и
 * свой адрес, и она не обязана иметь английский оригинал.
 *
 * Следствие, ради которого это и важно: локаль — обычное поле, поэтому
 * фильтрация по ней ничем не отличается от фильтрации по категории, а
 * полнотекстовый поиск может выбрать алгоритм разбора по языку записи.
 */

export const localeField: Field = {
  name: 'locale',
  type: 'text',
  required: true,
  index: true,
  label: 'Язык',
  admin: {
    description:
      'Код из числа объявленных у сайта: en, de, ru. Материал на другом языке — отдельная запись, а не перевод этой.',
  },
  validate: (value: unknown) => {
    if (typeof value !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(value)) {
      return 'Код языка вида en или en-GB.'
    }

    return true
  },
}

/**
 * Проверяет, что язык записи объявлен у её сайта.
 *
 * Проверка на **разрешённом** значении, а не на поле самого сайта: список
 * локалей наследуется от бренда и региона (ADR-0013), и запись на языке,
 * который сайт получил по наследству, законна.
 *
 * Без этой проверки материал на необъявленном языке существует, но никогда не
 * попадает в выдачу: лента спрашивает язык из разрешения сайта. Это худший
 * вид ошибки — редактор видит свою работу в админке и не понимает, почему её
 * нет на витрине.
 */
export async function assertLocaleDeclared(args: {
  readonly payload: Parameters<typeof resolveTenantById>[0]
  readonly siteId: string | number | null | undefined
  readonly locale: unknown
}): Promise<void> {
  if (args.siteId === null || args.siteId === undefined || typeof args.locale !== 'string') {
    /** Обязательность полей проверяет сама схема — здесь только связь между ними. */
    return
  }

  const settings = await resolveTenantById(args.payload, args.siteId)
  const declared = settings.availableLocales.entries.map((entry) => entry.value)

  if (!declared.includes(args.locale)) {
    throw new Error(
      declared.length === 0
        ? 'У сайта не объявлено ни одной локали — сначала заполните их в карточке тенанта.'
        : `Язык «${args.locale}» не объявлен у этого сайта. Доступны: ${declared.join(', ')}.`,
    )
  }
}
