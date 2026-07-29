import { describe, expect, it } from 'vitest'

import { describeEnv, EnvValidationError, loadEnv } from './env'

/**
 * Тесты закрывают критерий приёмки ТЗ: «Запуск с неполной конфигурацией невозможен».
 * Каждый негативный кейс здесь — это отказ старта, а не предупреждение в логе.
 */

const SECRET = 'x'.repeat(32)

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    APP_PUBLIC_URL: 'https://cms.example.com',
    DATABASE_URL: 'postgres://cms:pass@db:5432/broker_cms',
    REDIS_URL: 'redis://cache:6379',
    BUS_URL: 'amqp://cms:pass@bus:5672/platform',
    BUS_EXCHANGE: 'platform.events',
    S3_ENDPOINT: 'https://s3.example.com',
    S3_REGION: 'eu-central-1',
    S3_BUCKET: 'broker-cms-media',
    S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    S3_SECRET_ACCESS_KEY: SECRET,
    MEDIA_PUBLIC_URL: 'https://media.example-cdn.com',
    MDS_HTTP_URL: 'http://mds:3003',
    SENTRY_DSN: 'https://key@glitchtip.example.com/1',
    PAYLOAD_SECRET: SECRET,
    PREVIEW_SECRET: SECRET,
    DELIVERY_KEY_PEPPER: SECRET,
    TRADING_TERMS_MODE: 'unverified',
    ...overrides,
  }
}

function issuesOf(source: Record<string, string | undefined>): string[] {
  try {
    loadEnv(source)
  } catch (error) {
    if (error instanceof EnvValidationError) return [...error.issues]
    throw error
  }
  throw new Error('ожидалась EnvValidationError, но конфигурация прошла проверку')
}

describe('loadEnv — валидное окружение', () => {
  it('принимает полный набор переменных', () => {
    const env = loadEnv(validEnv())
    expect(env.NODE_ENV).toBe('test')
    expect(env.BUS_EXCHANGE).toBe('platform.events')
  })

  it('подставляет LOG_LEVEL по умолчанию — единственное поле с умолчанием', () => {
    expect(loadEnv(validEnv()).LOG_LEVEL).toBe('info')
    expect(loadEnv(validEnv({ LOG_LEVEL: 'debug' })).LOG_LEVEL).toBe('debug')
  })

  it('игнорирует посторонние переменные окружения', () => {
    expect(() => loadEnv(validEnv({ PATH: '/usr/bin', HOME: '/root' }))).not.toThrow()
  })
})

describe('loadEnv — fail-closed', () => {
  it('падает, если обязательная переменная отсутствует', () => {
    expect(issuesOf(validEnv({ PAYLOAD_SECRET: undefined }))).toContain(
      'PAYLOAD_SECRET: не задана или пуста',
    )
  })

  it('трактует пустую строку как отсутствие значения', () => {
    expect(issuesOf(validEnv({ DATABASE_URL: '' }))).toContain('DATABASE_URL: не задана или пуста')
  })

  it('трактует строку из пробелов как отсутствие значения', () => {
    expect(issuesOf(validEnv({ PREVIEW_SECRET: '   \t  ' }))).toContain(
      'PREVIEW_SECRET: не задана или пуста',
    )
  })

  it('сообщает обо ВСЕХ проблемах разом, а не о первой', () => {
    const issues = issuesOf(
      validEnv({ PAYLOAD_SECRET: undefined, REDIS_URL: undefined, BUS_EXCHANGE: '' }),
    )
    expect(issues).toHaveLength(3)
  })

  it('отвергает короткий секрет', () => {
    const issues = issuesOf(validEnv({ DELIVERY_KEY_PEPPER: 'слишком-коротко' }))
    expect(issues.join('\n')).toMatch(/DELIVERY_KEY_PEPPER.*не короче 32/)
  })

  it('отвергает нерабочий URL', () => {
    expect(issuesOf(validEnv({ MDS_HTTP_URL: 'не-url' })).join('\n')).toMatch(/MDS_HTTP_URL/)
  })

  it('требует postgres-схему в DATABASE_URL', () => {
    expect(issuesOf(validEnv({ DATABASE_URL: 'mysql://db:3306/cms' })).join('\n')).toMatch(
      /DATABASE_URL.*postgres/,
    )
  })

  it('требует amqp-схему в BUS_URL', () => {
    expect(issuesOf(validEnv({ BUS_URL: 'http://bus:5672' })).join('\n')).toMatch(/BUS_URL.*amqp/)
  })
})

describe('loadEnv — правила предметной области', () => {
  it('требует явного режима витрины торговых условий, без умолчания (ADR-0005)', () => {
    expect(issuesOf(validEnv({ TRADING_TERMS_MODE: undefined }))).toContain(
      'TRADING_TERMS_MODE: не задана или пуста',
    )
  })

  it('отвергает неизвестный режим витрины', () => {
    expect(issuesOf(validEnv({ TRADING_TERMS_MODE: 'as-is' })).join('\n')).toMatch(
      /TRADING_TERMS_MODE/,
    )
  })

  it('требует отдельный домен для раздачи медиа (ТЗ 5.3)', () => {
    const issues = issuesOf(
      validEnv({
        APP_PUBLIC_URL: 'https://cms.example.com',
        MEDIA_PUBLIC_URL: 'https://cms.example.com/media',
      }),
    )
    expect(issues.join('\n')).toMatch(/MEDIA_PUBLIC_URL.*отдельный домен/)
  })

  it('различает домены по origin, а не по строке', () => {
    expect(() =>
      loadEnv(
        validEnv({
          APP_PUBLIC_URL: 'https://cms.example.com',
          MEDIA_PUBLIC_URL: 'https://media.example.com',
        }),
      ),
    ).not.toThrow()
  })
})

describe('describeEnv', () => {
  it('скрывает секреты и оставляет остальное читаемым', () => {
    const summary = describeEnv(loadEnv(validEnv()))

    expect(summary.PAYLOAD_SECRET).toBe('<скрыто>')
    expect(summary.DATABASE_URL).toBe('<скрыто>')
    expect(summary.S3_SECRET_ACCESS_KEY).toBe('<скрыто>')
    expect(summary.NODE_ENV).toBe('test')
    expect(summary.BUS_EXCHANGE).toBe('platform.events')
  })

  it('не пропускает значение секрета ни в одно поле сводки', () => {
    const summary = describeEnv(loadEnv(validEnv()))
    expect(Object.values(summary).join('|')).not.toContain(SECRET)
  })
})
