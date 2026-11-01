/**
 * Стартовый баланс счёта, раздельно по типу (CMS-25, Р-236).
 *
 * Решение владельца, записанное дословно: «у демо — из CMS, у реального —
 * ноль». Довод точен — реальный счёт с ненулевым начальным балансом это деньги,
 * взявшиеся ниоткуда (Р-236).
 *
 * До сих пор стартовый баланс был один — `demoStartBalanceCents` на карточке
 * тенанта, и это молча читалось как «стартовый баланс вообще». CMS-25 делает
 * разделение явным и названным: число из CMS — это стартовый баланс **демо**,
 * у реального счёта старт — **нуль по правилу**, а не по этому полю.
 *
 * Нуль реального счёта живёт константой, а не настройкой, намеренно. Настройка
 * стартовой суммы реального счёта — это ручка, которой можно создать деньги из
 * ничего; её отсутствие и есть защита. Демо-сумма настраивается, потому что
 * демо-деньги не деньги; реальная — нет, потому что реальные деньги деньги.
 */

/**
 * Тип счёта (Р-236): демо или реальный, разделены.
 *
 * Атрибут записи счёта; сам счёт живёт в торговой части. Здесь тип нужен ровно
 * затем, чтобы по нему развести стартовый баланс.
 */
export const ACCOUNT_TYPES = ['demo', 'real'] as const

export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const ACCOUNT_TYPE_LABELS: Readonly<Record<AccountType, string>> = {
  demo: 'Демо',
  real: 'Реальный',
}

export function isAccountType(value: unknown): value is AccountType {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value)
}

/**
 * Стартовый баланс реального счёта — ноль, всегда (Р-236).
 *
 * Константа, а не настройка: см. заголовок файла. В наименьших единицах валюты,
 * как и демо-сумма, — чтобы обе величины были в одной системе единиц и их
 * нельзя было случайно сравнить в разных.
 */
export const REAL_ACCOUNT_START_BALANCE_MINOR_UNITS = 0

/**
 * Откуда взялся стартовый баланс. Нужен, чтобы отличать назначенный нуль
 * реального счёта от «демо-сумма не задана» — внешне обе могли бы выглядеть
 * отказом, а означают разное.
 */
export type StartBalanceSource =
  /** Реальный счёт: нуль по правилу (Р-236). */
  | 'real-zero'
  /** Демо-счёт: сумма из CMS. */
  | 'demo-configured'
  /** Демо-счёт, но сумма не задана ни на сайте, ни выше по цепочке — отказ. */
  | 'demo-unset'

export interface StartBalanceResolution {
  /**
   * Стартовый баланс в наименьших единицах валюты. `null` означает отказ:
   * демо-сумму никто не назначил, и подставлять своё число нельзя — это открыло
   * бы демо-счёт на сумму, которой никто не выбирал (та же причина, что у
   * `demoStartBalanceCents === null` в контракте выдачи).
   */
  readonly minorUnits: number | null
  readonly source: StartBalanceSource
}

/**
 * Разводит стартовый баланс по типу счёта (CMS-25, Р-236).
 *
 * Реальный счёт всегда получает нуль — демо-сумма на него не влияет вовсе, даже
 * будучи заданной: смешать их значило бы позволить настройке демо протечь в
 * реальные деньги. Демо-счёт получает сумму из CMS; если её нет — отказ, а не
 * нуль: нуль на демо-счёте выглядел бы назначенным балансом, а «сумма не
 * задана» обязана быть отличимо от «баланс ноль».
 */
export function resolveStartBalance(args: {
  readonly accountType: AccountType
  /** Демо-сумма из CMS в наименьших единицах; `null` — не задана. */
  readonly demoStartBalanceMinorUnits: number | null
}): StartBalanceResolution {
  if (args.accountType === 'real') {
    return { minorUnits: REAL_ACCOUNT_START_BALANCE_MINOR_UNITS, source: 'real-zero' }
  }

  if (args.demoStartBalanceMinorUnits === null) {
    return { minorUnits: null, source: 'demo-unset' }
  }

  return { minorUnits: args.demoStartBalanceMinorUnits, source: 'demo-configured' }
}
