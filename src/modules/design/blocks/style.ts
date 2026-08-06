/**
 * Стиль блока (ТЗ 2.2).
 *
 * > «ТОЛЬКО из токенов, никакого свободного CSS»
 *
 * Это не ограничение ради ограничения. Свободный CSS в руках редактора
 * означает, что через год сайт состоит из ста несогласованных отступов, а
 * смена бренда требует обхода каждой страницы. Закрытые перечни делают
 * невозможным то, что иначе делают ежедневно.
 */

/** Вертикальный отступ. Значения — ступени шкалы, а не пиксели. */
export const PADDING_STEPS = ['none', 'xs', 's', 'm', 'l', 'xl'] as const

export type PaddingStep = (typeof PADDING_STEPS)[number]

/** Ширина контента. Свободного позиционирования нет (ТЗ 2.2). */
export const BLOCK_WIDTHS = ['narrow', 'content', 'wide', 'full'] as const

export type BlockWidth = (typeof BLOCK_WIDTHS)[number]

/**
 * Тема блока.
 *
 * `inherit` — умолчание: блок берёт тему страницы. Явные `light` и `dark`
 * нужны для секций-вставок, которые выглядят одинаково в обеих темах —
 * например, тёмный герой поверх светлой страницы.
 */
export const BLOCK_THEMES = ['inherit', 'light', 'dark'] as const

export type BlockTheme = (typeof BLOCK_THEMES)[number]

export const BLOCK_ALIGNMENTS = ['start', 'center', 'end'] as const

export type BlockAlignment = (typeof BLOCK_ALIGNMENTS)[number]

export interface BlockStyle {
  readonly paddingY: PaddingStep
  /**
   * Имя семантической роли, а не цвет. Проверяется на существование в
   * разрешённом наборе токенов сайта: ссылка на несуществующую роль означает
   * блок без фона, и увидит это читатель.
   */
  readonly background: string | null
  readonly width: BlockWidth
  readonly theme: BlockTheme
  readonly align: BlockAlignment
}

export const DEFAULT_BLOCK_STYLE: BlockStyle = {
  paddingY: 'm',
  background: null,
  width: 'content',
  theme: 'inherit',
  align: 'start',
}

/**
 * Брейкпоинты (ТЗ 2.2: «адаптивность через варианты и видимость по
 * брейкпоинтам»).
 *
 * Перечень закрытый: свободные медиазапросы вернули бы свободный CSS через
 * заднюю дверь.
 */
export const BREAKPOINTS = ['mobile', 'tablet', 'desktop'] as const

export type Breakpoint = (typeof BREAKPOINTS)[number]

export interface BlockVisibility {
  /**
   * На каких брейкпоинтах блок показывается. Пустой список означает «на всех»
   * — а не «ни на одном»: пустое поле у редактора чаще значит «не трогал», и
   * противоположное умолчание прятало бы блоки молча.
   */
  readonly breakpoints: readonly Breakpoint[]
  /**
   * Юрисдикции, где блок разрешён. Пусто — во всех.
   *
   * Здесь умолчание «во всех» опасно, и это осознанный размен: запрет на
   * продукт задаётся явно, а забытое поле проверяется отдельным правилом
   * комплаенса при сборке релиза (ТЗ 2.4).
   */
  readonly jurisdictions: readonly string[]
  readonly from?: string | null
  readonly until?: string | null
  /** Механизм появится на M5; поле резервируется сейчас (ADR-0003). */
  readonly abVariant?: string | null
}

export const DEFAULT_BLOCK_VISIBILITY: BlockVisibility = {
  breakpoints: [],
  jurisdictions: [],
}

export interface StyleIssue {
  readonly code: 'unknown-role' | 'invalid-enum'
  readonly field: string
  readonly message: string
}

/**
 * Проверяет стиль блока против закрытых перечней и набора ролей.
 *
 * `roles` — имена семантических ролей, разрешённых для сайта. Пустой набор
 * означает, что токены ещё не заведены; тогда проверка фона пропускается, а о
 * пустом наборе сообщит валидатор графа токенов. Иначе одно упущение
 * порождало бы ошибку в каждом блоке страницы.
 */
export function validateBlockStyle(
  style: Partial<BlockStyle>,
  roles: ReadonlySet<string>,
): StyleIssue[] {
  const issues: StyleIssue[] = []

  const check = <T extends string>(field: string, value: unknown, allowed: readonly T[]): void => {
    if (value === undefined || value === null) {
      return
    }

    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      issues.push({
        code: 'invalid-enum',
        field,
        message: `Недопустимое значение «${String(value)}» для «${field}». Разрешены: ${allowed.join(', ')}.`,
      })
    }
  }

  check('paddingY', style.paddingY, PADDING_STEPS)
  check('width', style.width, BLOCK_WIDTHS)
  check('theme', style.theme, BLOCK_THEMES)
  check('align', style.align, BLOCK_ALIGNMENTS)

  if (
    typeof style.background === 'string' &&
    style.background !== '' &&
    roles.size > 0 &&
    !roles.has(style.background)
  ) {
    issues.push({
      code: 'unknown-role',
      field: 'background',
      message: `Фон ссылается на несуществующую семантическую роль «${style.background}».`,
    })
  }

  return issues
}
