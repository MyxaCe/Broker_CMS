/**
 * Выбор страницы для пункта меню ([[DEBT-011]], ADR-0034).
 *
 * ТЗ 2.2: «выбор страницы из списка, а не ввод идентификатора». Разница не в
 * удобстве. Введённый руками идентификатор не знает, существует ли страница,
 * на какой она локали и чей это сайт, — и всё это выясняется при сборке
 * релиза, через неделю после правки меню.
 */

export interface TenantRow {
  readonly id: string
  readonly name: string
  readonly kind: 'brand' | 'region' | 'site'
  readonly parentId: string | null
}

export interface PageOption {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly siteId: string
  readonly status: string
}

function relationId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id)
  }

  return String(value)
}

export function tenantRows(body: unknown): TenantRow[] {
  const docs = (body as { docs?: unknown } | null)?.docs

  if (!Array.isArray(docs)) {
    return []
  }

  return docs.flatMap((doc) => {
    if (doc === null || typeof doc !== 'object') {
      return []
    }

    const record = doc as Record<string, unknown>
    const kind = record.kind

    if (kind !== 'brand' && kind !== 'region' && kind !== 'site') {
      return []
    }

    return [
      {
        id: String(record.id),
        name: typeof record.name === 'string' ? record.name : String(record.id),
        kind,
        parentId: relationId(record.parent),
      },
    ]
  })
}

/**
 * Сайты, на которых действует меню этого владельца.
 *
 * Меню бренда действует на всех его сайтах, поэтому и страницы предлагаются
 * со всех. Это **не** значит, что ссылка на страницу одного сайта правильна
 * в меню бренда: идентификатор страницы принадлежит сайту, и на соседнем
 * сайте он не разрешится. Предупредить об этом обязан интерфейс — см.
 * `warnAboutForeignPages`.
 */
export function siteIdsUnder(rows: readonly TenantRow[], ownerId: string): string[] {
  const byParent = new Map<string, TenantRow[]>()

  for (const row of rows) {
    const key = row.parentId ?? ''
    byParent.set(key, [...(byParent.get(key) ?? []), row])
  }

  const found: string[] = []
  const queue = rows.filter((row) => row.id === ownerId)
  const seen = new Set<string>()

  while (queue.length > 0) {
    const row = queue.shift()

    if (row === undefined || seen.has(row.id)) {
      continue
    }

    seen.add(row.id)

    if (row.kind === 'site') {
      found.push(row.id)
    }

    queue.push(...(byParent.get(row.id) ?? []))
  }

  return found
}

/**
 * Предупреждать ли о том, что выбор страницы в этом меню рискован.
 *
 * Меню, действующее больше чем на одном сайте, не может ссылаться на
 * страницу: идентификатор принадлежит сайту. Молчать об этом нельзя —
 * редактор соберёт меню бренда из страниц одного сайта, и на остальных
 * пункты просто исчезнут (`resolveNavTree` выбрасывает неразрешённые).
 */
export function warnAboutForeignPages(siteIds: readonly string[]): string | null {
  if (siteIds.length <= 1) {
    return null
  }

  return `Это меню действует на сайтах: ${siteIds.length}. Ссылка на страницу принадлежит одному сайту — на остальных такой пункт в меню не появится. Для общих пунктов используйте внешний адрес или заведите меню у сайта.`
}

export function pageOptions(body: unknown): PageOption[] {
  const docs = (body as { docs?: unknown } | null)?.docs

  if (!Array.isArray(docs)) {
    return []
  }

  return docs
    .flatMap((doc) => {
      if (doc === null || typeof doc !== 'object') {
        return []
      }

      const record = doc as Record<string, unknown>
      const site = relationId(record.site)

      return [
        {
          id: String(record.id),
          path: typeof record.path === 'string' ? record.path : '',
          title: typeof record.title === 'string' ? record.title : '',
          siteId: site ?? '',
          status: typeof record.status === 'string' ? record.status : 'draft',
        },
      ]
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Что сейчас выбрано в пункте.
 *
 * `unresolved` отделён от `empty` по той же причине, что и у файла из
 * медиатеки: страницу могли удалить или снять с публикации, и тогда пункт
 * указывает в никуда. Сборка релиза назовёт это `dangling-page`, но узнать
 * об этом в момент правки меню дешевле.
 */
export type PageChoice =
  | { readonly kind: 'empty' }
  /**
   * Список страниц ещё не прочитан. Отдельное состояние, а не «страницы
   * нет»: пока список пуст, **любой** выбор выглядел бы удалённой страницей,
   * и редактор начал бы чинить то, что не сломано. Тот же класс, что
   * «медиатека не ответила» у выбора файла.
   */
  | { readonly kind: 'unknown'; readonly id: string }
  | { readonly kind: 'resolved'; readonly option: PageOption; readonly note: string | null }
  | { readonly kind: 'unresolved'; readonly id: string; readonly note: string }

export function describePageChoice(
  pageId: unknown,
  /** `null` — список ещё не прочитан. Пустой массив — прочитан и пуст. */
  options: readonly PageOption[] | null,
): PageChoice {
  const id = pageId === null || pageId === undefined ? '' : String(pageId).trim()

  if (id === '') {
    return { kind: 'empty' }
  }

  if (options === null) {
    return { kind: 'unknown', id }
  }

  const option = options.find((item) => item.id === id)

  if (option === undefined) {
    return {
      kind: 'unresolved',
      id,
      note: `Выбрана страница #${id}, которой нет среди страниц этой локали: она удалена, в черновике или на другом языке. В меню такого пункта не будет — сборка релиза назовёт это расхождением.`,
    }
  }

  return {
    kind: 'resolved',
    option,
    /**
     * Черновик — не ошибка: редактор вправе собрать меню раньше страниц. Но
     * пункт на черновик в меню не попадёт, и знать об этом надо сейчас.
     */
    note:
      option.status === 'published'
        ? null
        : 'Страница в черновике: до публикации пункт в меню не появится.',
  }
}

/** Подпись страницы в списке: путь важнее заголовка — по нему её узнают. */
export function describeOption(option: PageOption): string {
  return option.title === '' ? option.path : `${option.path} — ${option.title}`
}
