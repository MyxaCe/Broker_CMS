import { describe, expect, it } from 'vitest'

import { toActor } from './actor'

/**
 * `toActor` стоит на входе каждой проверки доступа. Всё, что он вернёт
 * некорректно, немедленно превращается либо в лишний отказ, либо — что хуже —
 * в лишний доступ.
 */

const VALID = { id: 'u-1', role: 'editor', isActive: true, tenants: ['de'] }

describe('toActor — отказ вместо пустого действующего лица', () => {
  it.each([null, undefined, 'строка', 42, []])('не разбирает %s', (value) => {
    expect(toActor(value)).toBeNull()
  })

  it('без идентификатора — null', () => {
    expect(toActor({ ...VALID, id: undefined })).toBeNull()
  })

  it('с пустым идентификатором — null', () => {
    expect(toActor({ ...VALID, id: '' })).toBeNull()
  })

  it('неизвестная роль — null, а не роль по умолчанию', () => {
    expect(toActor({ ...VALID, role: 'super-user' })).toBeNull()
  })

  it('отсутствующая роль — null', () => {
    expect(toActor({ ...VALID, role: undefined })).toBeNull()
  })
})

describe('toActor — активность', () => {
  it('отсутствие флага трактуется как неактивность', () => {
    expect(toActor({ ...VALID, isActive: undefined })?.isActive).toBe(false)
  })

  it('строка "true" не считается активностью', () => {
    expect(toActor({ ...VALID, isActive: 'true' })?.isActive).toBe(false)
  })

  it('явный true даёт активность', () => {
    expect(toActor(VALID)?.isActive).toBe(true)
  })
})

describe('toActor — привязка к тенантам', () => {
  it('разбирает список идентификаторов', () => {
    expect(toActor({ ...VALID, tenants: ['de', 'at'] })?.tenantIds).toEqual(['de', 'at'])
  })

  it('разбирает развёрнутые документы', () => {
    expect(toActor({ ...VALID, tenants: [{ id: 'de' }, { id: 'at' }] })?.tenantIds).toEqual([
      'de',
      'at',
    ])
  })

  it('приводит числовые идентификаторы к строкам', () => {
    expect(toActor({ ...VALID, tenants: [1, 2] })?.tenantIds).toEqual(['1', '2'])
  })

  it('отсутствующая привязка даёт пустой список, а не доступ ко всему', () => {
    expect(toActor({ ...VALID, tenants: undefined })?.tenantIds).toEqual([])
  })

  it('мусор в списке отбрасывается', () => {
    expect(toActor({ ...VALID, tenants: ['de', null, {}, '', 'at'] })?.tenantIds).toEqual([
      'de',
      'at',
    ])
  })

  it('числовой идентификатор пользователя приводится к строке', () => {
    expect(toActor({ ...VALID, id: 7 })?.id).toBe('7')
  })
})
