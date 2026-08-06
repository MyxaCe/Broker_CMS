import { THEMES } from './types'

import type { ColorPair } from '../validators'
import type { ResolvedTokens } from './resolve'
import type { Theme } from './types'
import type { ContrastUsage } from '../contrast'

/**
 * Какие пары ролей обязаны проходить контраст (ТЗ 2.1).
 *
 * Список объявлен явно, а не выведен «все цвета против всех»: перебор дал бы
 * сотни бессмысленных пар (`border.subtle` на `text.muted` нигде не
 * встречается) и утопил бы настоящие нарушения в шуме.
 *
 * Каждая пара здесь — **сочетание, которое реально попадает на экран**.
 * Добавление пары означает: «мы утверждаем, что так рисуем».
 */

export interface ContrastRequirement {
  readonly foreground: string
  readonly background: string
  readonly usage: ContrastUsage
  /** Зачем эта пара существует — попадает в отчёт валидации. */
  readonly reason: string
}

export const REQUIRED_CONTRAST_PAIRS: readonly ContrastRequirement[] = [
  {
    foreground: 'text.primary',
    background: 'surface.base',
    usage: 'text',
    reason: 'основной текст на основном фоне',
  },
  {
    foreground: 'text.primary',
    background: 'surface.raised',
    usage: 'text',
    reason: 'текст на карточке',
  },
  {
    foreground: 'text.secondary',
    background: 'surface.base',
    usage: 'text',
    reason: 'вторичный текст на основном фоне',
  },
  {
    /**
     * `text.muted` — самый частый источник нарушений: приглушённый текст
     * подбирают на глаз, и «чуть светлее» почти всегда оказывается ниже AA.
     */
    foreground: 'text.muted',
    background: 'surface.base',
    usage: 'text',
    reason: 'приглушённый текст (подписи, сноски)',
  },
  {
    foreground: 'text.link',
    background: 'surface.base',
    usage: 'text',
    reason: 'ссылка в тексте',
  },
  {
    foreground: 'text.inverse',
    background: 'accent.default',
    usage: 'text',
    reason: 'текст на акцентной кнопке',
  },
  {
    foreground: 'text.inverse',
    background: 'accent.hover',
    usage: 'text',
    reason: 'текст на кнопке под курсором',
  },
  {
    /**
     * Границы и иконки — нетекстовые элементы, порог ниже (3:1), но не
     * отсутствует: невидимая рамка поля ввода означает, что поле не найти.
     */
    foreground: 'border.default',
    background: 'surface.base',
    usage: 'non-text',
    reason: 'граница поля ввода',
  },
  {
    foreground: 'border.strong',
    background: 'surface.base',
    usage: 'non-text',
    reason: 'выделенная граница',
  },
  {
    foreground: 'state.danger',
    background: 'surface.base',
    usage: 'text',
    reason: 'сообщение об ошибке',
  },
  {
    foreground: 'state.warning',
    background: 'surface.base',
    usage: 'text',
    reason: 'предупреждение',
  },
  {
    foreground: 'state.success',
    background: 'surface.base',
    usage: 'text',
    reason: 'подтверждение',
  },
  {
    /**
     * Рост и падение — не украшение: по ним читают график. Общее с терминалом
     * (ТЗ 2.1), и неразличимый на фоне цвет здесь означает неверно прочитанную
     * котировку.
     */
    foreground: 'market.up',
    background: 'surface.base',
    usage: 'non-text',
    reason: 'рост котировки',
  },
  {
    foreground: 'market.down',
    background: 'surface.base',
    usage: 'non-text',
    reason: 'падение котировки',
  },
]

/**
 * Собирает пары для проверки контраста из разрешённого набора.
 *
 * Проверяются **обе темы**: тёмная тема обычно и подводит — её собирают
 * позже и внимания ей достаётся меньше.
 *
 * Пары, чьи роли в наборе не объявлены, пропускаются молча: об отсутствии
 * роли сообщит разрешение графа, и дублировать это здесь значит показать одну
 * ошибку дважды под разными именами.
 */
export function collectContrastPairs(resolved: ResolvedTokens): ColorPair[] {
  const pairs: ColorPair[] = []

  for (const theme of THEMES) {
    for (const requirement of REQUIRED_CONTRAST_PAIRS) {
      const foreground = resolved.rolesByTheme[theme][requirement.foreground]
      const background = resolved.rolesByTheme[theme][requirement.background]

      if (foreground === undefined || background === undefined) {
        continue
      }

      pairs.push({
        role: describePair(requirement, theme),
        foreground,
        background,
        usage: requirement.usage,
      })
    }
  }

  return pairs
}

function describePair(requirement: ContrastRequirement, theme: Theme): string {
  return `${requirement.foreground} на ${requirement.background} (${theme}, ${requirement.reason})`
}
