/**
 * Ограничение частоты запросов к API доставки (ТЗ разд. 6).
 *
 * Считается скользящим окном по двум ведрам: текущему и предыдущему. Оценка —
 * текущее ведро плюс доля предыдущего, пропорциональная тому, сколько его ещё
 * «видно» из окна.
 *
 * Простое фиксированное окно дешевле, но допускает всплеск в **двойной** предел
 * на стыке окон: предел выбирается в конце одного окна и сразу заново в начале
 * следующего. Для двери наружу это ровно тот случай, когда защита есть на
 * бумаге и нет в момент, когда она нужна.
 *
 * Хранилище — общее для всех процессов. Счётчик в памяти одного процесса
 * перестаёт что-либо значить, как только процессов становится два, и при этом
 * продолжает выглядеть защитой.
 */

export interface RateLimitRule {
  /** Сколько запросов разрешено за окно. */
  readonly limit: number
  readonly windowMs: number
}

export interface RateLimitVerdict {
  readonly allowed: boolean
  /** Сколько ещё можно до конца окна; не бывает отрицательным. */
  readonly remaining: number
  /** Через сколько секунд имеет смысл повторить. Всегда не меньше единицы. */
  readonly retryAfterSec: number
}

export interface RateLimiter {
  /** Учитывает обращение и выносит решение. */
  consume(bucket: string, rule: RateLimitRule): Promise<RateLimitVerdict>
  /**
   * Смотрит, не исчерпан ли предел, **не увеличивая счётчик**.
   *
   * Нужен, чтобы отказать до обращения к базе: иначе перебор ключа продолжает
   * стоить нам запроса в БД на каждую попытку и после срабатывания предела.
   */
  peek(bucket: string, rule: RateLimitRule): Promise<RateLimitVerdict>
}

/**
 * Оценка нагрузки скользящим окном.
 *
 * Отделена от хранилища намеренно: арифметика проверяется без Redis, а Redis
 * отвечает только за два числа.
 */
export function estimateUsage(args: {
  readonly previousCount: number
  readonly currentCount: number
  /** Сколько прошло с начала текущего окна. */
  readonly elapsedMs: number
  readonly windowMs: number
}): number {
  const share = Math.max(0, 1 - args.elapsedMs / args.windowMs)

  return args.previousCount * share + args.currentCount
}

export function decide(args: {
  readonly usage: number
  readonly rule: RateLimitRule
  readonly elapsedMs: number
}): RateLimitVerdict {
  const allowed = args.usage <= args.rule.limit
  const remaining = Math.max(0, Math.floor(args.rule.limit - args.usage))

  /**
   * Повторять раньше конца текущего окна бессмысленно: до этого момента доля
   * предыдущего ведра не уменьшится настолько, чтобы решение изменилось.
   */
  const retryAfterSec = Math.max(1, Math.ceil((args.rule.windowMs - args.elapsedMs) / 1000))

  return { allowed, remaining, retryAfterSec }
}

/** Границы окна для отметки времени. Вынесено, чтобы ключи считались одинаково везде. */
export function windowBounds(nowMs: number, windowMs: number) {
  const start = nowMs - (nowMs % windowMs)

  return { start, previousStart: start - windowMs, elapsedMs: nowMs - start }
}

/**
 * Пределы по умолчанию.
 *
 * Разделены намеренно: чтение и неудачная авторизация — разные виды нагрузки.
 * Один предел на оба означал бы, что подбор ключа ограничен так же слабо, как
 * обычное чтение витрины.
 */
export const DEFAULT_READ_RULE: RateLimitRule = { limit: 600, windowMs: 60_000 }

export const DEFAULT_AUTH_FAILURE_RULE: RateLimitRule = { limit: 20, windowMs: 60_000 }
