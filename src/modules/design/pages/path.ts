/**
 * Пути страниц (ТЗ 2.3).
 *
 * `path` уникален в пределах пары «сайт + локаль», а смена пути обязана
 * оставить след в истории — из неё собирается 301.
 *
 * Нормализация нужна до сравнения: `/about`, `/about/` и `/About` — это один
 * адрес для человека и три разных для базы. Без приведения к одному виду
 * уникальность не работает, а редиректы ведут в никуда.
 */

/**
 * Начинается с косой черты, дальше сегменты из строчных букв, цифр и дефисов.
 * Без завершающей черты, без параметров, без якоря — они не часть адреса
 * страницы.
 */
export const PATH_PATTERN = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/

/** Корень сайта. Отдельная константа, потому что общий шаблон его допускает. */
export const ROOT_PATH = '/'

export function normalizePath(raw: string): string {
  const trimmed = raw.trim().toLowerCase()

  if (trimmed === '' || trimmed === ROOT_PATH) {
    return ROOT_PATH
  }

  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`

  /**
   * Завершающая черта убирается, повторяющиеся схлопываются. `//about//us/`
   * и `/about/us` — один адрес, и хранить их по-разному значит завести два
   * разных ответа на один запрос.
   */
  const collapsed = withLeading.replace(/\/{2,}/g, '/').replace(/\/+$/, '')

  return collapsed === '' ? ROOT_PATH : collapsed
}

export function isValidPath(raw: string): boolean {
  return PATH_PATTERN.test(normalizePath(raw))
}

export interface RedirectRule {
  readonly from: string
  readonly to: string
  readonly status: 301 | 302 | 410
}

export interface RedirectIssue {
  readonly code: 'cycle' | 'self' | 'duplicate' | 'unknown-target'
  readonly from: string
  readonly message: string
}

/**
 * Проверяет набор редиректов на циклы (ТЗ 2.3).
 *
 * Цикл — не теоретическая опасность: он возникает сам собой, когда страницу
 * переименовали дважды и вернули прежнее имя. Браузер в цикле показывает
 * ошибку, а поисковый робот исключает адрес из индекса.
 */
export function findRedirectIssues(
  rules: readonly RedirectRule[],
  knownPaths: ReadonlySet<string> = new Set(),
): RedirectIssue[] {
  const issues: RedirectIssue[] = []
  const byFrom = new Map<string, RedirectRule>()

  for (const rule of rules) {
    const from = normalizePath(rule.from)
    const to = normalizePath(rule.to)

    /**
     * У 410 цели нет по смыслу: «удалено навсегда» — это не переход. Поле
     * `to` у него игнорируется целиком, включая совпадение с `from`, иначе
     * запись про удалённую страницу выглядела бы как ошибка.
     */
    if (rule.status !== 410 && from === to) {
      issues.push({
        code: 'self',
        from,
        message: `Редирект «${from}» указывает сам на себя.`,
      })
      continue
    }

    if (byFrom.has(from)) {
      issues.push({
        code: 'duplicate',
        from,
        message: `Для «${from}» задано больше одного редиректа — какой сработает, зависит от порядка чтения.`,
      })
      continue
    }

    byFrom.set(from, { ...rule, from, to })
  }

  for (const rule of byFrom.values()) {
    /** 410 — «удалено навсегда», цели у него нет по смыслу. */
    if (rule.status === 410) {
      continue
    }

    const visited = new Set<string>([rule.from])
    let current = rule.to

    for (;;) {
      if (visited.has(current)) {
        issues.push({
          code: 'cycle',
          from: rule.from,
          message: `Цепочка редиректов от «${rule.from}» зацикливается на «${current}».`,
        })
        break
      }

      visited.add(current)
      const next = byFrom.get(current)

      if (next === undefined) {
        /**
         * Конец цепочки. Цель обязана существовать: редирект в никуда — это
         * `404` после лишнего перехода, что хуже честного `404` сразу.
         */
        if (knownPaths.size > 0 && !knownPaths.has(current)) {
          issues.push({
            code: 'unknown-target',
            from: rule.from,
            message: `Редирект ведёт на «${current}», которого нет среди страниц сайта.`,
          })
        }

        break
      }

      current = next.to
    }
  }

  return issues
}
