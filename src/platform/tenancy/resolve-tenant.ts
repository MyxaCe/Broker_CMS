import { normalizeRelationId } from '../shared/relation'

import { buildChain, MAX_CHAIN_DEPTH } from './chain'
import { resolveTenantSettings } from './layers'

import type { TenantLayerSource, TenantSettings } from './layers'
import type { TenantKind, TenantNode } from './types'
import type { Payload } from 'payload'

/**
 * Сборка цепочки наследования для конкретного тенанта и разрешение его
 * настроек.
 *
 * Отделено от чистой логики (`layers.ts`, `chain.ts`) намеренно: здесь
 * единственное, что происходит, — чтение предков из базы. Всё остальное
 * остаётся проверяемым без неё.
 */

/** Идентификатор для ещё не сохранённого документа. */
const UNSAVED = '__unsaved__'

function toNode(data: Record<string, unknown>, fallbackId: string): TenantNode {
  const kind = data.kind
  return {
    id: normalizeRelationId(data.id) ?? fallbackId,
    slug: typeof data.slug === 'string' ? data.slug : '',
    kind: kind === 'brand' || kind === 'region' || kind === 'site' ? (kind as TenantKind) : 'site',
    parentId: normalizeRelationId(data.parent),
  }
}

/**
 * Загружает предков и собирает слои от корня к листу.
 *
 * Лист передаётся документом, а не идентификатором: при сохранении он ещё не
 * записан, и проверять нужно именно то состояние, которое пытаются сохранить.
 *
 * Форма цепочки проверяется здесь же — `buildChain` отвергает циклы, лишнюю
 * глубину и недопустимый порядок уровней. То есть сохранение тенанта заодно
 * проверяет и всю ветку над ним.
 */
export async function loadTenantLayers(
  payload: Payload,
  leafData: Record<string, unknown>,
): Promise<TenantLayerSource[]> {
  const leaf = toNode(leafData, UNSAVED)

  const nodes = new Map<string, TenantNode>([[leaf.id, leaf]])
  const documents = new Map<string, Record<string, unknown>>([[leaf.id, leafData]])

  let parentId = leaf.parentId
  let guard = 0

  while (parentId !== null) {
    if (nodes.has(parentId)) {
      // Цикл: дальше пусть разбирается buildChain — у него внятное сообщение.
      break
    }

    guard += 1
    if (guard > MAX_CHAIN_DEPTH) {
      break
    }

    const doc = (await payload.findByID({
      collection: 'tenants',
      id: parentId,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>

    const node = toNode(doc, parentId)
    nodes.set(node.id, node)
    documents.set(node.id, doc)
    parentId = node.parentId
  }

  return buildChain(nodes, leaf.id).map((node) => ({
    node,
    data: documents.get(node.id) ?? {},
  }))
}

/**
 * Разрешает настройки по документу листа.
 *
 * Документ передаётся целиком: при сохранении он ещё не записан, и проверять
 * нужно именно то состояние, которое пытаются сохранить.
 */
export async function resolveTenant(
  payload: Payload,
  leafData: Record<string, unknown>,
): Promise<TenantSettings> {
  return resolveTenantSettings(await loadTenantLayers(payload, leafData))
}

/**
 * Разрешает настройки уже сохранённого тенанта.
 *
 * Отдельная функция, потому что передать сюда «почти документ» — распространённая
 * ошибка: собственные значения листа окажутся потеряны, и результат будет
 * выглядеть как полностью унаследованный. Здесь лист читается целиком из базы.
 */
export async function resolveTenantById(
  payload: Payload,
  id: number | string,
): Promise<TenantSettings> {
  const doc = (await payload.findByID({
    collection: 'tenants',
    id,
    depth: 0,
    overrideAccess: true,
  })) as unknown as Record<string, unknown>

  return resolveTenant(payload, doc)
}
