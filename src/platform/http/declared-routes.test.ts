import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DECLARED_ROUTE_FILES, scanRouteFiles } from './declared-routes'

const APP_DIR = path.resolve(fileURLToPath(new URL('../../app', import.meta.url)))

describe('инвентаризация HTTP-поверхностей', () => {
  it('не существует ни одного незадекларированного маршрута', () => {
    const actual = scanRouteFiles(APP_DIR)
    const declared = new Set(DECLARED_ROUTE_FILES)
    const undeclared = actual.filter((route) => !declared.has(route))

    expect(
      undeclared,
      'Появилась HTTP-поверхность, которой нет в DECLARED_ROUTE_FILES. ' +
        'Это либо новая дверь к данным, либо файл, попавший сюда случайно. ' +
        'Добавьте маршрут в список с обоснованием — или удалите файл.',
    ).toEqual([])
  })

  it('в списке нет маршрутов, которых больше нет на диске', () => {
    const actual = new Set(scanRouteFiles(APP_DIR))
    const stale = DECLARED_ROUTE_FILES.filter((route) => !actual.has(route))

    expect(stale, 'Список разрешённых маршрутов разошёлся с реальностью.').toEqual([])
  })
})

describe('GraphQL не смонтирован', () => {
  /**
   * ТЗ разд. 13 запрещает родной GraphQL как вторую дверь к данным. Он
   * отключён в конфигурации, но отключение можно случайно снять — а вот
   * появление файла маршрута заметить труднее. Проверяем оба конца: и то, что
   * файлов нет, и то, что их нет в списке разрешённых.
   */
  it('среди маршрутов нет ничего похожего на graphql', () => {
    const suspicious = scanRouteFiles(APP_DIR).filter((route) => /graphql/i.test(route))
    expect(suspicious).toEqual([])
  })

  it('в списке разрешённых маршрутов graphql тоже отсутствует', () => {
    expect(DECLARED_ROUTE_FILES.filter((route) => /graphql/i.test(route))).toEqual([])
  })
})

describe('scanRouteFiles', () => {
  it('возвращает пустой список для несуществующего каталога', () => {
    expect(scanRouteFiles(path.join(APP_DIR, 'нет-такого-каталога'))).toEqual([])
  })

  it('находит смонтированные маршруты админки', () => {
    const routes = scanRouteFiles(APP_DIR)
    expect(routes).toContain('(payload)/api/[...slug]/route.ts')
    expect(routes).toContain('(payload)/admin/[[...segments]]/page.tsx')
  })
})
