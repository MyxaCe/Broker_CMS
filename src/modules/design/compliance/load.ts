import { buildChain } from '@/platform'

import { collectMediaReferences } from './rules'

import type { ComplianceInput, CompliancePageInput, RiskWarningArea } from './rules'
import type { TenantNode } from '@/platform'
import type { Payload } from 'payload'

/**
 * Сбор состояния сайта для комплаенс-проверок (ТЗ 2.4).
 *
 * Читается на момент сборки релиза: проверять надо то, что будет
 * опубликовано, а не то, что было когда-то.
 */

const READ = { pagination: false, depth: 0, overrideAccess: true } as const

export async function loadComplianceInput(args: {
  readonly payload: Payload
  readonly siteId: string | number
  readonly jurisdiction: string | null
  readonly locales: readonly string[]
}): Promise<ComplianceInput> {
  const chainIds = await tenantChain(args.payload, args.siteId)

  /**
   * Страницы берутся **только опубликованные**: черновик в релиз не попадает,
   * и требовать от него комплаенса значило бы мешать работе над материалом,
   * который ещё не показывают.
   */
  const pagesResult = await args.payload.find({
    collection: 'pages',
    where: { site: { equals: args.siteId }, status: { equals: 'published' } },
    ...READ,
  })

  const pages: CompliancePageInput[] = (
    pagesResult.docs as unknown as Record<string, unknown>[]
  ).map((doc) => ({
    path: typeof doc.path === 'string' ? doc.path : '',
    locale: typeof doc.locale === 'string' ? doc.locale : '',
    blocks: doc.blocks,
    jurisdictions: Array.isArray(doc.jurisdictions)
      ? (doc.jurisdictions as Record<string, unknown>[]).flatMap((entry) =>
          typeof entry.code === 'string' ? [entry.code] : [],
        )
      : [],
  }))

  /**
   * Полосы предупреждения ищутся по всей цепочке наследования: область бренда
   * действует на его сайтах, и требовать собственную полосу у каждого сайта
   * значило бы заводить двадцать копий одного регуляторного текста.
   */
  const areasResult = await args.payload.find({
    collection: 'global-areas',
    where: { owner: { in: chainIds }, kind: { equals: 'risk-warning' } },
    ...READ,
  })

  const riskWarnings: RiskWarningArea[] = (
    areasResult.docs as unknown as Record<string, unknown>[]
  ).map((doc) => {
    const warning = (doc.riskWarning ?? {}) as Record<string, unknown>

    return {
      isActive: doc.isActive === true,
      text: typeof warning.text === 'string' ? warning.text : null,
      lossPercentage: typeof warning.lossPercentage === 'number' ? warning.lossPercentage : null,
      locale: typeof doc.locale === 'string' ? doc.locale : '',
    }
  })

  return {
    jurisdiction: args.jurisdiction,
    locales: args.locales,
    riskWarnings,
    pages,
    mediaAlt: await loadMediaAlt(args.payload, pages),
  }
}

/**
 * Узнаёт, у каких изображений заполнен alt.
 *
 * Запрашиваются только те файлы, на которые ссылаются страницы: медиатека
 * бывает большой, и проверять её целиком незачем — не использованный файл
 * ничего не нарушает.
 */
async function loadMediaAlt(
  payload: Payload,
  pages: readonly CompliancePageInput[],
): Promise<Map<string, boolean>> {
  const ids = new Set<string>()

  for (const page of pages) {
    for (const reference of collectMediaReferences(page.blocks)) {
      ids.add(reference.id)
    }
  }

  const result = new Map<string, boolean>()

  if (ids.size === 0) {
    return result
  }

  const found = await payload.find({
    collection: 'media',
    where: { id: { in: [...ids] } },
    ...READ,
  })

  for (const doc of found.docs as unknown as Record<string, unknown>[]) {
    result.set(String(doc.id), typeof doc.alt === 'string' && doc.alt.trim() !== '')
  }

  /**
   * Ссылка на несуществующий файл считается изображением без alt: показать
   * такое изображение всё равно не получится, и молчать об этом хуже, чем
   * сообщить не самой точной формулировкой.
   */
  for (const id of ids) {
    if (!result.has(id)) {
      result.set(id, false)
    }
  }

  return result
}

async function tenantChain(payload: Payload, siteId: string | number): Promise<string[]> {
  const result = await payload.find({ collection: 'tenants', ...READ })
  const nodes = new Map<string, TenantNode>()

  for (const doc of result.docs) {
    const record = doc as unknown as Record<string, unknown>
    const kind = record.kind

    if (kind !== 'brand' && kind !== 'region' && kind !== 'site') {
      continue
    }

    const parent = record.parent

    nodes.set(String(record.id), {
      id: String(record.id),
      slug: typeof record.slug === 'string' ? record.slug : '',
      kind,
      parentId:
        parent === null || parent === undefined
          ? null
          : typeof parent === 'object' && 'id' in parent
            ? String((parent as { id: unknown }).id)
            : String(parent),
    })
  }

  return buildChain(nodes, String(siteId)).map((node) => node.id)
}
