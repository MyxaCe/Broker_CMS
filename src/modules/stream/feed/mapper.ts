/**
 * Тотальный маппер элемента ленты (ТЗ 1.3, ADR-0021).
 *
 * «Отсутствие обязательного поля у черновика не должно приводить к ошибке при
 * сборке ленты. Любой маппер обязан быть тотальным: невалидная запись
 * исключается из ленты и логируется как алерт, а не роняет весь эндпоинт.»
 *
 * Здесь это выражено типом: функция возвращает либо элемент, либо причину
 * исключения, и **не бросает никогда**. Бросающий маппер обошёл бы правило,
 * как бы аккуратно он ни был написан, — поэтому исключение ловится и здесь.
 */

export type MappedItem<TItem> =
  | { readonly ok: true; readonly item: TItem }
  | { readonly ok: false; readonly id: string; readonly reason: string }

export interface MappingOutcome<TItem> {
  readonly items: readonly TItem[]
  readonly excluded: readonly { readonly id: string; readonly reason: string }[]
}

export class MappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MappingError'
  }
}

/**
 * Прогоняет записи через маппер, исключая непригодные.
 *
 * Исключение — это **событие уровня ошибки**, а не тишина: лента молча
 * оказывается короче, чем ожидает редактор, и без алерта такое расхождение
 * ищут неделями. Журналирование оставлено вызывающему: здесь чистая функция,
 * а список исключённых возвращается целиком.
 */
export function mapFeed<TSource extends Record<string, unknown>, TItem>(
  records: readonly TSource[],
  map: (record: TSource) => TItem,
): MappingOutcome<TItem> {
  const items: TItem[] = []
  const excluded: { id: string; reason: string }[] = []

  for (const record of records) {
    const id = String(record.id)

    try {
      items.push(map(record))
    } catch (error) {
      /**
       * Ловится всё, включая то, чего маппер не обещал. Непойманное исключение
       * здесь означало бы отказ всей ленты из-за одной записи — ровно то, что
       * запрещено.
       */
      excluded.push({
        id,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { items, excluded }
}

/**
 * Требует значение, иначе исключает запись.
 *
 * Существует ради того, чтобы маппер писался прямолинейно:
 * `requireValue(doc.title, 'заголовок')` вместо ветвлений на каждое поле.
 * Имя не `require` намеренно — так называется совсем другое. Бросает `MappingError`,
 * который `mapFeed` превращает в исключение записи, а не в отказ ленты.
 */
export function requireValue<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined || value === '') {
    throw new MappingError(`Не заполнено обязательное поле: ${field}`)
  }

  return value
}

/** То же для строк: пустая строка после обрезки — это отсутствие значения. */
export function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MappingError(`Не заполнено обязательное поле: ${field}`)
  }

  return value
}
