import { describe, expect, it } from 'vitest'

import { REDACTED } from './changes'
import { actorFrom, extraChangesOf, markAuditChange, markSecretChanged } from './record'

/**
 * Отметки в контексте запроса — механизм для изменений, которых обобщённое
 * сравнение документов не видит. Главный случай: пароль, который Payload
 * не возвращает в документе.
 */
describe('отметки изменений в контексте', () => {
  it('пустой контекст не содержит отметок', () => {
    expect(extraChangesOf({})).toEqual([])
  })

  it.each([null, undefined, 'строка', 42])('не падает на контексте %s', (context) => {
    expect(extraChangesOf(context)).toEqual([])
  })

  it('накапливает отметки, а не заменяет их', () => {
    const context: Record<string, unknown> = {}

    markAuditChange(context, { field: 'a', before: 1, after: 2 })
    markAuditChange(context, { field: 'b', before: 3, after: 4 })

    expect(extraChangesOf(context).map((change) => change.field)).toEqual(['a', 'b'])
  })

  it('секретное поле отмечается без значения', () => {
    const context: Record<string, unknown> = {}

    markSecretChanged(context, 'password')

    expect(extraChangesOf(context)).toEqual([
      { field: 'password', before: REDACTED, after: REDACTED },
    ])
  })

  it('чужие ключи контекста не затрагиваются', () => {
    const context: Record<string, unknown> = { somethingElse: 'значение' }

    markSecretChanged(context, 'password')

    expect(context.somethingElse).toBe('значение')
  })
})

describe('actorFrom', () => {
  it('разбирает пользователя', () => {
    expect(actorFrom({ id: 7, email: 'a@b.test', role: 'editor' })).toEqual({
      id: '7',
      email: 'a@b.test',
      role: 'editor',
    })
  })

  it.each([null, undefined, 'строка'])('на %s отдаёт пустое лицо, а не падает', (value) => {
    expect(actorFrom(value)).toEqual({ id: null, email: null, role: null })
  })

  it('неполные данные не выдумываются', () => {
    expect(actorFrom({ id: 1 })).toEqual({ id: '1', email: null, role: null })
  })
})
