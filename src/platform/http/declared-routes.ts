import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Инвентаризация HTTP-поверхностей.
 *
 * ТЗ разд. 3 и 13: наружу смотрит ровно одна дверь — версионированный API
 * доставки. Проблема в том, что в файловом роутинге новая дверь появляется
 * созданием файла: достаточно одного `route.ts`, добавленного мимоходом или
 * принесённого обновлением фреймворка, и поверхность существует, а знает о ней
 * только автор.
 *
 * Поэтому список маршрутов объявляется явно и сверяется тестом. Появился файл,
 * которого нет в списке, — CI падает и требует осознанного решения.
 */

/** Файлы, создающие HTTP-поверхность в файловом роутинге Next. */
const ROUTE_FILE_NAMES = new Set(['route.ts', 'route.tsx', 'route.js', 'page.tsx', 'page.ts'])

/**
 * Явно разрешённые маршруты. Путь указывается относительно `src/app`,
 * с прямыми слэшами.
 *
 * Каждая запись обязана иметь обоснование: кто потребитель и почему это
 * не вторая дверь к данным.
 */
export const DECLARED_ROUTE_FILES: readonly string[] = [
  // Пока пусто: приложение ещё не смонтировано.
  //
  // Планируется на M1:
  //   'v1/[...path]/route.ts'  — API доставки, единственная публичная дверь
  //   'v1/health/route.ts'     — проба живости, без данных
  //
  // Админка Payload будет смонтирована отдельной группой маршрутов и НЕ
  // является публичной поверхностью: её доступность ограничивается периметром
  // (ADR-0009).
]

export function scanRouteFiles(appDir: string): string[] {
  if (!existsSync(appDir)) {
    return []
  }

  const found: string[] = []

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(full)
      } else if (ROUTE_FILE_NAMES.has(entry.name)) {
        found.push(path.relative(appDir, full).split(path.sep).join('/'))
      }
    }
  }

  walk(appDir)
  return found.sort()
}
