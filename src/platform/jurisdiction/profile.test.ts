import { describe, expect, it } from 'vitest'

import {
  CLIENT_CATEGORIES,
  DEFAULT_JURISDICTION_CODE,
  SEYCHELLES_DEFAULT_PROFILE,
  isClientCategory,
  profileForCode,
  resolveDefaultProfile,
} from './profile'

import type { JurisdictionProfile } from './profile'

/**
 * Профиль юрисдикции (CMS-24, Р-236, Р-237).
 *
 * Проверяется не «есть поля», а решения сущности: что Сейшелы — дефолт по
 * правилу, а не по удаче порядка строк; что защита от отрицательного баланса
 * видна включённым флагом (Р-281); что регуляторные числа других юрисдикций не
 * выдуманы, а оставлены точками расширения, отличимыми от нуля.
 */

function profile(overrides: Partial<JurisdictionProfile>): JurisdictionProfile {
  return { ...SEYCHELLES_DEFAULT_PROFILE, ...overrides }
}

describe('SEYCHELLES_DEFAULT_PROFILE', () => {
  it('Сейшелы — профиль по умолчанию с кодом SC', () => {
    expect(SEYCHELLES_DEFAULT_PROFILE.code).toBe(DEFAULT_JURISDICTION_CODE)
    expect(SEYCHELLES_DEFAULT_PROFILE.code).toBe('SC')
    expect(SEYCHELLES_DEFAULT_PROFILE.isDefault).toBe(true)
  })

  it('защита от отрицательного баланса — видимый включённый флаг (Р-281)', () => {
    expect(SEYCHELLES_DEFAULT_PROFILE.negativeBalanceProtection).toBe(true)
  })

  it('деление клиентов: розничный и профессиональный (Р-236)', () => {
    expect(SEYCHELLES_DEFAULT_PROFILE.clientCategories).toEqual(['retail', 'professional'])
  })

  it('регуляторные числа владельца не выдуманы — null, а не правдоподобное значение', () => {
    expect(SEYCHELLES_DEFAULT_PROFILE.marginCloseOutPercent).toBeNull()
    expect(SEYCHELLES_DEFAULT_PROFILE.maxLeverage).toBeNull()
    expect(SEYCHELLES_DEFAULT_PROFILE.dataResidency).toBeNull()
  })
})

describe('resolveDefaultProfile', () => {
  it('без заведённых профилей возвращает встроенные Сейшелы, а не пустоту', () => {
    expect(resolveDefaultProfile([])).toEqual(SEYCHELLES_DEFAULT_PROFILE)
  })

  it('берёт профиль с флагом isDefault', () => {
    const de = profile({ code: 'DE', name: 'Германия', isDefault: false })
    const sc = profile({ code: 'SC', name: 'Сейшелы', isDefault: true })

    expect(resolveDefaultProfile([de, sc]).code).toBe('SC')
  })

  it('при нескольких дефолтах побеждает первый по коду, а не по порядку строк', () => {
    const b = profile({ code: 'BB', isDefault: true })
    const a = profile({ code: 'AA', isDefault: true })

    expect(resolveDefaultProfile([b, a]).code).toBe('AA')
  })

  it('без флага откатывается к коду Сейшел', () => {
    const de = profile({ code: 'DE', isDefault: false })
    const sc = profile({ code: 'SC', isDefault: false })

    expect(resolveDefaultProfile([de, sc]).code).toBe('SC')
  })
})

describe('profileForCode', () => {
  it('подбирает профиль к коду юрисдикции тенанта', () => {
    const sc = profile({ code: 'SC' })
    const de = profile({ code: 'DE' })

    expect(profileForCode([sc, de], 'DE')).toBe(de)
  })

  it('нет профиля с кодом — null, а не молчаливый дефолт', () => {
    expect(profileForCode([profile({ code: 'SC' })], 'DE')).toBeNull()
  })

  it('пустой или отсутствующий код — null', () => {
    const profiles = [profile({ code: 'SC' })]

    expect(profileForCode(profiles, '')).toBeNull()
    expect(profileForCode(profiles, null)).toBeNull()
    expect(profileForCode(profiles, undefined)).toBeNull()
  })

  it('код с пробелами по краям подрезается перед сравнением', () => {
    const sc = profile({ code: 'SC' })

    expect(profileForCode([sc], '  SC  ')).toBe(sc)
  })
})

describe('isClientCategory', () => {
  it('принимает только известные категории', () => {
    for (const category of CLIENT_CATEGORIES) {
      expect(isClientCategory(category)).toBe(true)
    }

    expect(isClientCategory('vip')).toBe(false)
    expect(isClientCategory(null)).toBe(false)
    expect(isClientCategory(42)).toBe(false)
  })
})
