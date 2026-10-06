/**
 * Пригодна ли карточка файла к отдаче наружу (ТЗ 5.3).
 *
 * Живёт в `design`, а не в `platform`, и это не вкус. Вопрос «можно ли это
 * показать» — вопрос о сборке и о конструкторе, то есть о дизайне; у
 * платформы нет ни одного читателя этого правила. Первая попытка положить
 * его в `platform` стоила 500 на всей админке: клиентский компонент
 * потянул бы бочку `@/platform`, а в ней `node:fs` (см. ADR-0034).
 *
 * Одно определение на всех, и это не вкусовщина. Критерий «можно ли показать
 * эту картинку» существовал в сборке брендовых ассетов (ADR-0031), а теперь
 * нужен ещё и конструктору: выбор файла в форме пропсов обязан говорить
 * редактору то же самое, что скажет сборка релиза. Две реализации разошлись
 * бы — и разошлись бы именно в мелочах, из-за которых релиз отказывается
 * собираться уже после того, как редактор увидел зелёное.
 *
 * Отсутствующее поле **не заменяется умолчанием**: ни пустым `alt`, ни нулевым
 * размером. Умолчание сказало бы «описания нет», тогда как известно другое —
 * «карточка заполнена не до конца», и чинятся эти состояния по-разному.
 */

/** Карточка файла в том виде, в каком её отдаёт база или API. */
export interface MediaCardInput {
  readonly filename: unknown
  readonly width: unknown
  readonly height: unknown
  readonly mimeType: unknown
  readonly alt: unknown
}

/** То же, но уже проверенное: каждое поле есть и годно. */
export interface MediaCardFacts {
  readonly filename: string
  readonly width: number
  readonly height: number
  readonly alt: string
  readonly mimeType: string
}

export type MediaUsability =
  | { readonly kind: 'usable'; readonly facts: MediaCardFacts }
  | {
      readonly kind: 'unusable'
      /** Чего именно не хватает — словами, в порядке полей карточки. */
      readonly missing: readonly string[]
      /** Готовая причина для сообщения человеку. */
      readonly reason: string
    }

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export function describeMediaUsability(record: MediaCardInput): MediaUsability {
  const filename = nonEmptyString(record.filename)
  const width = positiveInteger(record.width)
  const height = positiveInteger(record.height)
  const mimeType = nonEmptyString(record.mimeType)
  const alt = nonEmptyString(record.alt)

  const missing: string[] = []

  if (filename === null) missing.push('имя файла')
  if (width === null) missing.push('ширина')
  if (height === null) missing.push('высота')
  if (mimeType === null) missing.push('тип содержимого')
  if (alt === null) missing.push('альтернативный текст')

  if (filename === null || width === null || height === null || mimeType === null || alt === null) {
    return { kind: 'unusable', missing, reason: `в карточке файла нет: ${missing.join(', ')}` }
  }

  return { kind: 'usable', facts: { filename, width, height, alt, mimeType } }
}
