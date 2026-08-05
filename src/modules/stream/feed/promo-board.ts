import { earliestTransition } from '../visibility'

import { MappingError, mapFeed, requireText } from './mapper'

import type { Payload, Where } from 'payload'

/**
 * Промо-доска (ТЗ 1.1).
 *
 * Не лента: курсора здесь нет намеренно. Промо-блоков на сайте единицы, они
 * показываются все сразу и упорядочены редакторским приоритетом, а не
 * временем. Пагинация над списком из пяти элементов — это механизм, который
 * нужно поддерживать и который никогда не пригодится.
 */

export interface PromoItem {
  readonly slug: string
  readonly title: string
  readonly badge: string | null
  readonly description: string | null
  readonly terms: string
  readonly cta: { readonly label: string; readonly href: string } | null
  readonly image: { readonly url: string; readonly alt: string } | null
  readonly jurisdictions: readonly string[]
  readonly priority: number
  readonly featured: boolean
}

export interface PromoBoard {
  readonly items: readonly PromoItem[]
  readonly excluded: readonly { readonly id: string; readonly reason: string }[]
  readonly nextTransitionAt: string | null
}

/**
 * Верхний предел на всякий случай.
 *
 * Не для производительности, а чтобы ошибка редактора (двести промо на одном
 * сайте) не превратилась в ответ на мегабайт.
 */
const BOARD_LIMIT = 50

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function toPromoItem(doc: Record<string, unknown>): PromoItem {
  const slug = requireText(doc.slug, 'машинное имя')
  const title = requireText(doc.title, 'заголовок')

  /**
   * Условия обязательны и здесь, а не только в форме: предложение без условий
   * — это нарушение, и лучше его отсутствие на витрине, чем оно же без
   * условий. Запись попадёт в алерт как исключённая.
   */
  const terms = requireText(doc.terms, 'условия')

  const ctaLabel = optionalText(doc.ctaLabel)
  const ctaHref = optionalText(doc.ctaHref)

  if ((ctaLabel === null) !== (ctaHref === null)) {
    /**
     * Кнопка без адреса и адрес без надписи одинаково бессмысленны на витрине.
     * Половина кнопки хуже её отсутствия: по ней кликают.
     */
    throw new MappingError('Кнопка задана наполовину: нужны и надпись, и адрес.')
  }

  const image = asRecord(doc.image)
  const imageUrl = image === null ? null : optionalText(image.url)
  const imageAlt = image === null ? null : optionalText(image.alt)

  return {
    slug,
    title,
    badge: optionalText(doc.badge),
    description: optionalText(doc.description),
    terms,
    cta: ctaLabel !== null && ctaHref !== null ? { label: ctaLabel, href: ctaHref } : null,
    image: imageUrl !== null && imageAlt !== null ? { url: imageUrl, alt: imageAlt } : null,
    jurisdictions: Array.isArray(doc.jurisdictions)
      ? doc.jurisdictions.flatMap((entry) => {
          const code = optionalText(asRecord(entry)?.code)
          return code === null ? [] : [code]
        })
      : [],
    priority: typeof doc.priority === 'number' ? doc.priority : 0,
    featured: doc.featured === true,
  }
}

export async function loadPromoBoard(args: {
  readonly payload: Payload
  readonly siteId: string | number
  readonly jurisdiction?: string | null
  readonly now?: Date
}): Promise<PromoBoard> {
  const now = args.now ?? new Date()
  const conditions: Where[] = [{ site: { equals: args.siteId } }]

  /** Пустой список юрисдикций означает «во всех» — как и у материалов. */
  if (args.jurisdiction) {
    conditions.push({
      or: [
        { 'jurisdictions.code': { equals: args.jurisdiction } },
        { 'jurisdictions.code': { exists: false } },
      ],
    })
  }

  const found = await args.payload.find({
    collection: 'promos',
    where: { and: conditions },
    /** Приоритет задаёт редактор; при равенстве побеждает более позднее. */
    sort: ['-priority', '-publishAt', '-id'],
    limit: BOARD_LIMIT,
    pagination: false,
    depth: 1,
    /** Как и у ленты: видимость — правило доступа, а не фильтр ([[BUG-005]]). */
    overrideAccess: false,
  })

  const docs = found.docs as unknown as Record<string, unknown>[]
  const mapped = mapFeed(docs, toPromoItem)

  return {
    items: mapped.items,
    excluded: mapped.excluded,
    nextTransitionAt: earliestTransition(docs as never, now)?.toISOString() ?? null,
  }
}
