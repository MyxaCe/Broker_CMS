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

describe('scanRouteFiles', () => {
  it('возвращает пустой список для несуществующего каталога', () => {
    expect(scanRouteFiles(path.join(APP_DIR, 'нет-такого-каталога'))).toEqual([])
  })
})
