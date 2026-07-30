import { computeChanges, summarizeChanges } from './changes'

import type { AuditActor, AuditEventInput } from './types'
import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  Payload,
  PayloadRequest,
} from 'payload'

/**
 * Запись событий в журнал аудита.
 *
 * Запись идёт с `overrideAccess: true` и с передачей `req`: первое — потому что
 * коллекция закрыта на запись снаружи, второе — чтобы событие попало в ту же
 * транзакцию, что и само изменение. Иначе возможен разрыв: изменение
 * откатилось, а запись о нём осталась, или наоборот.
 */

export function actorFrom(user: unknown): AuditActor {
  if (user === null || typeof user !== 'object') {
    return { id: null, email: null, role: null }
  }

  const record = user as Record<string, unknown>

  return {
    id: record.id === undefined || record.id === null ? null : String(record.id),
    email: typeof record.email === 'string' ? record.email : null,
    role: typeof record.role === 'string' ? record.role : null,
  }
}

export async function recordAuditEvent(
  payload: Payload,
  event: AuditEventInput,
  req?: PayloadRequest,
): Promise<void> {
  await payload.create({
    collection: 'audit-events',
    overrideAccess: true,
    ...(req ? { req } : {}),
    data: {
      occurredAt: new Date().toISOString(),
      action: event.action,
      targetCollection: event.targetCollection,
      targetId: event.targetId,
      tenantId: event.tenantId,
      tenantSlug: event.tenantSlug,
      actorId: event.actor.id,
      actorEmail: event.actor.email,
      actorRole: event.actor.role,
      summary: event.summary,
      changes: event.changes,
      requestId: event.requestId,
    } as never,
  })
}

export interface AuditHookOptions {
  /**
   * Какому тенанту принадлежит запись. Возвращает `null`, если событие
   * не относится ни к одному — такие видны только кросс-тенантным ролям.
   */
  readonly tenantOf: (doc: Record<string, unknown>) => {
    id: string | null
    slug: string | null
  }
}

function requestIdOf(req: PayloadRequest): string | null {
  const headers = req.headers
  return headers?.get?.('x-request-id') ?? null
}

/**
 * Хуки для коллекции, изменения которой попадают в журнал.
 *
 * Подключаются явно в каждой коллекции, а не «оборачиванием»: явная строка в
 * описании коллекции видна на ревью, а забытая обёртка — нет.
 */
export function auditHooks(options: AuditHookOptions): {
  afterChange: CollectionAfterChangeHook
  afterDelete: CollectionAfterDeleteHook
} {
  const afterChange: CollectionAfterChangeHook = async ({
    collection,
    doc,
    operation,
    previousDoc,
    req,
  }) => {
    const after = doc as unknown as Record<string, unknown>
    const before =
      operation === 'create' ? null : ((previousDoc as unknown as Record<string, unknown>) ?? null)

    const changes = computeChanges(before, after)

    /**
     * Изменение без содержательных отличий не записывается: сохранение формы
     * без правок иначе засоряет журнал, и существенное в нём теряется.
     */
    if (operation === 'update' && changes.length === 0) {
      return doc
    }

    await recordAuditEvent(
      req.payload,
      {
        action: operation === 'create' ? 'create' : 'update',
        targetCollection: collection.slug,
        targetId: after.id === undefined || after.id === null ? null : String(after.id),
        tenantId: options.tenantOf(after).id,
        tenantSlug: options.tenantOf(after).slug,
        actor: actorFrom(req.user),
        summary: summarizeChanges(changes),
        changes,
        requestId: requestIdOf(req),
      },
      req,
    )

    return doc
  }

  const afterDelete: CollectionAfterDeleteHook = async ({ collection, doc, id, req }) => {
    const removed = doc as unknown as Record<string, unknown>

    await recordAuditEvent(
      req.payload,
      {
        action: 'delete',
        targetCollection: collection.slug,
        targetId: String(id),
        tenantId: options.tenantOf(removed).id,
        tenantSlug: options.tenantOf(removed).slug,
        actor: actorFrom(req.user),
        summary: `удалено: ${String(removed.slug ?? removed.email ?? id)}`,
        changes: computeChanges(removed, {}),
        requestId: requestIdOf(req),
      },
      req,
    )

    return doc
  }

  return { afterChange, afterDelete }
}
