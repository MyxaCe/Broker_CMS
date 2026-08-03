/**
 * Скоупы ключей доставки (ТЗ разд. 6).
 *
 * Ключ сайта не должен уметь читать предпросмотр, а ключ предпросмотра —
 * ходить в терминальные конфигурации. Скоуп — это не украшение, а граница:
 * утёкший ключ одного потребителя не должен открывать данные другого.
 */

export const DELIVERY_SCOPES = [
  /** Опубликованная выдача: то, что отдаётся конечному пользователю. */
  'delivery:read',
  /** Черновое состояние по preview-токену. Отдельно, потому что это другой уровень доверия. */
  'preview:read',
  /** Конфигурация терминала и вселенная инструментов. */
  'terminal:read',
] as const

export type DeliveryScope = (typeof DELIVERY_SCOPES)[number]

export const SCOPE_LABELS: Record<DeliveryScope, string> = {
  'delivery:read': 'Чтение опубликованной выдачи',
  'preview:read': 'Чтение предпросмотра',
  'terminal:read': 'Чтение конфигурации терминала',
}

export function isDeliveryScope(value: string): value is DeliveryScope {
  return (DELIVERY_SCOPES as readonly string[]).includes(value)
}

/**
 * Есть ли у ключа требуемый скоуп.
 *
 * Расширяющих скоупов вроде «все» намеренно нет: такой скоуп немедленно
 * оказывается у всех ключей, и разграничение исчезает, оставаясь на бумаге.
 */
export function hasScope(granted: readonly string[], required: DeliveryScope): boolean {
  return granted.includes(required)
}

export function normalizeScopes(value: unknown): DeliveryScope[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<DeliveryScope>()

  for (const entry of value) {
    const scope = typeof entry === 'string' ? entry : String((entry as { scope?: unknown })?.scope)
    if (isDeliveryScope(scope)) {
      seen.add(scope)
    }
  }

  return [...seen]
}
