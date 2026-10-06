import { buildChain } from '@/platform'

import { tokenSetFromDocs } from './from-docs'
import { resolveTokens } from './resolve'

import type { ResolvedTokens } from './resolve'
import type { TokenSet } from './types'
import type { TenantNode } from '@/platform'
import type { Payload } from 'payload'

/**
 * Чтение набора токенов сайта с учётом наследования (ТЗ 2.1, 3.3).
 *
 * Порядок слияния — от дальнего предка к ближнему: бренд, регион, сайт.
 * Обратный порядок означал бы, что бренд перекрывает сайт, то есть локальная
 * настройка не действует.
 */

/**
 * `overrideAccess: true` здесь обоснован и безопасен: токены и так открыты на
 * чтение всем, а результат используется для сборки набора, а не отдаётся как
 * список записей.
 */
const READ = { pagination: false, depth: 0, overrideAccess: true } as const

export async function loadTokenSet(args: {
  readonly payload: Payload
  readonly siteId: string | number
}): Promise<{ resolved: ResolvedTokens; chain: readonly string[] }> {
  const nodes = await loadTenantNodes(args.payload)
  const chain = buildChain(nodes, String(args.siteId))
  const chainIds = chain.map((node) => node.id)

  if (chainIds.length === 0) {
    return { resolved: resolveTokens(emptySet()), chain: [] }
  }

  const [primitives, roles, components] = await Promise.all([
    args.payload.find({
      collection: 'design-primitives',
      where: { owner: { in: chainIds } },
      ...READ,
    }),
    args.payload.find({
      collection: 'design-roles',
      where: { owner: { in: chainIds } },
      ...READ,
    }),
    args.payload.find({
      collection: 'design-component-tokens',
      where: { owner: { in: chainIds } },
      ...READ,
    }),
  ])

  /**
   * Наборы раскладываются по узлам и сливаются в порядке цепочки. Разбор
   * записей и порядок слияния живут в `from-docs.ts`: тем же разбором
   * пользуется живой предпросмотр палитры в админке, и вторая реализация
   * показывала бы редактору не тот набор, который соберётся.
   */
  const set = tokenSetFromDocs(chainIds, {
    primitives: primitives.docs,
    roles: roles.docs,
    components: components.docs,
  })

  return { resolved: resolveTokens(set), chain: chainIds }
}

function emptySet(): TokenSet {
  return { primitives: [], roles: [], components: [] }
}

async function loadTenantNodes(payload: Payload): Promise<ReadonlyMap<string, TenantNode>> {
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

  return nodes
}
