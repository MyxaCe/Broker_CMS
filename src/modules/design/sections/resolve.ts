import { pickNearest } from '../structure/inherit'

/**
 * Переиспользуемые секции (ТЗ 2.2).
 *
 * > «переиспользуемые секции (наследуются бренд→регион→сайт)»
 *
 * Секция — именованное поддерево блоков, принадлежащее тенанту. Страница
 * ссылается на неё блоком `section-ref`, а не хранит копию: «Как открыть счёт»
 * стоит на десятке страниц, и правка обязана доехать до всех сразу.
 */

export const SECTION_KEY_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export interface SectionRecord {
  readonly key: string
  readonly locale: string
  readonly ownerId: string
  readonly isActive: boolean
  readonly blocks: unknown
}

export interface ResolvedSection extends SectionRecord {
  /** Совпадает ли владелец с самим сайтом. */
  readonly provenance: 'own' | 'inherited'
}

/**
 * Выбирает действующие секции для сайта.
 *
 * Ближайший к листу владелец побеждает: секция сайта перекрывает одноимённую
 * секцию бренда. Это то же правило, что и у остальных наследуемых сущностей, —
 * иначе редактору пришлось бы помнить, для чего оно другое.
 *
 * Недействующие секции **не** отбрасываются молча до сравнения: снятая с
 * публикации секция сайта перекрывает секцию бренда и оставляет ссылку
 * незаполненной. Обратное поведение — тихий откат к чужому тексту, а на сайте
 * брокера подмена текста без ведома редактора хуже пустого места.
 */
export function resolveSections(args: {
  /** Цепочка от корня к листу: `[brandId, regionId, siteId]`. */
  readonly chainIds: readonly string[]
  readonly records: readonly SectionRecord[]
  readonly locale: string
}): Map<string, ResolvedSection> {
  const picked = pickNearest({
    chainIds: args.chainIds,
    items: args.records.filter((record) => record.locale === args.locale),
    keyOf: (record) => record.key,
    ownerOf: (record) => record.ownerId,
    isActive: (record) => record.isActive,
  })

  const resolved = new Map<string, ResolvedSection>()

  for (const [key, entry] of picked) {
    resolved.set(key, { ...entry.item, provenance: entry.provenance })
  }

  return resolved
}

export interface SectionIssue {
  readonly code: 'missing-key' | 'unknown-section' | 'cycle' | 'too-deep'
  readonly path: string
  readonly key: string | null
  readonly message: string
}

/**
 * Предел вложенности раскрытия секций.
 *
 * Секция внутри секции — законный случай (общий блок доверия внутри общего
 * подвала продукта). Третий уровень уже означает, что редактор не может
 * предсказать, что окажется на странице.
 */
export const MAX_SECTION_DEPTH = 2

export interface ExpansionResult {
  readonly blocks: unknown
  readonly issues: readonly SectionIssue[]
}

/**
 * Подставляет содержимое секций в дерево блоков.
 *
 * Раскрытие происходит **при сборке релиза**, а не при выдаче. Причина —
 * неизменяемость релиза (ADR-0021): если бы потребитель дотягивал секции при
 * каждом запросе, вчерашний релиз менялся бы от сегодняшней правки секции, и
 * «релиз» перестал бы что-либо обещать.
 *
 * Не бросает: дерево приходит из поля JSON, и одна битая ссылка не должна
 * лишать редактора отчёта об остальных.
 */
export function expandSections(
  blocks: unknown,
  sections: ReadonlyMap<string, ResolvedSection>,
): ExpansionResult {
  const issues: SectionIssue[] = []
  const expanded = expand(blocks, sections, issues, 'blocks', [])

  return { blocks: expanded, issues }
}

function expand(
  value: unknown,
  sections: ReadonlyMap<string, ResolvedSection>,
  issues: SectionIssue[],
  path: string,
  stack: readonly string[],
): unknown {
  if (!Array.isArray(value)) {
    return value
  }

  const result: unknown[] = []

  value.forEach((node, index) => {
    const nodePath = `${path}[${index}]`

    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      result.push(node)
      return
    }

    const record = node as Record<string, unknown>

    if (record.type !== 'section-ref') {
      result.push(expandSlots(record, sections, issues, nodePath, stack))
      return
    }

    const props = (record.props ?? {}) as Record<string, unknown>
    const key = typeof props.key === 'string' ? props.key.trim() : ''

    if (key === '') {
      issues.push({
        code: 'missing-key',
        path: nodePath,
        key: null,
        message: 'Ссылка на секцию без выбранной секции.',
      })
      return
    }

    if (stack.includes(key)) {
      /**
       * Секция, ссылающаяся на себя через цепочку, раскрывалась бы вечно.
       * Сообщаем и не подставляем ничего — страница выйдет короче, но выйдет.
       */
      issues.push({
        code: 'cycle',
        path: nodePath,
        key,
        message: `Секция «${key}» ссылается сама на себя: ${[...stack, key].join(' → ')}.`,
      })
      return
    }

    if (stack.length >= MAX_SECTION_DEPTH) {
      issues.push({
        code: 'too-deep',
        path: nodePath,
        key,
        message: `Вложенность секций глубже ${MAX_SECTION_DEPTH}: содержимое страницы становится непредсказуемым.`,
      })
      return
    }

    const section = sections.get(key)

    if (section === undefined) {
      /**
       * Ссылка на несуществующую или снятую секцию — это дыра в странице.
       * Она обязана быть видна при сборке: молча выпавшая секция «Риски» —
       * это уже не косметика.
       */
      issues.push({
        code: 'unknown-section',
        path: nodePath,
        key,
        message: `Секция «${key}» не найдена: удалена, отключена или заведена на другом языке.`,
      })
      return
    }

    const inner = expand(section.blocks, sections, issues, `${nodePath}<${key}>`, [...stack, key])

    if (Array.isArray(inner)) {
      result.push(...inner)
    }
  })

  return result
}

/**
 * Раскрывает секции внутри слотов вложенности.
 *
 * Иначе ссылку достаточно было бы положить в колонку, чтобы она осталась
 * нераскрытой и уехала в выдачу как непонятный потребителю узел.
 */
function expandSlots(
  node: Record<string, unknown>,
  sections: ReadonlyMap<string, ResolvedSection>,
  issues: SectionIssue[],
  path: string,
  stack: readonly string[],
): Record<string, unknown> {
  const slots = node.slots

  if (slots === null || typeof slots !== 'object' || Array.isArray(slots)) {
    return node
  }

  const nextSlots: Record<string, unknown> = {}

  for (const [slot, children] of Object.entries(slots as Record<string, unknown>)) {
    nextSlots[slot] = expand(children, sections, issues, `${path}.slots.${slot}`, stack)
  }

  return { ...node, slots: nextSlots }
}
