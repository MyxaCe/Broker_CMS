import { MAX_NAV_DEPTH, NAV_TARGETS } from '../tree'

import type { NavLayout, NavTarget } from '../tree'

/**
 * Операции над деревом навигации для редактора ([[DEBT-011]], ADR-0034).
 *
 * ТЗ 2.2 прямо требует «отдельную древовидную структуру **со своим
 * редактором**». Модель была собрана полностью, включая признак мега-меню
 * (ADR-0033), — не хватало именно редактора: дерево правилось полем JSON.
 *
 * Живут отдельно от React, как и операции над деревом блоков, и по той же
 * причине: ошибаются здесь. Разница с блоками одна, но существенная — у
 * пункта меню дети лежат прямо в `children`, а не в именованных слотах,
 * поэтому адрес здесь просто цепочка индексов. Общий код с блоками был бы
 * обобщением двух разных форм ради экономии тридцати строк.
 */

/** Адрес пункта: индексы по уровням. `[1, 0]` — первый ребёнок второго пункта. */
export type NavPath = readonly number[]

export interface EditorNavItem {
  readonly label: string
  readonly target: NavTarget
  readonly pageId?: string | null
  readonly href?: string | null
  readonly openInNewTab?: boolean
  readonly layout?: NavLayout
  readonly children?: EditorNavItem[]
  /**
   * Поля модели, которых редактор не показывает, обязаны **переживать**
   * правку. Иначе открытие меню в новом интерфейсе молча стирает то, что в
   * него заложили раньше, — и заметить это можно только по пропавшему
   * поведению на витрине.
   */
  readonly [extra: string]: unknown
}

/** Приводит значение поля JSON к списку пунктов, не стирая непонятое. */
export function toNavList(value: unknown): EditorNavItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((node) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return []
    }

    const record = node as Record<string, unknown>
    const target = typeof record.target === 'string' ? record.target : ''

    return [
      {
        ...record,
        label: typeof record.label === 'string' ? record.label : '',
        target: (NAV_TARGETS as readonly string[]).includes(target)
          ? (target as NavTarget)
          : 'page',
        children: toNavList(record.children),
      } as EditorNavItem,
    ]
  })
}

export function createNavItem(): EditorNavItem {
  return { label: '', target: 'page', pageId: null, children: [] }
}

function childrenOf(item: EditorNavItem): EditorNavItem[] {
  return Array.isArray(item.children) ? item.children : []
}

export function getNavItem(
  list: readonly EditorNavItem[],
  path: NavPath,
): EditorNavItem | undefined {
  if (path.length === 0) {
    return undefined
  }

  const [head, ...rest] = path
  const node = list[head as number]

  if (node === undefined) {
    return undefined
  }

  return rest.length === 0 ? node : getNavItem(childrenOf(node), rest)
}

/**
 * Заменяет список, в котором лежит адресуемый пункт.
 *
 * Как и у блоков: вставка, удаление, перенос и правка выражены через одно
 * место. Четыре собственных обхода дерева — это четыре способа ошибиться во
 * вложенности вместо одного.
 */
function replaceList(
  list: readonly EditorNavItem[],
  parentPath: NavPath,
  change: (items: readonly EditorNavItem[]) => EditorNavItem[],
): EditorNavItem[] {
  if (parentPath.length === 0) {
    return change(list)
  }

  const [head, ...rest] = parentPath
  const index = head as number
  const node = list[index]

  if (node === undefined) {
    return [...list]
  }

  const next = [...list]
  next[index] = { ...node, children: replaceList(childrenOf(node), rest, change) }

  return next
}

export function setNavField(
  list: readonly EditorNavItem[],
  path: NavPath,
  name: string,
  value: unknown,
): EditorNavItem[] {
  if (path.length === 0) {
    return [...list]
  }

  const index = path[path.length - 1] as number

  return replaceList(list, path.slice(0, -1), (items) => {
    const next = [...items]
    const node = next[index]

    if (node !== undefined) {
      next[index] = { ...node, [name]: value }
    }

    return next
  })
}

export function insertNavItem(
  list: readonly EditorNavItem[],
  parentPath: NavPath,
  index: number,
  item: EditorNavItem,
): EditorNavItem[] {
  return replaceList(list, parentPath, (items) => {
    const next = [...items]
    const at = index < 0 || index > next.length ? next.length : index

    next.splice(at, 0, item)

    return next
  })
}

export function removeNavItem(list: readonly EditorNavItem[], path: NavPath): EditorNavItem[] {
  if (path.length === 0) {
    return [...list]
  }

  const index = path[path.length - 1] as number

  return replaceList(list, path.slice(0, -1), (items) => {
    const next = [...items]
    next.splice(index, 1)

    return next
  })
}

/** Сдвиг на шаг внутри своего списка. Упор в границу ничего не меняет. */
export function moveNavItem(
  list: readonly EditorNavItem[],
  path: NavPath,
  delta: number,
): EditorNavItem[] {
  if (path.length === 0) {
    return [...list]
  }

  const index = path[path.length - 1] as number
  const parentPath = path.slice(0, -1)
  const siblings = parentPath.length === 0 ? list : childrenOf(getNavItem(list, parentPath)!)
  const to = index + delta

  if (to < 0 || to >= siblings.length) {
    return [...list]
  }

  return replaceList(list, parentPath, (items) => {
    const next = [...items]
    const [node] = next.splice(index, 1)

    if (node !== undefined) {
      next.splice(to, 0, node)
    }

    return next
  })
}

/** Глубина поддерева: сам пункт — 1. */
export function navHeight(item: EditorNavItem): number {
  const children = childrenOf(item)

  if (children.length === 0) {
    return 1
  }

  return 1 + Math.max(...children.map((child) => navHeight(child)))
}

export type NavDropVerdict =
  { readonly kind: 'allow' } | { readonly kind: 'refuse'; readonly reason: string }

function isPrefixOf(prefix: NavPath, path: NavPath): boolean {
  return prefix.length <= path.length && prefix.every((part, index) => part === path[index])
}

export function canDropNav(
  list: readonly EditorNavItem[],
  from: NavPath,
  toParentPath: NavPath,
): NavDropVerdict {
  const node = getNavItem(list, from)

  if (node === undefined) {
    return { kind: 'refuse', reason: 'Перетаскиваемый пункт не найден.' }
  }

  if (isPrefixOf(from, toParentPath)) {
    return {
      kind: 'refuse',
      reason: 'Пункт нельзя вложить в самого себя или в свой подраздел — ветка была бы потеряна.',
    }
  }

  const depth = toParentPath.length + 1 + navHeight(node) - 1

  if (depth > MAX_NAV_DEPTH) {
    return {
      kind: 'refuse',
      reason: `Вложенность глубже ${MAX_NAV_DEPTH} уровней: на такой глубине пункт уже не находят.`,
    }
  }

  return { kind: 'allow' }
}

/**
 * Перенос пункта мышью.
 *
 * Те же две поправки, что у блоков, и обе невидимы на экране: индекс внутри
 * своего списка съезжает после изъятия, и **адрес назначения** съезжает
 * вместе с ним, если цель лежит после изъятого в общем предке.
 */
export function moveNavItemTo(
  list: readonly EditorNavItem[],
  from: NavPath,
  toParentPath: NavPath,
  toIndex: number,
): EditorNavItem[] {
  if (canDropNav(list, from, toParentPath).kind === 'refuse') {
    return [...list]
  }

  const node = getNavItem(list, from)

  if (node === undefined || from.length === 0) {
    return [...list]
  }

  const fromParent = from.slice(0, -1)
  const fromIndex = from[from.length - 1] as number

  const sameList =
    fromParent.length === toParentPath.length &&
    fromParent.every((part, index) => part === toParentPath[index])

  const target = sameList && toIndex > fromIndex ? toIndex - 1 : toIndex
  const destination = shiftAfterRemoval(toParentPath, fromParent, fromIndex)

  return insertNavItem(removeNavItem(list, from), destination, target, node)
}

function shiftAfterRemoval(path: NavPath, removedParent: NavPath, removedIndex: number): NavPath {
  const at = removedParent.length

  if (path.length <= at || !removedParent.every((part, index) => part === path[index])) {
    return path
  }

  const here = path[at]

  if (here === undefined || here <= removedIndex) {
    return path
  }

  const next = [...path]
  next[at] = here - 1

  return next
}
