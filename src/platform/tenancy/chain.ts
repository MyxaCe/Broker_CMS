import type { TenantKind, TenantNode } from './types'

/**
 * Цепочка наследования `brand → region → site` (ТЗ 3.3).
 *
 * Цепочка строится и проверяется в одном месте, потому что почти всё остальное
 * на неё опирается: разрешение полей, правила доступа, сборка релиза. Кривая
 * цепочка не должна «частично работать» — она должна не строиться вовсе.
 */

export const MAX_CHAIN_DEPTH = 3

export class TenantChainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantChainError'
  }
}

/** Какие уровни допустимы в качестве родителя. */
const ALLOWED_PARENT_KINDS: Record<TenantKind, readonly TenantKind[]> = {
  brand: [],
  region: ['brand'],
  /**
   * Сайт допускается и под регионом, и напрямую под брендом.
   *
   * Требовать промежуточный регион всегда — значит заставлять бренд с одним
   * рынком заводить фиктивную сущность, которую потом придётся поддерживать
   * и объяснять редакторам. Пустой уровень наследования не добавляет ничего,
   * кроме шага в цепочке.
   */
  site: ['brand', 'region'],
}

/**
 * Строит цепочку от корня к листу и проверяет её форму.
 *
 * @throws {TenantChainError} при цикле, отсутствующем узле, превышении глубины
 * или нарушении порядка уровней.
 */
export function buildChain(nodes: ReadonlyMap<string, TenantNode>, leafId: string): TenantNode[] {
  const reversed: TenantNode[] = []
  const visited = new Set<string>()

  let currentId: string | null = leafId

  while (currentId !== null) {
    if (visited.has(currentId)) {
      throw new TenantChainError(
        `Цикл в цепочке наследования: тенант "${currentId}" встречается дважды.`,
      )
    }
    visited.add(currentId)

    const node = nodes.get(currentId)
    if (!node) {
      throw new TenantChainError(`Тенант "${currentId}" не найден.`)
    }

    reversed.push(node)

    if (reversed.length > MAX_CHAIN_DEPTH) {
      throw new TenantChainError(
        `Глубина цепочки превышает ${MAX_CHAIN_DEPTH}: допустимо brand → region → site.`,
      )
    }

    currentId = node.parentId
  }

  const chain = reversed.reverse()
  assertChainShape(chain)
  return chain
}

function assertChainShape(chain: readonly TenantNode[]): void {
  const [root, ...rest] = chain

  if (!root) {
    throw new TenantChainError('Пустая цепочка наследования.')
  }

  if (root.kind !== 'brand' || root.parentId !== null) {
    throw new TenantChainError(
      `Корнем цепочки обязан быть бренд без родителя, получен "${root.slug}" (${root.kind}).`,
    )
  }

  let previous = root

  for (const node of rest) {
    /**
     * Проверка «сайт — всегда лист» идёт первой намеренно.
     *
     * Формально её покрывает и проверка допустимого родителя ниже: сайт не
     * указан родителем ни для одного уровня. Но тогда редактор, повесивший
     * сайт под сайтом, получил бы сообщение «недопустимый родитель» вместо
     * прямого «сайт не может иметь потомков» — то есть менее точную причину.
     */
    if (previous.kind === 'site') {
      throw new TenantChainError(
        `Сайт не может иметь потомков: "${previous.slug}" стоит выше "${node.slug}".`,
      )
    }

    const allowedParents = ALLOWED_PARENT_KINDS[node.kind]

    if (!allowedParents.includes(previous.kind)) {
      throw new TenantChainError(
        `Недопустимый родитель: "${node.slug}" (${node.kind}) не может наследоваться от "${previous.slug}" (${previous.kind}).`,
      )
    }

    previous = node
  }
}

/**
 * Все потомки указанных тенантов, включая их самих.
 *
 * Нужно для правил доступа: привязка к бренду означает доступ ко всему его
 * поддереву, иначе администратору бренда пришлось бы перечислять сайты руками
 * и дописывать список при каждом запуске нового.
 */
export function collectSubtree(
  nodes: ReadonlyMap<string, TenantNode>,
  rootIds: readonly string[],
): string[] {
  const childrenByParent = new Map<string, string[]>()

  for (const node of nodes.values()) {
    if (node.parentId === null) continue
    const siblings = childrenByParent.get(node.parentId)
    if (siblings) {
      siblings.push(node.id)
    } else {
      childrenByParent.set(node.parentId, [node.id])
    }
  }

  const result = new Set<string>()
  const queue = [...rootIds]

  while (queue.length > 0) {
    const id = queue.pop()
    if (id === undefined || result.has(id)) continue
    if (!nodes.has(id)) continue

    result.add(id)
    queue.push(...(childrenByParent.get(id) ?? []))
  }

  return [...result]
}
