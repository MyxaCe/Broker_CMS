import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * Среда интеграционного прогона обязана давать то, чем прогон пользуется.
 *
 * Заведено по CMS-19. Прогон на `main` краснел с 19.10 тремя заходами подряд,
 * и красным был шаг с именем «Изоляция тенантов». Изоляция была цела: падали
 * два набора из двадцати шести, потому что с 06.10 они создают документы
 * `media` — то есть грузят файл в S3, — а задание `integration` объектного
 * хранилища не поднимало вовсе. Отказ назывался чужим именем и указывал на
 * регуляторную границу, которая не ломалась.
 *
 * Класс дефекта: **переменная называет адрес, которого в задании никто не
 * слушает**. Снаружи это выглядит как падение того, что шаг называет.
 *
 * Проверка читает сам файл рабочего процесса — единственный источник правды о
 * том, что поднимается в прогоне, — и сверяет две стороны: адреса `localhost`
 * в `env` задания и порты, объявленные в том же задании службой или
 * контейнером шага.
 *
 * **Чего она не ловит, названо вслух:** новый набор, которому нужна служба, но
 * который не добавил переменную с её адресом, здесь не виден. Сверяется
 * объявленное с объявленным, а не желаемое с объявленным.
 */

const WORKFLOW = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

/**
 * Адреса, ведущие в пустоту **сознательно**. Запись без причины запрещена:
 * «нельзя, потому что нельзя» обходят первыми, а молчаливое исключение — это
 * способ, которым дыра живёт годами.
 */
const UNREACHABLE_BY_DESIGN: Readonly<Record<string, string>> = {
  APP_PUBLIC_URL:
    'адрес самого приложения; в интеграционном прогоне оно не поднимается, обращений по нему нет',
  MDS_HTTP_URL:
    'MDS интеграционным набором не опрашивается — синхронных обращений к нему нет по ТЗ 4.2; ' +
    'проверено прогоном 21.10: набор зелёный при мёртвом адресе MDS и живом хранилище',
}

/** Срез задания по его ключу: от строки `  <job>:` до следующего ключа того же отступа. */
function jobBlock(workflow: string, job: string): string {
  const lines = workflow.split(/\r?\n/)
  const start = lines.findIndex((line) => line === `  ${job}:`)
  if (start < 0) return ''

  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^ {2}\S/.test(line))

  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

/** Срез блока `env:` внутри задания. Отступ фиксирован схемой рабочего процесса. */
function envBlock(block: string): string {
  const lines = block.split('\n')
  const start = lines.findIndex((line) => line === '    env:')
  if (start < 0) return ''

  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.trim() !== '' && !/^ {6}/.test(line))

  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

interface Address {
  readonly name: string
  readonly port: number
}

/** Переменные задания, чьё значение указывает на порт локальной машины. */
function localAddresses(block: string): Address[] {
  const found: Address[] = []

  for (const line of envBlock(block).split('\n')) {
    const declaration = /^ {6}(?<name>[A-Z][A-Z0-9_]*): (?<value>.+)$/.exec(line)
    const name = declaration?.groups?.name
    const value = declaration?.groups?.value
    if (name === undefined || value === undefined) continue

    for (const match of value.matchAll(/(?:localhost|127\.0\.0\.1):(\d+)/g)) {
      found.push({ name, port: Number(match[1]) })
    }
  }

  return found
}

/**
 * Порты, которые задание действительно открывает: отображение службы
 * (`- 9000:9000`) и публикация контейнера, поднятого шагом (`-p 9000:9000`).
 * Второе существует потому, что `services:` не умеет передавать команду
 * контейнеру, а образу MinIO нужна `server /data`.
 */
function declaredPorts(block: string): number[] {
  const ports = new Set<number>()

  for (const line of block.split('\n')) {
    const service = /^\s*- (\d+):\d+\s*$/.exec(line)
    if (service) ports.add(Number(service[1]))

    for (const published of line.matchAll(/-p (\d+):\d+/g)) {
      ports.add(Number(published[1]))
    }
  }

  return [...ports].sort((a, b) => a - b)
}

/** Адреса, за которыми в задании никто не стоит и которые не объявлены пустыми. */
function unbacked(block: string, allowed: Readonly<Record<string, string>>): Address[] {
  const open = new Set(declaredPorts(block))

  return localAddresses(block).filter(
    (address) => !(address.name in allowed) && !open.has(address.port),
  )
}

const INTEGRATION = jobBlock(WORKFLOW, 'integration')

describe('среда интеграционного прогона', () => {
  /**
   * Сначала доказывается, что разбор дошёл до файла. Сломанный срез дал бы
   * пустые множества и безупречно зелёную проверку, которая не смотрит никуда.
   */
  it('разбор видит задание, его переменные и его порты', () => {
    expect(INTEGRATION, 'задание integration не найдено в ci.yml').not.toBe('')

    const names = localAddresses(INTEGRATION).map((address) => address.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'DATABASE_URL',
        'REDIS_URL',
        'BUS_URL',
        'S3_ENDPOINT',
        'MEDIA_PUBLIC_URL',
      ]),
    )

    expect(declaredPorts(INTEGRATION)).toEqual(expect.arrayContaining([5432, 5672, 6379, 9090]))
  })

  it('у каждого адреса localhost есть открытый порт в том же задании', () => {
    const findings = unbacked(INTEGRATION, UNREACHABLE_BY_DESIGN)

    expect(
      findings.map((address) => `${address.name} → localhost:${address.port}`),
      'переменная называет адрес, которого в прогоне никто не слушает',
    ).toEqual([])

    // Охват объявляется числом, и единица названа: переменные с адресом.
    expect(localAddresses(INTEGRATION).length).toBeGreaterThanOrEqual(5)
  })

  /**
   * Список исключений — данные, и мёртвая запись в нём опаснее отсутствующей:
   * она выглядит работающей и ничего не делает. Каждое исключение обязано
   * относиться к существующей переменной.
   */
  it('каждое исключение относится к существующей переменной', () => {
    const names = new Set(localAddresses(INTEGRATION).map((address) => address.name))

    for (const name of Object.keys(UNREACHABLE_BY_DESIGN)) {
      expect(names.has(name), `исключение «${name}» не относится ни к одной переменной`).toBe(true)
    }
  })

  /**
   * Парная проверка: инструмент, объявляющий всё негодным, бесполезен ровно
   * так же, как тот, что всё объявляет годным. Образцы синтетические — на них
   * видно, что проверка умеет и отвергать, и принимать.
   */
  describe('сама проверка', () => {
    const complete = [
      '    services:',
      '      store:',
      '        ports:',
      '          - 9000:9000',
      '    env:',
      '      S3_ENDPOINT: http://localhost:9000',
      '    steps:',
      '      - run: pnpm run test:integration',
    ].join('\n')

    const missing = complete.replace('          - 9000:9000\n', '')

    it('принимает задание, где служба объявлена', () => {
      expect(unbacked(complete, {})).toEqual([])
    })

    it('отвергает задание, где службы нет', () => {
      expect(unbacked(missing, {})).toEqual([{ name: 'S3_ENDPOINT', port: 9000 }])
    })

    it('принимает отсутствие службы, названное исключением', () => {
      expect(unbacked(missing, { S3_ENDPOINT: 'причина' })).toEqual([])
    })

    it('видит порт, открытый контейнером шага, а не только службой', () => {
      const byStep = [
        '    env:',
        '      S3_ENDPOINT: http://localhost:9000',
        '    steps:',
        '      - run: docker run -d --name ci-minio -p 9000:9000 minio',
      ].join('\n')

      expect(unbacked(byStep, {})).toEqual([])
    })
  })
})

/**
 * Растяжка, а не проверка корректности: она закрепляет **решение**, а не
 * поведение. Шаг гонит весь набор, и имя обязано называть набор, а не один его
 * файл. Тот, кто вздумает снова назвать шаг именем одной проверки, увидит
 * красное и вспомнит, почему так нельзя: три дня отказ в наборе читался как
 * нарушение границы между тенантами.
 */
describe('имя шага не утверждает больше, чем шаг знает', () => {
  it('шаг, зовущий весь интеграционный набор, назван набором', () => {
    const lines = INTEGRATION.split('\n')
    const run = lines.findIndex((line) => line.includes('run: pnpm run test:integration'))

    expect(run, 'шаг с интеграционным прогоном исчез из задания').toBeGreaterThan(0)

    const name = [...lines.slice(0, run)].reverse().find((line) => line.includes('- name:'))

    expect(name, 'у шага нет имени').toBeDefined()
    expect(name).toContain('Интеграционный')
  })
})
