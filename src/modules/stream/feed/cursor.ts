/**
 * Курсор ленты (ТЗ 1.2, ADR-0021).
 *
 * Пагинация по смещению здесь не годится: поток публикуется мгновенно, значит
 * между запросом первой и второй страницы список сдвигается. Читатель получает
 * повтор или пропуск — тем чаще, чем активнее сайт.
 *
 * Курсор указывает не на «сколько пропустить», а на «после какой записи»:
 * появление новых записей выше по ленте на это не влияет.
 */

export class CursorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CursorError'
  }
}

export interface CursorPosition {
  /** Значение поля сортировки последней отданной записи, в ISO. */
  readonly sortValue: string
  /** Её идентификатор. */
  readonly id: string
}

/**
 * Разделитель вне алфавита обеих частей.
 *
 * Идентификатор числовой, отметка времени — ISO, где двоеточие встречается.
 * Взята вертикальная черта: её нет ни в том, ни в другом ([[BUG-004]] — тот же
 * урок, полученный на ключах доставки).
 */
const SEPARATOR = '|'

/**
 * Курсор непрозрачен намеренно.
 *
 * Читаемый курсор — это приглашение его подделать и обещание не менять форму.
 * Кодирование не защита (base64url обратим), а обозначение: значение
 * принадлежит нам, а не потребителю.
 */
export function encodeCursor(position: CursorPosition): string {
  if (position.id === '' || position.sortValue === '') {
    throw new CursorError('Курсор из пустых значений построить нельзя.')
  }

  return Buffer.from(`${position.sortValue}${SEPARATOR}${position.id}`, 'utf8').toString(
    'base64url',
  )
}

/**
 * Разбирает курсор. Возвращает `null` на любом мусоре.
 *
 * Именно `null`, а не исключение: курсор приходит снаружи, и его порча — это
 * обычное дело (обрезали в письме, скопировали не целиком). Обработчик решает,
 * ответить ли ошибкой или начать ленту сначала.
 */
export function decodeCursor(value: string | null | undefined): CursorPosition | null {
  if (typeof value !== 'string' || value === '') {
    return null
  }

  let decoded: string

  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const separator = decoded.indexOf(SEPARATOR)

  if (separator === -1) {
    return null
  }

  const sortValue = decoded.slice(0, separator)
  const id = decoded.slice(separator + 1)

  if (sortValue === '' || id === '') {
    return null
  }

  if (Number.isNaN(Date.parse(sortValue))) {
    return null
  }

  return { sortValue, id }
}

/**
 * Условие «строго после позиции курсора» при сортировке по убыванию даты.
 *
 * Пара «дата + идентификатор», а не одна дата: даты публикации совпадают чаще,
 * чем кажется — редактор выпускает подборку одним нажатием, и у всех записей
 * оказывается одна отметка времени. По одному полю порядок в этом случае
 * неустойчив, и запись либо повторяется, либо теряется.
 */
export function afterCursorWhere(
  position: CursorPosition,
  options: { readonly sortField: string },
): Record<string, unknown> {
  return {
    or: [
      { [options.sortField]: { less_than: position.sortValue } },
      {
        and: [
          { [options.sortField]: { equals: position.sortValue } },
          { id: { less_than: position.id } },
        ],
      },
    ],
  }
}
