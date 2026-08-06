import { EMPTY_STRUCTURE } from '@/modules/design'

import type { ColorPair, StructureSnapshot, TextItem } from '@/modules/design'
import type { TenantNode, TenantSettings } from '@/platform'

/**
 * Снапшот релиза — полное состояние структуры сайта на момент сборки (ТЗ часть 3).
 *
 * Он же служит входом для валидаторов: проверять надо ровно то, что будет
 * опубликовано, а не текущее состояние черновиков. Иначе между проверкой и
 * публикацией остаётся зазор, в который помещается любое изменение.
 */

/**
 * Версия формата снапшота.
 *
 * Отдельная от версии контракта выдачи: снапшот — внутреннее представление,
 * а контракт — внешнее обещание. Они меняются по разным поводам, и связывать
 * их одной версией значит переиздавать контракт при каждой внутренней правке.
 */
export const SNAPSHOT_SCHEMA_VERSION = 'snapshot-v1'

export interface ResolvedValue {
  readonly value: string | null
  /** Откуда пришло значение: свой тенант или предок. Важно для отчёта редактору. */
  readonly source: string | null
}

export interface ReleaseSnapshot {
  readonly schemaVersion: string
  readonly site: {
    readonly id: string
    readonly slug: string
    readonly kind: TenantNode['kind']
  }
  readonly settings: {
    readonly jurisdiction: ResolvedValue
    readonly defaultLocale: ResolvedValue
    readonly availableLocales: readonly string[]
  }
  /**
   * Пары цветовых ролей для проверки контраста — собираются из разрешённого
   * набора токенов сайта (ТЗ 2.1).
   */
  readonly colorPairs: readonly ColorPair[]
  /** Тексты для проверки стоп-словаря. Наполняются вместе со страницами (M3). */
  readonly texts: readonly TextItem[]
  /**
   * Расхождения графа токенов: битые ссылки, незаполненные темы, повторы имён.
   * Непустой список блокирует сборку — токен без значения превращается на
   * витрине в пустую строку, то есть в невидимый текст или отсутствующий фон.
   */
  readonly tokenIssues: readonly { readonly code: string; readonly message: string }[]
  /**
   * Разрешённые токены по темам. Замораживаются вместе с релизом: тема сайта
   * обязана быть той же, что была на момент публикации, иначе откат вернул бы
   * старую разметку с новыми цветами.
   */
  readonly tokens: Readonly<Record<string, Readonly<Record<string, string>>>>
  /**
   * Нарушения комплаенса на момент сборки (ТЗ 2.4). Непустой список блокирует
   * релиз: отсутствующее предупреждение о риске — это не предупреждение в
   * интерфейсе, а нарушение, которое уже произошло бы на витрине.
   */
  readonly complianceFindings: readonly {
    readonly code: string
    readonly message: string
    readonly location: string
  }[]
  /**
   * Навигация и глобальные области, разрешённые по цепочке наследования и
   * замороженные вместе с релизом (ТЗ 2.2). Отдаются потребителю ручкой
   * `bootstrap` — одним ответом на страницу, а не тремя запросами.
   */
  readonly structure: StructureSnapshot
}

/**
 * Собирает снапшот из разрешённых настроек тенанта.
 *
 * Детерминирована: одинаковый вход даёт одинаковый снапшот. Без этого отпечаток
 * содержимого меняется от прогона к прогону, и `ETag` перестаёт означать
 * «содержимое то же».
 */
export function composeSnapshot(
  site: TenantNode,
  settings: TenantSettings,
  content: {
    colorPairs?: readonly ColorPair[]
    texts?: readonly TextItem[]
    tokenIssues?: readonly { readonly code: string; readonly message: string }[]
    tokens?: Readonly<Record<string, Readonly<Record<string, string>>>>
    complianceFindings?: readonly {
      readonly code: string
      readonly message: string
      readonly location: string
    }[]
    structure?: StructureSnapshot
  } = {},
): ReleaseSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    site: { id: site.id, slug: site.slug, kind: site.kind },
    settings: {
      jurisdiction: {
        value: settings.jurisdiction.value ?? null,
        source: settings.jurisdiction.sourceTenantId,
      },
      defaultLocale: {
        value: settings.defaultLocale.value ?? null,
        source: settings.defaultLocale.sourceTenantId,
      },
      // Сортировка обязательна: порядок накопления по цепочке не должен влиять
      // на отпечаток содержимого.
      availableLocales: settings.availableLocales.entries.map((entry) => entry.value).sort(),
    },
    colorPairs: content.colorPairs ?? [],
    texts: content.texts ?? [],
    tokenIssues: content.tokenIssues ?? [],
    tokens: content.tokens ?? {},
    complianceFindings: content.complianceFindings ?? [],
    structure: content.structure ?? EMPTY_STRUCTURE,
  }
}
