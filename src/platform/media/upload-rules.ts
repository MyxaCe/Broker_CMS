/**
 * Правила приёма файлов (ТЗ 5.3).
 *
 * Загрузка — это единственное место, где посторонний байт попадает внутрь
 * системы по воле человека. Поэтому перечень разрешённого закрытый, а не
 * запретительный: запретительный список всегда отстаёт от того, что придумают.
 */

/**
 * Разрешённые типы. Ровно то, что нужно сайту брокера.
 *
 * `image/svg+xml` здесь **нет** намеренно: SVG — это документ со скриптами,
 * а не картинка. Он разрешается отдельным правилом и только кросс-тенантной
 * роли (см. `mayUploadSvg`).
 */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'application/pdf',
] as const

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

export const SVG_MIME_TYPE = 'image/svg+xml'

/** 25 МБ. Правовые документы бывают тяжёлыми, баннеры — нет. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export type UploadRejection =
  | { readonly kind: 'mime-not-allowed'; readonly mimeType: string }
  | { readonly kind: 'svg-forbidden' }
  | { readonly kind: 'too-large'; readonly bytes: number; readonly limit: number }
  | { readonly kind: 'extension-mismatch'; readonly extension: string; readonly mimeType: string }

export interface UploadCandidate {
  readonly mimeType: string
  readonly bytes: number
  readonly filename: string
  /** Может ли загружающий класть SVG. */
  readonly mayUploadSvg: boolean
}

/**
 * Расширения, которые обязаны соответствовать заявленному типу.
 *
 * Проверка нужна из-за того, как файл потом раздаётся: имя с расширением
 * `.html` при типе `image/png` — это способ заставить браузер посмотреть на
 * содержимое, а не на заголовок. Отдельный домен для пользовательских файлов
 * (ТЗ 5.3) закрывает основную часть риска, но полагаться на одну меру там,
 * где дёшево иметь две, незачем.
 */
const EXTENSIONS_BY_MIME: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/avif': ['avif'],
  'image/gif': ['gif'],
  'application/pdf': ['pdf'],
  [SVG_MIME_TYPE]: ['svg'],
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')

  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase()
}

/**
 * Проверяет кандидата на загрузку.
 *
 * Возвращает причину отказа либо `null`. Проверки идут от самой дешёвой к
 * самой содержательной, но порядок здесь не про производительность: тип
 * проверяется раньше размера, потому что «файл не того типа» — более точная
 * причина, чем «слишком большой», и именно её стоит показать редактору.
 */
export function checkUpload(candidate: UploadCandidate): UploadRejection | null {
  const mimeType = candidate.mimeType.toLowerCase().split(';')[0]?.trim() ?? ''

  if (mimeType === SVG_MIME_TYPE) {
    if (!candidate.mayUploadSvg) {
      return { kind: 'svg-forbidden' }
    }
  } else if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { kind: 'mime-not-allowed', mimeType }
  }

  const extension = extensionOf(candidate.filename)
  const expected = EXTENSIONS_BY_MIME[mimeType] ?? []

  if (!expected.includes(extension)) {
    return { kind: 'extension-mismatch', extension, mimeType }
  }

  if (candidate.bytes > MAX_UPLOAD_BYTES) {
    return { kind: 'too-large', bytes: candidate.bytes, limit: MAX_UPLOAD_BYTES }
  }

  return null
}

export function describeRejection(rejection: UploadRejection): string {
  switch (rejection.kind) {
    case 'mime-not-allowed':
      return `Тип «${rejection.mimeType}» загружать нельзя. Разрешены: ${ALLOWED_MIME_TYPES.join(', ')}.`
    case 'svg-forbidden':
      return 'SVG может загружать только разработчик: этот формат исполняет скрипты и требует отдельной проверки.'
    case 'too-large':
      return `Файл ${Math.ceil(rejection.bytes / 1024 / 1024)} МБ при пределе ${Math.floor(rejection.limit / 1024 / 1024)} МБ.`
    case 'extension-mismatch':
      return `Расширение «.${rejection.extension}» не соответствует типу «${rejection.mimeType}».`
  }
}
