import { contrastRatio, meetsAA } from './contrast'
import { DEFAULT_FORBIDDEN_PHRASES, findForbiddenPhrases } from './forbidden-claims'

import type { ContrastUsage } from './contrast'
import type { TextItem } from './forbidden-claims'
import type { RoutingFinding } from './seo/types'
import type { StructureFinding } from './structure/types'
import type { Validator } from '@/platform'

/**
 * Валидаторы сборки релиза, относящиеся к дизайну и текстам (ТЗ 2.1, 2.4).
 *
 * Каркас прогона живёт в `delivery`, сами проверки — здесь: доступность и
 * комплаенс текстов относятся к дизайн-системе, а не к плоскости доставки.
 */

export interface ColorPair {
  /** Семантическая роль, а не «цвет №3»: в отчёте должно быть понятно, что чинить. */
  readonly role: string
  readonly foreground: string
  readonly background: string
  readonly usage: ContrastUsage
}

/**
 * Сколько материала досталось проверке-ретранслятору.
 *
 * Валидаторы токенов, структуры, маршрутизации и комплаенса получают не сам
 * материал, а уже готовые находки: считает их тот, кто читает базу. Поэтому по
 * входу такого валидатора невозможно отличить «осмотрели двести страниц, всё
 * чисто» от «никто ничего не осматривал» — в обоих случаях приходит пустой
 * список.
 *
 * `examined` — это число, которое обязан назвать вызывающий: сколько единиц
 * он осмотрел. `null` означает, что сбор не выполнялся, и тогда сборка
 * отклоняется с кодом `check-not-executed`, а не проходит.
 */
export interface RelayedCoverage {
  readonly examined: number | null
}

export interface ContrastInput {
  readonly colorPairs: readonly ColorPair[]
}

export const contrastValidator: Validator<ContrastInput> = {
  name: 'contrast-aa',
  description: 'Контраст цветовых ролей не ниже WCAG AA (ТЗ 2.1).',

  run(input) {
    return input.colorPairs.flatMap((pair) => {
      const ratio = contrastRatio(pair.foreground, pair.background)

      if (meetsAA(ratio, pair.usage)) {
        return []
      }

      return [
        {
          validator: 'contrast-aa',
          severity: 'blocking' as const,
          code: 'contrast-below-aa',
          message: `Контраст ${ratio.toFixed(2)}:1 ниже требуемого для «${pair.usage}». Цвета: ${pair.foreground} на ${pair.background}.`,
          location: `токен: ${pair.role}`,
        },
      ]
    })
  },

  /**
   * Пар нет — значит у сайта не разрешён ни один цветовой токен. Это «нечего
   * проверять», а не «проверка не выполнялась»: о пустом наборе токенов
   * сообщит `token-graph`, и дублировать его отказом здесь незачем.
   */
  coverage(input) {
    return input.colorPairs.length === 0
      ? { kind: 'empty', reason: 'у сайта не разрешено ни одной цветовой роли' }
      : { kind: 'checked', examined: input.colorPairs.length }
  },
}

export interface TokenGraphInput extends RelayedCoverage {
  readonly tokenIssues: readonly { readonly code: string; readonly message: string }[]
}

/**
 * Целостность графа токенов (ТЗ 2.1).
 *
 * Битая ссылка не роняет разрешение — она возвращается расхождением, потому
 * что в черновике это нормальное состояние. Но релиз с ней собраться не
 * должен: токен без значения превращается на витрине в пустую строку, то есть
 * в невидимый текст или отсутствующий фон.
 */
export const tokenGraphValidator: Validator<TokenGraphInput> = {
  name: 'token-graph',
  description: 'Ссылки между уровнями токенов разрешаются, обе темы заполнены (ТЗ 2.1).',

  run(input) {
    return input.tokenIssues.map((issue) => ({
      validator: 'token-graph',
      severity: 'blocking' as const,
      code: issue.code,
      message: issue.message,
      location: 'дизайн-токены',
    }))
  },

  /**
   * Ретранслятор: токены разрешает и считает загрузчик графа. Пустой список находок ничего не
   * говорит сам по себе, поэтому `examined` приходит извне.
   */
  coverage(input) {
    if (input.examined === null) {
      return { kind: 'missing', reason: 'граф токенов не разрешался — расхождения собраны не были' }
    }

    return input.examined === 0
      ? { kind: 'empty', reason: 'у сайта не заведено ни одного токена' }
      : { kind: 'checked', examined: input.examined }
  },
}

export interface ComplianceValidatorInput extends RelayedCoverage {
  readonly complianceFindings: readonly {
    readonly code: string
    readonly message: string
    readonly location: string
  }[]
}

/**
 * Комплаенс-ограничители (ТЗ 2.4).
 *
 * Все находки блокирующие без исключений. Предупреждение здесь было бы
 * бессмысленным: «релиз собран, но предупреждения о риске на сайте нет» — это
 * не предупреждение, а описание нарушения, которое уже произошло.
 */
export const complianceValidator: Validator<ComplianceValidatorInput> = {
  name: 'compliance',
  description: 'Риск-предупреждение, alt у изображений, юрисдикционная видимость (ТЗ 2.4).',

  run(input) {
    return input.complianceFindings.map((finding) => ({
      validator: 'compliance',
      severity: 'blocking' as const,
      code: finding.code,
      message: finding.message,
      location: finding.location,
    }))
  },

  /**
   * Ретранслятор: страницы обходят и нарушения считает правила комплаенса. Пустой список находок ничего не
   * говорит сам по себе, поэтому `examined` приходит извне.
   */
  coverage(input) {
    if (input.examined === null) {
      return { kind: 'missing', reason: 'правила комплаенса не запускались' }
    }

    return input.examined === 0
      ? { kind: 'empty', reason: 'у сайта нет ни одной страницы и ни одной глобальной области' }
      : { kind: 'checked', examined: input.examined }
  },
}

export interface StructureValidatorInput extends RelayedCoverage {
  readonly structureFindings: readonly StructureFinding[]
}

/**
 * Целостность структуры сайта (ТЗ 2.2).
 *
 * Единственная проверка, где уровень находки приходит **из самой находки**, а
 * не назначается здесь. Причина в том, что расхождения структуры неоднородны:
 * ненайденная секция — это дыра в странице, а битый пункт меню — это пункт,
 * который просто не показан. Первое публиковать нельзя, второе — можно, и
 * приравнивать их значило бы, что снятие страницы с публикации останавливает
 * выкатку всего сайта.
 */
export const structureValidator: Validator<StructureValidatorInput> = {
  name: 'structure',
  description: 'Ссылки навигации ведут на существующие страницы, секции раскрываются (ТЗ 2.2).',

  run(input) {
    return input.structureFindings.map((finding) => ({
      validator: 'structure',
      severity: finding.severity,
      code: finding.code,
      message: finding.message,
      location: finding.location,
    }))
  },

  /**
   * Ретранслятор: меню и области собирает загрузчик структуры. Пустой список находок ничего не говорит сам по
   * себе, поэтому `examined` приходит извне.
   */
  coverage(input) {
    if (input.examined === null) {
      return { kind: 'missing', reason: 'структура сайта не собиралась' }
    }

    return input.examined === 0
      ? { kind: 'empty', reason: 'у сайта нет ни одного меню и ни одной глобальной области' }
      : { kind: 'checked', examined: input.examined }
  },
}

export interface RoutingValidatorInput extends RelayedCoverage {
  readonly routingFindings: readonly RoutingFinding[]
}

/**
 * Маршрутизация и SEO (ТЗ 2.3).
 *
 * Уровень находки, как и у структуры, приходит из неё самой: цикл редиректов
 * не даёт открыть страницу вовсе, а отсутствующий публичный адрес соседнего
 * сайта всего лишь укорачивает граф hreflang.
 */
export const routingValidator: Validator<RoutingValidatorInput> = {
  name: 'routing',
  description: 'Редиректы без циклов, канонические адреса абсолютны, hreflang однозначен (ТЗ 2.3).',

  run(input) {
    return input.routingFindings.map((finding) => ({
      validator: 'routing',
      severity: finding.severity,
      code: finding.code,
      message: finding.message,
      location: finding.location,
    }))
  },

  /**
   * Ретранслятор: страницы и редиректы собирает загрузчик слоя В. Пустой
   * список находок ничего не говорит сам по себе, поэтому `examined` приходит
   * извне.
   */
  coverage(input) {
    if (input.examined === null) {
      return { kind: 'missing', reason: 'слой маршрутизации не собирался' }
    }

    return input.examined === 0
      ? { kind: 'empty', reason: 'у сайта нет ни одной страницы' }
      : { kind: 'checked', examined: input.examined }
  },
}

export interface ForbiddenClaimsInput {
  /**
   * Тексты страниц, секций и глобальных областей.
   *
   * `null` — тексты **не собирались**. Отдельное значение нужно потому, что
   * пустой массив здесь означал бы «на сайте нет ни строки текста», и месяц
   * означал именно это по недоразумению: сборка релиза не заполняла поле, а
   * проверка исправно отвечала «нарушений нет» (DEBT-013).
   */
  readonly texts: readonly TextItem[] | null
  /** Дополнительные формулировки бренда или юрисдикции — не замена основного словаря. */
  readonly extraPhrases?: readonly string[]
}

export const forbiddenClaimsValidator: Validator<ForbiddenClaimsInput> = {
  name: 'forbidden-claims',
  description: 'Отсутствие обещаний гарантированной доходности в текстах (ТЗ 2.4).',

  run(input) {
    const phrases = [...DEFAULT_FORBIDDEN_PHRASES, ...(input.extraPhrases ?? [])]

    return (input.texts ?? []).flatMap((item) =>
      findForbiddenPhrases(item.text, phrases).map((match) => ({
        validator: 'forbidden-claims',
        severity: 'blocking' as const,
        code: 'forbidden-claim',
        message: `Обещание доходности: «${match.phrase}». Найдено: «${match.fragment}».`,
        location: `${item.contentClass}: ${item.location}`,
      })),
    )
  },

  /**
   * Единственная проверка, которая получает сам материал, а не готовые
   * находки, — и всё равно нуждается в охвате: отличить «текстов нет» от
   * «текстов не дали» по массиву невозможно, а разница между ними здесь
   * регуляторная.
   */
  coverage(input) {
    if (input.texts === null) {
      return {
        kind: 'missing',
        reason: 'тексты страниц не собраны — сборке нечего было проверять стоп-словарём',
      }
    }

    return input.texts.length === 0
      ? { kind: 'empty', reason: 'на сайте нет ни одного текстового блока' }
      : { kind: 'checked', examined: input.texts.length }
  },
}
