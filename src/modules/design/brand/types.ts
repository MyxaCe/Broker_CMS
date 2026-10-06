import type { BrandAssetSlot } from '@/platform'

/**
 * Брендовые ассеты в снапшоте релиза (ТЗ 2.1, DEBT-014).
 *
 * Форма картинки повторяет ответ `brand` legacy — `url`, `width`, `height`,
 * `alt`, `mimeType`. Это сознательное решение, а не совпадение: витрина
 * сегодня читает именно эти поля, и переезд контура на v2 обязан быть для неё
 * сменой адреса, а не переписыванием разметки (Р-014).
 */
export interface BrandImage {
  readonly url: string
  readonly width: number
  readonly height: number
  /** Берётся из карточки файла: в медиатеке он обязателен (ТЗ 5.3). */
  readonly alt: string
  readonly mimeType: string
}

export interface BrandSocial {
  readonly name: string
  readonly url: string
}

export interface BrandFinding {
  readonly code: string
  readonly message: string
  readonly location: string
}

export interface BrandSnapshot {
  readonly assets: Readonly<Record<BrandAssetSlot, BrandImage | null>>
  readonly primaryColor: string | null
  readonly socials: readonly BrandSocial[]
  readonly findings: readonly BrandFinding[]
  /**
   * Сколько ссылок на медиатеку осмотрено.
   *
   * Не число слотов: пустой слот осматривать нечего. Поле существует ровно
   * затем, чтобы отчёт различал «ассеты проверены, всё на месте» и «ассетов
   * не заведено ни одного» — второе выглядит в списке находок так же пусто,
   * а означает регресс при переезде (ADR-0029).
   */
  readonly examinedReferences: number
}

/** Пустой бренд: все слоты пусты, ничего не осмотрено. */
export const EMPTY_BRAND: BrandSnapshot = {
  assets: {
    logoLight: null,
    logoDark: null,
    logoMono: null,
    logoMark: null,
    favicon: null,
    emailLogo: null,
  },
  primaryColor: null,
  socials: [],
  findings: [],
  examinedReferences: 0,
}
