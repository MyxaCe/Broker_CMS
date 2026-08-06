import { normalizePath } from '../pages/path'

/**
 * Навигация (ТЗ 2.2).
 *
 * > «Навигация — отдельная древовидная структура со своим редактором, а не
 * > массив ссылок»
 *
 * Разница не в форме хранения. Массив ссылок означает, что пункт меню — это
 * строка с адресом: она не знает, существует ли страница, куда ведёт, и
 * переживает её удаление. Дерево со ссылкой на страницу знает — и ломается
 * заметно, а не молча.
 */

/** Куда ведёт пункт меню. */
export const NAV_TARGETS = ['page', 'external', 'none'] as const

export type NavTarget = (typeof NAV_TARGETS)[number]

export const NAV_TARGET_LABELS: Record<NavTarget, string> = {
  page: 'Страница сайта',
  external: 'Внешний адрес',
  /** Заголовок раздела в мега-меню: сам никуда не ведёт, но группирует. */
  none: 'Только заголовок',
}

export interface NavNode {
  readonly label?: unknown
  readonly target?: unknown
  /** Идентификатор страницы для `page`. */
  readonly pageId?: unknown
  /** Адрес для `external`. */
  readonly href?: unknown
  readonly children?: unknown
  readonly jurisdictions?: unknown
  readonly openInNewTab?: unknown
}

export interface NavIssue {
  readonly code:
    | 'malformed'
    | 'missing-label'
    | 'unknown-target'
    | 'missing-page'
    | 'dangling-page'
    | 'missing-href'
    | 'insecure-href'
    | 'too-deep'
    | 'empty-group'
    | 'cycle'
  readonly path: string
  readonly message: string
}

/**
 * Предел вложенности меню.
 *
 * Три уровня — это раздел → подраздел → пункт, то есть предел мега-меню.
 * Глубже человек не находит нужное: он либо уходит, либо ищет поиском.
 */
export const MAX_NAV_DEPTH = 3

export interface NavContext {
  /** Идентификаторы существующих опубликованных страниц сайта. */
  readonly knownPages: ReadonlySet<string>
}

/**
 * Проверяет дерево навигации.
 *
 * Как и дерево блоков, не бросает: структура приходит из поля JSON. Собирает
 * все расхождения — меню правят целиком, и чинить по одному за прогон дорого.
 */
export function validateNavTree(nodes: unknown, context: NavContext): NavIssue[] {
  const issues: NavIssue[] = []
  const seen = new Set<object>()

  walk(nodes, 'nav', 1, issues, context, seen)

  return issues
}

function walk(
  value: unknown,
  path: string,
  depth: number,
  issues: NavIssue[],
  context: NavContext,
  seen: Set<object>,
): void {
  if (value === null || value === undefined) {
    return
  }

  if (!Array.isArray(value)) {
    issues.push({ code: 'malformed', path, message: 'Ожидался список пунктов меню.' })
    return
  }

  if (depth > MAX_NAV_DEPTH) {
    issues.push({
      code: 'too-deep',
      path,
      message: `Вложенность меню глубже ${MAX_NAV_DEPTH} уровней: на такой глубине пункт уже не находят.`,
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
  issues: NavIssue[],
  context: NavContext,
  seen: Set<object>,
): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    issues.push({ code: 'malformed', path, message: 'Пункт меню должен быть объектом.' })
    return
  }

  if (seen.has(node as object)) {
    issues.push({ code: 'cycle', path, message: 'Циклическая ссылка в дереве навигации.' })
    return
  }

  seen.add(node as object)

  const item = node as NavNode
  const label = typeof item.label === 'string' ? item.label.trim() : ''

  if (label === '') {
    issues.push({
      code: 'missing-label',
      path,
      message: 'У пункта меню нет подписи — в меню он будет пустым местом.',
    })
  }

  const target = typeof item.target === 'string' ? item.target : ''

  if (!(NAV_TARGETS as readonly string[]).includes(target)) {
    issues.push({
      code: 'unknown-target',
      path,
      message: `Недопустимое назначение «${target}». Разрешены: ${NAV_TARGETS.join(', ')}.`,
    })
  }

  if (target === 'page') {
    const pageId = item.pageId === null || item.pageId === undefined ? '' : String(item.pageId)

    if (pageId === '') {
      issues.push({
        code: 'missing-page',
        path,
        message: 'Пункт ведёт на страницу, но страница не выбрана.',
      })
    } else if (context.knownPages.size > 0 && !context.knownPages.has(pageId)) {
      /**
       * Ради этого навигация и хранит ссылку, а не адрес: удалённая или
       * снятая с публикации страница ломает меню **заметно**, а не молча
       * ведёт в `404`.
       */
      issues.push({
        code: 'dangling-page',
        path,
        message:
          'Пункт ведёт на страницу, которой нет среди опубликованных: она удалена, в черновике или на другом языке.',
      })
    }
  }

  if (target === 'external') {
    const href = typeof item.href === 'string' ? item.href.trim() : ''

    if (href === '') {
      issues.push({ code: 'missing-href', path, message: 'Не указан внешний адрес.' })
    } else if (!/^https:\/\//.test(href)) {
      /**
       * Только `https`. Ссылка по `http` с сайта брокера — это смешанное
       * содержимое и предупреждение браузера ровно там, где человек решает,
       * доверять ли деньгам.
       */
      issues.push({
        code: 'insecure-href',
        path,
        message: `Внешний адрес «${href}» не по https.`,
      })
    }
  }

  const children = item.children

  if (target === 'none' && (!Array.isArray(children) || children.length === 0)) {
    /**
     * Заголовок без вложенных пунктов — это подпись, на которую нельзя
     * нажать и под которой ничего нет. Читатель считает её сломанной.
     */
    issues.push({
      code: 'empty-group',
      path,
      message: 'Заголовок раздела без вложенных пунктов: нажать нельзя, показывать нечего.',
    })
  }

  if (children !== null && children !== undefined) {
    walk(children, `${path}.children`, depth + 1, issues, context, seen)
  }
}

export interface ResolvedNavItem {
  readonly label: string
  readonly url: string | null
  readonly openInNewTab: boolean
  readonly children: readonly ResolvedNavItem[]
}

/**
 * Разворачивает дерево в готовые пункты для выдачи.
 *
 * Ссылки на страницы превращаются в адреса **здесь**, а не у потребителя:
 * иначе каждый потребитель повторял бы правила построения адреса, и они
 * немедленно разошлись бы.
 *
 * Пункт с недоступной страницей **исключается**, а не отдаётся без адреса:
 * пустая ссылка в меню — это тупик, а отсутствующий пункт хотя бы честен.
 * О самом расхождении сообщает проверка при сборке релиза.
 */
export function resolveNavTree(
  nodes: unknown,
  pagePaths: ReadonlyMap<string, string>,
): ResolvedNavItem[] {
  if (!Array.isArray(nodes)) {
    return []
  }

  const resolved: ResolvedNavItem[] = []

  for (const node of nodes) {
    if (node === null || typeof node !== 'object') {
      continue
    }

    const item = node as NavNode
    const label = typeof item.label === 'string' ? item.label.trim() : ''

    if (label === '') {
      continue
    }

    const children = resolveNavTree(item.children, pagePaths)
    const url = urlOf(item, pagePaths)

    /** Пункт без адреса и без потомков показывать нечем. */
    if (url === null && children.length === 0) {
      continue
    }

    resolved.push({
      label,
      url,
      openInNewTab: item.openInNewTab === true,
      children,
    })
  }

  return resolved
}

function urlOf(item: NavNode, pagePaths: ReadonlyMap<string, string>): string | null {
  if (item.target === 'external') {
    return typeof item.href === 'string' && item.href.trim() !== '' ? item.href.trim() : null
  }

  if (item.target === 'page') {
    const pageId = item.pageId === null || item.pageId === undefined ? '' : String(item.pageId)
    const path = pagePaths.get(pageId)

    return path === undefined ? null : normalizePath(path)
  }

  return null
}
