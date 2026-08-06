import type { Payload, PayloadRequest } from 'payload'

/**
 * Защита тенанта от удаления, пока на него ссылается содержимое.
 *
 * Появилась из отказа, а не из осторожности: удаление сайта с материалами
 * падало нарушением ограничения `NOT NULL` — Payload сначала обнуляет ссылки,
 * а обнулить обязательное поле нельзя. Ограничение своё дело сделало и утечки
 * не допустило, но человек видел сообщение про `site_id`, а не про то, что у
 * сайта есть материалы.
 *
 * Здесь не добавляется новая гарантия — здесь добавляется внятность. Сама
 * гарантия остаётся на уровне БД, где её нельзя обойти.
 */

/** Коллекции, чья запись без тенанта не имеет смысла. */
const DEPENDENT_COLLECTIONS = [
  { collection: 'articles', field: 'site', label: 'материалы' },
  { collection: 'videos', field: 'site', label: 'видео' },
  { collection: 'promos', field: 'site', label: 'промо' },
  { collection: 'media', field: 'owner', label: 'файлы' },
  { collection: 'categories', field: 'owner', label: 'категории' },
  { collection: 'tags', field: 'owner', label: 'теги' },
  { collection: 'authors', field: 'owner', label: 'авторы' },
  { collection: 'design-primitives', field: 'owner', label: 'примитивы дизайна' },
  { collection: 'design-roles', field: 'owner', label: 'семантические роли' },
  { collection: 'design-component-tokens', field: 'owner', label: 'токены компонентов' },
] as const

export interface DependentCount {
  readonly label: string
  readonly count: number
}

export async function countDependents(args: {
  readonly payload: Payload
  readonly tenantId: string | number
  readonly req?: PayloadRequest
}): Promise<DependentCount[]> {
  const found: DependentCount[] = []

  for (const dependent of DEPENDENT_COLLECTIONS) {
    const result = await args.payload.count({
      collection: dependent.collection,
      where: { [dependent.field]: { equals: args.tenantId } },
      overrideAccess: true,
      ...(args.req ? { req: args.req } : {}),
    })

    if (result.totalDocs > 0) {
      found.push({ label: dependent.label, count: result.totalDocs })
    }
  }

  return found
}

export function describeDependents(dependents: readonly DependentCount[]): string {
  const listed = dependents.map((item) => `${item.label}: ${item.count}`).join(', ')

  return `Тенант нельзя удалить, пока на него что-то ссылается (${listed}). Перенесите или удалите это, либо отключите тенант вместо удаления — история тогда сохранится.`
}
