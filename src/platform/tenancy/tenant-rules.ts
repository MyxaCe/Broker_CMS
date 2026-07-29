import type { TenantKind } from './types'

/**
 * Правила целостности карточки тенанта.
 *
 * Вынесены из коллекции Payload намеренно: правило, живущее внутри хука, можно
 * проверить только подняв приложение и базу. Здесь это чистая функция, у
 * которой есть тесты на каждый случай, включая те, что в жизни встречаются
 * раз в год.
 */

export interface TenantDraft {
  readonly kind: TenantKind
  readonly slug: string
  readonly parentId: string | null
  readonly jurisdiction: string | null
  readonly locales: readonly string[]
  readonly defaultLocale: string | null
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

  /**
   * ADR-0003, правило 2: юрисдикция сайта — обязательное поле, fail-closed.
   * Сайт без юрисдикции не может собрать релиз, поэтому запрещаем сохранить его
   * в таком виде, а не обнаруживаем проблему на публикации.
   *
   * Для бренда и региона юрисдикция необязательна: они не отдаются наружу,
   * а служат слоями наследования.
   */
  if (draft.kind === 'site' && (draft.jurisdiction === null || draft.jurisdiction.trim() === '')) {
    issues.push(
      'jurisdiction: обязательна для сайта — без неё невозможно определить обязательные предупреждения и запрещённые продукты',
    )
  }

  if (draft.kind === 'site' && draft.locales.length === 0) {
    issues.push('locales: у сайта должна быть хотя бы одна локаль')
  }

  if (draft.defaultLocale !== null && !draft.locales.includes(draft.defaultLocale)) {
    issues.push(`defaultLocale: "${draft.defaultLocale}" отсутствует в списке локалей тенанта`)
  }

  if (draft.locales.length > 0 && draft.defaultLocale === null && draft.kind === 'site') {
    issues.push('defaultLocale: обязательна, если у сайта заданы локали')
  }

  const duplicates = findDuplicates(draft.locales)
  if (duplicates.length > 0) {
    issues.push(`locales: повторяются значения — ${duplicates.join(', ')}`)
  }

  return issues
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    }
    seen.add(value)
  }

  return [...duplicates]
}
