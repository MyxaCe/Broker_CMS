import type { TenantKind } from './types'

/**
 * Правила целостности карточки тенанта — только те, что проверяются **по
 * одному документу**.
 *
 * Всё, что зависит от цепочки (юрисдикция, локали), проверяется по
 * РАЗРЕШЁННОМУ значению в `validateResolvedSettings`: сайт вправе не задавать
 * их у себя, если они приходят сверху. Требовать локальное значение означало бы
 * отменить наследование ровно для тех полей, ради которых оно и нужно.
 */

export interface TenantDraft {
  readonly kind: TenantKind
  readonly slug: string
  readonly parentId: string | null
}

/** Идентификатор в URL и в ключе кеша: латиница, цифры, дефис. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validateTenantDraft(draft: TenantDraft): string[] {
  const issues: string[] = []

  if (draft.slug.trim() === '') {
    issues.push('slug: обязателен')
  } else if (!SLUG_PATTERN.test(draft.slug)) {
    issues.push(
      'slug: допустимы только строчные латинские буквы, цифры и дефис — значение попадает в URL и в ключ кеша',
    )
  }

  if (draft.kind === 'brand') {
    if (draft.parentId !== null) {
      issues.push('parent: бренд является корнем цепочки и не может иметь родителя')
    }
  } else if (draft.parentId === null) {
    issues.push(`parent: обязателен для уровня "${draft.kind}"`)
  }

  return issues
}
