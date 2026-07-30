import { describe, expect, it } from 'vitest'

import { decisionToWhere } from './payload-access'

/**
 * Перевод решения о доступе в условие выборки. Именно эта функция определяет,
 * станет ли изоляция ограничением запроса или останется намерением.
 */
describe('decisionToWhere', () => {
  it('отказ превращается в false — выборка не выполняется вовсе', () => {
    expect(decisionToWhere({ kind: 'deny' }, 'id')).toBe(false)
  })

  it('кросс-тенантный доступ превращается в true — без ограничения', () => {
    expect(decisionToWhere({ kind: 'allow-all' }, 'id')).toBe(true)
  })

  it('ограниченный доступ превращается в условие по перечню', () => {
    expect(decisionToWhere({ kind: 'allow-tenants', tenantIds: ['de', 'at'] }, 'id')).toEqual({
      id: { in: ['de', 'at'] },
    })
  })

  it('поле подставляется то, которое задано коллекцией', () => {
    expect(decisionToWhere({ kind: 'allow-tenants', tenantIds: ['de'] }, 'tenants')).toEqual({
      tenants: { in: ['de'] },
    })
  })

  it('перечень копируется, а не переиспользуется по ссылке', () => {
    const tenantIds = ['de']
    const where = decisionToWhere({ kind: 'allow-tenants', tenantIds }, 'site')
    tenantIds.push('at')

    expect(where).toEqual({ site: { in: ['de'] } })
  })
})
