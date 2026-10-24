import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * Прогон обязан запускаться на пуш в любую ветку.
 *
 * Заведено по CMS-18. До правки все 50 прогонов репозитория с 30.07 были на
 * `main` по событию `push`: веток прогон не видел вовсе, то есть работа
 * проверялась **после** слияния. Автор узнавал о своей ошибке последним, а
 * чинил уже в общей истории.
 *
 * Проверка читает сам файл рабочего процесса и спрашивает не «есть ли там
 * строка про ветки», а **пройдёт ли через фильтр имя обычной ветки задачи**.
 * Разница существенная: `branches: [main]` — тоже строка про ветки.
 */

const WORKFLOW = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

/** Имя, по которому называются ветки задач в этом репозитории (ПРАВИЛА, «Git и публикация»). */
const TASK_BRANCH = 'cms-19-krasnyj-progon-na-main'

/**
 * Образец фильтра веток GitHub переводится в предикат, а не сравнивается
 * текстом: `**`, `*` и литерал ведут себя по-разному, и именно поведение
 * решает, попадёт ветка в прогон или нет.
 */
function matchesBranch(pattern: string, branch: string): boolean {
  /**
   * Деление по `**` вместо подстановки метки-разделителя: приём «символ
   * заведомо вне алфавита» у нас уже оборачивался файлами, невидимыми для
   * поиска и диффа, и запрещён линтером внутри выражений.
   */
  const expression = pattern
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('.*')

  return new RegExp(`^${expression}$`).test(branch)
}

/**
 * Образцы веток для события из блока `on:`. Поддержаны обе формы записи —
 * поточная (`branches: [main]`) и блочная (`branches:` + список), — потому
 * что шаблон, знающий одну форму, молчит при любом поведении другой.
 */
function branchPatterns(workflow: string, event: string): string[] {
  const lines = workflow.split(/\r?\n/)

  const on = lines.findIndex((line) => line === 'on:')
  if (on < 0) return []

  const rest = lines.slice(on + 1)
  const end = rest.findIndex((line) => line.trim() !== '' && !/^\s/.test(line))
  const block = end < 0 ? rest : rest.slice(0, end)

  const start = block.findIndex((line) => line === `  ${event}:`)
  if (start < 0) return []

  const patterns: string[] = []
  let inList = false

  for (const line of block.slice(start + 1)) {
    if (/^ {2}\S/.test(line)) break

    const inline = /^ {4}branches: \[(.+)\]\s*$/.exec(line)
    if (inline?.[1]) {
      for (const item of inline[1].split(','))
        patterns.push(item.trim().replace(/^['"]|['"]$/g, ''))
      continue
    }

    if (/^ {4}branches:\s*$/.test(line)) {
      inList = true
      continue
    }

    const item = /^ {6}- (.+)$/.exec(line)
    if (inList && item?.[1]) {
      patterns.push(item[1].trim().replace(/^['"]|['"]$/g, ''))
      continue
    }

    if (/^ {4}\S/.test(line)) inList = false
  }

  return patterns
}

const PUSH = branchPatterns(WORKFLOW, 'push')

describe('что запускает прогон', () => {
  /**
   * Сначала доказывается, что разбор дошёл до файла: пустой список образцов
   * дал бы безупречно зелёную проверку, которая не смотрит никуда.
   */
  it('разбор видит образцы веток события push', () => {
    expect(PUSH.length, 'образцы веток для push не найдены в ci.yml').toBeGreaterThan(0)
  })

  it('ветка задачи попадает в прогон', () => {
    expect(
      PUSH.some((pattern) => matchesBranch(pattern, TASK_BRANCH)),
      `ни один образец ${JSON.stringify(PUSH)} не пропускает ветку «${TASK_BRANCH}»: ` +
        'работа проверяется только после слияния',
    ).toBe(true)
  })

  it('основная ветка из прогона не выпала', () => {
    expect(PUSH.some((pattern) => matchesBranch(pattern, 'main'))).toBe(true)
  })

  /**
   * Парная проверка: инструмент, пропускающий всё, бесполезен так же, как
   * тот, что всё отвергает. Образцы синтетические — на них видно, что
   * предикат умеет и пропускать, и не пропускать.
   */
  describe('сам предикат', () => {
    it('литерал пропускает только себя', () => {
      expect(matchesBranch('main', 'main')).toBe(true)
      expect(matchesBranch('main', 'cms-19-x')).toBe(false)
    })

    it('одна звезда не переходит через косую черту, две переходят', () => {
      expect(matchesBranch('feature/*', 'feature/a')).toBe(true)
      expect(matchesBranch('feature/*', 'feature/a/b')).toBe(false)
      expect(matchesBranch('**', 'feature/a/b')).toBe(true)
    })

    it('разбор читает блочную форму списка так же, как поточную', () => {
      const block = [
        'on:',
        '  push:',
        '    branches:',
        '      - main',
        '      - release/*',
        '',
      ].join('\n')

      expect(branchPatterns(block, 'push')).toEqual(['main', 'release/*'])
    })

    it('разбор не путает события между собой', () => {
      const two = [
        'on:',
        '  push:',
        "    branches: ['**']",
        '  pull_request:',
        '    branches: [main]',
        '',
      ].join('\n')

      expect(branchPatterns(two, 'push')).toEqual(['**'])
      expect(branchPatterns(two, 'pull_request')).toEqual(['main'])
    })
  })
})
