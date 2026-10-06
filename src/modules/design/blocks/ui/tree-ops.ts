import { emptyProps } from '../props'
import { findBlock, isAllowedSlot, propsOf } from '../registry'
import { DEFAULT_BLOCK_STYLE, DEFAULT_BLOCK_VISIBILITY } from '../style'
import { MAX_BLOCK_DEPTH } from '../validate-tree'

/**
 * Операции над деревом блоков для конструктора ([[DEBT-011]]).
 *
 * Живут отдельно от React и ничего о нём не знают. Причина простая: именно
 * здесь ошибаются. «Переместить вверх» на границе списка, «удалить» из
 * вложенного слота, «дублировать» ветку с потомками — это места, где правка
 * молча теряет содержимое, а заметить потерю можно только по тому, что блок
 * исчез со страницы.
 *
 * Компоненты поверх остаются тонкими: они показывают дерево и зовут эти
 * функции. Проверяются функции, а не разметка.
 */

/**
 * Адрес узла: чередование индекса и имени слота.
 *
 * `[0]` — первый блок верхнего уровня, `[0, 'columns', 1]` — второй блок в
 * слоте `columns` первого блока.
 */
export type BlockPath = readonly (number | string)[]

export interface EditorBlock {
  readonly type: string
  readonly variant?: string
  readonly props?: Record<string, unknown>
  readonly slots?: Record<string, EditorBlock[]>
  readonly style?: Record<string, unknown>
  readonly visibility?: Record<string, unknown>
  readonly dataSource?: Record<string, unknown>
}

/**
 * Приводит содержимое поля JSON к списку блоков.
 *
 * Поле может содержать что угодно: его правили руками до появления
 * конструктора. Мусор не роняет редактор и не стирается молча — он просто не
 * попадает в список, а исходное значение остаётся в поле, пока редактор не
 * сохранит дерево заново.
 */
export function toBlockList(value: unknown): EditorBlock[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((node) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return []
    }

    const record = node as Record<string, unknown>

    if (typeof record.type !== 'string') {
      return []
    }

    return [record as unknown as EditorBlock]
  })
}

/** Новый блок: пропсы-заготовка, умолчания стиля, пустые разрешённые слоты. */
export function createBlock(type: string): EditorBlock {
  const definition = findBlock(type)

  const slots: Record<string, EditorBlock[]> = {}

  for (const slot of definition?.slots ?? []) {
    slots[slot] = []
  }

  const block: Record<string, unknown> = {
    type,
    props: emptyProps(propsOf(type)),
    style: { ...DEFAULT_BLOCK_STYLE },
    visibility: { ...DEFAULT_BLOCK_VISIBILITY },
  }

  if (definition !== undefined && definition.variants.length > 0) {
    block.variant = definition.variants[0]
  }

  if (Object.keys(slots).length > 0) {
    block.slots = slots
  }

  /**
   * Привязанному блоку сразу проставляется источник: без него дерево не
   * проходит проверку, и редактор увидел бы отказ, ничего ещё не сделав.
   */
  if (definition?.boundTo !== undefined) {
    block.dataSource = { collection: definition.boundTo, limit: 6 }
  }

  return block as unknown as EditorBlock
}

export function getNode(tree: readonly EditorBlock[], path: BlockPath): EditorBlock | undefined {
  const found = locate(tree, path)

  return found === null ? undefined : found.list[found.index]
}

/** Список, в котором лежит узел, и его позиция в этом списке. */
function locate(
  tree: readonly EditorBlock[],
  path: BlockPath,
): { list: readonly EditorBlock[]; index: number } | null {
  if (path.length === 0 || path.length % 2 === 0) {
    return null
  }

  let list: readonly EditorBlock[] = tree

  for (let step = 0; step < path.length - 1; step += 2) {
    const index = path[step]
    const slot = path[step + 1]

    if (typeof index !== 'number' || typeof slot !== 'string') {
      return null
    }

    const node = list[index]

    if (node === undefined) {
      return null
    }

    const children = node.slots?.[slot]

    if (!Array.isArray(children)) {
      return null
    }

    list = children
  }

  const last = path[path.length - 1]

  if (typeof last !== 'number' || last < 0 || last >= list.length) {
    return null
  }

  return { list, index: last }
}

/**
 * Заменяет список, в котором лежит адресуемый узел.
 *
 * Всё остальное — вставка, удаление, перемещение, правка — выражено через это
 * одно место. Каждая операция со своим обходом дерева означала бы четыре
 * способа ошибиться во вложенности вместо одного.
 */
function replaceList(
  tree: readonly EditorBlock[],
  path: BlockPath,
  change: (list: readonly EditorBlock[]) => EditorBlock[],
): EditorBlock[] {
  if (path.length === 0) {
    return change(tree)
  }

  const index = path[0]
  const slot = path[1]

  if (typeof index !== 'number' || typeof slot !== 'string') {
    return [...tree]
  }

  const node = tree[index]

  if (node === undefined) {
    return [...tree]
  }

  const children = node.slots?.[slot] ?? []
  const next = [...tree]

  next[index] = {
    ...node,
    slots: { ...(node.slots ?? {}), [slot]: replaceList(children, path.slice(2), change) },
  }

  return next
}

/** Адрес списка, в котором лежит узел: адрес без последнего индекса. */
function listPathOf(path: BlockPath): BlockPath {
  return path.slice(0, -1)
}

export function updateNode(
  tree: readonly EditorBlock[],
  path: BlockPath,
  updater: (node: EditorBlock) => EditorBlock,
): EditorBlock[] {
  const found = locate(tree, path)

  if (found === null) {
    return [...tree]
  }

  const index = found.index

  return replaceList(tree, listPathOf(path), (list) => {
    const next = [...list]
    const node = next[index]

    if (node !== undefined) {
      next[index] = updater(node)
    }

    return next
  })
}

/** Правит одно свойство блока. Отдельно — потому что это девять десятых правок. */
export function setProp(
  tree: readonly EditorBlock[],
  path: BlockPath,
  name: string,
  value: unknown,
): EditorBlock[] {
  return updateNode(tree, path, (node) => ({
    ...node,
    props: { ...(node.props ?? {}), [name]: value },
  }))
}

export function insertBlock(
  tree: readonly EditorBlock[],
  listPath: BlockPath,
  index: number,
  block: EditorBlock,
): EditorBlock[] {
  return replaceList(tree, listPath, (list) => {
    const next = [...list]
    /** Позиция вне списка означает «в конец»: это добавление, а не промах. */
    const at = index < 0 || index > next.length ? next.length : index

    next.splice(at, 0, block)

    return next
  })
}

export function removeBlock(tree: readonly EditorBlock[], path: BlockPath): EditorBlock[] {
  const found = locate(tree, path)

  if (found === null) {
    return [...tree]
  }

  const index = found.index

  return replaceList(tree, listPathOf(path), (list) => {
    const next = [...list]
    next.splice(index, 1)

    return next
  })
}

/**
 * Двигает блок внутри его списка.
 *
 * За пределы списка блок не уходит: перенос из колонки на верхний уровень —
 * это другое действие, и делать его незаметным продолжением «вверх» нельзя.
 * Упор в границу ничего не меняет.
 */
export function moveBlock(
  tree: readonly EditorBlock[],
  path: BlockPath,
  delta: number,
): EditorBlock[] {
  const found = locate(tree, path)

  if (found === null) {
    return [...tree]
  }

  const from = found.index
  const to = from + delta

  if (to < 0 || to >= found.list.length) {
    return [...tree]
  }

  return replaceList(tree, listPathOf(path), (list) => {
    const next = [...list]
    const [node] = next.splice(from, 1)

    if (node !== undefined) {
      next.splice(to, 0, node)
    }

    return next
  })
}

/**
 * Копия блока со всем содержимым, рядом с оригиналом.
 *
 * Копирование глубокое: поверхностная копия разделила бы с оригиналом слоты и
 * пропсы, и правка копии молча меняла бы оригинал.
 */
export function duplicateBlock(tree: readonly EditorBlock[], path: BlockPath): EditorBlock[] {
  const node = getNode(tree, path)

  if (node === undefined) {
    return [...tree]
  }

  const found = locate(tree, path)!

  return insertBlock(tree, listPathOf(path), found.index + 1, deepCopy(node))
}

function deepCopy(node: EditorBlock): EditorBlock {
  return JSON.parse(JSON.stringify(node)) as EditorBlock
}

/** Человекочитаемая подпись узла в дереве: тип и первое заполненное поле. */
export function describeBlock(node: EditorBlock): string {
  const definition = findBlock(node.type)
  const title = definition?.title ?? node.type

  const props = node.props ?? {}

  for (const field of propsOf(node.type)) {
    const value = props[field.name]

    if (typeof value === 'string' && value.trim() !== '') {
      const short = value.trim()

      return `${title} — ${short.length > 40 ? `${short.slice(0, 40)}…` : short}`
    }
  }

  return title
}

/**
 * Перенос блока мышью ([[DEBT-011]], ADR-0034).
 *
 * Отдельно от `moveBlock`, потому что это другая операция. `moveBlock`
 * двигает на шаг внутри своего списка и упирается в границу; перенос мышью
 * забирает блок из одного списка и кладёт в другой, в том числе в слот
 * другого блока и на другой уровень вложенности.
 *
 * Именно здесь легко потерять ветку. Три способа:
 *
 *  · **положить блок в собственный слот** — узел исчезает вместе с
 *    потомками, потому что удаляется из дерева раньше, чем вставляется в
 *    свою же копию;
 *  · **съехать на единицу** при переносе внутри одного списка — удаление
 *    сдвигает индексы, и блок встаёт не туда, куда его отпустили;
 *  · **положить в слот, которого у типа нет** — дерево станет непроходимым
 *    для рендерера, и узнает об этом сборка релиза, а не редактор.
 *
 * Все три проверяются тестами, и ни один из них не виден на разметке.
 */

/** Можно ли перенести узел в указанный список. */
export type DropVerdict =
  { readonly kind: 'allow' } | { readonly kind: 'refuse'; readonly reason: string }

/** Адрес списка — префикс адреса узла: `[]`, `[0, 'columns']`, … */
function isPrefixOf(prefix: BlockPath, path: BlockPath): boolean {
  if (prefix.length > path.length) {
    return false
  }

  return prefix.every((part, index) => part === path[index])
}

/**
 * Глубина списка в уровнях вложенности. Верхний уровень — 1, слот блока
 * верхнего уровня — 2. Считается так же, как в `validateBlockTree`: иначе
 * редактор и сборка разошлись бы в том, что считать «глубже трёх».
 */
export function listDepth(listPath: BlockPath): number {
  return 1 + listPath.length / 2
}

/** Насколько глубока ветка под узлом: сам узел — 1. */
export function subtreeHeight(node: EditorBlock): number {
  const children = Object.values(node.slots ?? {}).flatMap((list) =>
    Array.isArray(list) ? list : [],
  )

  if (children.length === 0) {
    return 1
  }

  return 1 + Math.max(...children.map((child) => subtreeHeight(child)))
}

export function canDropInto(
  tree: readonly EditorBlock[],
  from: BlockPath,
  toListPath: BlockPath,
): DropVerdict {
  const node = getNode(tree, from)

  if (node === undefined) {
    return { kind: 'refuse', reason: 'Перетаскиваемый блок не найден.' }
  }

  /**
   * Собственный слот и слот любого потомка. Проверка идёт по адресу, а не по
   * ссылке на объект: адрес переживает пересоздание узлов, а ссылка — нет.
   */
  if (isPrefixOf(from, toListPath)) {
    return {
      kind: 'refuse',
      reason: 'Блок нельзя вложить в самого себя или в свой же слот — ветка была бы потеряна.',
    }
  }

  if (toListPath.length > 0) {
    const parentPath = toListPath.slice(0, -1)
    const slot = toListPath[toListPath.length - 1]
    const parent = getNode(tree, parentPath)

    if (parent === undefined || typeof slot !== 'string') {
      return { kind: 'refuse', reason: 'Целевой слот не найден.' }
    }

    if (!isAllowedSlot(parent.type, slot)) {
      return {
        kind: 'refuse',
        reason: `Блок «${parent.type}» не принимает содержимое в слот «${slot}».`,
      }
    }
  }

  const depth = listDepth(toListPath) + subtreeHeight(node) - 1

  if (depth > MAX_BLOCK_DEPTH) {
    return {
      kind: 'refuse',
      reason: `Вложенность стала бы глубже ${MAX_BLOCK_DEPTH} уровней: такую структуру невозможно отрисовать предсказуемо.`,
    }
  }

  return { kind: 'allow' }
}

/**
 * Переносит узел в указанную позицию другого (или того же) списка.
 *
 * Запрещённый перенос **возвращает дерево неизменным**, а не бросает: отказ
 * показывает интерфейс до отпускания кнопки, и падать здесь было бы поздно.
 * Тот же результат при тех же аргументах — и при неверном адресе тоже.
 */
export function moveBlockTo(
  tree: readonly EditorBlock[],
  from: BlockPath,
  toListPath: BlockPath,
  toIndex: number,
): EditorBlock[] {
  if (canDropInto(tree, from, toListPath).kind === 'refuse') {
    return [...tree]
  }

  const node = getNode(tree, from)

  if (node === undefined) {
    return [...tree]
  }

  const fromListPath = from.slice(0, -1)
  const fromIndex = from[from.length - 1]

  if (typeof fromIndex !== 'number') {
    return [...tree]
  }

  const sameList =
    fromListPath.length === toListPath.length &&
    fromListPath.every((part, index) => part === toListPath[index])

  /**
   * Сдвиг индексов при переносе внутри одного списка.
   *
   * Узел сначала вынимается, и всё, что было после него, съезжает на один
   * влево. Позиция, на которую его отпустили, считалась **до** изъятия —
   * значит при движении вниз её надо уменьшить на единицу. Без этого блок
   * встаёт на место раньше нужного, и выглядит это как «перетаскивание не
   * работает», а не как ошибка на единицу.
   */
  const target = sameList && toIndex > fromIndex ? toIndex - 1 : toIndex

  /**
   * Тот же сдвиг, но в **адресе назначения**, и он не очевиден.
   *
   * `[1, 'columns']` — это слот второго блока. Вынули первый — второй стал
   * первым, и прежний адрес указывает в чужой слот либо в пустоту. Поймано
   * собственным тестом на переносе сверху в слот: блок исчезал, и дерево при
   * этом оставалось правильным деревом, то есть ни одна проверка формы не
   * сработала бы.
   */
  const destination = shiftAfterRemoval(toListPath, fromListPath, fromIndex)

  const without = removeBlock(tree, from)

  return insertBlock(without, destination, target, node)
}

/**
 * Поправляет адрес после изъятия узла из списка.
 *
 * Трогается ровно один сегмент: индекс в том самом списке, из которого
 * вынули узел. Остальные уровни изъятие не затрагивает.
 */
function shiftAfterRemoval(
  path: BlockPath,
  removedFromList: BlockPath,
  removedIndex: number,
): BlockPath {
  const at = removedFromList.length

  if (path.length <= at) {
    return path
  }

  if (!removedFromList.every((part, index) => part === path[index])) {
    return path
  }

  const here = path[at]

  if (typeof here !== 'number' || here <= removedIndex) {
    return path
  }

  const next = [...path]
  next[at] = here - 1

  return next
}
