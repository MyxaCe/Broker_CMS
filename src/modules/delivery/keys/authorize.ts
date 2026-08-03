import { extractBearer, parseKey, secretMatches } from './key-format'
import { hasScope, normalizeScopes } from './scopes'

import type { DeliveryScope } from './scopes'

/**
 * Проверка ключа доставки (ТЗ разд. 6, fail-closed).
 *
 * Чистая функция: запись ключа передаётся снаружи, поиск в БД — забота
 * вызывающего. Так всё дерево отказов проверяется тестами без базы.
 */

export interface StoredKey {
  readonly keyId: string
  readonly secretHash: string
  readonly scopes: readonly string[]
  /** Пустой список означает «ключ ни к какому сайту не привязан» и ведёт к отказу. */
  readonly siteIds: readonly string[]
  readonly isActive: boolean
  readonly expiresAt: Date | null
}

export type AuthDecision =
  | { readonly kind: 'allow'; readonly keyId: string; readonly siteIds: readonly string[] }
  | { readonly kind: 'deny'; readonly reason: DenyReason }

/**
 * Причина отказа нужна для журнала и метрик, но **не для ответа наружу**:
 * снаружи все отказы выглядят одинаково, иначе по ним подбирают ключ.
 */
export type DenyReason =
  | 'missing-header'
  | 'malformed-key'
  | 'unknown-key'
  | 'bad-secret'
  | 'inactive'
  | 'expired'
  | 'no-site-binding'
  | 'missing-scope'
  | 'site-not-allowed'

export interface AuthorizeArgs {
  readonly authorizationHeader: string | null
  /** Запись, найденная по открытой части ключа. `null` — ключ не найден. */
  readonly stored: StoredKey | null
  readonly requiredScope: DeliveryScope
  /** Сайт, к которому идёт обращение. */
  readonly siteId: string
  readonly pepper: string
  readonly now?: Date
}

/**
 * Порядок проверок значим: сначала форма, затем существование, затем секрет,
 * и только потом состояние и права. Проверять права до секрета — значит
 * отвечать по-разному на верный и неверный ключ.
 */
export function authorizeDeliveryRequest(args: AuthorizeArgs): AuthDecision {
  const presented = extractBearer(args.authorizationHeader)

  if (presented === null) {
    return { kind: 'deny', reason: 'missing-header' }
  }

  const parsed = parseKey(presented)

  if (parsed === null) {
    return { kind: 'deny', reason: 'malformed-key' }
  }

  if (args.stored === null) {
    return { kind: 'deny', reason: 'unknown-key' }
  }

  if (!secretMatches(parsed.secret, args.stored.secretHash, args.pepper)) {
    return { kind: 'deny', reason: 'bad-secret' }
  }

  if (!args.stored.isActive) {
    return { kind: 'deny', reason: 'inactive' }
  }

  const now = args.now ?? new Date()

  if (args.stored.expiresAt !== null && args.stored.expiresAt.getTime() <= now.getTime()) {
    return { kind: 'deny', reason: 'expired' }
  }

  /**
   * Пустая привязка — отказ, а не доступ ко всему. Та же ошибка, что и в
   * правилах доступа к данным: пустой список фильтров читается как «фильтров
   * нет» (ADR-0012).
   */
  if (args.stored.siteIds.length === 0) {
    return { kind: 'deny', reason: 'no-site-binding' }
  }

  if (!hasScope(normalizeScopes(args.stored.scopes), args.requiredScope)) {
    return { kind: 'deny', reason: 'missing-scope' }
  }

  if (!args.stored.siteIds.includes(args.siteId)) {
    return { kind: 'deny', reason: 'site-not-allowed' }
  }

  return { kind: 'allow', keyId: args.stored.keyId, siteIds: [...args.stored.siteIds] }
}
