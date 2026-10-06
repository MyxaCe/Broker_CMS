import { loadTenantChainIds } from '@/platform'

import { pickNearest } from '../structure/inherit'

import { composeDisclaimers } from './compose'

import type { DisclaimerSourceArea, DisclaimerSourcePage, DisclaimerText } from './compose'
import type { DisclaimersSnapshot } from './types'
import type { Payload } from 'payload'

/**
 * Чтение текстов дисклеймеров на момент сборки релиза (ТЗ 2.4).
 *
 * Страницы и области **не читаются заново**: они приходят сюда теми же, что
 * видел комплаенс-гейт. Второй обход базы разошёлся бы с первым в отборе
 * черновиков, и разошёлся бы незаметно — гейт ходил бы по одному набору
 * страниц, а дисклеймеры по другому. Этот урок у нас уже оплачен
 * стоп-словарём.
 */

const READ = { pagination: false, depth: 0, overrideAccess: true } as const

export async function loadDisclaimers(args: {
  readonly payload: Payload
  readonly siteId: string | number
  readonly pages: readonly DisclaimerSourcePage[]
  readonly areas: readonly DisclaimerSourceArea[]
}): Promise<DisclaimersSnapshot> {
  const chainIds = await loadTenantChainIds(args.payload, args.siteId)

  const found = await args.payload.find({
    collection: 'disclaimers',
    where: { owner: { in: chainIds } },
    ...READ,
  })

  const records = (found.docs as unknown as Record<string, unknown>[]).map((doc) => ({
    key: typeof doc.key === 'string' ? doc.key : '',
    locale: typeof doc.locale === 'string' ? doc.locale : '',
    text: typeof doc.text === 'string' ? doc.text : '',
    owner: ownerId(doc.owner),
    isActive: doc.isActive !== false,
  }))

  /**
   * Наследование — тем же правилом, что у секций и областей: побеждает
   * ближайший к сайту владелец, а выключенный текст побеждает и **не**
   * попадает в результат.
   *
   * Последнее здесь особенно важно. Тихий откат к формулировке бренда на
   * сайте, где её отключили, означал бы показ регуляторного текста, который
   * этому сайту не подходит, — и никто бы этого не заметил. Пустое место
   * заметят: релиз не соберётся.
   */
  const picked = pickNearest({
    chainIds,
    items: records,
    keyOf: (record) => `${record.locale}\u0000${record.key}`,
    ownerOf: (record) => record.owner,
    isActive: (record) => record.isActive,
  })

  const texts: DisclaimerText[] = [...picked.values()].map((entry) => ({
    key: entry.item.key,
    locale: entry.item.locale,
    text: entry.item.text,
  }))

  return composeDisclaimers({ pages: args.pages, areas: args.areas, texts })
}

function ownerId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }

  if (value !== null && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id)
  }

  return ''
}
