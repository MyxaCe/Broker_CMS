import { contrastRatio, meetsAA } from './contrast'
import { DEFAULT_FORBIDDEN_PHRASES, findForbiddenPhrases } from './forbidden-claims'

import type { ContrastUsage } from './contrast'
import type { TextItem } from './forbidden-claims'
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
}

export interface TokenGraphInput {
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
}

export interface ComplianceValidatorInput {
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
}

export interface StructureValidatorInput {
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
}

export interface ForbiddenClaimsInput {
  readonly texts: readonly TextItem[]
  /** Дополнительные формулировки бренда или юрисдикции — не замена основного словаря. */
  readonly extraPhrases?: readonly string[]
}

export const forbiddenClaimsValidator: Validator<ForbiddenClaimsInput> = {
  name: 'forbidden-claims',
  description: 'Отсутствие обещаний гарантированной доходности в текстах (ТЗ 2.4).',

  run(input) {
    const phrases = [...DEFAULT_FORBIDDEN_PHRASES, ...(input.extraPhrases ?? [])]

    return input.texts.flatMap((item) =>
      findForbiddenPhrases(item.text, phrases).map((match) => ({
        validator: 'forbidden-claims',
        severity: 'blocking' as const,
        code: 'forbidden-claim',
        message: `Обещание доходности: «${match.phrase}». Найдено: «${match.fragment}».`,
        location: `${item.contentClass}: ${item.location}`,
      })),
    )
  },
}
