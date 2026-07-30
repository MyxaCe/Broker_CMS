/**
 * Payload отдаёт связь либо идентификатором, либо развёрнутым документом —
 * в зависимости от глубины выборки. Правила доступа не должны зависеть от того,
 * какую глубину запросил вызывающий код.
 */
export function normalizeRelationId(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }

  if (value !== null && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') {
      return String(id)
    }
  }

  return null
}

export function normalizeRelationIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(normalizeRelationId)
    .filter((id): id is string => id !== null && id.trim() !== '')
}
