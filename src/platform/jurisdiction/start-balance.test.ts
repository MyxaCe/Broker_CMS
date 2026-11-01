import { describe, expect, it } from 'vitest'

import {
  ACCOUNT_TYPES,
  REAL_ACCOUNT_START_BALANCE_MINOR_UNITS,
  isAccountType,
  resolveStartBalance,
} from './start-balance'

/**
 * Стартовый баланс раздельно по типу счёта (CMS-25, Р-236).
 *
 * Проверяется решение владельца дословно: у демо — из CMS, у реального —
 * ноль. И отдельно — что «демо-сумма не задана» отличимо от «баланс ноль», по
 * тому же уроку, что null против нуля у суммы в контракте выдачи.
 */

describe('resolveStartBalance', () => {
  it('реальный счёт — всегда ноль (деньги не берутся из ниоткуда)', () => {
    expect(resolveStartBalance({ accountType: 'real', demoStartBalanceMinorUnits: null })).toEqual({
      minorUnits: REAL_ACCOUNT_START_BALANCE_MINOR_UNITS,
      source: 'real-zero',
    })
    expect(REAL_ACCOUNT_START_BALANCE_MINOR_UNITS).toBe(0)
  })

  it('реальный счёт игнорирует демо-сумму, даже если она задана', () => {
    expect(
      resolveStartBalance({ accountType: 'real', demoStartBalanceMinorUnits: 1_000_000 }),
    ).toEqual({ minorUnits: 0, source: 'real-zero' })
  })

  it('демо-счёт берёт сумму из CMS', () => {
    expect(
      resolveStartBalance({ accountType: 'demo', demoStartBalanceMinorUnits: 1_000_000 }),
    ).toEqual({ minorUnits: 1_000_000, source: 'demo-configured' })
  })

  it('демо-счёт без заданной суммы — отказ (null), а не нулевой баланс', () => {
    expect(resolveStartBalance({ accountType: 'demo', demoStartBalanceMinorUnits: null })).toEqual({
      minorUnits: null,
      source: 'demo-unset',
    })
  })

  it('демо-сумма ровно ноль — это назначенный ноль, а не отказ', () => {
    expect(resolveStartBalance({ accountType: 'demo', demoStartBalanceMinorUnits: 0 })).toEqual({
      minorUnits: 0,
      source: 'demo-configured',
    })
  })
})

describe('isAccountType', () => {
  it('принимает только demo и real', () => {
    for (const type of ACCOUNT_TYPES) {
      expect(isAccountType(type)).toBe(true)
    }

    expect(isAccountType('bonus')).toBe(false)
    expect(isAccountType(null)).toBe(false)
  })
})
