import { loadTenantChainIds } from '@/platform'

import { composeStructure } from './compose'

import type { GlobalAreaRecord, NavigationRecord } from './compose'
import type { StructureSnapshot } from './types'
import type { SectionRecord } from '../sections/resolve'
import type { Payload } from 'payload'

/**
 * Чтение структуры сайта на момент сборки релиза (ТЗ 2.2).
 *
 * Всё, что наследуется, читается по всей цепочке `бренд → регион → сайт`
 * одним запросом на коллекцию: меню бренда действует на его сайтах, и
 * запрашивать по уровню отдельно значило бы три обращения там, где хватает
 * одного.
 */

const READ = { pagination: false, depth: 0, overrideAccess: true } as const

export async function loadStructure(args: {
  readonly payload: Payload
  readonly siteId: string | number
  readonly locales: readonly string[]
}): Promise<StructureSnapshot> {
  const chainIds = await loadTenantChainIds(args.payload, args.siteId)

  const [sectionsResult, navigationsResult, areasResult, pagesResult] = await Promise.all([
    args.payload.find({ collection: 'sections', where: { owner: { in: chainIds } }, ...READ }),
    args.payload.find({ collection: 'navigations', where: { owner: { in: chainIds } }, ...READ }),
    args.payload.find({ collection: 'global-areas', where: { owner: { in: chainIds } }, ...READ }),
    /**
     * Страницы — только опубликованные и только самого сайта: меню обязано
     * вести туда, что действительно отдаётся, а не туда, что существует в
     * черновике или на соседнем сайте бренда.
     */
    args.payload.find({
      collection: 'pages',
      where: { site: { equals: args.siteId }, status: { equals: 'published' } },
      ...READ,
    }),
  ])

  const sections: SectionRecord[] = (
    sectionsResult.docs as unknown as Record<string, unknown>[]
  ).map((doc) => ({
    key: typeof doc.key === 'string' ? doc.key : '',
    locale: typeof doc.locale === 'string' ? doc.locale : '',
    ownerId: relationId(doc.owner),
    isActive: doc.isActive === true,
    blocks: doc.blocks,
  }))

  const navigations: NavigationRecord[] = (
    navigationsResult.docs as unknown as Record<string, unknown>[]
  ).map((doc) => ({
    placement: typeof doc.placement === 'string' ? doc.placement : '',
    locale: typeof doc.locale === 'string' ? doc.locale : '',
    ownerId: relationId(doc.owner),
    isActive: doc.isActive === true,
    items: doc.items,
  }))

  const globalAreas: GlobalAreaRecord[] = (
    areasResult.docs as unknown as Record<string, unknown>[]
  ).map((doc) => {
    const warning = (doc.riskWarning ?? {}) as Record<string, unknown>
    const text = typeof warning.text === 'string' ? warning.text : ''

    return {
      kind: typeof doc.kind === 'string' ? doc.kind : '',
      locale: typeof doc.locale === 'string' ? doc.locale : '',
      ownerId: relationId(doc.owner),
      isActive: doc.isActive === true,
      blocks: doc.blocks,
      riskWarning:
        doc.kind === 'risk-warning' && text.trim() !== ''
          ? {
              text,
              lossPercentage:
                typeof warning.lossPercentage === 'number' ? warning.lossPercentage : null,
            }
          : null,
      jurisdictions: Array.isArray(doc.jurisdictions)
        ? (doc.jurisdictions as Record<string, unknown>[]).flatMap((entry) =>
            typeof entry.code === 'string' ? [entry.code] : [],
          )
        : [],
    }
  })

  const pagePaths = new Map<string, Map<string, string>>()

  for (const doc of pagesResult.docs as unknown as Record<string, unknown>[]) {
    const locale = typeof doc.locale === 'string' ? doc.locale : ''
    const path = typeof doc.path === 'string' ? doc.path : ''

    if (locale === '' || path === '') {
      continue
    }

    const byId = pagePaths.get(locale) ?? new Map<string, string>()
    byId.set(String(doc.id), path)
    pagePaths.set(locale, byId)
  }

  return composeStructure({
    chainIds,
    locales: args.locales,
    sections,
    navigations,
    globalAreas,
    pagePaths,
  })
}

function relationId(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id)
  }

  return value === null || value === undefined ? '' : String(value)
}
