import { isValidSymbol, normalizeSymbol } from './symbol'
import { coverageOf } from './universe'

import type { UniverseCoverage, UniverseState } from './universe'

/**
 * Правила включения инструмента в список разрешённых (Р-026).
 *
 * Требование владельца дословно: «суть в том, что я могу отключить или
 * подключить любые котировки через наш сервис управления». Значит набор —
 * операция, выполняемая в любой момент, а не значение в сиде.
 *
 * Чтобы операция была безопасной, не хватало одного: включить можно было
 * символ, которого MDS не котирует, и узнать об этом только из мёртвой
 * страницы на витрине — она откроется и никогда не покажет цену.
 *
 * Здесь чистые функции. Барьер стоит на сервере (хук коллекции), интерфейс —
 * удобство: клиентский код подставляет кто угодно, и граница на нём стоять не
 * может.
 */

/** Что известно про символ относительно снимка вселенной. */
export const STANDINGS = ['quoted', 'listed-unquoted', 'absent', 'unknown'] as const
export type Standing = (typeof STANDINGS)[number]

export const STANDING_LABELS: Record<Standing, string> = {
  quoted: 'Котируется',
  'listed-unquoted': 'Есть в MDS, цены не было',
  absent: 'Нет в MDS',
  unknown: 'Не проверено: снимка вселенной нет',
}

/**
 * Почему включение требует подтверждения. Формулировки разные намеренно:
 * «символа нет в MDS» и «вселенную не удалось получить» чинятся по-разному, и
 * одинаковый текст отправил бы чинить не туда.
 */
export const STANDING_REASONS: Record<Standing, string> = {
  quoted: '',
  'listed-unquoted':
    'MDS знает символ, но цены у него на момент снимка не было: страница откроется и останется без котировки',
  absent: 'MDS такого символа не котирует вовсе: страница откроется и никогда не покажет цену',
  unknown:
    'Снимок вселенной MDS не получен — проверить нечем. Это не значит «не котируется»: это значит «неизвестно»',
}

/**
 * Единственное состояние, при котором включение безопасно и потому не требует
 * подтверждения.
 *
 * Обратите внимание на `unknown`: недоступность MDS **не** делает включение
 * свободным. Иначе отказ соседа превращался бы в разрешение — ровно то, что
 * §4б запрещает на этой границе.
 */
export function requiresConfirmation(standing: Standing): boolean {
  return standing !== 'quoted'
}

export function standingOf(symbol: string, universe: UniverseState): Standing {
  if (universe === null) {
    return 'unknown'
  }

  const entry = universe.bySymbol.get(symbol)

  if (entry === undefined) {
    return 'absent'
  }

  /**
   * Снимок без опроса цен (`quoted === null`) ничего не утверждает о
   * котируемости. Назвать такой символ котируемым значило бы выдать
   * «не спрашивали» за «спросили и есть».
   */
  if (universe.quoted === null) {
    return 'unknown'
  }

  return entry.quoted ? 'quoted' : 'listed-unquoted'
}

/** Сырая строка списка, как её отдаёт форма. */
export interface AllowListInput {
  readonly symbol?: unknown
  readonly confirmedUnquoted?: unknown
  readonly confirmedReason?: unknown
}

/** Строка после нормализации и разметки. Именно это уходит в базу. */
export interface AllowListRow {
  readonly symbol: string
  readonly confirmedUnquoted: boolean
  readonly confirmedReason: string | null
  /** Чем символ был на момент сохранения. Разметка, а не вычисляемое поле. */
  readonly standingAtSave: Standing
  readonly checkedAt: string
}

export const ALLOW_LIST_ISSUE_CODES = [
  'symbol-empty',
  'symbol-malformed',
  'duplicate',
  'confirmation-required',
  'confirmation-without-reason',
] as const
export type AllowListIssueCode = (typeof ALLOW_LIST_ISSUE_CODES)[number]

export interface AllowListIssue {
  readonly code: AllowListIssueCode
  readonly index: number
  readonly symbol: string
  readonly message: string
}

export interface AllowListCheck {
  readonly rows: readonly AllowListRow[]
  readonly issues: readonly AllowListIssue[]
  /** Объявленный охват: по чему проверяли и сколько единиц осмотрено. */
  readonly coverage: UniverseCoverage
}

/**
 * Минимальная длина причины.
 *
 * Причина в одну букву — это обход требования, а не объяснение. Через полгода
 * «а» не позволит ни подтвердить решение, ни снять его, и запись превратится
 * в разрешение без автора и без повода.
 */
const MIN_REASON_LENGTH = 3

function reasonOf(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? null : text
}

/**
 * Проверяет список целиком и возвращает размеченные строки.
 *
 * Возвращает, а не бросает: вызов из хука решает сам, что делать с находками,
 * а тесты получают разбор, а не текст исключения.
 */
export function checkAllowList(
  input: readonly AllowListInput[],
  universe: UniverseState,
  now: Date,
): AllowListCheck {
  const checkedAt = now.toISOString()
  const rows: AllowListRow[] = []
  const issues: AllowListIssue[] = []
  const seen = new Map<string, number>()

  input.forEach((raw, index) => {
    const symbol = normalizeSymbol(raw.symbol)

    if (symbol === '') {
      issues.push({
        code: 'symbol-empty',
        index,
        symbol,
        message: `Строка ${index + 1}: символ не указан.`,
      })
      return
    }

    if (!isValidSymbol(symbol)) {
      issues.push({
        code: 'symbol-malformed',
        index,
        symbol,
        message: `«${symbol}»: символ не может содержать пробелы и запятые и длиннее 32 знаков не бывает.`,
      })
      return
    }

    const firstAt = seen.get(symbol)

    if (firstAt !== undefined) {
      issues.push({
        code: 'duplicate',
        index,
        symbol,
        message: `«${symbol}» уже есть в списке (строка ${firstAt + 1}). Повтор ничего не разрешает дважды, но прячет настоящий размер списка.`,
      })
      return
    }

    seen.set(symbol, index)

    const standing = standingOf(symbol, universe)
    const confirmed = raw.confirmedUnquoted === true
    const reason = reasonOf(raw.confirmedReason)

    if (requiresConfirmation(standing) && !confirmed) {
      issues.push({
        code: 'confirmation-required',
        index,
        symbol,
        message: `«${symbol}»: ${STANDING_REASONS[standing]}. Включить можно, но только явно: отметьте «включаю осознанно» и напишите причину.`,
      })
      return
    }

    if (confirmed && (reason === null || reason.length < MIN_REASON_LENGTH)) {
      issues.push({
        code: 'confirmation-without-reason',
        index,
        symbol,
        message: `«${symbol}»: осознанное включение без причины — это то же включение по неведению, только с галочкой. Напишите, почему (не короче ${MIN_REASON_LENGTH} знаков).`,
      })
      return
    }

    rows.push({
      symbol,
      confirmedUnquoted: confirmed,
      confirmedReason: reason,
      standingAtSave: standing,
      checkedAt,
    })
  })

  return { rows, issues, coverage: coverageOf(universe) }
}

/**
 * Разрешённые символы для выдачи наружу.
 *
 * Отсортированы и без повторов: порядок накопления не должен влиять на
 * отпечаток содержимого, иначе `ETag` меняется при неизменных данных.
 *
 * Осознанно включённые некотируемые символы **входят** в выдачу: владелец их
 * разрешил, пометка существует для него, а не для потребителя. Фильтровать их
 * здесь значило бы, что включение выглядит выполненным и им не является.
 */
export function allowedSymbols(rows: readonly AllowListRow[]): readonly string[] {
  return [...new Set(rows.map((row) => row.symbol))].sort()
}
