import { describe, expect, it } from 'vitest'

import { validateTenantDraft } from './tenant-rules'

import type { TenantDraft } from './tenant-rules'

function draft(overrides: Partial<TenantDraft> = {}): TenantDraft {
  return { kind: 'site', slug: 'apex-de', parentId: 'eu', ...overrides }
}

describe('validateTenantDraft — валидные карточки', () => {
  it('корректный сайт проходит', () => {
    expect(validateTenantDraft(draft())).toEqual([])
  })

  it('бренд без родителя проходит', () => {
    expect(validateTenantDraft(draft({ kind: 'brand', slug: 'apex', parentId: null }))).toEqual([])
  })

  it('регион с родителем проходит', () => {
    expect(
      validateTenantDraft(draft({ kind: 'region', slug: 'apex-eu', parentId: 'apex' })),
    ).toEqual([])
  })
})

describe('validateTenantDraft — slug', () => {
  it('пустой slug отвергается', () => {
    expect(validateTenantDraft(draft({ slug: '  ' })).join()).toMatch(/slug: обязателен/)
  })

  it.each(['Apex-DE', 'apex_de', 'apex de', 'апекс', 'apex--de', '-apex', 'apex-'])(
    'отвергает недопустимый slug "%s"',
    (slug) => {
      expect(validateTenantDraft(draft({ slug })).join()).toMatch(/slug:/)
    },
  )

  it.each(['apex', 'apex-de', 'apex-de-2', 'a1'])('принимает корректный slug "%s"', (slug) => {
    expect(validateTenantDraft(draft({ slug }))).toEqual([])
  })
})

describe('validateTenantDraft — форма цепочки', () => {
  it('бренд с родителем отвергается', () => {
    expect(validateTenantDraft(draft({ kind: 'brand', parentId: 'что-то' })).join()).toMatch(
      /бренд является корнем/,
    )
  })

  it('сайт без родителя отвергается', () => {
    expect(validateTenantDraft(draft({ parentId: null })).join()).toMatch(/parent: обязателен/)
  })

  it('регион без родителя отвергается', () => {
    expect(validateTenantDraft(draft({ kind: 'region', parentId: null })).join()).toMatch(
      /parent: обязателен/,
    )
  })
})

describe('validateTenantDraft — накопление проблем', () => {
  it('сообщает обо всех нарушениях разом', () => {
    expect(validateTenantDraft(draft({ slug: 'Плохой', parentId: null }))).toHaveLength(2)
  })
})
