import { BRAND_ASSET_LABELS, BRAND_ASSET_SLOTS } from '@/platform'

import { describeMediaUsability } from '../media/usability'

import type { BrandFinding, BrandImage, BrandSnapshot, BrandSocial } from './types'
import type { BrandAssetSlot } from '@/platform'

/**
 * Сборка брендовых ассетов снапшота из разрешённых ссылок и карточек файлов.
 *
 * Функция чистая: документы медиатеки приходят готовой картой. Так всё
 * дерево случаев — ссылка в никуда, карточка без размеров, файл без имени —
 * проверяется без базы, а в живой системе каждый из них встречается раз в
 * полгода.
 */

/** Карточка файла в том виде, в каком её читает сборка. */
export interface MediaRecord {
  readonly id: string
  readonly filename: unknown
  readonly width: unknown
  readonly height: unknown
  readonly mimeType: unknown
  readonly alt: unknown
}

export interface ComposeBrandInput {
  /** Слот → идентификатор файла, разрешённый по цепочке. `null` — слот пуст. */
  readonly references: Readonly<Record<BrandAssetSlot, string | null>>
  readonly media: ReadonlyMap<string, MediaRecord>
  readonly primaryColor: string | null
  readonly socials: readonly BrandSocial[]
  /**
   * Как собрать публичный адрес файла. Передаётся функцией, потому что база
   * адресов — это окружение, а снапшот обязан собираться без него.
   */
  readonly publicUrl: (filename: string) => string
}

/**
 * Превращает карточку файла в картинку контракта — или объясняет, почему не
 * может.
 *
 * Негодная карточка **не становится** `null`. Умолчание сказало бы «логотипа
 * нет», тогда как известно другое — «логотип выбран, а показать его нечем», и
 * чинятся эти два состояния разными действиями. Это тот же класс, что
 * `?? []` у стоп-словаря: умолчание — утверждение о том, чего мы не знаем.
 *
 * Сам критерий пригодности живёт в `@/platform` и общий с конструктором:
 * редактор, выбирающий файл в форме пропсов, обязан видеть тот же вердикт,
 * который вынесет сборка релиза (ADR-0034).
 */
function toImage(
  record: MediaRecord,
  publicUrl: (filename: string) => string,
): { image: BrandImage } | { reason: string } {
  const usability = describeMediaUsability(record)

  if (usability.kind === 'unusable') {
    return { reason: usability.reason }
  }

  const { filename, width, height, alt, mimeType } = usability.facts

  return { image: { url: publicUrl(filename), width, height, alt, mimeType } }
}

export function composeBrand(input: ComposeBrandInput): BrandSnapshot {
  const assets: Record<BrandAssetSlot, BrandImage | null> = {
    logoLight: null,
    logoDark: null,
    logoMono: null,
    logoMark: null,
    favicon: null,
    emailLogo: null,
  }

  const findings: BrandFinding[] = []
  let examinedReferences = 0

  for (const slot of BRAND_ASSET_SLOTS) {
    const reference = input.references[slot]

    if (reference === null) {
      continue
    }

    examinedReferences += 1

    const record = input.media.get(reference)

    if (record === undefined) {
      /**
       * Ссылка есть, файла нет. Удалить файл, на который ссылаются, умеет
       * только кросс-тенантная роль, и карты использования у медиатеки пока
       * нет (DEBT-014 соседствует с этим по той же причине) — то есть
       * состояние достижимо и ничем больше не ловится.
       */
      findings.push({
        code: 'brand-asset-unresolved',
        message: `${BRAND_ASSET_LABELS[slot]}: выбран файл, которого в медиатеке нет. Релиз не собран, потому что витрина получила бы ссылку в никуда вместо картинки.`,
        location: `${slot}#${reference}`,
      })
      continue
    }

    const result = toImage(record, input.publicUrl)

    if ('reason' in result) {
      findings.push({
        code: 'brand-asset-unusable',
        message: `${BRAND_ASSET_LABELS[slot]}: файл выбран, но отдать его витрине нельзя — ${result.reason}.`,
        location: `${slot}#${reference}`,
      })
      continue
    }

    assets[slot] = result.image
  }

  return {
    assets,
    primaryColor: input.primaryColor,
    /** Порядок фиксирован: отпечаток содержимого не должен зависеть от обхода цепочки. */
    socials: [...input.socials].sort((left, right) => left.name.localeCompare(right.name)),
    findings,
    examinedReferences,
  }
}
