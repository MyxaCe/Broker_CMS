/**
 * Извлекает тенанта из документа для журнала аудита.
 *
 * Связь приходит либо развёрнутой, либо одним идентификатором — в зависимости
 * от глубины выборки. Обе формы обязаны давать один и тот же результат: запись
 * аудита не должна зависеть от того, как был прочитан документ.
 */
export function tenantOfField(
  doc: Record<string, unknown>,
  field: string,
): { id: string | null; slug: string | null } {
  const value = doc[field]

  if (value !== null && typeof value === 'object' && 'id' in value) {
    const record = value as Record<string, unknown>

    return {
      id: record.id === undefined || record.id === null ? null : String(record.id),
      slug: typeof record.slug === 'string' ? record.slug : null,
    }
  }

  return { id: value === undefined || value === null ? null : String(value), slug: null }
}

/** Сущности потока принадлежат сайту. */
export function siteOf(doc: Record<string, unknown>): { id: string | null; slug: string | null } {
  return tenantOfField(doc, 'site')
}

/** Таксономии и медиа принадлежат произвольному узлу дерева. */
export function ownerOf(doc: Record<string, unknown>): { id: string | null; slug: string | null } {
  return tenantOfField(doc, 'owner')
}
