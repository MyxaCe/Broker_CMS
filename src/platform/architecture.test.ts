import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * Границы модулей — не соглашение, а исполняемое правило (ТЗ разд. 9, TASK-003).
 *
 * Эти тесты прогоняют линтер по синтетическим файлам и проверяют, что нарушение
 * границы действительно ловится. Без них правило живёт до первого рефакторинга
 * конфигурации: кто-то случайно ослабит паттерн, и никто не заметит.
 */

const eslint = new ESLint()

async function violations(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false })
  return (result?.messages ?? [])
    .filter((message) => message.severity === 2)
    .map((message) => `${message.ruleId ?? 'unknown'}: ${message.message}`)
}

describe('границы модулей', () => {
  it('запрещает импорт внутренностей чужого модуля', async () => {
    const found = await violations(
      `import { thing } from '@/modules/design/internal/tokens'\nexport const use = thing\n`,
      'src/modules/stream/example.ts',
    )
    expect(found.join('\n')).toMatch(/no-restricted-imports/)
  })

  it('разрешает импорт публичного интерфейса модуля', async () => {
    const found = await violations(
      `import { MODULE_NAME } from '@/modules/design'\nexport const use = MODULE_NAME\n`,
      'src/modules/stream/example.ts',
    )
    expect(found).toEqual([])
  })

  it('запрещает доменному модулю знать о delivery', async () => {
    const found = await violations(
      `import { MODULE_NAME } from '@/modules/delivery'\nexport const use = MODULE_NAME\n`,
      'src/modules/trading/example.ts',
    )
    expect(found.join('\n')).toMatch(/no-restricted-imports/)
  })

  it('разрешает delivery читать доменные модули', async () => {
    const found = await violations(
      `import { MODULE_NAME } from '@/modules/trading'\nexport const use = MODULE_NAME\n`,
      'src/modules/delivery/example.ts',
    )
    expect(found).toEqual([])
  })

  it('запрещает platform зависеть от модулей', async () => {
    const found = await violations(
      `import { MODULE_NAME } from '@/modules/stream'\nexport const use = MODULE_NAME\n`,
      'src/platform/example.ts',
    )
    expect(found.join('\n')).toMatch(/no-restricted-imports/)
  })
})

describe('единственная точка чтения окружения', () => {
  it('запрещает process.env вне модуля конфигурации', async () => {
    const found = await violations(
      `export const url = process.env.DATABASE_URL\n`,
      'src/modules/delivery/example.ts',
    )
    expect(found.join('\n')).toMatch(/no-restricted-syntax/)
  })

  it('разрешает process.env в src/platform/config/env.ts', async () => {
    const found = await violations(
      `export const source = process.env\n`,
      'src/platform/config/env.ts',
    )
    expect(found).toEqual([])
  })
})
