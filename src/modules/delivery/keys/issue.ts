import { authorizeDeliveryRequest } from './authorize'
import { generateKey, parseKey } from './key-format'

import type { AuthDecision, StoredKey } from './authorize'
import type { DeliveryScope } from './scopes'
import type { Payload, PayloadRequest } from 'payload'

/**
 * Выдача и проверка ключей доставки.
 *
 * Разделено с чистой логикой намеренно: здесь только обращения к БД, всё
 * остальное — в `authorize.ts` и `key-format.ts`, где проверяется тестами
 * без базы.
 */

export interface IssuedKey {
  readonly id: number | string
  readonly keyId: string
  /**
   * Показывается вызывающему ровно один раз. Ни в базу, ни в журнал не
   * попадает: восстановить ключ потом невозможно, и это свойство, а не
   * неудобство.
   */
  readonly plaintext: string
}

export async function issueDeliveryKey(args: {
  readonly payload: Payload
  readonly pepper: string
  readonly name: string
  readonly scopes: readonly DeliveryScope[]
  readonly siteIds: readonly (number | string)[]
  readonly expiresAt?: Date | null
  readonly req?: PayloadRequest
}): Promise<IssuedKey> {
  const generated = generateKey(args.pepper)

  const created = await args.payload.create({
    collection: 'delivery-keys',
    overrideAccess: true,
    ...(args.req ? { req: args.req } : {}),
    data: {
      name: args.name,
      keyId: generated.keyId,
      secretHash: generated.secretHash,
      scopes: [...args.scopes],
      sites: [...args.siteIds],
      isActive: true,
      expiresAt: args.expiresAt ? args.expiresAt.toISOString() : null,
    } as never,
  })

  return { id: created.id, keyId: generated.keyId, plaintext: generated.plaintext }
}

function toStoredKey(doc: Record<string, unknown>): StoredKey {
  const sites = Array.isArray(doc.sites) ? doc.sites : []

  return {
    keyId: String(doc.keyId),
    secretHash: String(doc.secretHash),
    scopes: Array.isArray(doc.scopes) ? doc.scopes.map(String) : [],
    siteIds: sites
      .map((site) =>
        site !== null && typeof site === 'object' && 'id' in site
          ? String((site as { id: unknown }).id)
          : String(site),
      )
      .filter((id) => id !== '' && id !== 'null'),
    isActive: doc.isActive === true,
    expiresAt: typeof doc.expiresAt === 'string' ? new Date(doc.expiresAt) : null,
  }
}

/**
 * Находит ключ по открытой части и проверяет его.
 *
 * Поиск идёт по индексированному идентификатору, а не перебором таблицы:
 * перебор с проверкой секрета на каждой записи — это и медленно, и наблюдаемо
 * по времени ответа.
 */
export async function verifyDeliveryKey(args: {
  readonly payload: Payload
  readonly pepper: string
  readonly authorizationHeader: string | null
  readonly requiredScope: DeliveryScope
  readonly siteId: string
  readonly now?: Date
}): Promise<AuthDecision> {
  const presented = args.authorizationHeader
  const parsed = presented === null ? null : parseKey(presented.replace(/^Bearer\s+/i, ''))

  let stored: StoredKey | null = null

  if (parsed !== null) {
    const found = await args.payload.find({
      collection: 'delivery-keys',
      where: { keyId: { equals: parsed.keyId } },
      limit: 1,
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })

    const doc = found.docs[0] as unknown as Record<string, unknown> | undefined
    stored = doc ? toStoredKey(doc) : null
  }

  return authorizeDeliveryRequest({
    authorizationHeader: args.authorizationHeader,
    stored,
    requiredScope: args.requiredScope,
    siteId: args.siteId,
    pepper: args.pepper,
    ...(args.now ? { now: args.now } : {}),
  })
}
