import { describe, expect, it } from 'vitest'

import { authorizeDeliveryRequest } from './authorize'
import {
  extractBearer,
  generateKey,
  hashSecret,
  KEY_PREFIX,
  KeyFormatError,
  parseKey,
  secretMatches,
} from './key-format'
import { DELIVERY_SCOPES, hasScope, isDeliveryScope, normalizeScopes } from './scopes'

import type { StoredKey } from './authorize'

const PEPPER = 'test-pepper-32-characters-long!!'

describe('generateKey', () => {
  it('ключ состоит из префикса, идентификатора и секрета', () => {
    const key = generateKey(PEPPER)

    expect(key.plaintext.startsWith(`${KEY_PREFIX}_${key.keyId}_`)).toBe(true)
    expect(parseKey(key.plaintext)).toEqual({
      keyId: key.keyId,
      secret: key.plaintext.slice(`${KEY_PREFIX}_${key.keyId}_`.length),
    })
  })

  /**
   * Секрет закодирован в base64url, где `_` — допустимый символ, а он же
   * служит разделителем. Разбор по всем разделителям обрезал бы секрет.
   * Перебор нужен потому, что символ встречается не в каждом случайном ключе.
   */
  it('ключ с разделителем внутри секрета разбирается верно', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const key = generateKey(PEPPER)
      const parsed = parseKey(key.plaintext)

      expect(parsed?.keyId, key.plaintext).toBe(key.keyId)
      expect(secretMatches(parsed!.secret, key.secretHash, PEPPER), key.plaintext).toBe(true)
    }
  })

  it('идентификатор шестнадцатеричный — в нём разделителя быть не может', () => {
    expect(generateKey(PEPPER).keyId).toMatch(/^[0-9a-f]+$/)
  })

  /** Утёкший ключ должен быть опознаваем в логах и репозиториях. */
  it('префикс делает ключ узнаваемым', () => {
    expect(generateKey(PEPPER).plaintext.startsWith(`${KEY_PREFIX}_`)).toBe(true)
  })

  it('секрет в открытом виде не сохраняется — только отпечаток', () => {
    const key = generateKey(PEPPER)
    const secret = parseKey(key.plaintext)!.secret

    expect(key.secretHash).not.toContain(secret)
    expect(key.secretHash).toHaveLength(64)
  })

  it('два вызова дают разные ключи', () => {
    expect(generateKey(PEPPER).plaintext).not.toBe(generateKey(PEPPER).plaintext)
  })
})

describe('hashSecret', () => {
  it('одинаковый секрет и перец дают одинаковый отпечаток', () => {
    expect(hashSecret('секрет', PEPPER)).toBe(hashSecret('секрет', PEPPER))
  })

  /**
   * Без перца утёкшая копия таблицы позволяет подбирать секреты офлайн.
   * Перец хранится вне БД, поэтому одна лишь база бесполезна.
   */
  it('другой перец даёт другой отпечаток того же секрета', () => {
    expect(hashSecret('секрет', PEPPER)).not.toBe(
      hashSecret('секрет', 'другой-перец-32-символа!!!'),
    )
  })

  it('пустой перец отвергается, а не игнорируется', () => {
    expect(() => hashSecret('секрет', '   ')).toThrow(KeyFormatError)
  })
})

describe('parseKey', () => {
  it('разбирает корректный ключ', () => {
    const key = generateKey(PEPPER)
    expect(parseKey(key.plaintext)?.keyId).toBe(key.keyId)
  })

  it.each([
    ['пустая строка', ''],
    ['без префикса', 'abc_def'],
    ['чужой префикс', 'other_abcdef12_0123456789abcdef0123'],
    ['короткий идентификатор', 'bkc_ab_0123456789abcdef0123'],
    ['нешестнадцатеричный идентификатор', 'bkc_ZZZZZZZZ_0123456789abcdef0123'],
    ['короткий секрет', 'bkc_abcdef12_short'],
    ['нет второго разделителя', 'bkc_abcdef120123456789abcdef0123'],
  ])('отвергает %s', (_name, value) => {
    expect(parseKey(value)).toBeNull()
  })
})

describe('secretMatches', () => {
  const key = generateKey(PEPPER)
  const secret = parseKey(key.plaintext)!.secret

  it('верный секрет совпадает', () => {
    expect(secretMatches(secret, key.secretHash, PEPPER)).toBe(true)
  })

  it('неверный секрет не совпадает', () => {
    expect(secretMatches('не-тот-секрет', key.secretHash, PEPPER)).toBe(false)
  })

  it('верный секрет с чужим перцем не совпадает', () => {
    expect(secretMatches(secret, key.secretHash, 'другой-перец-32-символа!!!')).toBe(false)
  })

  it('отпечаток другой длины не роняет сравнение', () => {
    expect(secretMatches(secret, 'короткий', PEPPER)).toBe(false)
  })
})

describe('extractBearer', () => {
  it('извлекает ключ', () => {
    expect(extractBearer('Bearer bkc_abc_def')).toBe('bkc_abc_def')
  })

  it('схема нечувствительна к регистру', () => {
    expect(extractBearer('bearer bkc_abc_def')).toBe('bkc_abc_def')
  })

  it.each([null, '', 'bkc_abc_def', 'Basic bkc_abc_def', 'Bearer', 'Bearer a b'])(
    'отвергает %s',
    (header) => {
      expect(extractBearer(header)).toBeNull()
    },
  )
})

describe('скоупы', () => {
  it('перечень скоупов известен', () => {
    expect(DELIVERY_SCOPES).toContain('delivery:read')
  })

  it('неизвестный скоуп отбрасывается', () => {
    expect(normalizeScopes(['delivery:read', 'выдумка'])).toEqual(['delivery:read'])
  })

  it('повторы схлопываются', () => {
    expect(normalizeScopes(['delivery:read', 'delivery:read'])).toEqual(['delivery:read'])
  })

  it('разбирает форму, в которой хранит Payload', () => {
    expect(normalizeScopes([{ scope: 'preview:read' }])).toEqual(['preview:read'])
  })

  /** Расширяющего скоупа «все» нет намеренно: он немедленно оказался бы у всех. */
  it('нет скоупа, дающего всё', () => {
    expect(DELIVERY_SCOPES.some((scope) => isDeliveryScope(scope) && scope.endsWith(':*'))).toBe(
      false,
    )
    expect(hasScope(['delivery:read'], 'terminal:read')).toBe(false)
  })
})

describe('authorizeDeliveryRequest', () => {
  const key = generateKey(PEPPER)

  function stored(overrides: Partial<StoredKey> = {}): StoredKey {
    return {
      keyId: key.keyId,
      secretHash: key.secretHash,
      scopes: ['delivery:read'],
      siteIds: ['site-1'],
      isActive: true,
      expiresAt: null,
      ...overrides,
    }
  }

  function authorize(overrides: Partial<Parameters<typeof authorizeDeliveryRequest>[0]> = {}) {
    return authorizeDeliveryRequest({
      authorizationHeader: `Bearer ${key.plaintext}`,
      stored: stored(),
      requiredScope: 'delivery:read',
      siteId: 'site-1',
      pepper: PEPPER,
      ...overrides,
    })
  }

  it('корректный запрос разрешается', () => {
    expect(authorize()).toEqual({ kind: 'allow', keyId: key.keyId, siteIds: ['site-1'] })
  })

  it.each([
    ['нет заголовка', { authorizationHeader: null }, 'missing-header'],
    ['кривой ключ', { authorizationHeader: 'Bearer мусор' }, 'malformed-key'],
    ['ключ не найден', { stored: null }, 'unknown-key'],
    ['отключён', { stored: stored({ isActive: false }) }, 'inactive'],
    ['без привязки', { stored: stored({ siteIds: [] }) }, 'no-site-binding'],
    ['нет скоупа', { requiredScope: 'terminal:read' as const }, 'missing-scope'],
    ['чужой сайт', { siteId: 'site-2' }, 'site-not-allowed'],
  ])('отказывает: %s', (_name, overrides, reason) => {
    const decision = authorize(overrides)

    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') expect(decision.reason).toBe(reason)
  })

  it('неверный секрет отклоняется', () => {
    const other = generateKey(PEPPER)
    const decision = authorize({ authorizationHeader: `Bearer ${other.plaintext}` })

    expect(decision).toEqual({ kind: 'deny', reason: 'bad-secret' })
  })

  it('истёкший ключ отклоняется', () => {
    const decision = authorize({
      stored: stored({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }),
      now: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(decision).toEqual({ kind: 'deny', reason: 'expired' })
  })

  it('ключ, действительный до будущей даты, работает', () => {
    const decision = authorize({
      stored: stored({ expiresAt: new Date('2030-01-01T00:00:00.000Z') }),
      now: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(decision.kind).toBe('allow')
  })

  /**
   * Порядок проверок значим: права проверяются ПОСЛЕ секрета. Иначе ответ на
   * верный и неверный ключ различается, и по этому различию ключ подбирают.
   */
  it('неверный секрет отклоняется раньше, чем проверяются права', () => {
    const other = generateKey(PEPPER)
    const decision = authorizeDeliveryRequest({
      authorizationHeader: `Bearer ${other.plaintext}`,
      stored: stored({ isActive: false, siteIds: [], scopes: [] }),
      requiredScope: 'delivery:read',
      siteId: 'site-1',
      pepper: PEPPER,
    })

    expect(decision).toEqual({ kind: 'deny', reason: 'bad-secret' })
  })
})
