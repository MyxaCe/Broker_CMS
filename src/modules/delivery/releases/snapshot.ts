import type { ColorPair, TextItem } from '@/modules/design'
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
   * Пары цветовых ролей и тексты появятся вместе с токенами и страницами (M3).
   * Поля объявлены сейчас, чтобы форма снапшота и набор валидаторов не менялись
   * при их появлении — добавится содержимое, а не структура.
   */
  readonly colorPairs: readonly ColorPair[]
  readonly texts: readonly TextItem[]
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
  content: { colorPairs?: readonly ColorPair[]; texts?: readonly TextItem[] } = {},
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
  }
}
