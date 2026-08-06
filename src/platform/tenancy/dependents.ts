import type { CollectionConfig, Field, Payload, PayloadRequest } from 'payload'

/**
 * Защита тенанта от удаления, пока на него ссылается содержимое.
 *
 * Появилась из отказа, а не из осторожности: удаление сайта с материалами
 * падало нарушением `NOT NULL` — Payload сначала обнуляет ссылки, а обнулить
 * обязательное поле нельзя. Ограничение своё дело сделало и утечки не
 * допустило, но человек видел сообщение про `site_id`, а не про то, что у
 * сайта есть материалы.
 *
 * Здесь не добавляется новая гарантия — здесь добавляется внятность. Сама
 * гарантия остаётся на уровне БД, где её нельзя обойти.
 */

/**
 * Перечень выводится из конфигурации, а не задаётся списком (погашен
 * [[DEBT-010]]).
 *
 * Список отставал от новых коллекций **четыре раза подряд**: материалы, видео
 * и промо, три коллекции токенов, страницы. Каждый раз ошибка находилась
 * падением чужого теста и объяснялась не сразу.
 *
 * Сломан был не список, а правило: «не забудь дописать» не работает — четыре
 * повторения это доказали. Теперь коллекция попадает сюда самим фактом того,
 * что у неё есть обязательная связь с тенантом.
 */
function isRequiredTenantRelation(field: Field): field is Field & { name: string } {
  if (field.type !== 'relationship' || !('name' in field)) {
    return false
  }

  const relation = field.relationTo

  const pointsToTenants = Array.isArray(relation)
    ? relation.includes('tenants')
    : relation === 'tenants'

  /**
   * Только обязательные связи. Необязательная обнуляется без ошибки — там
   * удаление тенанта корректно и отказывать не за что.
   */
  return pointsToTenants && field.required === true
}

/**
 * Подписи для человека.
 *
 * «материалы» читается лучше, чем `articles`. Отсутствие подписи не выключает
 * проверку — подставляется имя коллекции: забытая подпись хуже читается, но
 * ничего не ломает.
 */
const LABELS: Record<string, string> = {
  articles: 'материалы',
  videos: 'видео',
  promos: 'промо',
  media: 'файлы',
  categories: 'категории',
  tags: 'теги',
  authors: 'авторы',
  pages: 'страницы',
  'design-primitives': 'примитивы дизайна',
  'design-roles': 'семантические роли',
  'design-component-tokens': 'токены компонентов',
}

export interface DependentCollection {
  readonly collection: string
  readonly field: string
  readonly label: string
}

/**
 * Коллекции с обязательной связью на тенанта.
 *
 * Вынесена отдельной функцией, чтобы её можно было проверить тестом: пустой
 * перечень выключил бы защиту молча, и заметить это было бы нечем.
 */
export function findDependentCollections(
  collections: readonly CollectionConfig[],
): DependentCollection[] {
  const found: DependentCollection[] = []

  for (const collection of collections) {
    /** Сам тенант ссылается на родителя — это дерево, а не зависимость. */
    if (collection.slug === 'tenants') {
      continue
    }

    for (const field of collection.fields) {
      if (isRequiredTenantRelation(field)) {
        found.push({
          collection: collection.slug,
          field: field.name,
          label: LABELS[collection.slug] ?? collection.slug,
        })
      }
    }
  }

  return found
}

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
  const dependents = findDependentCollections(
    args.payload.config.collections as unknown as CollectionConfig[],
  )

  for (const dependent of dependents) {
    const result = await args.payload.count({
      collection: dependent.collection as never,
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
