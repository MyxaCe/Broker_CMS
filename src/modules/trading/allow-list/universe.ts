/**
 * Вселенная MDS в нашем представлении — локальный снимок, а не живой запрос.
 *
 * ТЗ 4.2: CMS никогда не обращается к MDS синхронно. Снимок снимает фоновый
 * воркер, а редактор и сборка релиза читают только его. Причина не в скорости:
 * синхронный запрос к соседу внутри сохранения карточки означает, что лежащий
 * сосед делает невозможной правку наших собственных данных.
 */

/** Чем кончилась попытка снять снимок. */
export const SYNC_OUTCOMES = ['fetched', 'unreachable', 'malformed'] as const
export type SyncOutcome = (typeof SYNC_OUTCOMES)[number]

export const SYNC_OUTCOME_LABELS: Record<SyncOutcome, string> = {
  fetched: 'Снимок снят',
  unreachable: 'MDS недоступен',
  malformed: 'MDS ответил не по контракту',
}

export interface UniverseEntry {
  readonly symbol: string
  readonly name: string | null
  readonly group: string | null
  readonly category: string | null
  readonly provider: string | null
  /**
   * Была ли у символа цена на момент снимка.
   *
   * `false` — это **знание**, а не отсутствие знания: вселенную сняли, цены
   * спросили, цены у этого символа не было. «Не спрашивали» выражается
   * полем `quoted: null` у всего снимка, а не этим флагом.
   */
  readonly quoted: boolean
}

export interface UniverseSnapshot {
  /** Когда снимок снят. Возраст показывается редактору: снимок — не «сейчас». */
  readonly takenAt: string
  /** Сколько инструментов во вселенной на момент снимка. */
  readonly instruments: number
  /**
   * Сколько из них имело цену. `null` — котировки не опрашивались, и тогда
   * `quoted` у записей ничего не утверждает.
   */
  readonly quoted: number | null
  readonly bySymbol: ReadonlyMap<string, UniverseEntry>
}

/**
 * Состояние знания о вселенной.
 *
 * `null` означает «снимка нет» и **не равно** снимку с нулём инструментов.
 * Это тот самый класс, на котором мы уже обжигались: пустой список говорит
 * «ничего не котируется», хотя известно только «источник ничего не сказал».
 */
export type UniverseState = UniverseSnapshot | null

export interface UniverseCoverage {
  readonly state: 'snapshot' | 'missing'
  readonly takenAt: string | null
  readonly instruments: number | null
  readonly quoted: number | null
}

/**
 * Охват, который проверка обязана объявить вместе с результатом (ADR-0029).
 *
 * Без него «нарушений нет» неотличимо от «проверять было нечем», а на границе
 * разрешённых инструментов это разница между проверенным списком и списком,
 * который никто не смотрел.
 */
export function coverageOf(universe: UniverseState): UniverseCoverage {
  if (universe === null) {
    return { state: 'missing', takenAt: null, instruments: null, quoted: null }
  }

  return {
    state: 'snapshot',
    takenAt: universe.takenAt,
    instruments: universe.instruments,
    quoted: universe.quoted,
  }
}

export function buildUniverseSnapshot(args: {
  readonly takenAt: string
  readonly entries: readonly UniverseEntry[]
  readonly quoted: number | null
}): UniverseSnapshot {
  return {
    takenAt: args.takenAt,
    instruments: args.entries.length,
    quoted: args.quoted,
    bySymbol: new Map(args.entries.map((entry) => [entry.symbol, entry])),
  }
}
