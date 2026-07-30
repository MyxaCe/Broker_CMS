#!/usr/bin/env node
/**
 * Приводит сгенерированные Payload миграции к правилам проекта.
 *
 * Payload генерирует файл миграции по своему шаблону, который не проходит наши
 * проверки по двум причинам (см. BUG-001):
 *
 *  1. типы `MigrateUpArgs` и `MigrateDownArgs` импортируются обычным `import`.
 *     При `verbatimModuleSyntax: true` esbuild сохраняет импорт дословно, и в
 *     рантайме Node ищет несуществующий экспорт — миграция падает ещё до
 *     подключения к БД;
 *  2. в сигнатуры попадают `payload` и `req`, которые в теле не используются, —
 *     их отклоняют `noUnusedParameters` и линтер.
 *
 * Скрипт идемпотентен: повторный запуск ничего не меняет.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = path.resolve(fileURLToPath(new URL('../src/migrations', import.meta.url)))

/**
 * Без якорей на начало и конец строки намеренно: файл может прийти с BOM или
 * с CRLF, и якоря тогда молча перестают совпадать — скрипт отработает «успешно»,
 * ничего не исправив. Строка достаточно характерная, чтобы искать её как есть.
 */
const VALUE_IMPORT =
  /import \{ MigrateUpArgs, MigrateDownArgs, sql \} from '@payloadcms\/db-postgres'/

const TYPED_IMPORT = [
  "import { sql } from '@payloadcms/db-postgres'",
  '',
  "import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'",
].join('\n')

const UNUSED_PARAMS = /\{ db, payload, req \}: Migrate(Up|Down)Args/g

let changed = 0

for (const entry of readdirSync(MIGRATIONS_DIR)) {
  if (!entry.endsWith('.ts') || entry === 'index.ts') continue

  const file = path.join(MIGRATIONS_DIR, entry)
  const before = readFileSync(file, 'utf8')

  const after = before
    .replace(VALUE_IMPORT, TYPED_IMPORT)
    .replace(UNUSED_PARAMS, '{ db }: Migrate$1Args')

  if (after !== before) {
    writeFileSync(file, after, 'utf8')
    process.stdout.write(`приведена к правилам проекта: ${entry}\n`)
    changed += 1
  }
}

if (changed === 0) {
  process.stdout.write('миграции уже соответствуют правилам проекта\n')
}
