import type {
  CollectionEntry,
  CollectionLayerState,
  CollectionResolution,
  FieldResolution,
  LayerState,
  TenantNode,
} from './types'

/**
 * Разрешение наследуемых значений по цепочке `brand → region → site` (ТЗ 3.3).
 *
 * Функции чистые и ничего не знают ни о БД, ни о Payload: цепочка и слои
 * передаются явно. Это единственный способ покрыть тестами всё дерево случаев,
 * включая те, которые в живой системе воспроизводятся раз в полгода.
 */

/**
 * Разрешает скалярное или объектное поле.
 *
 * Побеждает ближайший к листу слой, задавший значение. Одновременно считается
 * то, что получится после «вернуть к наследуемому» — без этого админка не
 * может честно показать кнопку возврата: она обязана знать, к чему возвращает.
 */
export function resolveField<T>(
  chain: readonly TenantNode[],
  layers: ReadonlyMap<string, LayerState<T>>,
): FieldResolution<T> {
  const leaf = chain.at(-1)

  if (!leaf) {
    return emptyResolution()
  }

  const ancestors = chain.slice(0, -1)
  const inherited = resolveAcross(ancestors, layers)
  const leafState = layers.get(leaf.id) ?? { state: 'unset' as const }

  if (leafState.state === 'unset') {
    return {
      value: inherited?.value,
      provenance: inherited ? 'inherited' : 'unset',
      sourceTenantId: inherited?.tenantId ?? null,
      inheritedValue: inherited?.value,
      inheritedFromTenantId: inherited?.tenantId ?? null,
    }
  }

  return {
    value: leafState.value,
    provenance: leafState.state === 'fork' ? 'forked' : 'overridden',
    sourceTenantId: leaf.id,
    inheritedValue: inherited?.value,
    inheritedFromTenantId: inherited?.tenantId ?? null,
  }
}

/** Значение можно вернуть к наследуемому, только если лист сам его задал. */
export function canRevertToInherited<T>(resolution: FieldResolution<T>): boolean {
  return resolution.provenance === 'overridden' || resolution.provenance === 'forked'
}

/**
 * Возврат к наследуемому оставит поле пустым — значит, для обязательного поля
 * это не «сброс», а удаление значения. Админка обязана предупредить, а
 * валидатор сборки релиза — не пропустить.
 */
export function revertLeavesEmpty<T>(resolution: FieldResolution<T>): boolean {
  return canRevertToInherited(resolution) && resolution.inheritedValue === undefined
}

function resolveAcross<T>(
  chain: readonly TenantNode[],
  layers: ReadonlyMap<string, LayerState<T>>,
): { value: T; tenantId: string } | null {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const node = chain[index]
    if (!node) continue

    const layer = layers.get(node.id)
    if (layer && layer.state !== 'unset') {
      return { value: layer.value, tenantId: node.id }
    }
  }

  return null
}

function emptyResolution<T>(): FieldResolution<T> {
  return {
    value: undefined,
    provenance: 'unset',
    sourceTenantId: null,
    inheritedValue: undefined,
    inheritedFromTenantId: null,
  }
}

/**
 * Разрешает коллекцию: библиотеку блоков, набор шаблонов, правовой каркас.
 *
 * Идём от корня к листу, накапливая элементы. Слой в состоянии `fork`
 * обнуляет накопленное и начинает со своего снимка — в этом и состоит отвязка:
 * элементы, добавленные родителем после форка, сюда уже не приезжают.
 *
 * Слой `extend` добавляет новые ключи и переопределяет существующие, сохраняя
 * связь с родителем.
 */
export function resolveCollection<T>(
  chain: readonly TenantNode[],
  layers: ReadonlyMap<string, CollectionLayerState<T>>,
): CollectionResolution<T> {
  const leafId = chain.at(-1)?.id ?? null
  let accumulated = new Map<string, CollectionEntry<T>>()
  let forkedAtTenantId: string | null = null

  for (const node of chain) {
    const layer = layers.get(node.id)
    if (!layer || layer.state === 'unset') continue

    if (layer.state === 'fork') {
      accumulated = new Map()
      forkedAtTenantId = node.id
    }

    for (const [key, value] of layer.items) {
      accumulated.set(key, {
        key,
        value,
        provenance: provenanceFor(node.id, leafId, layer.state),
        sourceTenantId: node.id,
      })
    }
  }

  return {
    entries: [...accumulated.values()].sort((left, right) => left.key.localeCompare(right.key)),
    forkedAtTenantId,
  }
}

function provenanceFor(
  tenantId: string,
  leafId: string | null,
  layerState: 'extend' | 'fork',
): CollectionEntry<unknown>['provenance'] {
  if (tenantId !== leafId) {
    return 'inherited'
  }
  return layerState === 'fork' ? 'forked' : 'overridden'
}
