import { findBlock, isAllowedSlot, isAllowedVariant } from './registry'
import { validateBlockStyle } from './style'

import type { BlockStyle, BlockVisibility } from './style'

/**
 * Проверка дерева блоков страницы (ТЗ 2.2, 2.4).
 *
 * Обходит дерево целиком и собирает **все** расхождения, а не первое: редактор
 * должен увидеть полный список, а не чинить по одной ошибке за прогон.
 *
 * Не бросает ни при каких входных данных, включая заведомо испорченные. Дерево
 * приходит из поля JSON, то есть может содержать что угодно — в том числе
 * циклическую ссылку, если кто-то соберёт её программно.
 */

export interface BlockNode {
  readonly type?: unknown
  readonly variant?: unknown
  readonly props?: unknown
  readonly slots?: unknown
  readonly style?: Partial<BlockStyle>
  readonly visibility?: Partial<BlockVisibility>
  readonly dataSource?: unknown
}

export interface TreeIssue {
  readonly code:
    | 'unknown-type'
    | 'unknown-variant'
    | 'unknown-slot'
    | 'invalid-enum'
    | 'unknown-role'
    | 'not-data-bound'
    | 'missing-data-source'
    | 'restricted-block'
    | 'too-deep'
    | 'malformed'
  readonly path: string
  readonly message: string
}

export interface TreeContext {
  /** Имена семантических ролей, разрешённых для сайта. */
  readonly roles: ReadonlySet<string>
  /** Разрешены ли блоки, доступные только кросс-тенантной роли. */
  readonly allowRestricted?: boolean
}

/**
 * Предел вложенности.
 *
 * Три уровня покрывают всё осмысленное: секция → колонки → карточка. Глубже
 * — это не вёрстка, а способ собрать структуру, которую невозможно ни
 * отрисовать предсказуемо, ни удержать в голове при правке.
 */
export const MAX_BLOCK_DEPTH = 3

export function validateBlockTree(blocks: unknown, context: TreeContext): TreeIssue[] {
  const issues: TreeIssue[] = []
  /** Защита от циклической ссылки: дерево приходит из JSON и может быть собрано программно. */
  const seen = new Set<object>()

  walk(blocks, 'blocks', 1, issues, context, seen)

  return issues
}

function walk(
  value: unknown,
  path: string,
  depth: number,
  issues: TreeIssue[],
  context: TreeContext,
  seen: Set<object>,
): void {
  if (value === null || value === undefined) {
    return
  }

  if (!Array.isArray(value)) {
    issues.push({ code: 'malformed', path, message: 'Ожидался список блоков.' })
    return
  }

  if (depth > MAX_BLOCK_DEPTH) {
    issues.push({
      code: 'too-deep',
      path,
      message: `Вложенность глубже ${MAX_BLOCK_DEPTH} уровней: такую структуру невозможно отрисовать предсказуемо.`,
    })
    return
  }

  value.forEach((node, index) => {
    checkNode(node, `${path}[${index}]`, depth, issues, context, seen)
  })
}

function checkNode(
  node: unknown,
  path: string,
  depth: number,
  issues: TreeIssue[],
  context: TreeContext,
  seen: Set<object>,
): void {
  if (node === null || typeof node !== 'object') {
    issues.push({ code: 'malformed', path, message: 'Блок должен быть объектом.' })
    return
  }

  if (seen.has(node as object)) {
    issues.push({ code: 'malformed', path, message: 'Циклическая ссылка в дереве блоков.' })
    return
  }

  seen.add(node as object)

  const block = node as BlockNode
  const type = typeof block.type === 'string' ? block.type : ''
  const definition = findBlock(type)

  if (definition === undefined) {
    issues.push({
      code: 'unknown-type',
      path,
      message: `Тип блока «${type}» отсутствует в реестре. Реестр расширяется разработчиком.`,
    })
    return
  }

  if (definition.restricted === true && context.allowRestricted !== true) {
    issues.push({
      code: 'restricted-block',
      path,
      message: `Блок «${definition.title}» доступен только разработчику: произвольная разметка на витрине требует отдельных полномочий.`,
    })
  }

  const variant = typeof block.variant === 'string' ? block.variant : null

  if (!isAllowedVariant(type, variant)) {
    issues.push({
      code: 'unknown-variant',
      path,
      message: `Вариант «${variant}» не объявлен у типа «${type}». Доступны: ${definition.variants.join(', ') || '—'}.`,
    })
  }

  for (const issue of validateBlockStyle(block.style ?? {}, context.roles)) {
    issues.push({ code: issue.code, path: `${path}.style.${issue.field}`, message: issue.message })
  }

  checkDataSource(block, definition.boundTo, path, issues)

  if (block.slots !== null && block.slots !== undefined) {
    if (typeof block.slots !== 'object' || Array.isArray(block.slots)) {
      issues.push({
        code: 'malformed',
        path: `${path}.slots`,
        message: 'Слоты должны быть объектом.',
      })
      return
    }

    for (const [slot, children] of Object.entries(block.slots as Record<string, unknown>)) {
      if (!isAllowedSlot(type, slot)) {
        issues.push({
          code: 'unknown-slot',
          path: `${path}.slots.${slot}`,
          message: `Тип «${type}» не разрешает слот «${slot}».`,
        })
        continue
      }

      walk(children, `${path}.slots.${slot}`, depth + 1, issues, context, seen)
    }
  }
}

/**
 * Проверяет описание источника данных.
 *
 * Два симметричных нарушения: блок, не привязанный к коллекции, с источником —
 * и привязанный без источника. Первое означает, что редактор ждёт данных там,
 * где их не будет; второе — пустой блок на витрине.
 */
function checkDataSource(
  block: BlockNode,
  boundTo: string | undefined,
  path: string,
  issues: TreeIssue[],
): void {
  const source = block.dataSource

  if (boundTo === undefined) {
    if (source !== null && source !== undefined) {
      issues.push({
        code: 'not-data-bound',
        path: `${path}.dataSource`,
        message: 'У этого типа блока нет источника данных.',
      })
    }

    return
  }

  if (source === null || source === undefined) {
    issues.push({
      code: 'missing-data-source',
      path: `${path}.dataSource`,
      message: `Блок привязан к коллекции «${boundTo}», но запрос не описан — на витрине он будет пустым.`,
    })
    return
  }

  if (typeof source !== 'object' || Array.isArray(source)) {
    issues.push({
      code: 'malformed',
      path: `${path}.dataSource`,
      message: 'Источник данных должен быть объектом.',
    })
    return
  }

  const collection = (source as Record<string, unknown>).collection

  if (collection !== undefined && collection !== boundTo) {
    issues.push({
      code: 'not-data-bound',
      path: `${path}.dataSource.collection`,
      message: `Тип блока привязан к «${boundTo}», а источник указывает на «${String(collection)}».`,
    })
  }
}
