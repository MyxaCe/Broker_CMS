import { describe, expect, it } from 'vitest'

import {
  buildCacheKey,
  buildETag,
  CACHE_KEY_VERSION,
  CacheKeyError,
  contentHash,
  matchesETag,
} from './cache-key'

import type { CacheKeyInput } from './cache-key'

function axes(overrides: Partial<CacheKeyInput> = {}): CacheKeyInput {
  return {
    site: 'apex-de',
    releaseId: '42',
    resource: 'page:/accounts',
    locale: 'de',
    jurisdiction: 'de-bafin',
    variant: 'default',
    ...overrides,
  }
}

describe('buildCacheKey — все измерения участвуют', () => {
  it.each([
    ['site', 'apex-at'],
    ['releaseId', '43'],
    ['resource', 'page:/about'],
    ['locale', 'en'],
    ['jurisdiction', 'at-fma'],
    ['variant', 'experiment-b'],
  ])('изменение "%s" меняет ключ', (field, value) => {
    const base = buildCacheKey(axes())
    const changed = buildCacheKey(axes({ [field]: value }))

    expect(changed).not.toBe(base)
  })

  it('одинаковые измерения дают одинаковый ключ', () => {
    expect(buildCacheKey(axes())).toBe(buildCacheKey(axes()))
  })

  it('версия формата входит в ключ', () => {
    expect(buildCacheKey(axes()).startsWith(`${CACHE_KEY_VERSION}|`)).toBe(true)
  })
})

describe('buildCacheKey — устойчивость к подстановке', () => {
  it('разделитель в значении не создаёт коллизию', () => {
    const injected = buildCacheKey(axes({ locale: 'de|jur=xx' }))
    const honest = buildCacheKey(axes({ locale: 'de', jurisdiction: 'xx' }))

    expect(injected).not.toBe(honest)
  })

  it('значения кодируются', () => {
    expect(buildCacheKey(axes({ resource: 'page:/акции' }))).toContain('%')
  })

  it.each(['site', 'releaseId', 'resource', 'locale', 'jurisdiction', 'variant'])(
    'пустое измерение "%s" отвергается',
    (field) => {
      expect(() => buildCacheKey(axes({ [field]: '' }))).toThrow(CacheKeyError)
    },
  )
})

describe('contentHash — отпечаток не зависит от порядка полей', () => {
  it('порядок ключей не влияет', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }))
  })

  it('вложенный порядок тоже не влияет', () => {
    expect(contentHash({ outer: { a: 1, b: 2 } })).toBe(contentHash({ outer: { b: 2, a: 1 } }))
  })

  it('порядок в массиве влияет — это разные данные', () => {
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]))
  })

  it('разное содержимое даёт разный отпечаток', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }))
  })

  it('undefined не влияет на отпечаток', () => {
    expect(contentHash({ a: 1, b: undefined })).toBe(contentHash({ a: 1 }))
  })
})

describe('buildETag', () => {
  it('валидатор сильный — без префикса W/', () => {
    expect(buildETag(axes(), { blocks: [] }).startsWith('W/')).toBe(false)
  })

  it('одинаковый кортеж и содержимое дают одинаковый ETag', () => {
    expect(buildETag(axes(), { blocks: [1] })).toBe(buildETag(axes(), { blocks: [1] }))
  })

  it('изменение содержимого меняет ETag', () => {
    expect(buildETag(axes(), { blocks: [1] })).not.toBe(buildETag(axes(), { blocks: [2] }))
  })

  it('изменение измерения меняет ETag при том же содержимом', () => {
    const payload = { blocks: [] }
    expect(buildETag(axes({ locale: 'de' }), payload)).not.toBe(
      buildETag(axes({ locale: 'en' }), payload),
    )
  })
})

describe('matchesETag', () => {
  const etag = '"abc123"'

  it('пустой заголовок не совпадает', () => {
    expect(matchesETag(null, etag)).toBe(false)
    expect(matchesETag('  ', etag)).toBe(false)
  })

  it('точное совпадение', () => {
    expect(matchesETag('"abc123"', etag)).toBe(true)
  })

  it('совпадение в списке', () => {
    expect(matchesETag('"other", "abc123"', etag)).toBe(true)
  })

  it('слабый префикс у присланного значения не мешает', () => {
    expect(matchesETag('W/"abc123"', etag)).toBe(true)
  })

  it('звёздочка совпадает с чем угодно', () => {
    expect(matchesETag('*', etag)).toBe(true)
  })

  it('чужой валидатор не совпадает', () => {
    expect(matchesETag('"another"', etag)).toBe(false)
  })
})
