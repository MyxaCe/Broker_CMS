import { describe, expect, it } from 'vitest'

import { validateUserDraft } from './user-rules'

describe('validateUserDraft — привязка к тенантам', () => {
  it.each(['editor', 'author', 'compliance', 'translator', 'viewer', 'site-admin'] as const)(
    'роль %s без привязки отвергается',
    (role) => {
      expect(validateUserDraft({ role, tenantIds: [] }).join()).toMatch(
        /обязательна хотя бы одна привязка/,
      )
    },
  )

  it('роль с привязкой проходит', () => {
    expect(validateUserDraft({ role: 'editor', tenantIds: ['de'] })).toEqual([])
  })

  it.each(['brand-admin', 'developer'] as const)(
    'кросс-тенантная роль %s без привязки проходит',
    (role) => {
      expect(validateUserDraft({ role, tenantIds: [] })).toEqual([])
    },
  )

  it.each(['brand-admin', 'developer'] as const)(
    'кросс-тенантная роль %s с привязкой отвергается как вводящая в заблуждение',
    (role) => {
      expect(validateUserDraft({ role, tenantIds: ['de'] }).join()).toMatch(
        /действует поверх всех тенантов/,
      )
    },
  )

  it('повторяющаяся привязка отвергается', () => {
    expect(validateUserDraft({ role: 'editor', tenantIds: ['de', 'at', 'de'] }).join()).toMatch(
      /привязка повторяется — de/,
    )
  })

  it('сообщает обо всех проблемах разом', () => {
    expect(validateUserDraft({ role: 'developer', tenantIds: ['de', 'de'] })).toHaveLength(2)
  })
})
