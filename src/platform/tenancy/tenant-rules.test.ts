import { describe, expect, it } from 'vitest'

import { validateTenantDraft } from './tenant-rules'

import type { TenantDraft } from './tenant-rules'

function draft(overrides: Partial<TenantDraft> = {}): TenantDraft {
  return {
    kind: 'site',
    slug: 'apex-de',
    parentId: 'eu',
    jurisdiction: 'de-bafin',
    locales: ['de', 'en'],
    defaultLocale: 'de',
    ...overrides,
  }
}

describe('validateTenantDraft — валидные карточки', () => {
  it('корректный сайт проходит', () => {
    expect(validateTenantDraft(draft())).toEqual([])
  })

  it('бренд без родителя и без юрисдикции проходит', () => {
    expect(
      validateTenantDraft(
        draft({
          kind: 'brand',
          slug: 'apex',
          parentId: null,
          jurisdiction: null,
          locales: [],
          defaultLocale: null,
        }),
      ),
    ).toEqual([])
  })

  it('регион без юрисдикции проходит — он не отдаётся наружу', () => {
    expect(
      validateTenantDraft(
        draft({ kind: 'region', slug: 'apex-eu', parentId: 'apex', jurisdiction: null }),
      ),
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
    expect(
      validateTenantDraft(draft({ kind: 'brand', parentId: 'что-то', jurisdiction: null })).join(),
    ).toMatch(/бренд является корнем/)
  })

  it('сайт без родителя отвергается', () => {
    expect(validateTenantDraft(draft({ parentId: null })).join()).toMatch(/parent: обязателен/)
  })

  it('регион без родителя отвергается', () => {
    expect(
      validateTenantDraft(draft({ kind: 'region', parentId: null, jurisdiction: null })).join(),
    ).toMatch(/parent: обязателен/)
  })
})

describe('validateTenantDraft — юрисдикция (ADR-0003, fail-closed)', () => {
  it('сайт без юрисдикции не сохраняется', () => {
    expect(validateTenantDraft(draft({ jurisdiction: null })).join()).toMatch(
      /jurisdiction: обязательна для сайта/,
    )
  })

  it('пустая строка не считается юрисдикцией', () => {
    expect(validateTenantDraft(draft({ jurisdiction: '   ' })).join()).toMatch(/jurisdiction:/)
  })
})

describe('validateTenantDraft — локали', () => {
  it('сайт без локалей отвергается', () => {
    const issues = validateTenantDraft(draft({ locales: [], defaultLocale: null })).join()
    expect(issues).toMatch(/хотя бы одна локаль/)
  })

  it('локаль по умолчанию обязана входить в список', () => {
    expect(validateTenantDraft(draft({ defaultLocale: 'fr' })).join()).toMatch(
      /defaultLocale: "fr" отсутствует/,
    )
  })

  it('сайт с локалями обязан иметь локаль по умолчанию', () => {
    expect(validateTenantDraft(draft({ defaultLocale: null })).join()).toMatch(
      /defaultLocale: обязательна/,
    )
  })

  it('повторяющиеся локали отвергаются', () => {
    expect(validateTenantDraft(draft({ locales: ['de', 'en', 'de'] })).join()).toMatch(
      /повторяются значения — de/,
    )
  })
})

describe('validateTenantDraft — накопление проблем', () => {
  it('сообщает обо всех нарушениях разом', () => {
    const issues = validateTenantDraft(
      draft({
        slug: 'Плохой',
        parentId: null,
        jurisdiction: null,
        locales: [],
        defaultLocale: 'de',
      }),
    )
    expect(issues.length).toBeGreaterThanOrEqual(4)
  })
})
