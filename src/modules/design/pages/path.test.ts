import { describe, expect, it } from 'vitest'

import { findRedirectIssues, isValidPath, normalizePath, ROOT_PATH } from './path'

import type { RedirectRule } from './path'

describe('нормализация пути', () => {
  /**
   * `/about`, `/about/` и `/About` — один адрес для человека и три разных для
   * базы. Без приведения к одному виду уникальность не работает.
   */
  it.each([
    ['/about/', '/about'],
    ['/About', '/about'],
    ['about', '/about'],
    ['//about//us/', '/about/us'],
    ['  /about  ', '/about'],
  ])('«%s» → «%s»', (raw, expected) => {
    expect(normalizePath(raw)).toBe(expected)
  })

  it('корень остаётся корнем', () => {
    expect(normalizePath('/')).toBe(ROOT_PATH)
    expect(normalizePath('')).toBe(ROOT_PATH)
    expect(normalizePath('//')).toBe(ROOT_PATH)
  })

  it('нормализация идемпотентна', () => {
    const once = normalizePath('/About/Us/')

    expect(normalizePath(once)).toBe(once)
  })
})

describe('проверка пути', () => {
  it.each(['/', '/about', '/accounts/pro', '/o-nas-2026'])('допустим: %s', (path) => {
    expect(isValidPath(path)).toBe(true)
  })

  it.each(['/about?utm=1', '/about#top', '/про-нас', '/about us'])('недопустим: %s', (path) => {
    expect(isValidPath(path)).toBe(false)
  })
})

describe('редиректы', () => {
  function rule(from: string, to: string, status: RedirectRule['status'] = 301): RedirectRule {
    return { from, to, status }
  }

  it('прямая цепочка без циклов проходит', () => {
    expect(findRedirectIssues([rule('/a', '/b'), rule('/b', '/c')])).toEqual([])
  })

  /**
   * Цикл возникает сам собой: страницу переименовали дважды и вернули прежнее
   * имя. Браузер в цикле показывает ошибку, робот исключает адрес из индекса.
   */
  it('цикл обнаруживается', () => {
    const issues = findRedirectIssues([rule('/a', '/b'), rule('/b', '/a')])

    expect(issues.some((issue) => issue.code === 'cycle')).toBe(true)
  })

  it('длинный цикл обнаруживается', () => {
    const issues = findRedirectIssues([rule('/a', '/b'), rule('/b', '/c'), rule('/c', '/a')])

    expect(issues.some((issue) => issue.code === 'cycle')).toBe(true)
  })

  it('редирект сам на себя обнаруживается', () => {
    const issues = findRedirectIssues([rule('/a', '/a')])

    expect(issues[0]?.code).toBe('self')
  })

  it('нормализация учитывается при сравнении', () => {
    const issues = findRedirectIssues([rule('/a/', '/A')])

    expect(issues[0]?.code).toBe('self')
  })

  /** Какой сработает — зависело бы от порядка чтения из базы. */
  it('два редиректа с одного адреса — расхождение', () => {
    const issues = findRedirectIssues([rule('/a', '/b'), rule('/a', '/c')])

    expect(issues.some((issue) => issue.code === 'duplicate')).toBe(true)
  })

  /** Редирект в никуда — это 404 после лишнего перехода. */
  it('цель, которой нет среди страниц, — расхождение', () => {
    const issues = findRedirectIssues([rule('/a', '/b')], new Set(['/c']))

    expect(issues.some((issue) => issue.code === 'unknown-target')).toBe(true)
  })

  it('известная цель расхождения не даёт', () => {
    expect(findRedirectIssues([rule('/a', '/b')], new Set(['/b']))).toEqual([])
  })

  /** У «удалено навсегда» цели нет по смыслу. */
  it('410 не требует цели', () => {
    expect(findRedirectIssues([rule('/a', '/a', 410)], new Set(['/c']))).toEqual([])
  })

  it('пустой набор расхождений не даёт', () => {
    expect(findRedirectIssues([])).toEqual([])
  })
})
