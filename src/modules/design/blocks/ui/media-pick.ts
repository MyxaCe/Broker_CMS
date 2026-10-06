import { describeMediaUsability } from '@/platform'

/**
 * Выбор файла из медиатеки в форме пропсов блока ([[DEBT-011]], ADR-0034).
 *
 * Логика живёт отдельно от React по той же причине, что и операции над
 * деревом блоков: ошибаются именно здесь. «Файл выбран» и «файл выбран, а
 * карточки нет» — разные состояния, и если их смешать, редактор увидит пустое
 * поле там, где на самом деле ссылка в никуда (DEBT-019).
 *
 * Компонент поверх остаётся тонким: он ходит в API и показывает то, что
 * решили эти функции.
 */

/** Карточка файла в том виде, в каком её отдаёт локальное API Payload. */
export interface MediaRow {
  readonly id: string
  readonly alt: string
  readonly filename: string | null
  readonly mimeType: string | null
  readonly width: number | null
  readonly height: number | null
  /**
   * Адрес файла, как его собрал Payload. Берётся у него, а не собирается
   * здесь: база адресов — это окружение, и вторая склейка разошлась бы с
   * первой ровно тогда, когда поменяется хранилище.
   */
  readonly url: string | null
}

export function toMediaRow(doc: Record<string, unknown>): MediaRow {
  return {
    id: String(doc.id ?? ''),
    alt: typeof doc.alt === 'string' ? doc.alt : '',
    filename: typeof doc.filename === 'string' ? doc.filename : null,
    mimeType: typeof doc.mimeType === 'string' ? doc.mimeType : null,
    width: typeof doc.width === 'number' ? doc.width : null,
    height: typeof doc.height === 'number' ? doc.height : null,
    url: typeof doc.url === 'string' && doc.url !== '' ? doc.url : null,
  }
}

export function mediaDocsOf(body: unknown): MediaRow[] {
  const docs = (body as { docs?: unknown } | null)?.docs

  if (!Array.isArray(docs)) {
    return []
  }

  return docs
    .filter((doc): doc is Record<string, unknown> => doc !== null && typeof doc === 'object')
    .map(toMediaRow)
    .filter((row) => row.id !== '')
}

export const MEDIA_SEARCH_LIMIT = 24

/**
 * Запрос к медиатеке.
 *
 * Поиск идёт по `alt`, а не по имени файла: имя — это `scan-2024-07-11.png`,
 * а ищут «логотип». Альтернативный текст в медиатеке обязателен (ТЗ 5.3), то
 * есть поле, по которому ищем, заведомо заполнено у каждой карточки.
 */
export function mediaSearchUrl(term: string): string {
  const trimmed = term.trim()
  const base = `/api/media?limit=${MEDIA_SEARCH_LIMIT}&depth=0&sort=-updatedAt`

  return trimmed === '' ? base : `${base}&where[alt][like]=${encodeURIComponent(trimmed)}`
}

export function mediaByIdUrl(id: string): string {
  return `/api/media/${encodeURIComponent(id)}?depth=0`
}

/**
 * Что сейчас выбрано в поле.
 *
 * `unresolved` отделён от `empty` намеренно и это главное, ради чего модуль
 * существует. Файл, на который ссылается блок, удаляет кросс-тенантная роль
 * без всякого предупреждения (DEBT-019), и поле после этого выглядит так же,
 * как незаполненное. Разница видна только если её назвать: пустое поле чинят
 * выбором файла, ссылку в никуда — поиском того, что удалили.
 */
export type MediaSelection =
  | { readonly kind: 'empty' }
  | { readonly kind: 'loading'; readonly id: string }
  | { readonly kind: 'unresolved'; readonly id: string; readonly note: string }
  | { readonly kind: 'unusable'; readonly row: MediaRow; readonly note: string }
  | { readonly kind: 'resolved'; readonly row: MediaRow }
  /** Карточку не прочитали: это отказ, а не отсутствие файла. */
  | { readonly kind: 'unreadable'; readonly id: string; readonly note: string }

export function emptySelectionFor(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

/**
 * Собирает состояние поля из идентификатора и того, что ответила медиатека.
 *
 * `card === undefined` означает «ещё не читали», `card === null` — «прочитали,
 * карточки нет». Третий случай, `failure`, — «прочитать не удалось», и он не
 * схлопывается в «нет»: недоступное API не является доказательством удаления.
 */
export function describeSelection(args: {
  readonly value: unknown
  readonly card: MediaRow | null | undefined
  readonly failure?: string | null
}): MediaSelection {
  if (emptySelectionFor(args.value)) {
    return { kind: 'empty' }
  }

  const id = String(args.value).trim()

  if (args.failure !== undefined && args.failure !== null) {
    return {
      kind: 'unreadable',
      id,
      note: `Карточку файла #${id} прочитать не удалось (${args.failure}). Это отказ медиатеки, а не отсутствие файла — не удаляйте ссылку, пока не проверите.`,
    }
  }

  if (args.card === undefined) {
    return { kind: 'loading', id }
  }

  if (args.card === null) {
    return {
      kind: 'unresolved',
      id,
      note: `Выбран файл #${id}, которого в медиатеке нет: он удалён или принадлежит другому тенанту. Блок опубликуется без изображения, и ошибки нигде не будет — выберите файл заново.`,
    }
  }

  const usability = describeMediaUsability(args.card)

  if (usability.kind === 'unusable') {
    return {
      kind: 'unusable',
      row: args.card,
      note: `Файл выбран, но отдать его витрине нельзя — ${usability.reason}. Сборка релиза остановится на этом же месте.`,
    }
  }

  return { kind: 'resolved', row: args.card }
}

/** Человекочитаемая подпись карточки в списке: что это и какого размера. */
export function describeRow(row: MediaRow): string {
  const size = row.width === null || row.height === null ? null : `${row.width}×${row.height}`
  const parts = [row.alt === '' ? (row.filename ?? `#${row.id}`) : row.alt]

  if (size !== null) {
    parts.push(size)
  }

  if (row.mimeType !== null) {
    parts.push(row.mimeType)
  }

  return parts.join(' · ')
}
