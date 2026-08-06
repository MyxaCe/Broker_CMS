/**
 * Одно правило наследования для всего, что живёт «где-то в цепочке» (ТЗ 2.2).
 *
 * Секции, меню, глобальные области наследуются одинаково: побеждает ближайший
 * к сайту владелец. Правило вынесено сюда, потому что три копии одного правила
 * разошлись бы — и разошлись бы незаметно, каждая в свою сторону.
 */

export interface NearestPick<T> {
  readonly item: T
  /** Совпадает ли владелец с самим сайтом. */
  readonly provenance: 'own' | 'inherited'
}

export interface NearestArgs<T> {
  /** Цепочка от корня к листу: `[brandId, regionId, siteId]`. */
  readonly chainIds: readonly string[]
  readonly items: readonly T[]
  /** Под каким ключом элементы конкурируют между собой. */
  readonly keyOf: (item: T) => string
  readonly ownerOf: (item: T) => string
  readonly isActive: (item: T) => boolean
}

/**
 * Выбирает по одному элементу на ключ — от ближайшего к сайту владельца.
 *
 * Недействующий элемент участвует в отборе и **побеждает**, но в результат не
 * попадает. Это не тонкость реализации, а решение: отключённая секция сайта
 * оставляет пустое место, а не откатывает к секции бренда. Тихий откат — это
 * подмена текста без ведома редактора, и на сайте брокера он хуже пустоты.
 */
export function pickNearest<T>(args: NearestArgs<T>): Map<string, NearestPick<T>> {
  const rank = new Map<string, number>()
  args.chainIds.forEach((id, index) => rank.set(id, index))

  const leafId = args.chainIds.at(-1) ?? null
  const best = new Map<string, { item: T; rank: number }>()

  for (const item of args.items) {
    const position = rank.get(args.ownerOf(item))

    if (position === undefined) {
      continue
    }

    const current = best.get(args.keyOf(item))

    if (current === undefined || position > current.rank) {
      best.set(args.keyOf(item), { item, rank: position })
    }
  }

  const result = new Map<string, NearestPick<T>>()

  for (const [key, entry] of best) {
    if (!args.isActive(entry.item)) {
      continue
    }

    result.set(key, {
      item: entry.item,
      provenance: args.ownerOf(entry.item) === leafId ? 'own' : 'inherited',
    })
  }

  return result
}
