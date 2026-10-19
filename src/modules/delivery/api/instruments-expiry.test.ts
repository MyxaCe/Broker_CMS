import { describe, expect, it } from 'vitest'

import {
  CONSUMER_REUSE_WINDOW_SECONDS,
  INSTRUMENTS_LIFETIME_SECONDS,
  instrumentsExpiresAt,
  TOLERATED_REUSE_WINDOWS,
} from './instruments-expiry'

/**
 * Срок годности списка инструментов (Р-042).
 *
 * Проверяется не «функция складывает числа», а четыре свойства, на которых
 * держится решение: срок в будущем, срок переживает пропуски перепроверки,
 * тело ответа в пределах окна не меняется, и величина выведена из окна
 * потребителя, а не выбрана круглой.
 */

const SECOND = 1000
const LIFETIME_MS = INSTRUMENTS_LIFETIME_SECONDS * SECOND

describe('срок годности списка: форма значения', () => {
  it('момент в ISO-8601 по UTC', () => {
    const value = instrumentsExpiresAt(Date.parse('2026-10-19T12:00:00.000Z'))

    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Number.isFinite(Date.parse(value))).toBe(true)
  })

  /**
   * Негодные часы — отказ, а не правдоподобный момент.
   *
   * Проверяется **наш** барьер, а не свойство «что-то упало»: `new Date(NaN)
   * .toISOString()` бросает `RangeError` и сам, то есть проверка на класс
   * исключения осталась бы зелёной после снятия нашей проверки — защита
   * держалась бы на слое ниже. Поэтому проверяется формулировка: ниже
   * лежащий слой говорит «Invalid time value» и не называет причину.
   */
  it('нечисловой момент выдачи — отказ, и отказ называет причину', () => {
    expect(() => instrumentsExpiresAt(Number.NaN)).toThrow(/момент выдачи не число/)
    expect(() => instrumentsExpiresAt(Number.POSITIVE_INFINITY)).toThrow(/момент выдачи не число/)
  })
})

describe('срок годности списка: запас перед потребителем', () => {
  /**
   * Главное свойство. Срок, который в момент выдачи уже близок, закрывал бы
   * витрину при штатной работе — ровно та ошибка, от которой удержались, не
   * прочитав `no-cache` как нулевой срок.
   */
  it('срок всегда строго дальше одного времени жизни и не дальше двух', () => {
    const origin = Date.parse('2026-10-19T00:00:00.000Z')

    /** Шаг взят не кратным окну: иначе проверялась бы только его граница. */
    for (let offset = 0; offset <= LIFETIME_MS * 3; offset += 37 * SECOND) {
      const now = origin + offset
      const ahead = Date.parse(instrumentsExpiresAt(now)) - now

      expect(ahead).toBeGreaterThan(LIFETIME_MS)
      expect(ahead).toBeLessThanOrEqual(2 * LIFETIME_MS)
    }
  })

  /**
   * РАСТЯЖКА. Два пропуска перепроверки витрины — задержка, третий —
   * неработающий канал. Ради этого выбрана величина, и если кто-то сократит
   * срок до одного окна, граница начнёт закрываться от одной опоздавшей
   * перепроверки, а «ложная тревога» кончается тем, что защиту отключают.
   */
  it('РАСТЯЖКА: список переживает два пропуска перепроверки потребителя', () => {
    const now = Date.parse('2026-10-19T12:04:59.000Z')
    const deadline = Date.parse(instrumentsExpiresAt(now))

    const secondMiss = now + 2 * CONSUMER_REUSE_WINDOW_SECONDS * SECOND

    expect(secondMiss).toBeLessThan(deadline)
  })
})

describe('срок годности списка: квантование', () => {
  /**
   * `ETag` выдачи — сильный валидатор по телу ответа. Срок, меняющийся на
   * каждый запрос, означал бы новый `ETag` на каждый запрос: условный запрос
   * перестал бы работать, а обещание «одинаковый кортеж — одинаковый ответ»
   * стало бы неправдой.
   */
  it('в пределах окна значение не меняется', () => {
    const start = Math.floor(Date.parse('2026-10-19T12:00:00.000Z') / LIFETIME_MS) * LIFETIME_MS

    expect(instrumentsExpiresAt(start)).toBe(instrumentsExpiresAt(start + LIFETIME_MS - 1))
  })

  it('на границе окна значение сдвигается ровно на одно окно', () => {
    const start = Math.floor(Date.parse('2026-10-19T12:00:00.000Z') / LIFETIME_MS) * LIFETIME_MS

    const before = Date.parse(instrumentsExpiresAt(start + LIFETIME_MS - 1))
    const after = Date.parse(instrumentsExpiresAt(start + LIFETIME_MS))

    expect(after - before).toBe(LIFETIME_MS)
  })

  it('срок монотонен: позже спросил — не раньше получил', () => {
    const origin = Date.parse('2026-10-19T00:00:00.000Z')
    let previous = 0

    for (let offset = 0; offset <= LIFETIME_MS * 4; offset += 61 * SECOND) {
      const value = Date.parse(instrumentsExpiresAt(origin + offset))

      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe('срок годности списка: откуда взялась величина', () => {
  /**
   * МУТАЦИЯ, КОТОРУЮ НЕЧЕМ ПОКРАСИТЬ, И ПОЭТОМУ ОНА ЗАПИСАНА ЗДЕСЬ.
   *
   * `CONSUMER_REUSE_WINDOW_SECONDS` — копия чужой константы
   * (`EDITORIAL_REUSE_WINDOW_SECONDS` в `packages/tenant/src/expiry.ts` у
   * команды `site-platform`, то же число стоит в `apps/web/lib/tenant.ts`
   * как `revalidate`). Импортировать её неоткуда: репозитории выкатываются
   * порознь.
   *
   * Поэтому расхождение двух чисел **не поймает ни один тест**, и проверка
   * здесь — не защита, а запись связи: сосед меняет окно — срок надо
   * пересчитать. Числа названы вслух, чтобы расхождение увидел хотя бы тот,
   * кто придёт его менять.
   */
  it('РАСТЯЖКА: 900 секунд = три окна переиспользования витрины по 300', () => {
    expect(CONSUMER_REUSE_WINDOW_SECONDS).toBe(300)
    expect(TOLERATED_REUSE_WINDOWS).toBe(3)
    expect(INSTRUMENTS_LIFETIME_SECONDS).toBe(900)
  })
})
