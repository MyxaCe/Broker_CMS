import { buildChain } from '@/platform'

import { mergeTokenSets, resolveTokens } from './resolve'

import type { ResolvedTokens } from './resolve'
import type { ComponentToken, Primitive, SemanticRole, TokenSet } from './types'
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
   * Наборы раскладываются по узлам и сливаются в порядке цепочки. Сортировать
   * плоский список нельзя: порядок выдачи базы не совпадает с порядком
   * наследования, и перекрытие получилось бы случайным.
   */
  const sets = chainIds.map((id) => ({
    primitives: pick<Primitive>(primitives.docs, id, toPrimitive),
    roles: pick<SemanticRole>(roles.docs, id, toRole),
    components: pick<ComponentToken>(components.docs, id, toComponent),
  }))

  return { resolved: resolveTokens(mergeTokenSets(sets)), chain: chainIds }
}

function emptySet(): TokenSet {
  return { primitives: [], roles: [], components: [] }
}

function ownerIdOf(doc: Record<string, unknown>): string {
  const owner = doc.owner

  if (owner !== null && typeof owner === 'object' && 'id' in owner) {
    return String((owner as { id: unknown }).id)
  }

  return owner === null || owner === undefined ? '' : String(owner)
}

function pick<T>(
  docs: readonly unknown[],
  ownerId: string,
  map: (doc: Record<string, unknown>) => T,
): T[] {
  return (docs as Record<string, unknown>[])
    .filter((doc) => ownerIdOf(doc) === ownerId)
    .map((doc) => map(doc))
}

function toPrimitive(doc: Record<string, unknown>): Primitive {
  return {
    name: String(doc.name),
    category: doc.category as Primitive['category'],
    value: String(doc.value),
  }
}

function toRole(doc: Record<string, unknown>): SemanticRole {
  return {
    name: String(doc.name),
    group: doc.group as SemanticRole['group'],
    light: String(doc.light),
    dark: String(doc.dark),
  }
}

function toComponent(doc: Record<string, unknown>): ComponentToken {
  return {
    name: String(doc.name),
    source: doc.source as ComponentToken['source'],
    reference: String(doc.reference),
  }
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
