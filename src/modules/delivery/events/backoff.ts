/**
 * Повторные попытки доставки событий (ТЗ 3.5).
 *
 * Недоставленное событие не теряется: оно остаётся в outbox и повторяется с
 * возрастающей задержкой. Это и отличает outbox от вызова «на удачу» —
 * временная недоступность шины перестаёт быть потерей данных.
 */

/** Задержка удваивается, но не растёт бесконечно. */
export const BASE_DELAY_MS = 5_000
export const MAX_DELAY_MS = 15 * 60 * 1000

/**
 * После этого числа попыток событие уходит в разбор.
 *
 * Бесконечные попытки — это не надёжность, а способ никогда не заметить
 * проблему: очередь растёт, а тревоги нет. Исчерпанное событие обязано стать
 * видимым.
 */
export const MAX_ATTEMPTS = 12

export function isExhausted(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS
}

/**
 * Задержка перед следующей попыткой.
 *
 * Без разброса все накопившиеся события повторяются одновременно и добивают
 * шину ровно в тот момент, когда она только поднялась. Разброс задаётся
 * снаружи, чтобы функция осталась чистой и проверяемой.
 */
export function nextAttemptDelayMs(attempts: number, jitter = 0): number {
  if (attempts < 0 || !Number.isInteger(attempts)) {
    throw new RangeError(`Число попыток должно быть целым неотрицательным, получено ${attempts}.`)
  }

  const exponential = BASE_DELAY_MS * Math.pow(2, Math.min(attempts, 20))
  const capped = Math.min(exponential, MAX_DELAY_MS)

  /** Разброс только вверх: попытка раньше срока не имеет смысла. */
  return capped + Math.max(0, Math.floor(capped * jitter))
}

export function nextAttemptAt(attempts: number, now: Date, jitter = 0): Date {
  return new Date(now.getTime() + nextAttemptDelayMs(attempts, jitter))
}
