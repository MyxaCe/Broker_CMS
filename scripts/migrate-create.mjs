#!/usr/bin/env node
/**
 * Создание миграции: генерация → приведение к правилам проекта → форматирование.
 *
 * Отдельный скрипт, а не цепочка `a && b && c` в package.json: pnpm дописывает
 * аргументы к ПОСЛЕДНЕЙ команде цепочки, поэтому имя миграции уходило в
 * prettier вместо генератора. Ошибка тихая — миграция создавалась безымянной,
 * а prettier ругался на несуществующий файл.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const name = process.argv[2]

if (!name) {
  process.stderr.write('Укажите имя миграции: pnpm run migrate:create <имя>\n')
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run(process.execPath, [
  '--env-file-if-exists=.env',
  './node_modules/payload/bin.js',
  'migrate:create',
  name,
])

run(process.execPath, ['scripts/normalize-migrations.mjs'])

run(process.execPath, ['./node_modules/prettier/bin/prettier.cjs', '--write', 'src/migrations'])
