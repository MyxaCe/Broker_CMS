import type { ResolvedNavItem } from '../navigation/tree'

/**
 * Структура сайта, замороженная в релизе (ТЗ 2.2, разд. 3 — `bootstrap`).
 *
 * Навигация и глобальные области разрешаются **на момент сборки** и уезжают в
 * снапшот. Читать их при выдаче значило бы, что откат вернул бы старую разметку
 * с сегодняшним меню — состояние, которого никогда не публиковали.
 */

export interface SnapshotNavigation {
  readonly locale: string
  readonly placement: string
  readonly items: readonly ResolvedNavItem[]
}

export interface SnapshotGlobalArea {
  readonly locale: string
  readonly kind: string
  readonly blocks: unknown
  /** Заполнено только у полосы риск-предупреждения. */
  readonly riskWarning: {
    readonly text: string
    readonly lossPercentage: number | null
  } | null
  /** Пусто — область показывается во всех юрисдикциях сайта. */
  readonly jurisdictions: readonly string[]
}

export interface StructureFinding {
  readonly code: string
  readonly message: string
  readonly location: string
  readonly severity: 'blocking' | 'warning'
}

export interface StructureSnapshot {
  readonly navigation: readonly SnapshotNavigation[]
  readonly globalAreas: readonly SnapshotGlobalArea[]
  /**
   * Расхождения структуры: битые ссылки меню, ненайденные секции.
   * Отдельно от находок валидатора — здесь они собираются, там превращаются
   * в отчёт релиза.
   */
  readonly findings: readonly StructureFinding[]
}

export const EMPTY_STRUCTURE: StructureSnapshot = {
  navigation: [],
  globalAreas: [],
  findings: [],
}
