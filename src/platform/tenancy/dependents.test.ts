import { describe, expect, it } from 'vitest'

import { describeDependents, findDependentCollections } from './dependents'

import type { CollectionConfig } from 'payload'

/**
 * Вывод перечня зависимостей из конфигурации ([[DEBT-010]]).
 *
 * Список отставал от новых коллекций четыре раза подряд. Здесь проверяется не
 * «функция работает», а то, ради чего она заменила список: коллекция попадает
 * в перечень **самим фактом** обязательной связи с тенантом.
 */

function collection(slug: string, fields: unknown[]): CollectionConfig {
  return { slug, fields } as CollectionConfig
}

const REQUIRED_RELATION = {
  name: 'site',
  type: 'relationship',
  relationTo: 'tenants',
  required: true,
}

describe('вывод зависимостей', () => {
  it('находит обязательную связь с тенантом', () => {
    const found = findDependentCollections([collection('articles', [REQUIRED_RELATION])])

    expect(found).toEqual([{ collection: 'articles', field: 'site', label: 'материалы' }])
  })

  /** Необязательная связь обнуляется без ошибки — отказывать не за что. */
  it('необязательную связь пропускает', () => {
    const found = findDependentCollections([
      collection('optional', [{ ...REQUIRED_RELATION, required: false }]),
    ])

    expect(found).toEqual([])
  })

  it('связь на другую коллекцию пропускает', () => {
    const found = findDependentCollections([
      collection('other', [{ ...REQUIRED_RELATION, relationTo: 'media' }]),
    ])

    expect(found).toEqual([])
  })

  it('связь на несколько коллекций учитывается, если среди них тенанты', () => {
    const found = findDependentCollections([
      collection('multi', [{ ...REQUIRED_RELATION, relationTo: ['media', 'tenants'] }]),
    ])

    expect(found).toHaveLength(1)
  })

  /** Тенант ссылается на родителя — это дерево, а не зависимость. */
  it('сам тенант в перечень не попадает', () => {
    const found = findDependentCollections([
      collection('tenants', [{ ...REQUIRED_RELATION, name: 'parent' }]),
    ])

    expect(found).toEqual([])
  })

  it('поле с другим именем находится наравне с «site»', () => {
    const found = findDependentCollections([
      collection('design-roles', [{ ...REQUIRED_RELATION, name: 'owner' }]),
    ])

    expect(found[0]?.field).toBe('owner')
  })

  /** Забытая подпись хуже читается, но ничего не ломает. */
  it('коллекция без подписи получает своё имя', () => {
    const found = findDependentCollections([collection('новая', [REQUIRED_RELATION])])

    expect(found[0]?.label).toBe('новая')
  })

  it('пустая конфигурация даёт пустой перечень', () => {
    expect(findDependentCollections([])).toEqual([])
  })
})

describe('сообщение об отказе', () => {
  it('называет и что мешает, и сколько', () => {
    const message = describeDependents([
      { label: 'материалы', count: 3 },
      { label: 'страницы', count: 1 },
    ])

    expect(message).toContain('материалы: 3')
    expect(message).toContain('страницы: 1')
    expect(message).toContain('отключите тенант вместо удаления')
  })
})
