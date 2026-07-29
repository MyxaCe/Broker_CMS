import { z } from 'zod'

/**
 * Единственное место во всём приложении, где читается process.env.
 * Везде остальном — импорт готового объекта конфигурации (`getEnv()`).
 * Запрет принуждается правилом линтера `no-restricted-syntax` (eslint.config.mjs).
 *
 * Принцип fail-closed (ТЗ разд. 3 и 6): отсутствие ИЛИ пустое значение любой
 * обязательной переменной означает, что процесс не стартует. Конструкции вида
 * `if (SECRET) { проверить }` запрещены: они превращают забытый секрет в тихо
 * отключённую проверку — именно этот дефект назван в ТЗ как причина переписывания.
 */

/** Ключи, значения которых не попадают ни в логи, ни в отчёты об ошибках. */
const SECRET_KEYS = new Set([
  'PAYLOAD_SECRET',
  'PREVIEW_SECRET',
  'DELIVERY_KEY_PEPPER',
  'DATABASE_URL',
  'REDIS_URL',
  'BUS_URL',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'SENTRY_DSN',
])

/**
 * Минимальная длина секрета. 32 символа — это не «на глаз»: секрет короче
 * подбирается офлайн быстрее, чем истекает срок его ротации.
 */
const MIN_SECRET_LENGTH = 32

const secret = () =>
  z.string().min(MIN_SECRET_LENGTH, `должен быть не короче ${MIN_SECRET_LENGTH} символов`)

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),

    /**
     * Уровень логирования — единственное поле с умолчанием. Это не нарушение
     * fail-closed: значение не гейтит ни доступ, ни целостность данных.
     */
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    APP_PUBLIC_URL: z.string().url(),

    // --- хранилища ---
    DATABASE_URL: z.string().url().startsWith('postgres', 'должен быть postgres-URL'),
    REDIS_URL: z.string().url(),

    // --- шина событий (ТЗ 3.5) ---
    BUS_URL: z.string().url().startsWith('amqp', 'должен быть amqp-URL'),
    BUS_EXCHANGE: z.string().min(1),

    // --- медиа (ТЗ 5.3) ---
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: secret(),
    MEDIA_PUBLIC_URL: z.string().url(),

    // --- внешние системы ---
    MDS_HTTP_URL: z.string().url(),
    SENTRY_DSN: z.string().url(),

    // --- секреты приложения ---
    PAYLOAD_SECRET: secret(),
    PREVIEW_SECRET: secret(),
    DELIVERY_KEY_PEPPER: secret(),

    /**
     * Режим витрины торговых условий — ADR-0004 и ADR-0005.
     * Умолчания нет намеренно: невозможно случайно оказаться в ослабленном
     * режиме `unverified`, его выбирают явно и осознанно.
     */
    TRADING_TERMS_MODE: z.enum(['core', 'unverified']),
  })
  .superRefine((env, ctx) => {
    /**
     * ТЗ 5.3: пользовательские файлы раздаются с отдельного домена.
     * Совпадение origin означает, что загруженный файл исполняется в том же
     * origin, что и админка — то есть XSS через загрузку.
     */
    if (originOf(env.MEDIA_PUBLIC_URL) === originOf(env.APP_PUBLIC_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MEDIA_PUBLIC_URL'],
        message:
          'должен указывать на отдельный домен, не совпадающий с APP_PUBLIC_URL (ТЗ 5.3: раздача пользовательских файлов вне origin приложения)',
      })
    }
  })

export type Env = z.infer<typeof envSchema>

export class EnvValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Конфигурация окружения невалидна (${issues.length}):\n  - ${issues.join('\n  - ')}`)
    this.name = 'EnvValidationError'
  }
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * Пустая строка и строка из пробелов трактуются как отсутствие значения.
 * Без этого `SECRET=` в .env прошёл бы проверку и включил бы пустой секрет.
 */
function normalize(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() !== '') {
      result[key] = value
    }
  }
  return result
}

function formatIssue(issue: z.ZodIssue): string {
  const key = issue.path.join('.') || '(корень)'
  const isMissing = issue.code === z.ZodIssueCode.invalid_type && issue.received === 'undefined'
  return isMissing ? `${key}: не задана или пуста` : `${key}: ${issue.message}`
}

/**
 * Разбирает и проверяет окружение. Чистая функция — источник передаётся явно,
 * чтобы тесты не зависели от окружения процесса.
 *
 * @throws {EnvValidationError} со списком ВСЕХ проблем разом. Показывать их по
 * одной — значит заставить человека перезапускать процесс столько раз, сколько
 * переменных он забыл.
 */
export function loadEnv(source: Readonly<Record<string, string | undefined>>): Env {
  const parsed = envSchema.safeParse(normalize(source))

  if (!parsed.success) {
    throw new EnvValidationError(parsed.error.issues.map(formatIssue))
  }

  return parsed.data
}

/** Значения, которые безопасно писать в лог при старте. Секреты не раскрываются. */
export function describeEnv(env: Env): Record<string, string> {
  const summary: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    summary[key] = SECRET_KEYS.has(key) ? '<скрыто>' : String(value)
  }
  return summary
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key)
}

let cached: Env | undefined

/**
 * Инициализация при старте процесса — до приёма первого запроса.
 * Вызывается ровно один раз из точки входа.
 */
export function initEnv(source: Readonly<Record<string, string | undefined>> = process.env): Env {
  cached = loadEnv(source)
  return cached
}

export function getEnv(): Env {
  if (!cached) {
    throw new Error(
      'Конфигурация не инициализирована: initEnv() должен быть вызван в точке входа до любого обращения к getEnv().',
    )
  }
  return cached
}

/** Только для тестов: сбросить закешированную конфигурацию. */
export function resetEnvForTests(): void {
  cached = undefined
}
