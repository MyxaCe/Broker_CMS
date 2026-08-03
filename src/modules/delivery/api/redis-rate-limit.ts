import Redis from 'ioredis'

import { decide, estimateUsage, windowBounds } from './rate-limit'

import type { RateLimiter, RateLimitRule, RateLimitVerdict } from './rate-limit'

/**
 * Счётчик частоты запросов в Redis.
 *
 * Хранилище общее для всех процессов — это и есть причина, по которой счётчик
 * здесь, а не в памяти приложения.
 */
export class RedisRateLimiter implements RateLimiter {
  private readonly client: Redis
  private readonly prefix: string

  constructor(args: { url: string; prefix?: string }) {
    /**
     * `maxRetriesPerRequest: 1` — при недоступном Redis запрос обязан быстро
     * получить ошибку, а не ждать. Что делать с этой ошибкой, решает вызывающий:
     * см. `consume`.
     */
    this.client = new Redis(args.url, { maxRetriesPerRequest: 1, lazyConnect: true })
    this.prefix = args.prefix ?? 'ratelimit'
  }

  async consume(
    bucket: string,
    rule: RateLimitRule,
    nowMs = Date.now(),
  ): Promise<RateLimitVerdict> {
    const { start, previousStart, elapsedMs } = windowBounds(nowMs, rule.windowMs)
    const currentKey = `${this.prefix}:${bucket}:${start}`
    const previousKey = `${this.prefix}:${bucket}:${previousStart}`

    /**
     * Счётчик увеличивается **до** решения: отклонённый запрос — это тоже
     * нагрузка, и не считать его значило бы разрешить бесконечный поток
     * отклоняемых обращений.
     */
    const results = await this.client
      .multi()
      .incr(currentKey)
      /** Живёт два окна: предыдущее ведро нужно для оценки, третье — уже нет. */
      .pexpire(currentKey, rule.windowMs * 2)
      .get(previousKey)
      .exec()

    if (results === null) {
      throw new Error('Счётчик частоты запросов не ответил.')
    }

    const currentCount = Number(results[0]?.[1] ?? 0)
    const previousCount = Number(results[2]?.[1] ?? 0)

    const usage = estimateUsage({
      previousCount: Number.isFinite(previousCount) ? previousCount : 0,
      currentCount: Number.isFinite(currentCount) ? currentCount : 0,
      elapsedMs,
      windowMs: rule.windowMs,
    })

    return decide({ usage, rule, elapsedMs })
  }

  async peek(bucket: string, rule: RateLimitRule, nowMs = Date.now()): Promise<RateLimitVerdict> {
    const { start, previousStart, elapsedMs } = windowBounds(nowMs, rule.windowMs)

    const results = await this.client
      .multi()
      .get(`${this.prefix}:${bucket}:${start}`)
      .get(`${this.prefix}:${bucket}:${previousStart}`)
      .exec()

    const currentCount = Number(results?.[0]?.[1] ?? 0)
    const previousCount = Number(results?.[1]?.[1] ?? 0)

    const usage = estimateUsage({
      previousCount: Number.isFinite(previousCount) ? previousCount : 0,
      currentCount: Number.isFinite(currentCount) ? currentCount : 0,
      elapsedMs,
      windowMs: rule.windowMs,
    })

    return decide({ usage, rule, elapsedMs })
  }

  async connect(): Promise<void> {
    if (this.client.status === 'ready' || this.client.status === 'connecting') {
      return
    }

    await this.client.connect()
  }

  async close(): Promise<void> {
    await this.client.quit()
  }
}
