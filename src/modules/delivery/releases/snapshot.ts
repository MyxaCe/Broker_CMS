import { EMPTY_ROUTING, EMPTY_STRUCTURE } from '@/modules/design'

import type {
  BrandSnapshot,
  ColorPair,
  DisclaimersSnapshot,
  RoutingSnapshot,
  StructureSnapshot,
  TextItem,
} from '@/modules/design'
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
    /**
     * Стартовый баланс демо-счёта в центах (ТЗ часть 4, Р-027).
     *
     * `null` означает «не задан ни на одном слое цепочки». Подставлять сюда
     * привычный миллион центов нельзя: правдоподобное число на месте отказа
     * не вызывает вопросов, а отсутствие значения — вызывает. Legacy
     * подставляет, и это одно из расхождений, названных при переезде.
     */
    readonly demoStartBalanceCents: number | null
  }
  /**
   * Брендовые ассеты на момент сборки (ТЗ 2.1, DEBT-014).
   *
   * `null` означает, что сбор не выполнялся, и это **не то же самое**, что
   * «ассетов нет»: у пустого бренда слоты пусты, но сам он собран. Поле
   * различает их по тому же уроку, что `texts` — проверка, не получившая
   * материала, обязана быть отличима от пройденной.
   */
  readonly brand: BrandSnapshot | null
  /**
   * Дисклеймеры продукта (ТЗ 2.4, Р-028): карта текстов по локалям и
   * требуемые ключи по страницам.
   *
   * `null` — сбор не выполнялся, и это блокирующая находка. Правило уже
   * прожило месяц невызванным, отдавая при этом чистый отчёт (BUG-010);
   * умолчание здесь вернуло бы ровно то состояние.
   */
  readonly disclaimers: DisclaimersSnapshot | null
  /**
   * Разрешённые инструменты сайта на момент сборки (Р-026).
   *
   * Замораживаются вместе с релизом по той же причине, что токены и
   * структура, и по одной дополнительной: список — регуляторная граница, и
   * «что было разрешено в момент публикации» обязано быть восстановимо.
   *
   * Пустой массив означает «ничего не разрешено» (Р-025) и отличается от
   * `configured: false` — «карточку доступа не заводили». Для потребителя это
   * одно и то же; разница нужна отчёту сборки, потому что чинится разными
   * действиями.
   */
  readonly instruments: {
    readonly symbols: readonly string[]
    readonly configured: boolean
    readonly confirmedUnquoted: readonly { readonly symbol: string; readonly standing: string }[]
  }
  /**
   * Пары цветовых ролей для проверки контраста — собираются из разрешённого
   * набора токенов сайта (ТЗ 2.1).
   */
  readonly colorPairs: readonly ColorPair[]
  /**
   * Тексты для проверки стоп-словаря.
   *
   * `null` означает, что сбор текстов не выполнялся, и это **не то же самое**,
   * что пустой массив. Поле месяц заполнялось умолчанием `[]`, сборка его не
   * передавала, и стоп-словарь исправно докладывал «нарушений нет», не увидев
   * ни строки (DEBT-013).
   */
  readonly texts: readonly TextItem[] | null
  /**
   * Сколько единиц материала осмотрено при сборке — по одному числу на
   * проверку-ретранслятор.
   *
   * Существует ровно затем, чтобы отчёт различал «нарушений нет» и «проверять
   * было нечего»: сами валидаторы получают готовые находки и по ним отличить
   * одно от другого не могут. `null` — сбор не выполнялся, сборка отклоняется.
   */
  readonly examined: {
    readonly tokens: number | null
    readonly structureNodes: number | null
    readonly routedPages: number | null
    readonly compliancePages: number | null
  }
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
  /**
   * Маршрутизация и SEO (ТЗ 2.3): манифест путей, hreflang, редиректы,
   * директивы robots. Замораживается по той же причине, что и структура:
   * карта сайта, отданная вчера, обязана совпадать с тем, что вчера было
   * опубликовано.
   */
  readonly routing: RoutingSnapshot
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
    /**
     * Обязательное поле без умолчания: пропустить его — значит собрать релиз,
     * не проверив тексты, и раньше это делалось молча. Теперь `null` пишется
     * руками и означает ровно то, что означает.
     */
    texts: readonly TextItem[] | null
    /**
     * Обязательное поле без умолчания — по тому же уроку, что и `texts`.
     * Умолчание `[]` здесь означало бы «ничего не разрешено» там, где на деле
     * список просто не передали: молчаливое `[]` однажды уже дало гейту
     * комплаенса чистый отчёт на непроверенном материале.
     */
    instruments: ReleaseSnapshot['instruments']
    /**
     * Обязательное поле без умолчания — по тому же уроку, что `texts` и
     * `instruments`. Умолчание `EMPTY_BRAND` означало бы «ассетов нет» там,
     * где на деле их не собирали, и проверка снова отдала бы чистый отчёт,
     * не выполнившись.
     */
    brand: BrandSnapshot | null
    /** Обязательное поле без умолчания — по тому же уроку, что `texts`. */
    disclaimers: DisclaimersSnapshot | null
    examined?: Partial<ReleaseSnapshot['examined']>
    tokenIssues?: readonly { readonly code: string; readonly message: string }[]
    tokens?: Readonly<Record<string, Readonly<Record<string, string>>>>
    complianceFindings?: readonly {
      readonly code: string
      readonly message: string
      readonly location: string
    }[]
    structure?: StructureSnapshot
    routing?: RoutingSnapshot
  },
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
      demoStartBalanceCents: settings.demoStartBalanceCents.value ?? null,
    },
    brand: content.brand,
    disclaimers: content.disclaimers,
    instruments: content.instruments,
    colorPairs: content.colorPairs ?? [],
    texts: content.texts,
    examined: {
      tokens: content.examined?.tokens ?? null,
      structureNodes: content.examined?.structureNodes ?? null,
      routedPages: content.examined?.routedPages ?? null,
      compliancePages: content.examined?.compliancePages ?? null,
    },
    tokenIssues: content.tokenIssues ?? [],
    tokens: content.tokens ?? {},
    complianceFindings: content.complianceFindings ?? [],
    structure: content.structure ?? EMPTY_STRUCTURE,
    routing: content.routing ?? EMPTY_ROUTING,
  }
}
