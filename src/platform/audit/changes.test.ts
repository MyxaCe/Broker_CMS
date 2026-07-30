import { describe, expect, it } from 'vitest'

import {
  computeChanges,
  isSensitiveField,
  normalizeAuditValue,
  REDACTED,
  summarizeChanges,
} from './changes'

describe('normalizeAuditValue — связи не тащат чужие документы в журнал', () => {
  const populated = {
    id: 2,
    slug: 'apex-eu',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    parent: { id: 1, slug: 'apex', createdAt: '2026-07-01T00:00:00.000Z' },
  }

  it('развёрнутый документ сворачивается до идентификатора', () => {
    expect(normalizeAuditValue(populated)).toBe(2)
  })

  it('вложенный документ тоже не попадает в журнал', () => {
    expect(JSON.stringify(normalizeAuditValue({ parent: populated }))).not.toContain('apex-eu')
  })

  it('строки массива сохраняются целиком — у них нет служебных дат', () => {
    expect(normalizeAuditValue([{ id: 'row-1', code: 'de' }])).toEqual([
      { id: 'row-1', code: 'de' },
    ])
  })

  it('обычная группа не трогается', () => {
    expect(normalizeAuditValue({ mode: 'override', value: 'de-bafin' })).toEqual({
      mode: 'override',
      value: 'de-bafin',
    })
  })

  it.each([null, undefined, 'строка', 42, true])('оставляет %s как есть', (value) => {
    expect(normalizeAuditValue(value)).toBe(value)
  })
})

describe('isSensitiveField', () => {
  it.each([
    'password',
    'newPassword',
    'salt',
    'hash',
    'apiKey',
    'API_KEY',
    'previewSecret',
    'refreshToken',
    'deliveryKeyPepper',
    // Одно и то же поле приходит в разном оформлении: код, колонки БД, внешние ответы.
    'api_key',
    'API-KEY',
    'PAYLOAD_SECRET',
    'password_hash',
  ])('распознаёт "%s" как чувствительное', (field) => {
    expect(isSensitiveField(field)).toBe(true)
  })

  it.each(['email', 'fullName', 'role', 'slug', 'jurisdiction'])(
    'не считает "%s" чувствительным',
    (field) => {
      expect(isSensitiveField(field)).toBe(false)
    },
  )
})

describe('computeChanges — сокрытие секретов', () => {
  it('никогда не пишет значение чувствительного поля', () => {
    const changes = computeChanges({ password: 'старый-пароль' }, { password: 'новый-пароль' })

    expect(changes).toEqual([{ field: 'password', before: REDACTED, after: REDACTED }])
  })

  it('но фиксирует сам факт изменения — иначе смену пароля не расследовать', () => {
    const changes = computeChanges({ password: 'a' }, { password: 'b' })
    expect(changes.map((change) => change.field)).toContain('password')
  })

  it('ни одно значение секрета не утекает в результат', () => {
    const changes = computeChanges(
      { apiKey: 'ключ-1', salt: 'соль-1' },
      { apiKey: 'ключ-2', salt: 'соль-2' },
    )

    expect(JSON.stringify(changes)).not.toContain('ключ-')
    expect(JSON.stringify(changes)).not.toContain('соль-')
  })
})

describe('computeChanges — что попадает в журнал', () => {
  it('фиксирует изменившееся поле', () => {
    expect(computeChanges({ role: 'editor' }, { role: 'compliance' })).toEqual([
      { field: 'role', before: 'editor', after: 'compliance' },
    ])
  })

  it('не фиксирует неизменившееся', () => {
    expect(computeChanges({ role: 'editor' }, { role: 'editor' })).toEqual([])
  })

  it('сравнивает вложенные структуры по содержимому', () => {
    const before = { jurisdiction: { mode: 'override', value: 'de-bafin' } }
    const after = { jurisdiction: { mode: 'override', value: 'de-bafin' } }

    expect(computeChanges(before, after)).toEqual([])
  })

  it('замечает изменение внутри вложенной структуры', () => {
    const changes = computeChanges(
      { jurisdiction: { mode: 'inherit' } },
      { jurisdiction: { mode: 'override', value: 'de-bafin' } },
    )

    expect(changes).toHaveLength(1)
    expect(changes[0]?.field).toBe('jurisdiction')
  })

  it('при создании фиксирует заполненные поля', () => {
    const changes = computeChanges(null, { slug: 'apex-de', kind: 'site' })

    expect(changes).toEqual([
      { field: 'kind', before: undefined, after: 'site' },
      { field: 'slug', before: undefined, after: 'apex-de' },
    ])
  })

  it('поля отсортированы — журнал не должен зависеть от порядка ключей', () => {
    const changes = computeChanges(null, { zeta: 1, alpha: 2, mid: 3 })
    expect(changes.map((change) => change.field)).toEqual(['alpha', 'mid', 'zeta'])
  })
})

describe('computeChanges — шум', () => {
  it.each(['id', 'collection', 'createdAt', 'updatedAt', 'loginAttempts', 'lockUntil', 'sessions'])(
    'игнорирует служебное поле "%s"',
    (field) => {
      expect(computeChanges({ [field]: 'a' }, { [field]: 'b' })).toEqual([])
    },
  )

  it('смена связи записывается идентификаторами, а не документами', () => {
    const changes = computeChanges(
      { parent: { id: 1, slug: 'apex', createdAt: 'x' } },
      { parent: { id: 2, slug: 'apex-eu', createdAt: 'y' } },
    )

    expect(changes).toEqual([{ field: 'parent', before: 1, after: 2 }])
  })

  it('не считает изменением переход между пустыми значениями', () => {
    expect(computeChanges({ note: null }, { note: undefined })).toEqual([])
    expect(computeChanges({}, { note: null })).toEqual([])
  })

  it('заполнение пустого поля — изменение', () => {
    expect(computeChanges({ note: null }, { note: 'текст' })).toEqual([
      { field: 'note', before: null, after: 'текст' },
    ])
  })
})

describe('summarizeChanges', () => {
  it('перечисляет поля', () => {
    expect(
      summarizeChanges([
        { field: 'slug', before: 'a', after: 'b' },
        { field: 'kind', before: 'x', after: 'y' },
      ]),
    ).toBe('slug, kind')
  })

  it('схлопывает длинный список', () => {
    const changes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((field) => ({
      field,
      before: 1,
      after: 2,
    }))

    expect(summarizeChanges(changes)).toBe('a, b, c, d, e и ещё 2')
  })

  it('сообщает об отсутствии изменений явно', () => {
    expect(summarizeChanges([])).toBe('без изменений')
  })
})
