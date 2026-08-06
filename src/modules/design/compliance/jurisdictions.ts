/**
 * Требования юрисдикций (ТЗ 2.4).
 *
 * > «Эти правила — часть движка, а не поля в форме»
 *
 * Таблица живёт в коде намеренно. Это не редакторский контент, а
 * регуляторное знание: «в этой юрисдикции обязательно риск-предупреждение» —
 * не мнение, которое можно поправить в админке между делом.
 *
 * Практическое следствие: изменение требования проходит через выкатку, то есть
 * через ревью и историю. Поле в форме позволило бы снять обязательность
 * предупреждения одним нажатием, и в журнале это выглядело бы как обычная
 * правка настроек.
 */

export interface JurisdictionRequirements {
  readonly code: string
  readonly title: string
  /**
   * Требуется ли постоянно видимое предупреждение о риске.
   *
   * У большинства регуляторов розничного форекса — да. Исключения бывают, и
   * поэтому это поле, а не константа.
   */
  readonly riskWarningRequired: boolean
  /**
   * Обязательно ли раскрывать долю теряющих счетов рядом с предупреждением.
   * Требование ESMA и производных от него режимов.
   */
  readonly lossPercentageRequired: boolean
  /**
   * Типы блоков, запрещённые в юрисдикции. Продукт, запрещённый регулятором,
   * не должен рендериться вовсе (ТЗ 2.4).
   */
  readonly forbiddenBlocks: readonly string[]
}

/**
 * Известные юрисдикции.
 *
 * Перечень заведомо неполон: его наполняет юрист, а не разработчик. Поэтому
 * неизвестный код **не считается разрешающим** — см. `requirementsFor`.
 */
export const JURISDICTIONS: readonly JurisdictionRequirements[] = [
  {
    code: 'eu-mifid',
    title: 'ЕС (MiFID II)',
    riskWarningRequired: true,
    lossPercentageRequired: true,
    forbiddenBlocks: [],
  },
  {
    code: 'de-bafin',
    title: 'Германия (BaFin)',
    riskWarningRequired: true,
    lossPercentageRequired: true,
    forbiddenBlocks: [],
  },
  {
    code: 'uk-fca',
    title: 'Великобритания (FCA)',
    riskWarningRequired: true,
    lossPercentageRequired: true,
    forbiddenBlocks: [],
  },
  {
    code: 'cy-cysec',
    title: 'Кипр (CySEC)',
    riskWarningRequired: true,
    lossPercentageRequired: true,
    forbiddenBlocks: [],
  },
  {
    code: 'au-asic',
    title: 'Австралия (ASIC)',
    riskWarningRequired: true,
    lossPercentageRequired: false,
    forbiddenBlocks: [],
  },
  {
    code: 'ru-cbr',
    title: 'Россия (Банк России)',
    riskWarningRequired: true,
    lossPercentageRequired: false,
    forbiddenBlocks: [],
  },
]

const BY_CODE = new Map(JURISDICTIONS.map((item) => [item.code, item]))

/**
 * Требования юрисдикции.
 *
 * Неизвестный код возвращает **самые строгие** требования, а не пустые. Это
 * ключевое решение: новая юрисдикция, о которой таблица ещё не знает, должна
 * вести себя как требующая предупреждения. Обратное умолчание означало бы,
 * что опечатка в коде юрисдикции молча снимает комплаенс-проверку.
 */
export function requirementsFor(code: string | null | undefined): JurisdictionRequirements {
  if (typeof code !== 'string' || code === '') {
    return {
      code: '',
      title: 'не задана',
      riskWarningRequired: true,
      lossPercentageRequired: true,
      forbiddenBlocks: [],
    }
  }

  return (
    BY_CODE.get(code) ?? {
      code,
      title: `неизвестная (${code})`,
      riskWarningRequired: true,
      lossPercentageRequired: true,
      forbiddenBlocks: [],
    }
  )
}

export function isKnownJurisdiction(code: string): boolean {
  return BY_CODE.has(code)
}
