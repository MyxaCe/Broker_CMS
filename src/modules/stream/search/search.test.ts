import { describe, expect, it } from 'vitest'

import {
  MAX_QUERY_LENGTH,
  MAX_SEARCH_LIMIT,
  normalizeQuery,
  normalizeSearchLimit,
  SearchError,
} from './search'
import {
  buildSearchText,
  FALLBACK_SEARCH_CONFIG,
  MAX_SEARCH_TEXT_LENGTH,
  searchConfigFor,
  truncateSearchText,
} from './text-index'

describe('конфигурация разбора по языку', () => {
  /**
   * Ради этого локаль и появилась у записи: без языка Postgres разбирает текст
   * по правилам конфигурации по умолчанию, и русское «ставки» не находится по
   * запросу «ставка».
   */
  it.each([
    ['ru', 'russian'],
    ['en', 'english'],
    ['de', 'german'],
  ])('%s → %s', (locale, config) => {
    expect(searchConfigFor(locale)).toBe(config)
  })

  /** Словари заведены по языку, а не по региону. */
  it('региональный вариант сводится к базовому языку', () => {
    expect(searchConfigFor('en-GB')).toBe('english')
    expect(searchConfigFor('pt-BR')).toBe('portuguese')
  })

  /**
   * Разбор без стемминга хуже правильного словаря, но лучше чужого: чужой
   * даёт не меньше находок, а неверные.
   */
  it.each([null, undefined, '', 'xx', 'клингонский'])(
    'неизвестный язык (%s) получает разбор без стемминга',
    (locale) => {
      expect(searchConfigFor(locale)).toBe(FALLBACK_SEARCH_CONFIG)
    },
  )
})

describe('текст для индекса', () => {
  it('собирает заголовок, анонс и тело', () => {
    const text = buildSearchText({
      title: 'Ставка повышена',
      excerpt: 'Коротко о решении',
      body: { root: { children: [{ type: 'text', text: 'Регулятор поднял ставку' }] } },
    })

    expect(text).toContain('Ставка повышена')
    expect(text).toContain('Коротко о решении')
    expect(text).toContain('Регулятор поднял ставку')
  })

  /** Грубый, но честный способ сказать «заголовок важнее»: весов у нас нет. */
  it('заголовок повторяется, чтобы весить больше', () => {
    const text = buildSearchText({ title: 'Ставка' })

    expect(text.split('Ставка').length - 1).toBe(3)
  })

  it('пустая запись даёт пустой текст', () => {
    expect(buildSearchText({})).toBe('')
    expect(buildSearchText({ title: '   ' })).toBe('')
  })

  it('описание видео тоже попадает в индекс', () => {
    expect(buildSearchText({ title: 'Разбор', description: 'Еженедельный обзор' })).toContain(
      'Еженедельный обзор',
    )
  })

  /**
   * Postgres отказывается строить вектор длиннее мегабайта, и падение
   * приходило бы при сохранении — редактор терял бы работу из-за длины текста.
   */
  it('слишком длинный текст обрезается, а не роняет сохранение', () => {
    const huge = 'слово '.repeat(200_000)

    expect(truncateSearchText(huge).length).toBe(MAX_SEARCH_TEXT_LENGTH)
    expect(truncateSearchText('коротко')).toBe('коротко')
  })
})

describe('разбор запроса', () => {
  it('обрезает пробелы и схлопывает повторы', () => {
    expect(normalizeQuery('  ставка   цб  ')).toBe('ставка цб')
  })

  /** По одной букве находится всё, и такой ответ бесполезен обеим сторонам. */
  it.each(['', ' ', 'а'])('слишком короткий запрос отвергается: «%s»', (query) => {
    expect(() => normalizeQuery(query)).toThrow(SearchError)
  })

  /** Это не запрос человека, а попытка нагрузить разбор. */
  it('слишком длинный запрос отвергается', () => {
    expect(() => normalizeQuery('а'.repeat(MAX_QUERY_LENGTH + 1))).toThrow(SearchError)
  })

  it('отсутствующий запрос отвергается', () => {
    expect(() => normalizeQuery(undefined)).toThrow(SearchError)
    expect(() => normalizeQuery(42)).toThrow(SearchError)
  })
})

describe('размер выдачи', () => {
  it('умолчание задано', () => {
    expect(normalizeSearchLimit(null)).toBeGreaterThan(0)
  })

  it('чрезмерный размер обрезается', () => {
    expect(normalizeSearchLimit(1000)).toBe(MAX_SEARCH_LIMIT)
  })

  it.each([0, -1, 2.5])('некорректный размер отвергается: %s', (limit) => {
    expect(() => normalizeSearchLimit(limit)).toThrow(SearchError)
  })
})
