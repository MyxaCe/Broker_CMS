import { contrastRatio, meetsAA } from './contrast'
import { DEFAULT_FORBIDDEN_PHRASES, findForbiddenPhrases } from './forbidden-claims'

import type { ContrastUsage } from './contrast'
import type { TextItem } from './forbidden-claims'
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
