/**
 * Планировщик переходов (ТЗ 1.2).
 *
 * Важно понимать, чего планировщик **не** делает: он не «включает» и не
 * «выключает» материалы. Видимость определяется временем и правилом доступа —
 * материал появляется и гаснет сам, даже если планировщик остановлен
 * (ADR-0021).
 *
 * Планировщик обслуживает **побочные эффекты** перехода: событие в шину, по
 * которому потребители сбрасывают кеш. Без него витрина обновится не позже,
 * чем истечёт её собственный срок жизни ответа; с ним — сразу.
 *
 * Это разделение — причина, по которой остановленный планировщик не является
 * аварией: он влияет на скорость обновления, а не на корректность.
 */

export const TRANSITION_KINDS = ['published', 'expired'] as const

export type TransitionKind = (typeof TRANSITION_KINDS)[number]

export interface PendingTransition {
  readonly collection: string
  readonly id: string
  readonly siteId: string
  readonly siteSlug: string
  readonly slug: string
  readonly kind: TransitionKind
  readonly at: string
}

/**
 * Коллекции потока, у которых есть переходы по времени.
 *
 * Перечень явный, а не «все коллекции с полем `publishAt`»: неявный список
 * молча включил бы в себя всё, что случайно назвало поле так же.
 */
export const SCHEDULED_COLLECTIONS = ['articles', 'videos', 'promos'] as const

export type ScheduledCollection = (typeof SCHEDULED_COLLECTIONS)[number]

/**
 * Записи, у которых переход наступил в промежутке `(since, until]`.
 *
 * Промежуток полуоткрытый намеренно: соседние проходы не должны обработать
 * один и тот же переход дважды. Верхняя граница включается, нижняя — нет.
 */
export function transitionWindow(args: { readonly since: Date; readonly until: Date }): {
  readonly publishedWhere: Record<string, unknown>
  readonly expiredWhere: Record<string, unknown>
} {
  const from = args.since.toISOString()
  const to = args.until.toISOString()

  return {
    publishedWhere: {
      and: [
        { status: { equals: 'published' } },
        { publishAt: { greater_than: from } },
        { publishAt: { less_than_equal: to } },
      ],
    },
    expiredWhere: {
      and: [
        { status: { equals: 'published' } },
        { unpublishAt: { greater_than: from } },
        { unpublishAt: { less_than_equal: to } },
      ],
    },
  }
}

/**
 * Метки, по которым потребитель сбрасывает кеш.
 *
 * Пока метка одна на сайт целиком: точечная инвалидация появится вместе с
 * моделью страниц, когда станет известно, где именно материал показан. Метка
 * шире необходимого — это лишний сброс кеша, а метка уже необходимого — это
 * устаревшая витрина; выбор очевиден.
 */
export function changedTagsFor(transition: PendingTransition): string[] {
  return [`site:${transition.siteSlug}`, `${transition.collection}:${transition.slug}`]
}
