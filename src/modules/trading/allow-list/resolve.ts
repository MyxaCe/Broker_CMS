import { allowedSymbols } from './rules'

import type { AllowListRow, Standing } from './rules'
import type { Payload } from 'payload'

/**
 * Разрешённые инструменты сайта на момент сборки релиза.
 *
 * Читается при сборке и замораживается в снапшоте — по той же причине, по
 * которой замораживаются токены и структура: вчерашний релиз не должен
 * меняться от сегодняшней правки. Отдельно здесь это важнее обычного:
 * список — регуляторная граница, и «что было разрешено в момент публикации»
 * обязано быть восстановимо.
 */

export interface AllowListResolution {
  /** Символы для выдачи. Пустой массив означает «ничего не разрешено» (Р-025). */
  readonly symbols: readonly string[]
  /**
   * Сколько из них было включено осознанно вопреки отсутствию котировки.
   * Не фильтр, а видимость: такие включения обязаны быть заметны в отчёте
   * сборки, иначе пометка существует только в карточке.
   */
  readonly confirmedUnquoted: readonly { readonly symbol: string; readonly standing: Standing }[]
  /**
   * Есть ли у сайта карточка доступа вообще.
   *
   * `false` — карточки нет. Это по-прежнему «ничего не разрешено»: на этой
   * границе ненастроенность и запрет совпадают намеренно (§4б, Р-025).
   * Различие нужно не потребителю, а отчёту сборки: «список пуст» и «список
   * не заводили» чинятся разными действиями.
   */
  readonly configured: boolean
}

export const EMPTY_ALLOW_LIST: AllowListResolution = {
  symbols: [],
  confirmedUnquoted: [],
  configured: false,
}

function rowsOf(doc: Record<string, unknown>): AllowListRow[] {
  const raw = Array.isArray(doc.instruments) ? doc.instruments : []

  return raw.flatMap((item) => {
    const row = (item ?? {}) as Record<string, unknown>
    const symbol = typeof row.symbol === 'string' ? row.symbol : ''

    if (symbol === '') {
      return []
    }

    return [
      {
        symbol,
        confirmedUnquoted: row.confirmedUnquoted === true,
        confirmedReason: typeof row.confirmedReason === 'string' ? row.confirmedReason : null,
        standingAtSave: (typeof row.standingAtSave === 'string'
          ? row.standingAtSave
          : 'unknown') as Standing,
        checkedAt: typeof row.checkedAt === 'string' ? row.checkedAt : '',
      },
    ]
  })
}

/** Чистая часть: из документа карточки — в решение. Тестируется без базы. */
export function resolveFromDoc(doc: Record<string, unknown> | undefined): AllowListResolution {
  if (doc === undefined) {
    return EMPTY_ALLOW_LIST
  }

  const rows = rowsOf(doc)

  return {
    symbols: allowedSymbols(rows),
    confirmedUnquoted: rows
      .filter((row) => row.confirmedUnquoted)
      .map((row) => ({ symbol: row.symbol, standing: row.standingAtSave })),
    configured: true,
  }
}

export async function resolveAllowList(
  payload: Payload,
  siteId: string | number,
): Promise<AllowListResolution> {
  const found = await payload.find({
    collection: 'instrument-access',
    where: { site: { equals: siteId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  return resolveFromDoc(found.docs[0] as Record<string, unknown> | undefined)
}
