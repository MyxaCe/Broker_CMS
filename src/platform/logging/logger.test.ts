import { Writable } from 'node:stream'

import pino from 'pino'
import { describe, expect, it } from 'vitest'

import { loggerOptions } from './logger'

/**
 * Журнал — это место, где секрет оказывается случайно: его никто не пишет
 * туда намеренно, он приезжает внутри объекта, который «просто залогировали».
 *
 * Проверяются **настоящие** настройки журнала: логгер собирается ровно из них,
 * но пишет в память. Копия настроек проверяла бы саму себя.
 */

function capture(): { logger: pino.Logger; lines: () => Record<string, unknown>[] } {
  const written: string[] = []

  const sink = new Writable({
    write(chunk, _encoding, done) {
      written.push(String(chunk))
      done()
    },
  })

  return {
    logger: pino({ ...loggerOptions(), level: 'trace' }, sink),
    lines: () => written.map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

describe('журнал не пропускает секреты', () => {
  it.each(['password', 'secret', 'secretHash', 'authorization', 'token', 'plaintext'])(
    'поле %s скрывается',
    (field) => {
      const { logger, lines } = capture()

      logger.info({ [field]: 'НАСТОЯЩЕЕ-ЗНАЧЕНИЕ' }, 'проверка')

      const dump = JSON.stringify(lines())
      expect(dump).not.toContain('НАСТОЯЩЕЕ-ЗНАЧЕНИЕ')
      expect(dump).toContain('[скрыто]')
    },
  )

  /**
   * Секрет чаще приходит внутри «контекста», чем отдельным аргументом — именно
   * так он и утекает: логируют объект целиком, не глядя на его состав.
   */
  it('скрывает и во вложенном объекте', () => {
    const { logger, lines } = capture()

    logger.info({ ключ: { secretHash: 'НАСТОЯЩЕЕ-ЗНАЧЕНИЕ' } }, 'проверка')

    expect(JSON.stringify(lines())).not.toContain('НАСТОЯЩЕЕ-ЗНАЧЕНИЕ')
  })

  it('обычные поля не трогает', () => {
    const { logger, lines } = capture()

    logger.info({ site: 'apex-de', released: 42 }, 'проверка')

    expect(lines()[0]).toMatchObject({ site: 'apex-de', released: 42 })
  })
})

describe('форма записи', () => {
  it('время в ISO, а не в миллисекундах эпохи', () => {
    const { logger, lines } = capture()

    logger.info({}, 'проверка')

    expect(String(lines()[0]?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  /** Запись без источника невозможно ни отфильтровать, ни отнести к чему-либо. */
  it('постоянные поля попадают в каждую запись', () => {
    const { logger, lines } = capture()
    const child = logger.child({ component: 'проверка' })

    child.info({}, 'раз')
    child.warn({}, 'два')

    expect(lines().every((line) => line.component === 'проверка')).toBe(true)
  })
})
